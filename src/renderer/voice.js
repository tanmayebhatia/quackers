// Quackers voice — live speech session over WebRTC.
// The OpenAI key stays in the main process; this file only ever sees a
// short-lived session secret's SDP answer.

let pc = null;
let dc = null;
let teachStartIndex = -1; // transcript index when a trick lesson began
let micStream = null;
let micTrack = null;
let micSender = null; // the RTP sender carrying the mic — muted to the server via replaceTrack, NOT track.enabled, so the local barge-in analyser keeps hearing
let audioEl = null;
let audioCtx = null;
let analyser = null;
let levelRaf = null;
let active = false;
let connecting = false;
let pendingEnd = false;
let transcript = [];
let redialUsed = false; // one automatic reconnect per user-started session
let dropTimer = null; // grace window before treating an ICE 'disconnected' as a real drop

// --- Barge-in / turn-taking state ---------------------------------------
// The duck no longer goes deaf while it talks. The mic stays live so a local
// double-talk detector can hear him cut in; the moment he does, we cancel the
// duck's response, kill its audio, and truncate its memory to what he actually
// heard. See onServerEvent (output_audio_buffer.*) and triggerBargeIn.
let speaking = false; // duck audio is currently playing
let playbackStartedAt = 0; // performance.now() when the current duck audio began — for truncate audio_end_ms
let currentItemId = null; // id of the assistant message item currently being spoken (for conversation.item.truncate)
let bargeRaf = null; // rAF handle for the barge-in monitor loop
let bargeOverMs = 0; // how long (ms) his voice has been above the interrupt threshold
let inputCtx = null; // separate AudioContext tapping the raw mic for barge-in detection
let inputAnalyser = null;
let duckOutLevel = 0; // latest RMS of the duck's OWN output — used to discount echo from the barge-in threshold

// A response is "active" from response.created until response.done. The realtime
// API rejects a second response.create while one is in flight, so ambient/game/
// trick events arriving mid-turn used to error out and vanish. Now they queue.
let responseActive = false;
let responseRequested = false; // response.create sent, response.created not yet seen
let pendingResponse = false; // an event asked to speak while a turn was active — fire when it ends

// Barge-in tuning. These govern the local double-talk detector and are the knobs
// to adjust by ear on real hardware — speakers bleed the duck's own voice into
// the mic (echo), headphones don't. Start conservative so echo rarely false-fires.
const BARGE_MIN_LEVEL = 0.055; // absolute mic RMS floor to even consider it speech
const BARGE_ECHO_FACTOR = 0.9; // fraction of the duck's own output level treated as expected echo and discounted
const BARGE_SUSTAIN_MS = 180; // his voice must stay above threshold this long to count as a real interruption (rejects coughs/clicks)

// rapid double-fires (hotkey mashing, double-click fumbles) must not spawn
// session bursts — they used to burn three connects in under two seconds
let lastToggleAt = 0;
function toggle() {
  const now = performance.now();
  if (now - lastToggleAt < 1200) return;
  lastToggleAt = now;
  if (active || connecting) stopSession();
  else startSession();
}

window.quackers.onTalkToggle(toggle);

// double-clicking the duck toggles conversation (pet.js calls this)
window.voiceToggle = toggle;

// Pre-warm on intent. Two things dominate time-to-first-word and both can be
// paid off BEFORE the tap: grabbing the mic (device init, no network/billing)
// and minting the session secret (one OpenAI round trip; minting alone bills
// nothing — audio only starts at the SDP exchange). When he's about to interact
// (window focus, or the pointer moving over the duck), we warm both. A tap then
// skips getUserMedia AND the mint, leaving just the SDP call before "hi".
// Everything is released on blur so we never hold the mic hot in the background.
let warmSecret = null; // { value, at } — a pre-minted session secret, single-use
let lastWarmAt = 0;
const WARM_SECRET_TTL_MS = 45000; // ephemeral secrets are short-lived; don't trust a stale one

function maybeWarm() {
  const now = performance.now();
  if (now - lastWarmAt < 5000) return; // throttle — pointermove fires constantly
  lastWarmAt = now;
  warmMic();
  prewarmSecret();
}
window.addEventListener('focus', maybeWarm);
window.addEventListener('pointermove', maybeWarm, { passive: true });
window.addEventListener('blur', coolOff);

async function warmMic() {
  if (active || connecting || micStream) return;
  try {
    if (!(await window.quackers.keyStatus())) return; // no key, no point holding the mic
    // Never trigger the mic PERMISSION prompt just because the app got focus —
    // only pre-open the mic if he's already granted it. The first-ever grant
    // happens on the intentional tap-to-talk path, where a prompt makes sense.
    try {
      const perm = await navigator.permissions.query({ name: 'microphone' });
      if (perm.state !== 'granted') return;
    } catch {
      return; // permissions API unavailable — skip warming; the cold path still works
    }
    micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    micTrack = micStream.getAudioTracks()[0];
  } catch {
    micStream = null;
    micTrack = null;
  }
}

async function prewarmSecret() {
  if (active || connecting || warmSecret) return;
  try {
    if (!(await window.quackers.keyStatus())) return;
    const r = await window.quackers.realtimePrewarm();
    if (r && r.value) warmSecret = { value: r.value, at: performance.now() };
  } catch {
    warmSecret = null;
  }
}

// Lost focus: drop the pre-warmed secret and release the mic if we're not in a
// call. Holding the mic open in the background is a privacy smell, not a feature.
function coolOff() {
  warmSecret = null;
  if (!active && !connecting && micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    micTrack = null;
  }
}

const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

// --- Speaking into an open session (system-role events) ------------------
// Every one of these adds a system message to the conversation, then asks for a
// response through the queue so it can never collide with an in-flight turn.
function systemSay(text, live = true) {
  if (!active || !dc || dc.readyState !== 'open') return false;
  send({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] },
  });
  if (live) requestResponse();
  return true;
}

// the body reports game outcomes into the live conversation (pet.js calls this)
window.reportGameEvent = (text) => { systemSay(`GAME EVENT: ${text}`); };

// ambient happenings (coding-buddy events) flow into an open conversation
window.reportAmbientEvent = (text) => {
  systemSay(`${text} — react briefly and naturally, mid-conversation.`);
};

// live trick progress narration (main → session)
window.quackers.onTrickEvent(({ text }) => { systemSay(text); });

// live build narration (main → session), exactly like trick events
window.quackers.onWorkshopEvent(({ text }) => { systemSay(text); });

// the stage board speaks through the duck; returns false when no session is
// live so stage.js can fall back to a thought bubble
window.reportStageSay = (line) =>
  systemSay(`STAGE EVENT: your board wants to say: "${line}". Say it (or your own quick version of it) out loud now.`);

// after a conversation is digested into memory, the duck updates its diary
window.quackers.onDigested(() => {
  window.duckAPI.emote('preen');
  window.duckAPI.sayBubble('*updates diary*');
});

async function startSession(isRedial = false) {
  if (!isRedial) redialUsed = false;
  connecting = true;
  window.duckAPI.setVoiceState('connecting');

  // No key = no voice. Check FIRST, before touching the mic or hatching: a
  // keyless tap used to fire a pointless macOS mic prompt AND crack the egg
  // open on a session that could never connect — spending the one-time hatch on
  // a dead conversation. keyStatus() is a permission-free boolean check.
  // The mic may already be warm (grabbed on focus); if so getUserMedia is skipped.
  const keyReady = window.quackers.keyStatus();
  const micReady = micStream
    ? Promise.resolve(micStream)
    : navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS).catch((e) => ({ __err: e }));

  const hasKey = await keyReady;
  if (!hasKey) {
    connecting = false;
    window.duckAPI.setVoiceState('idle');
    window.duckAPI.sayBubble("I don't have a voice yet…");
    window.quackers.openKeyWindow();
    return;
  }

  try {
    const grabbed = await micReady;
    if (grabbed && grabbed.__err) throw grabbed.__err;
    if (!micStream) {
      micStream = grabbed;
      micTrack = micStream.getAudioTracks()[0];
    }

    pc = new RTCPeerConnection();

    // A dropped transport (wifi blip, sleep/wake, network switch) used to leave
    // the duck looking connected while deaf — mic streaming to nothing, forever.
    // Now: tear down cleanly (which digests the transcript into memory) and, once
    // per session, quietly redial. ICE 'disconnected' is often transient, so give
    // it a grace window; 'failed' is terminal, act at once.
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      const s = pc.connectionState;
      if (s === 'connected' && dropTimer) { clearTimeout(dropTimer); dropTimer = null; }
      else if (s === 'failed') handleConnectionDrop();
      else if (s === 'disconnected' && !dropTimer) {
        dropTimer = setTimeout(() => {
          dropTimer = null;
          if (pc && pc.connectionState !== 'connected') handleConnectionDrop();
        }, 4000);
      }
    };

    audioEl = new Audio();
    audioEl.autoplay = true;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
      setupAnalyser(e.streams[0]);
    };

    micSender = pc.addTrack(micTrack, micStream);
    setupInputAnalyser(micStream); // local ear for barge-in

    dc = pc.createDataChannel('oai-events');
    dc.onmessage = (e) => {
      try {
        onServerEvent(JSON.parse(e.data));
      } catch {
        /* ignore malformed events */
      }
    };
    // a dying channel must never be invisible — it's how "duck went silent
    // after looking" hid for a day (oversized image killed the SCTP transport)
    dc.onclose = () => window.quackers.logEvent('dc-closed', { state: 'closed' });
    dc.onerror = (e) => window.quackers.logEvent('dc-error', { error: String((e && e.error && e.error.message) || 'unknown') });
    dc.onopen = () => {
      window.duckAPI.setVoiceState('listening');
      // Say hi. The mic is muted to the server while the duck talks (barge-in
      // machinery below), so the duck can't hear itself greet.
      responseRequested = true;
      send({
        type: 'response.create',
        response: {
          instructions:
            "Open the conversation as YOURSELF — your memory and stage above tell you exactly how. Use his name if you know it. If there's a live thread worth picking up (something from yesterday, a plan, a running bit), touch it in half a sentence. If this is your first-ever conversation, your opening is a tiny awestruck '…hi.' One short sentence total, in your chirpy voice.",
        },
      });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // consume the pre-minted secret if it's still fresh, else let main mint inline
    const preSecret =
      warmSecret && performance.now() - warmSecret.at < WARM_SECRET_TTL_MS ? warmSecret.value : null;
    warmSecret = null; // single-use, whether or not it was fresh
    const res = await window.quackers.realtimeConnect({ offerSdp: offer.sdp, secret: preSecret });
    if (res.error === 'no-voice') {
      // no API key yet — turn it into the "give me a voice" moment
      stopSession();
      window.duckAPI.sayBubble("I don't have a voice yet…");
      window.quackers.openKeyWindow();
      return;
    }
    if (res.error) throw new Error(res.error);
    await pc.setRemoteDescription({ type: 'answer', sdp: res.answerSdp });

    active = true;
    connecting = false;

    // NOW the session is live — safe to spend the one-time hatch. First-ever
    // talk while still an egg: the shell cracks as the duck comes online, and
    // its first spoken word is the greeting fired on dc.onopen.
    if (!isRedial && window.duckAPI.isEgg && window.duckAPI.isEgg()) {
      window.duckAPI.hatchNow();
    }
  } catch (err) {
    stopSession();
    window.duckAPI.sayBubble(String(err.message || err).slice(0, 80));
  }
}

// A transport that died under us: save what was said, tell the human in
// character, and redial once. Guarded so the pc.close() inside stopSession
// can't recurse back in through the 'closed' state change.
function handleConnectionDrop() {
  if (!active) return;
  const canRedial = !redialUsed;
  redialUsed = true;
  window.quackers.logEvent('session-dropped', { state: pc && pc.connectionState, canRedial });
  stopSession(); // digests the transcript so the memory survives the drop
  window.duckAPI.sayBubble(canRedial ? '…lost you for a sec —' : '…my line dropped. tap me to talk again.');
  if (canRedial) setTimeout(() => { if (!active && !connecting) startSession(true); }, 1200);
}

function stopSession() {
  active = false;
  connecting = false;
  pendingEnd = false;
  stopBargeMonitor();
  speaking = false;
  currentItemId = null;
  responseActive = false;
  responseRequested = false;
  pendingResponse = false;
  if (dropTimer) { clearTimeout(dropTimer); dropTimer = null; }
  if (transcript.length >= 2) window.quackers.digestTranscript(transcript);
  transcript = [];
  if (levelRaf) cancelAnimationFrame(levelRaf);
  levelRaf = null;
  analyser = null;
  if (audioCtx) audioCtx.close().catch(() => {});
  audioCtx = null;
  if (inputCtx) inputCtx.close().catch(() => {});
  inputCtx = null;
  inputAnalyser = null;
  duckOutLevel = 0;
  if (dc) { try { dc.close(); } catch { /* noop */ } }
  dc = null;
  if (pc) { try { pc.close(); } catch { /* noop */ } }
  pc = null;
  micSender = null;
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
  micTrack = null;
  if (audioEl) audioEl.srcObject = null;
  audioEl = null;
  window.duckAPI.setSpeakLevel(0);
  window.duckAPI.setFollow(false);
  window.duckAPI.setVoiceState('idle');
}

function send(obj) {
  if (!dc || dc.readyState !== 'open') {
    window.quackers.logEvent('dc-send-skipped', { type: obj && obj.type, state: dc ? dc.readyState : 'none' });
    return;
  }
  try {
    dc.send(JSON.stringify(obj));
  } catch (err) {
    // an oversized message throws here (and can kill the channel) — log it
    // instead of letting the session die a silent death
    window.quackers.logEvent('dc-send-failed', { type: obj && obj.type, error: String(err && err.message) });
  }
}

// Ask the model to speak, but never while a turn is already in flight — the
// realtime API rejects a second response.create and the event would be lost.
function requestResponse() {
  if (responseActive || responseRequested) {
    pendingResponse = true;
    return;
  }
  responseRequested = true;
  send({ type: 'response.create' });
}

// --- Mic gating (to the SERVER only — the local analyser always hears) ----
function muteMicToServer() {
  if (micSender && micTrack && micSender.track) {
    micSender.replaceTrack(null).catch(() => {});
  }
}
function restoreMicToServer() {
  if (micSender && micTrack && micSender.track !== micTrack) {
    micSender.replaceTrack(micTrack).catch(() => {});
  }
}

// --- Barge-in detector ----------------------------------------------------
// Runs only while the duck is speaking. Reads the raw mic and, if his voice
// stays above the echo-adjusted threshold long enough, cuts the duck off.
function startBargeMonitor() {
  stopBargeMonitor();
  bargeOverMs = 0;
  let last = performance.now();
  const buf = inputAnalyser ? new Uint8Array(inputAnalyser.fftSize) : null;
  const loop = () => {
    if (!speaking || !inputAnalyser || !buf) return;
    const now = performance.now();
    const dt = now - last;
    last = now;
    inputAnalyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const level = Math.sqrt(sum / buf.length);
    // discount the duck's own voice bleeding into the mic (echo): the louder the
    // duck is right now, the higher the bar his real voice must clear.
    const threshold = BARGE_MIN_LEVEL + BARGE_ECHO_FACTOR * duckOutLevel;
    if (level > threshold) {
      bargeOverMs += dt;
      if (bargeOverMs >= BARGE_SUSTAIN_MS) { triggerBargeIn(); return; }
    } else {
      bargeOverMs = 0;
    }
    bargeRaf = requestAnimationFrame(loop);
  };
  bargeRaf = requestAnimationFrame(loop);
}

function stopBargeMonitor() {
  if (bargeRaf) cancelAnimationFrame(bargeRaf);
  bargeRaf = null;
  bargeOverMs = 0;
}

// He talked over the duck. Cancel the generation, kill the audio now, and
// truncate the assistant item so the model's memory matches what he actually
// heard — not the sentence it was mid-way through saying.
function triggerBargeIn() {
  if (!speaking) return;
  speaking = false;
  stopBargeMonitor();
  const heardMs = Math.max(0, Math.round(performance.now() - playbackStartedAt));
  window.quackers.logEvent('barge-in', { heardMs });
  send({ type: 'response.cancel' });
  send({ type: 'output_audio_buffer.clear' }); // stop the duck's audio immediately (WebRTC)
  if (currentItemId) {
    send({
      type: 'conversation.item.truncate',
      item_id: currentItemId,
      content_index: 0,
      audio_end_ms: heardMs,
    });
  }
  currentItemId = null;
  restoreMicToServer(); // he's already talking — let the server hear the rest
  window.duckAPI.setSpeakLevel(0);
  window.duckAPI.setVoiceState('listening');
}

function onServerEvent(ev) {
  switch (ev.type) {
    case 'response.created':
      responseActive = true;
      responseRequested = false;
      break;

    // Grab the id of the message item being spoken so a barge-in can truncate
    // exactly it. Function-call items aren't spoken, so we only track messages.
    case 'response.output_item.added':
      if (ev.item && ev.item.type === 'message' && ev.item.id) currentItemId = ev.item.id;
      break;

    // WebRTC-only events marking assistant audio playback. Instead of going deaf
    // (the old micTrack.enabled=false), we mute the mic to the SERVER only —
    // the local barge-in analyser keeps hearing him. Muting to the server still
    // prevents the duck answering its own echo (Electron's AEC is broken,
    // electron#47043), which is why we can't just leave the mic fully open.
    case 'output_audio_buffer.started':
      speaking = true;
      playbackStartedAt = performance.now();
      muteMicToServer();
      window.duckAPI.setVoiceState('speaking');
      startBargeMonitor();
      break;
    case 'output_audio_buffer.stopped':
    case 'output_audio_buffer.cleared':
      speaking = false;
      stopBargeMonitor();
      window.duckAPI.setSpeakLevel(0);
      if (pendingEnd) {
        stopSession();
        window.duckAPI.emote('sleepy');
        break;
      }
      restoreMicToServer();
      window.duckAPI.setVoiceState('listening');
      break;

    case 'conversation.item.input_audio_transcription.completed':
      if (ev.transcript && ev.transcript.trim()) {
        transcript.push({ role: 'user', text: ev.transcript.trim() });
      }
      break;

    case 'response.done': {
      responseActive = false;
      responseRequested = false;
      currentItemId = null;
      const items = (ev.response && ev.response.output) || [];
      const calls = [];
      for (const item of items) {
        if (item.type === 'function_call') {
          let args = {};
          try { args = JSON.parse(item.arguments || '{}'); } catch { /* noop */ }
          calls.push({ name: item.name, args, callId: item.call_id });
        } else if (item.type === 'message') {
          for (const c of item.content || []) {
            if (c.transcript && c.transcript.trim()) {
              transcript.push({ role: 'duck', text: c.transcript.trim() });
            }
          }
        }
      }
      if (calls.length) runToolBatch(calls);
      // an event that wanted to speak while this turn was live now gets its turn
      else if (pendingResponse) { pendingResponse = false; requestResponse(); }
      break;
    }

    case 'error':
      console.error('realtime error', ev);
      window.quackers.logEvent('realtime-error', ev.error || ev);
      break;
  }
}

let emoteBurst = { count: 0, at: 0 };

// Every tool call from ONE model turn shares ONE response.create. The realtime
// API rejects a second response while one is active, so firing per-tool used to
// stall the duck whenever it emoted AND looked in the same breath — which the
// prompt actively encourages. Run them in order, send each output, then create
// a single response.
async function runToolBatch(calls) {
  for (const { name, args, callId } of calls) {
    let output = 'ok';
    try {
      output = await execToolInner(name, args);
    } catch (err) {
      // a failed tool must still answer, or the realtime session waits forever
      output = 'that did not work just now — carry on without it, gracefully';
      window.quackers.logEvent('tool-error', { name, error: String(err && err.message) });
      window.duckAPI.setThinking(false);
    }
    window.quackers.logEvent('tool-call', { name, args, output: String(output).slice(0, 200) });
    send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: String(output) },
    });
  }
  pendingResponse = false;
  requestResponse();
}

async function execToolInner(name, args) {
  let output = 'ok';

  switch (name) {
    case 'emote': {
      window.duckAPI.emote(args.emotion);
      // an emote flurry means the model is emoting INSTEAD of speaking — nudge it back to words
      const now = performance.now();
      if (now - emoteBurst.at > 10000) emoteBurst = { count: 0, at: now };
      emoteBurst.count++;
      if (emoteBurst.count > 2) output = 'your body is tired of emoting — no more emotes for now, use your WORDS';
      break;
    }

    case 'follow_cursor':
      window.duckAPI.setFollow(!!args.follow);
      output = args.follow ? 'now following the cursor' : 'stopped following';
      break;

    case 'start_chase':
      window.duckAPI.setFollow(false);
      window.duckAPI.startChase();
      output =
        'Chase started — you are now running from his cursor. You will get a GAME EVENT message when it ends; react to it out loud.';
      break;

    case 'start_mischief':
      window.duckAPI.setFollow(false);
      window.duckAPI.startMischief();
      output =
        'You are now rampaging around his screen for a minute — footprints, doodles, crimes. Narrate gleefully while you do it.';
      break;

    case 'record_game_result': {
      const tally = await window.quackers.gameResult(String(args.game || ''), String(args.winner || ''));
      output = tally
        ? `Recorded. All-time ${args.game}: you ${tally.duck} — him ${tally.user}. React accordingly.`
        : 'could not record that (unknown winner?)';
      break;
    }

    case 'learn_trick':
      teachStartIndex = transcript.length;
      output = await window.quackers.trickTeachStart(String(args.name || ''));
      break;

    case 'finish_trick': {
      const narration = transcript
        .slice(Math.max(0, teachStartIndex))
        .filter((l) => l.role === 'user')
        .map((l) => l.text)
        .join('\n');
      teachStartIndex = -1;
      const res = await window.quackers.trickTeachFinish(narration);
      output = res.error || `${res.summary} — recap this aloud in one quick breath, then offer to try it.`;
      break;
    }

    case 'perform_trick':
      output = await window.quackers.trickPerform(String(args.name || ''), String(args.guidance || ''));
      break;

    case 'confirm_trick_step': {
      const ok = await window.quackers.trickConfirm(Boolean(args.approved));
      output = ok ? (args.approved ? 'confirmed — continuing' : 'declined — the step is skipped and the trick stops') : 'nothing was waiting for confirmation';
      break;
    }

    case 'cancel_trick':
      await window.quackers.trickCancel();
      teachStartIndex = -1;
      output = 'stopped everything immediately';
      break;

    case 'check_workshop': {
      const res = await window.quackers.workshopCheck(String(args.name || ''));
      output = res.framed;
      break;
    }

    case 'build_artifact':
      output = await window.quackers.workshopBuild({
        name: String(args.name || ''),
        kind: String(args.kind || ''),
        description: String(args.description || ''),
      });
      break;

    case 'run_artifact':
      output = await window.quackers.workshopRun(String(args.name || ''));
      break;

    case 'close_artifact':
      output = await window.quackers.workshopClose();
      break;

    case 'equip_prop':
      output = await window.quackers.workshopEquip(String(args.name || ''));
      break;

    case 'unequip_prop':
      output = await window.quackers.workshopUnequip(String(args.name || ''));
      break;

    case 'remember_name':
      await window.quackers.rememberName(String(args.name || ''));
      output = 'imprinted. that is his name now.';
      break;

    case 'remember':
      await window.quackers.memoryAdd(String(args.note || ''));
      output = 'saved to memory';
      break;

    case 'recall': {
      // framing comes from brain.runRecall so the lab tests the same words
      const res = await window.quackers.recall(String(args.query || ''));
      output = res.output;
      break;
    }

    case 'think_hard': {
      window.duckAPI.setThinking(true);
      try {
        const res = await window.quackers.thinkHard({
          question: String(args.question || ''),
          recent: String(args.recent || ''),
        });
        output = res.framed;
      } finally {
        window.duckAPI.setThinking(false);
      }
      break;
    }

    case 'look_at_screen':
    case 'look_at_app': {
      const shot =
        name === 'look_at_app'
          ? await window.quackers.captureApp(String(args.app_name || ''))
          : await window.quackers.captureScreen();
      if (shot.error) {
        output = shot.error;
      } else {
        // one message per image: data-channel messages have a hard size limit
        // (~256KB) and one oversized send kills the whole channel, silently
        send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${shot.jpegBase64}` }],
          },
        });
        if (shot.cursorCropBase64) {
          send({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${shot.cursorCropBase64}` }],
            },
          });
        }
        const closeupNote = shot.cursorCropBase64
          ? ' The FIRST image is the wide view; the SECOND is a close-up of where his cursor is — the thing he means is almost always in the close-up, so read that one carefully.'
          : '';
        // ground the model in which app is frontmost (sensed without permission),
        // unless we already named the exact window it grabbed — no need to repeat
        const appNote =
          shot.frontApp && shot.frontApp !== shot.windowName ? ` He's currently in ${shot.frontApp}.` : '';
        output = shot.fallbackFromApp
          ? `You couldn't isolate the "${shot.fallbackFromApp}" window, so here's the whole screen.${appNote}${closeupNote} Find ${shot.fallbackFromApp} and talk about what's there; if you genuinely can't see it, say so plainly.`
          : `Snapshot of ${shot.windowName ? `the "${shot.windowName}" window` : "the user's screen"} attached above.${appNote}${closeupNote} Actually look and react to the substance — what he's working on, specific things you notice, real words you can read — not vague impressions.`;
      }
      break;
    }

    case 'switch_to_chat':
      // let the one-line spoken goodbye finish, then hand off to the chat panel
      pendingEnd = true;
      setTimeout(() => { if (window.chatAPI) window.chatAPI.open(); }, 900);
      output = 'ok — say your quick goodbye-to-voice now, then the chat opens';
      break;

    case 'end_conversation':
      pendingEnd = true; // session closes once the goodbye audio finishes
      output = 'ok — say your goodbye now';
      break;

    default:
      output = `unknown tool ${name}`;
  }

  return output;
}

// Playback is the <audio> element; Web Audio is only a tap here, reading the
// speak level that drives the beak/mouth animation — and doubling as the echo
// reference for the barge-in detector (duckOutLevel).
function setupAnalyser(stream) {
  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);

  const loop = () => {
    if (!analyser) return;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const level = Math.sqrt(sum / buf.length);
    duckOutLevel = level; // echo reference for the barge-in threshold
    window.duckAPI.setSpeakLevel(level);
    levelRaf = requestAnimationFrame(loop);
  };
  loop();
}

// A separate tap on the RAW mic (never muted at the track level) so the barge-in
// detector can hear him even while the mic is muted to the server during playback.
function setupInputAnalyser(stream) {
  try {
    inputCtx = new AudioContext();
    const src = inputCtx.createMediaStreamSource(stream);
    inputAnalyser = inputCtx.createAnalyser();
    inputAnalyser.fftSize = 512;
    src.connect(inputAnalyser);
  } catch {
    inputAnalyser = null; // no local ear → barge-in silently disabled, voice still works
  }
}
