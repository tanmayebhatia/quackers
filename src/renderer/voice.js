// Quackers voice — live speech session over WebRTC.
// The OpenAI key stays in the main process; this file only ever sees a
// short-lived session secret's SDP answer.

let pc = null;
let dc = null;
let teachStartIndex = -1; // transcript index when a trick lesson began
let micStream = null;
let micTrack = null;
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

// the body reports game outcomes into the live conversation (pet.js calls this)
window.reportGameEvent = (text) => {
  if (!active || !dc || dc.readyState !== 'open') return;
  send({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: `GAME EVENT: ${text}` }] },
  });
  send({ type: 'response.create' });
};

// ambient happenings (coding-buddy events) flow into an open conversation
window.reportAmbientEvent = (text) => {
  if (!active || !dc || dc.readyState !== 'open') return;
  send({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: `${text} — react briefly and naturally, mid-conversation.` }] },
  });
  send({ type: 'response.create' });
};

// live trick progress narration (main → session)
window.quackers.onTrickEvent(({ text }) => {
  if (!active || !dc || dc.readyState !== 'open') return;
  send({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] },
  });
  send({ type: 'response.create' });
});

// live build narration (main → session), exactly like trick events
window.quackers.onWorkshopEvent(({ text }) => {
  if (!active || !dc || dc.readyState !== 'open') return;
  send({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] },
  });
  send({ type: 'response.create' });
});

// the stage board speaks through the duck; returns false when no session is
// live so stage.js can fall back to a thought bubble
window.reportStageSay = (line) => {
  if (!active || !dc || dc.readyState !== 'open') return false;
  send({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'system',
      content: [{ type: 'input_text', text: `STAGE EVENT: your board wants to say: "${line}". Say it (or your own quick version of it) out loud now.` }],
    },
  });
  send({ type: 'response.create' });
  return true;
};

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
  const hasKey = await window.quackers.keyStatus();
  if (!hasKey) {
    connecting = false;
    window.duckAPI.setVoiceState('idle');
    window.duckAPI.sayBubble("I don't have a voice yet…");
    window.quackers.openKeyWindow();
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    micTrack = micStream.getAudioTracks()[0];

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

    pc.addTrack(micTrack, micStream);

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
      // Say hi. Mic stays muted until the greeting finishes playing
      // (output_audio_buffer events), so the duck can't hear itself.
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

    const res = await window.quackers.realtimeConnect(offer.sdp);
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
  if (dropTimer) { clearTimeout(dropTimer); dropTimer = null; }
  if (transcript.length >= 2) window.quackers.digestTranscript(transcript);
  transcript = [];
  if (levelRaf) cancelAnimationFrame(levelRaf);
  levelRaf = null;
  analyser = null;
  if (audioCtx) audioCtx.close().catch(() => {});
  audioCtx = null;
  if (dc) { try { dc.close(); } catch { /* noop */ } }
  dc = null;
  if (pc) { try { pc.close(); } catch { /* noop */ } }
  pc = null;
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

function onServerEvent(ev) {
  switch (ev.type) {
    // WebRTC-only events marking assistant audio playback. We hard-mute the
    // mic while the duck talks: Electron's echo cancellation is broken
    // (electron#47043), so without this the duck hears itself and replies.
    case 'output_audio_buffer.started':
      if (micTrack) micTrack.enabled = false;
      window.duckAPI.setVoiceState('speaking');
      break;
    case 'output_audio_buffer.stopped':
    case 'output_audio_buffer.cleared':
      window.duckAPI.setSpeakLevel(0);
      if (pendingEnd) {
        stopSession();
        window.duckAPI.emote('sleepy');
        break;
      }
      if (micTrack) micTrack.enabled = true;
      window.duckAPI.setVoiceState('listening');
      break;

    case 'conversation.item.input_audio_transcription.completed':
      if (ev.transcript && ev.transcript.trim()) {
        transcript.push({ role: 'user', text: ev.transcript.trim() });
      }
      break;

    case 'response.done': {
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
  send({ type: 'response.create' });
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
// speak level that drives the beak/mouth animation.
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
    window.duckAPI.setSpeakLevel(Math.sqrt(sum / buf.length));
    levelRaf = requestAnimationFrame(loop);
  };
  loop();
}
