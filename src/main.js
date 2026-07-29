const { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage, globalShortcut, systemPreferences, desktopCapturer, powerMonitor, Notification, shell, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');

const spine = require('./spine');
const dreamer = require('./dream');
const senses = require('./senses');
const brain = require('./brain');
const chat = require('./chat');
const tricks = require('./tricks');
const workshop = require('./workshop');
const privacy = require('./privacy');
const computerPrimitives = require('./computer-primitives');
const integrations = require('./integrations');

const TOGGLE_ACCELERATOR = 'Control+Shift+Q';
const TALK_ACCELERATOR = 'Control+Shift+T';
const CLIP_ACCELERATOR = 'Control+Shift+C';
const REALTIME_MODEL = 'gpt-realtime-2.1'; // fast "mouth" for live speech
// The base realtime voice sets the TIMBRE; the prompt (HOW YOU SOUND) drives it
// into a tiny, squeaky little-duck delivery on top. coral + that direction is
// the locked-in combo (chosen by ear over the whole realtime voice set). No DSP
// pitch-shift — the young register comes from the voice performance itself, so
// there's no robotic artifact. Override to audition others via QUACKERS_VOICE.
const VOICE = process.env.QUACKERS_VOICE || 'coral';
const BUDDY_PORT = 42990; // loopback-only endpoint for coding-buddy events

let win = null;
let tray = null;

function toggleDuck() {
  if (!win) return;
  if (win.isVisible()) {
    win.webContents.send('quackers:dismiss');
    // fallback in case the renderer stalls mid-poof
    setTimeout(() => {
      if (win && win.isVisible()) win.hide();
    }, 700);
  } else {
    win.showInactive();
    win.webContents.send('quackers:arrive');
  }
}

function toggleTalk() {
  if (!win) return;
  if (!win.isVisible()) {
    win.showInactive();
    win.webContents.send('quackers:arrive');
  }
  win.webContents.send('quackers:talk-toggle');
}

function requestChat() {
  if (!win) return;
  if (!win.isVisible()) {
    win.showInactive();
    win.webContents.send('quackers:arrive');
  }
  win.webContents.send('quackers:chat-request');
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Click-through by default; forward mousemove so the renderer can tell
  // when the cursor is over the duck and ask to become interactive.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function fitToWorkArea() {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds(workArea);
  computeGroundOffset();
}

// ---------------------------------------------------------------------------
// Ground line vs the Dock.
// Always-visible dock: workArea already stops at the dock's top — offset 0,
// the duck walks along the dock. Auto-hiding bottom dock: workArea is the full
// screen, so without help the duck sits flush at the bottom and the dock
// slides out UNDER it. We raise the ground by the dock's resting height so
// the duck hovers exactly where the dock appears — right for both setups.
// ---------------------------------------------------------------------------

let groundOffset = 0;

function computeGroundOffset() {
  if (process.platform !== 'darwin') return;
  execFile('defaults', ['read', 'com.apple.dock'], { timeout: 4000 }, (err, out) => {
    let offset = 0;
    if (!err && out) {
      const autohide = /[\s"]autohide"?\s*=\s*1/.test(out);
      const orientation = (out.match(/orientation"?\s*=\s*"?(\w+)/) || [])[1] || 'bottom';
      if (autohide && orientation === 'bottom') {
        const tile = parseFloat((out.match(/tilesize"?\s*=\s*"?([\d.]+)/) || [])[1]) || 48;
        offset = Math.round(tile + 16); // icon size + dock chrome/padding
      }
    }
    if (offset !== groundOffset) {
      groundOffset = offset;
      logEvent('ground-offset', { offset });
      if (win) win.webContents.send('quackers:ground', groundOffset);
    }
  });
}

function buildTrayMenu() {
  const items = [
    { label: 'Quackers is on your screen', enabled: false },
    { type: 'separator' },
    { label: 'Show / Hide', accelerator: TOGGLE_ACCELERATOR, click: toggleDuck },
    { label: 'Talk / Hush', accelerator: TALK_ACCELERATOR, click: toggleTalk },
    { label: 'Chat (type instead)…', click: requestChat },
    { label: 'Clip that! (last 15s)', accelerator: CLIP_ACCELERATOR, click: requestClip },
    { label: 'Our scrapbook…', click: openScrapbookWindow },
    { label: 'Sticky notes & work guard…', click: openRemindersWindow },
    { label: 'Connect coding tools…', click: openIntegrationsWindow },
    { label: 'What Quackers remembers…', click: openMemoryWindow },
    { label: 'Fix screen vision…', click: openScreenSettings },
    {
      label: 'Give it hands (for tricks)…',
      click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'),
    },
    {
      label: 'Let it vibe to your music 🎧',
      type: 'checkbox',
      checked: spine.musicSense(),
      click: (item) => {
        // macOS asks once per player ("Quackers wants to control Spotify") —
        // that dialog IS the consent story, so the toggle just flips the sense
        spine.setMusicSense(item.checked);
        senses.setMusicEnabled(item.checked);
        logEvent('music-sense', { on: item.checked });
      },
    },
  ];
  items.push({ type: 'separator' });
  items.push({
    label: hasConfiguredApiKey() ? 'Change voice key…' : 'Give Quackers a voice…',
    click: openKeyWindow,
  });
  items.push({ type: 'separator' });
  items.push({ label: 'Quit Quackers', click: () => app.quit() });
  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// QUACKERS_DATA_DIR points the whole app at an alternate profile — used by
// fresh-install verification and safe manual testing (never touches the real
// duck's memory).
if (process.env.QUACKERS_DATA_DIR) {
  app.setPath('userData', process.env.QUACKERS_DATA_DIR);
}

// One duck per machine. A second launch (easy to do by accident) would spawn a
// rival duck writing the same spine.json — lost writes, and a window for the
// corruption the atomic save guards against. Bail out early and wake the duck
// that's already home. (Scoped by userData path so a QUACKERS_DATA_DIR scratch
// profile can still run alongside the real install for verification.)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (!win.isVisible()) win.showInactive();
      win.webContents.send('quackers:arrive');
    } else if (onboardWin) {
      onboardWin.focus();
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();

  spine.init(app.getPath('userData'));
  try {
    privacy.scrubLogFile(path.join(app.getPath('userData'), 'interactions.jsonl'));
  } catch {
    /* old diagnostics must never block startup */
  }
  logEvent('startup', {
    stage: spine.stage(),
    screenPermission: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'n/a',
    micPermission: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'n/a',
  });
  createWindow();

  const trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  if (trayIcon.isEmpty()) tray.setTitle('🐤'); // fallback if assets are missing — a duck, matching the icon
  tray.setToolTip('Quackers');
  refreshTray();

  globalShortcut.register(TOGGLE_ACCELERATOR, toggleDuck);
  globalShortcut.register(TALK_ACCELERATOR, toggleTalk);
  globalShortcut.register(CLIP_ACCELERATOR, requestClip);

  screen.on('display-metrics-changed', fitToWorkArea);
  screen.on('display-added', fitToWorkArea);
  screen.on('display-removed', fitToWorkArea);

  tricks.init({
    spine,
    loadApiKey,
    logEvent,
    sendToDuck: (channel, payload) => {
      if (win) win.webContents.send(channel, payload);
    },
    protect: (on) => {
      if (win) win.setContentProtection(on);
    },
    dockHidden: () => groundOffset > 0, // measured: auto-hiding bottom dock
  });

  workshop.init({
    dir: app.getPath('userData'),
    spine,
    loadApiKey,
    logEvent,
    sendToDuck: (channel, payload) => {
      if (win) win.webContents.send(channel, payload);
    },
    smokeTest: rendererSmoke,
  });

  senses.start();
  wireMusicSense(); // subscribe BEFORE enabling — the first detection must not race the listener
  senses.setMusicEnabled(spine.musicSense());
  computeGroundOffset();
  startImpulseLoop();
  startDreamLoop();
  startBuddyServer();
  startReminderLoop();

  // brand-new install: pick your quacker + name it before the egg drops.
  // Existing ducks (or a first run that already onboarded) skip this forever.
  if (spine.stage() === 'egg' && !spine.identity().onboarded) {
    openOnboardingWindow();
  }
});

// ---------------------------------------------------------------------------
// Onboarding — one small window, once, then never again
// ---------------------------------------------------------------------------

let onboardWin = null;

function openOnboardingWindow() {
  if (onboardWin) {
    onboardWin.focus();
    return;
  }
  onboardWin = new BrowserWindow({
    width: 560,
    height: 640,
    title: 'Pick your Quacker',
    resizable: false,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  onboardWin.loadFile(path.join(__dirname, 'renderer', 'onboarding.html'));
  onboardWin.on('closed', () => {
    onboardWin = null;
  });
}

ipcMain.on('onboard-complete', (_event, { skin, duckName, personName }) => {
  const cleanPersonName = String(personName || '').replace(/[\r\n]+/g, ' ').slice(0, 60).trim();
  if (!cleanPersonName) return;
  spine.setIdentity(skin, duckName, cleanPersonName);
  logEvent('onboarded', { skin: spine.skin(), duckName: spine.duckName() });
  if (onboardWin) onboardWin.close();
  if (win) win.webContents.send('quackers:egg-drop'); // and so it begins
});

// ---------------------------------------------------------------------------
// Proactivity v2 — planned, ambient-aware, and hard-capped (spine.allowImpulse:
// max 4/day, 90-min gaps). DND means total silence. The duck earns the right
// to speak by mostly not speaking.
// ---------------------------------------------------------------------------

let lastDnd = false;
let lastOnCall = false;
let lastMusicHappeningAt = 0;

// music changes the duck's body language (headphones, bobbing) — a free visual
// state, pushed the moment senses notices a play/pause/track change rather
// than waiting for an impulse tick
function wireMusicSense() {
  senses.onMusicChange((music) => {
    if (win) win.webContents.send('quackers:music', music);
    if (music && Date.now() - lastMusicHappeningAt > 30 * 60 * 1000) {
      // at most one memory crumb per half hour — listening along, not logging
      lastMusicHappeningAt = Date.now();
      spine.addHappening('music', `${music.track} — ${music.artist}`);
    }
  });
}

function startImpulseLoop() {
  let wasAway = false;
  setInterval(() => {
    if (!win) return;

    // ambient states reach the renderer even while the duck is hidden — a
    // stale headphones/call flag on re-show reads as a broken duck
    const ambient = senses.snapshot();
    if (ambient.dnd !== lastDnd) {
      lastDnd = ambient.dnd;
      win.webContents.send('quackers:dnd', ambient.dnd);
    }
    if (ambient.onCall !== lastOnCall) {
      lastOnCall = ambient.onCall;
      win.webContents.send('quackers:call', ambient.onCall);
    }
    const idle = powerMonitor.getSystemIdleTime(); // seconds

    // A work guard is an explicit recurring promise, separate from the duck's
    // surprise-impulse budget. It still observes presence, Focus, and calls.
    if (
      !ambient.dnd &&
      !ambient.onCall &&
      idle <= 60 &&
      spine.recordWorkGuardNudge(ambient.app, ambient.appMinutes)
    ) {
      const guard = spine.workGuard();
      const note = spine.addReminder({
        text: guard.message || `You’ve been in ${ambient.app} for ${Math.round(ambient.appMinutes)} minutes. Tiny reset?`,
        color: 'mint',
      });
      if (note) deliverStickyReminder(note, { notify: true });
    }

    if (!win.isVisible()) return;
    if (ambient.dnd) return; // Focus on = the duck does not exist audibly
    if (ambient.onCall) return; // never speak over a meeting

    if (idle > 15 * 60) {
      if (!wasAway) {
        wasAway = true;
        win.webContents.send('quackers:user-away');
      }
      return;
    }
    if (wasAway && idle < 10) {
      wasAway = false;
      win.webContents.send('quackers:user-back');
      if (spine.canImpulse('welcome')) {
        win.webContents.send('quackers:impulse', { kind: 'welcome' });
      }
      return;
    }
    if (idle > 60) return; // only speak to a present human

    // a loop actually due within the window beats everything else — and a
    // dated-but-distant (or overdue) loop must never shadow the others
    const due = spine.dueSoonLoop(45);
    if (due && spine.canImpulse('loop')) {
      win.webContents.send('quackers:impulse', { kind: 'loop-due', text: due.description });
      return;
    }
    // One thought from the latest dream may knock once. It uses the same
    // renderer acknowledgment and global restraint budget as every other
    // proactive moment, and expires rather than nagging.
    const dreamOffer = spine.pendingDreamOffer();
    if (dreamOffer && spine.canImpulse('dream')) {
      win.webContents.send('quackers:impulse', {
        kind: 'dream',
        text: dreamOffer.opener,
        dreamId: dreamOffer.dreamId,
      });
      return;
    }
    // occasionally surface an undated open loop (rare by design)
    const undated = spine.undatedLoop();
    if (Math.random() < 0.1 && undated && spine.canImpulse('loop')) {
      win.webContents.send('quackers:impulse', { kind: 'loop', text: undated.description });
      return;
    }
    // he's been heads-down in one app for a very long time
    if (ambient.appMinutes != null && ambient.appMinutes > 110 && spine.canImpulse('stretch')) {
      win.webContents.send('quackers:impulse', { kind: 'stretch', text: ambient.app });
      return;
    }
    // battery about to die — the one almost-useful thing the duck does
    if (ambient.battery != null && ambient.battery <= 8 && ambient.charging === false && spine.canImpulse('battery')) {
      win.webContents.send('quackers:impulse', { kind: 'battery', text: String(ambient.battery) });
      return;
    }
    // deep in the night and he's still here — one gentle nudge, then the duck
    // just models good behavior (cap on, asleep by the dock)
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5 && spine.canImpulse('latenight')) {
      win.webContents.send('quackers:impulse', { kind: 'latenight' });
    }
  }, 30000);
}

// The renderer confirms an impulse was actually SHOWN before we charge the
// hard daily budget — a nudge dropped mid-conversation must not count.
ipcMain.on('impulse-shown', (_event, payload) => {
  const data = payload && typeof payload === 'object' ? payload : { kind: payload };
  const k = String(data.kind || '').slice(0, 20);
  if (k === 'dream' && data.dreamId) spine.markDreamOfferShown(String(data.dreamId).slice(0, 80));
  spine.recordImpulse(k === 'loop-due' ? 'loop' : k); // due-nudges share the loop cadence
});

function takeDreamOfferForConversation(prompted) {
  const offer = spine.unsharedDreamOffer();
  if (!offer) return { ok: false, reason: 'no unshared overnight thought' };
  if (!prompted && !spine.canImpulse('dream')) {
    return { ok: false, reason: 'not a good interruption moment yet' };
  }
  spine.markDreamOfferShown(offer.dreamId);
  if (!prompted) spine.recordImpulse('dream');
  logEvent('dream-offer-conversation', {
    ok: true,
    mode: prompted ? 'prompted' : 'lull',
  });
  return { ok: true, opener: offer.opener, detail: offer.detail };
}

ipcMain.handle('dream-offer-take', (_event, prompted) =>
  takeDreamOfferForConversation(Boolean(prompted))
);

// ---------------------------------------------------------------------------
// The dream loop — when the duck has been left alone and it's been ~a day,
// the slow mind tidies memory, refreshes its understanding of him, grows the
// duck's own personality a little, and writes the diary.
// ---------------------------------------------------------------------------

let dreaming = false;

async function runDream(trigger) {
  if (dreaming || !dreamer.due(spine)) return;
  const key = loadApiKey();
  if (!key) return;
  dreaming = true;
  try {
    if (win) win.webContents.send('quackers:dreaming', true);
    const ok = await dreamer.dream({ spine, apiKey: key, model: brain.DREAM_MODEL, logEvent });
    if (ok) {
      await backfillEmbeddings();
      if (win) {
        const overnight = spine.activeDreamMind();
        win.webContents.send('quackers:dreamed', {
          hasOffer: Boolean(overnight && overnight.offer),
        });
      }
      logEvent('dream-done', { trigger });
    }
  } finally {
    dreaming = false;
    if (win) win.webContents.send('quackers:dreaming', false);
  }
}

function startDreamLoop() {
  // shortly after startup (a natural quiet moment), then whenever he's away
  setTimeout(() => runDream('startup'), 90 * 1000);
  setInterval(() => {
    if (powerMonitor.getSystemIdleTime() > 5 * 60) runDream('idle');
  }, 10 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Coding buddy — a loopback-only endpoint so dev tools (Claude Code hooks,
// CI scripts, anything that can curl) can tell the duck what happened.
// User-initiated tooling, so it bypasses impulse caps but is rate-limited.
// ---------------------------------------------------------------------------

let lastBuddyAt = 0;

function startBuddyServer() {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url === '/health' ? { ok: true, duck: spine.stage() } : { error: 'POST /event' }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      try {
        const ev = JSON.parse(body || '{}');
        const type = String(ev.type || '').slice(0, 40);
        const detail = String(ev.detail || '').slice(0, 200);
        if (!type) return;
        logEvent('buddy-event', { type, detail });
        const now = Date.now();
        if (now - lastBuddyAt < 20000) return; // don't let a chatty hook spam the duck
        lastBuddyAt = now;
        if (type === 'pr-opened') {
          spine.addHappening('coding', `${spine.userName() || 'your person'} opened a PR${detail ? ` — "${detail}"` : ''}`);
        } else if (['run-done', 'run-failed', 'tests-passed', 'tests-failed'].includes(type)) {
          spine.addHappening('coding', `${type}${detail ? ` (${detail})` : ''}`);
        }
        const now2 = senses.snapshot();
        if (win && win.isVisible() && !now2.dnd && !now2.onCall) {
          win.webContents.send('quackers:buddy', { type, detail });
        }
      } catch {
        /* malformed event — ignore */
      }
    });
  });
  server.on('error', (err) => logEvent('buddy-server-error', { error: err.message }));
  server.listen(BUDDY_PORT, '127.0.0.1');
}

ipcMain.on('set-interactive', (_event, interactive) => {
  if (!win) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('quit', () => app.quit());

ipcMain.on('hide-now', () => {
  if (win) win.hide();
});

// ---------------------------------------------------------------------------
// Voice engine (BYO OpenAI key; realtime session brokered from main so the
// key never enters the renderer)
// ---------------------------------------------------------------------------

// Local diagnostics are metadata-only. Conversation text, model output,
// memories, names, and screen contents never enter the interaction log.
function logEvent(type, data) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'interactions.jsonl'),
      JSON.stringify(privacy.privateLogEntry(type, data)) + '\n',
      { mode: 0o600 }
    );
  } catch {
    /* logging must never break the duck */
  }
}

ipcMain.on('log-event', (_event, { type, data }) => logEvent(type, data));

function readKeyFrom(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const match = txt.match(/^\s*OPENAI_API_KEY\s*=\s*(.+)\s*$/m);
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    return null;
  }
}

function encryptedKeyPath() {
  return path.join(app.getPath('userData'), 'openai-key.enc');
}

function readEncryptedKey() {
  try {
    // A keyless first launch should never touch Keychain. Besides doing no
    // useful work, the availability probe can wait on macOS UI while a newly
    // packaged app is establishing its secure-storage identity.
    if (!fs.existsSync(encryptedKeyPath())) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = Buffer.from(fs.readFileSync(encryptedKeyPath(), 'utf8').trim(), 'base64');
    return safeStorage.decryptString(encrypted).trim() || null;
  } catch {
    return null;
  }
}

function saveEncryptedKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('macOS secure key storage is unavailable; unlock your login keychain and try again');
  }
  const target = encryptedKeyPath();
  const tmp = `${target}.tmp`;
  const encrypted = safeStorage.encryptString(key).toString('base64');
  fs.writeFileSync(tmp, `${encrypted}\n`, { mode: 0o600 });
  fs.renameSync(tmp, target);
  fs.chmodSync(target, 0o600);
}

function readAndMigrateLegacyUserKey() {
  const legacy = path.join(app.getPath('userData'), '.env');
  const key = readKeyFrom(legacy);
  if (!key) return null;
  try {
    saveEncryptedKey(key);
    fs.unlinkSync(legacy);
  } catch {
    // Keep the existing key readable until secure storage is available. Never
    // delete the only working copy unless encryption completed successfully.
  }
  return key;
}

function loadApiKey() {
  // Environment/app .env remain developer-only options. Keys entered through
  // the UI are encrypted with Electron safeStorage (macOS Keychain-backed).
  return (
    (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) ||
    readEncryptedKey() ||
    readAndMigrateLegacyUserKey() ||
    readKeyFrom(path.join(app.getAppPath(), '.env')) ||
    readKeyFrom(path.join(path.dirname(app.getPath('exe')), '..', 'Resources', '.env')) ||
    null
  );
}

// Startup/UI status must never decrypt a Keychain item. An ad-hoc development
// signature can legitimately change between builds, and macOS may pause access
// to an item written by the prior signature. Decryption happens only when the
// person intentionally uses an API-powered feature.
function hasConfiguredApiKey() {
  return Boolean(
    (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) ||
    fs.existsSync(encryptedKeyPath()) ||
    readKeyFrom(path.join(app.getPath('userData'), '.env')) ||
    readKeyFrom(path.join(app.getAppPath(), '.env')) ||
    readKeyFrom(path.join(path.dirname(app.getPath('exe')), '..', 'Resources', '.env'))
  );
}


// The session config the mint is bound to. Rebuilt per mint so a pre-warmed
// secret still snapshots current memory/ambient state (within its short life).
function buildRealtimeSessionConfig() {
  return {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions: brain.buildInstructions({ spine, ambientLine: senses.ambientLine() }),
    audio: {
      input: {
        // 'medium' (was 'low') tightens end-of-turn latency — the model commits
        // to replying sooner after he stops. Barge-in is handled client-side
        // (voice.js triggers response.cancel the instant he talks over the duck),
        // so we don't also set interrupt_response here — the mic is muted to the
        // server during playback and the local double-talk detector is authoritative.
        turn_detection: { type: 'semantic_vad', eagerness: 'medium' },
        transcription: { model: 'gpt-4o-mini-transcribe' },
      },
      output: { voice: VOICE },
    },
    tools: brain.buildRealtimeTools(spine.userName()),
    tool_choice: 'auto',
  };
}

// Mint an ephemeral client secret. Minting alone starts no call and bills no
// audio — that only begins at the /realtime/calls SDP exchange — so this is safe
// to pre-run on intent (see realtime-prewarm) to keep it off the tap-to-talk path.
async function mintRealtimeSecret(key) {
  const mint = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: buildRealtimeSessionConfig() }),
  });
  if (!mint.ok) {
    const body = (await mint.text()).slice(0, 300);
    return { error: `session mint failed (${mint.status}): ${body}` };
  }
  const secret = await mint.json();
  return { value: secret.value };
}

// Pre-warm: hand the renderer a minted secret it can cache for a tap that's
// seconds away. No mic prompt here — that stays on the intentional connect path.
ipcMain.handle('realtime-prewarm', async () => {
  const key = loadApiKey();
  if (!key) return { error: 'no-voice' };
  try {
    return await mintRealtimeSecret(key);
  } catch (err) {
    return { error: `network error: ${err.message}` };
  }
});

// arg is { offerSdp, secret? }. A pre-warmed secret skips the mint round trip;
// a bare string is still accepted for safety. Legacy callers passed the SDP
// string directly.
ipcMain.handle('realtime-connect', async (_event, arg) => {
  const offerSdp = typeof arg === 'string' ? arg : arg && arg.offerSdp;
  const preSecret = typeof arg === 'object' && arg ? arg.secret : null;
  const key = loadApiKey();
  if (!key) {
    return { error: 'no-voice' };
  }

  spine.touchConversation();

  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status !== 'granted') {
      const ok = await systemPreferences.askForMediaAccess('microphone');
      if (!ok) return { error: 'I need microphone access to hear you' };
    }
  }

  try {
    let secretValue = preSecret;
    if (!secretValue) {
      const minted = await mintRealtimeSecret(key);
      if (minted.error) return { error: minted.error };
      secretValue = minted.value;
    }

    let sdpRes = await fetch(
      `https://api.openai.com/v1/realtime/calls?model=${REALTIME_MODEL}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretValue}`, 'Content-Type': 'application/sdp' },
        body: offerSdp,
      }
    );
    if (sdpRes.status === 409) {
      // the previous session hasn't fully torn down server-side yet (quick
      // hang-up → redial) — give it a beat and try once more
      logEvent('session-start', { ok: false, retrying: '409 stale session' });
      await new Promise((r) => setTimeout(r, 1500));
      sdpRes = await fetch(`https://api.openai.com/v1/realtime/calls?model=${REALTIME_MODEL}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretValue}`, 'Content-Type': 'application/sdp' },
        body: offerSdp,
      });
    }
    if (!sdpRes.ok) {
      const body = (await sdpRes.text()).slice(0, 300);
      logEvent('session-start', { ok: false, error: `webrtc ${sdpRes.status}: ${body}` });
      return { error: `webrtc connect failed (${sdpRes.status}): ${body}` };
    }
    logEvent('session-start', { ok: true, model: REALTIME_MODEL, voice: VOICE, stage: spine.stage() });
    return { answerSdp: await sdpRes.text() };
  } catch (err) {
    logEvent('session-start', { ok: false, error: err.message });
    return { error: `network error: ${err.message}` };
  }
});

// IMPORTANT ordering: macOS only lists an app in the Screen Recording pane
// after it has ATTEMPTED a capture. So we always attempt first (registers the
// app with TCC), and only then handle a missing permission — opening the
// right System Settings pane for the user.

function screenPermissionMissing() {
  return (
    process.platform === 'darwin' &&
    systemPreferences.getMediaAccessStatus('screen') !== 'granted'
  );
}

// Honest, actionable failures. Hiding a fixable problem behind charm made
// users think the product was broken — the duck now says what's wrong and
// exactly where the fix lives.
function permissionError() {
  return {
    error: brain.personalizeStaticPrompt(
      "Your eyes aren't hooked up yet: macOS hasn't granted Quackers screen recording. Tell him, lightly and in ONE sentence, that your eyes need switching on — the little duck in his menu bar has a 'Fix screen vision' button that opens the right settings page (and the app needs a quick restart after). Then move on cheerfully.",
      spine.userName()
    ),
  };
}

function visionRevokedError() {
  return {
    error: brain.personalizeStaticPrompt(
      "Your eyes got switched off: macOS quietly expires the Screen Recording permission sometimes, and it just did. Tell him, lightly and in ONE sentence, that macOS turned your eyes off again and the little duck in his menu bar has a 'Fix screen vision' button that re-opens the right settings page (quick app restart after). Then move on cheerfully.",
      spine.userName()
    ),
  };
}

function openScreenSettings() {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
}

// The privacy line, played as character animation: every capture starts with
// the duck visibly walking out and squinting at the screen. Looking is never
// silent — if the duck can see, you can see the duck seeing.
async function performLookAnimation() {
  if (!win) return;
  win.webContents.send('quackers:looking');
  // long enough for the waddle-to-cursor + squint to read as "it's looking"
  await new Promise((r) => setTimeout(r, 1500));
}

async function captureFullScreen() {
  await performLookAnimation();
  if (win) win.setContentProtection(true); // keep the duck out of its own snapshot
  try {
    const shot = await captureFullScreenInner();
    logEvent('capture-screen', {
      ok: !shot.error,
      error: shot.error,
      wideKB: shot.jpegBase64 ? Math.round(shot.jpegBase64.length / 1024) : 0,
      cropKB: shot.cursorCropBase64 ? Math.round(shot.cursorCropBase64.length / 1024) : 0,
    });
    return shot;
  } catch (err) {
    logEvent('capture-screen', { ok: false, thrown: String(err) });
    if (screenPermissionMissing()) return permissionError();
    return { error: `capture failed: ${String(err)}` };
  } finally {
    if (win) win.setContentProtection(false);
    if (win) win.webContents.send('quackers:looking-done');
  }
}

ipcMain.handle('capture-screen', () => captureFullScreen());

ipcMain.handle('capture-app', async (_event, appName) => {
  const query = String(appName || '').toLowerCase().trim();
  // The most reliable "look at my <app>" is when that app is ALREADY frontmost:
  // it's what's visibly on screen, so a full-screen grab + cursor close-up beats
  // guessing among windows by title. Window "names" are page/document titles, so
  // a title match is fragile — and worse, Chrome's profile chooser is literally
  // titled "Google Chrome" and would win an exact match over the real page. The
  // frontmost-app sense (lsappinfo, no TCC permission) tells us for free.
  const frontApp = senses.snapshot().app || '';
  const front = frontApp.toLowerCase();
  const frontMatches = query && front && (front.includes(query) || query.includes(front));
  await performLookAnimation();
  if (win) win.setContentProtection(true);
  try {
    if (frontMatches) {
      logEvent('capture-app', { ok: 'frontmost', query, front: frontApp });
      const full = await captureFullScreenInner();
      if (full.error) return full;
      return { ...full, windowName: frontApp };
    }
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1280, height: 1280 },
      fetchWindowIcons: false,
    });
    const candidates = sources.filter(
      (s) => s.name && s.name !== 'Quackers' && !s.thumbnail.isEmpty()
    );
    // among title matches, prefer the largest window — real content windows
    // dwarf popovers, choosers, and tooltips that happen to share the app name
    const area = (s) => { const z = s.thumbnail.getSize(); return z.width * z.height; };
    const matches = candidates
      .filter((s) => {
        const n = s.name.toLowerCase();
        return n === query || n.includes(query) || query.includes(n);
      })
      .sort((a, b) => area(b) - area(a));
    const match = matches[0];
    if (match) {
      logEvent('capture-app', { ok: true, query, windowName: match.name, matched: matches.length });
      return { jpegBase64: match.thumbnail.toJPEG(80).toString('base64'), windowName: match.name };
    }
    // No window title matched (windows are titled by content, not app name).
    // Fall back to a full-screen shot and let the vision model find the app.
    logEvent('capture-app', { ok: 'fallback', query, front: frontApp, windows: candidates.map((s) => s.name).slice(0, 10) });
    const full = await captureFullScreenInner();
    if (full.error) return full;
    return { ...full, fallbackFromApp: appName };
  } catch (err) {
    logEvent('capture-app', {
      ok: false,
      query,
      thrown: String(err),
      permissionStatus: systemPreferences.getMediaAccessStatus('screen'),
    });
    if (screenPermissionMissing()) return permissionError();
    return { error: `capture failed: ${String(err)}` };
  } finally {
    if (win) win.setContentProtection(false);
    if (win) win.webContents.send('quackers:looking-done');
  }
});

// the shared capture body — captureFullScreen wraps this with the look
// animation, content protection, and logging; the capture-app fallback calls
// it directly because the duck is already visibly looking.
//
// One native-resolution grab of the display under the cursor yields TWO
// images: a downscaled wide view, and a full-detail close-up centered on the
// cursor — because "look at this" almost always means "look at what I'm
// pointing at".
// Encode under a hard byte budget: WebRTC data-channel messages die (often
// silently, taking the whole channel with them) past ~256KB, so every image
// must land safely below that after base64's 4/3 inflation. Photo-heavy
// screens can blow any fixed width+quality choice — re-encode until it fits.
function jpegUnder(image, maxBytes, quality = 74) {
  let img = image;
  let q = quality;
  let buf = img.toJPEG(q);
  for (let i = 0; i < 4 && buf.length > maxBytes; i++) {
    img = img.resize({ width: Math.max(480, Math.round(img.getSize().width * 0.78)) });
    q = Math.max(50, q - 7);
    buf = img.toJPEG(q);
  }
  return buf;
}

async function captureFullScreenInner() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.size.width, height: display.size.height },
  });
  const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  const img = source && source.thumbnail;
  if (!img || img.isEmpty()) {
    // an empty grab with a "granted" status means macOS silently revoked the
    // permission (Sequoia expires it) — say so instead of gaslighting the user
    logEvent('capture-blank', { permissionStatus: systemPreferences.getMediaAccessStatus('screen'), sources: sources.length });
    return screenPermissionMissing() ? permissionError() : visionRevokedError();
  }

  const size = img.getSize();
  const wide = size.width > 1280 ? img.resize({ width: 1280 }) : img;

  // close-up: ~40% of the display, centered on the cursor, clamped to bounds
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sx = size.width / display.bounds.width;
  const sy = size.height / display.bounds.height;
  const cw = Math.round(clamp(size.width * 0.4, Math.min(640, size.width), size.width));
  const ch = Math.round(clamp(size.height * 0.4, Math.min(420, size.height), size.height));
  const rect = {
    x: Math.round(clamp((cursor.x - display.bounds.x) * sx - cw / 2, 0, size.width - cw)),
    y: Math.round(clamp((cursor.y - display.bounds.y) * sy - ch / 2, 0, size.height - ch)),
    width: cw,
    height: ch,
  };
  let cropBase64 = null;
  try {
    // the crop rect is in NATIVE pixels (1382×894 on a 3456-wide Retina) —
    // shrink before encoding or a photo under the cursor produces a megabyte.
    // This close-up is the image that matters (it's what he's pointing at), so
    // keep it detailed: 1024px keeps small text — code, UI labels — legible and
    // still lands far under budget; jpegUnder pulls it back only if a photo blows it.
    let crop = img.crop(rect);
    if (crop.getSize().width > 1024) crop = crop.resize({ width: 1024 });
    cropBase64 = jpegUnder(crop, 110_000, 80).toString('base64');
  } catch {
    /* close-up is best-effort; the wide shot always ships */
  }

  return {
    jpegBase64: jpegUnder(wide, 140_000).toString('base64'),
    cursorCropBase64: cropBase64,
    // permission-free context so the model is grounded in WHICH app it's seeing,
    // not just pixels — "he's in VS Code" beats squinting at a title bar
    frontApp: senses.snapshot().app || null,
  };
}

ipcMain.handle('memory-add', (_event, note) => {
  spine.addFact(note, 'told-directly', 8);
  backfillEmbeddings();
  return true;
});

ipcMain.handle('dream-research-queue', (_event, input) => {
  const request = spine.queueDreamResearch(input || {});
  logEvent('dream-research-queued', { ok: Boolean(request), count: request ? 1 : 0 });
  return request;
});

ipcMain.handle('remember-name', (_event, name) => {
  const clean = String(name || '').replace(/[\r\n]+/g, ' ').slice(0, 60).trim();
  if (!clean) return false;
  const isFirst = !spine.userName();
  spine.setUserName(clean);
  if (isFirst) spine.addFact(`The person's name is ${clean}`, 'person', 10);
  backfillEmbeddings();
  logEvent('imprinted-name', { name: clean, first: isFirst });
  return true;
});

ipcMain.handle('trick-teach-start', (_event, name) => tricks.startTeaching(name));
ipcMain.handle('trick-teach-finish', (_event, narration) => tricks.finishTeaching(String(narration || '').slice(0, 6000)));
ipcMain.handle('trick-perform', (_event, { name, guidance }) => tricks.perform(name, guidance));
ipcMain.handle('trick-confirm', (_event, approved) => tricks.resolveConfirm(approved));
ipcMain.handle('trick-cancel', () => tricks.cancel());

// ---------------------------------------------------------------------------
// Workshop — the duck builds things (docs/workshop-design.md). The smoke test
// runs in the real renderer sandbox: main hands code over, the renderer boots
// it in a hidden stage iframe and reports back.
// ---------------------------------------------------------------------------

let smokeSeq = 0;
const smokePending = new Map();

function rendererSmoke(code) {
  return new Promise((resolve) => {
    if (!win) return resolve({ ok: false, error: 'no renderer to test on' });
    const token = ++smokeSeq;
    const timer = setTimeout(() => {
      smokePending.delete(token);
      resolve({ ok: false, error: 'test bench timed out' });
    }, 8000);
    smokePending.set(token, { resolve, timer });
    win.webContents.send('quackers:workshop-smoke', { token, code });
  });
}

ipcMain.on('workshop-smoke-result', (_event, { token, ok, error }) => {
  const p = smokePending.get(token);
  if (!p) return;
  clearTimeout(p.timer);
  smokePending.delete(token);
  p.resolve({ ok: Boolean(ok), error: error ? String(error).slice(0, 300) : null });
});

ipcMain.handle('workshop-check', (_event, name) => workshop.checkWorkshop(name));
ipcMain.handle('workshop-build', (_event, req) => workshop.requestBuild(req || {}));
ipcMain.handle('workshop-run', (_event, name) => workshop.runArtifact(name));
ipcMain.handle('workshop-close', () => workshop.closeArtifact());
ipcMain.handle('workshop-equip', (_event, name) => workshop.equipProp(name));
ipcMain.handle('workshop-unequip', (_event, name) => workshop.unequipProp(name));
ipcMain.handle('props-get', () => workshop.equippedPropLayers());
ipcMain.on('workshop-state', (_event, { id, state }) => workshop.saveState(id, state));

ipcMain.handle('game-result', (_event, { game, winner }) => {
  const tally = spine.recordGameResult(game, winner);
  logEvent('game-result', { game, winner, tally });
  return tally;
});

// music rides along so a freshly-loaded renderer starts with the current
// state instead of waiting for the next change
ipcMain.handle('stage-get', () => ({
  ...spine.stageInfo(),
  ...spine.identity(),
  userName: spine.userName(),
  groundOffset,
  music: senses.snapshot().music,
}));

ipcMain.handle('hatch', () => {
  const hatched = spine.hatch();
  if (hatched) logEvent('hatched', {});
  return spine.stageInfo();
});

ipcMain.handle('key-status', () => Boolean(loadApiKey()));

ipcMain.handle('key-save', (_event, key) => {
  const clean = String(key || '').trim();
  if (!/^sk-/.test(clean)) return { ok: false, error: 'that does not look like an OpenAI key (starts with sk-)' };
  try {
    saveEncryptedKey(clean);
    try {
      fs.unlinkSync(path.join(app.getPath('userData'), '.env'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    refreshTray();
    if (win) win.webContents.send('quackers:voice-granted');
    logEvent('key-saved', {});
    backfillEmbeddings();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------------------
// Clip that! — the renderer keeps a rolling recording of the duck's canvas;
// on request it hands us the last ~15s and we save it to the Desktop.
// ---------------------------------------------------------------------------

function requestClip() {
  if (win) win.webContents.send('quackers:clip-request');
}

ipcMain.handle('clip-save', (_event, arrayBuffer) => {
  try {
    const buf = Buffer.from(arrayBuffer);
    if (!buf.length) return { ok: false, error: 'empty clip' };
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const file = path.join(app.getPath('desktop'), `quackers-${stamp}.webm`);
    fs.writeFileSync(file, buf);
    spine.addScrapbookEntry({
      kind: 'clip',
      title: 'A tiny Quackers movie',
      body: `Saved by ${spine.userName() || 'their person'} — fifteen seconds from life on the desktop.`,
      assetPath: file,
      source: 'clip',
      color: 'sky',
    });
    logEvent('clip-saved', { file, bytes: buf.length });
    new Notification({ title: 'Quackers', body: `Clip saved to Desktop (${Math.round(buf.length / 1024)} KB)` }).show();
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------------------
// Retrieval memory — embed new memories, and answer live `recall` queries
// ---------------------------------------------------------------------------

async function embed(texts) {
  return brain.embed({ apiKey: loadApiKey(), texts, log: logEvent });
}

let backfilling = false;
async function backfillEmbeddings() {
  if (backfilling) return;
  backfilling = true;
  try {
    const count = await brain.backfillEmbeddings({ spine, apiKey: loadApiKey(), log: logEvent });
    if (count) logEvent('embed-backfill', { count });
  } finally {
    backfilling = false;
  }
}

ipcMain.handle('recall', (_event, query) =>
  brain.runRecall({ spine, apiKey: loadApiKey(), query, log: logEvent })
);

// ---------------------------------------------------------------------------
// The reasoning layer — the fast voice consults a real reasoning model
// for substantive moments, then speaks the result in character.
// ---------------------------------------------------------------------------

ipcMain.handle('think-hard', async (_event, { question, recent }) => {
  const res = await brain.runThinkHard({ spine, apiKey: loadApiKey(), question, recent, log: logEvent });
  return { answer: res.answer, framed: brain.frameThinkHard(res.answer, spine.userName() || 'your person') };
});

// ---------------------------------------------------------------------------
// Text-chat mode — a typed conversation with the SAME duck. The API key stays
// here (exactly like the realtime broker); the renderer only ever sees streamed
// text and tool effects. On close the transcript flows through the SAME digest
// as a voice conversation, so talking and texting are one continuous memory.
// ---------------------------------------------------------------------------

let chatMessages = null; // running chat/completions message array; null when closed
let chatTranscript = []; // {role:'duck'|'user', text} for the digest, mirroring voice
let chatBusy = false; // a model turn/tool loop is in flight

function chatSend(type, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(type, payload);
}

function toApiToolCall(tc) {
  return { id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } };
}

// Run model turns until one settles with no tool calls (capped so a tool loop
// can never spin). Streams visible text to the panel; runs tools here in main.
async function runChatLoop() {
  if (chatBusy || !chatMessages) return;
  chatBusy = true;
  let closeAfter = false;
  let switchVoiceAfter = false;
  try {
    const apiKey = loadApiKey();
    if (!apiKey) return;
    for (let hop = 0; hop < 6; hop++) {
      chatSend('quackers:chat-typing', true);
      const { text, toolCalls } = await chat.runChatTurn({
        apiKey,
        messages: chatMessages,
        personName: spine.userName(),
        onDelta: (d) => chatSend('quackers:chat-delta', d),
        log: logEvent,
      });
      chatSend('quackers:chat-typing', false);

      if (text) {
        chatMessages.push({
          role: 'assistant',
          content: text,
          ...(toolCalls.length ? { tool_calls: toolCalls.map(toApiToolCall) } : {}),
        });
        chatTranscript.push({ role: 'duck', text });
        chatSend('quackers:chat-turn-end', text);
      } else if (toolCalls.length) {
        chatMessages.push({ role: 'assistant', content: null, tool_calls: toolCalls.map(toApiToolCall) });
      }

      if (!toolCalls.length) break; // settled

      for (const tc of toolCalls) {
        const r = await runChatTool(tc);
        chatMessages.push({ role: 'tool', tool_call_id: tc.id, content: String(r.output) });
        if (r.image) {
          chatMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: r.imageNote || 'This is my screen right now.' },
              { type: 'image_url', image_url: { url: r.image } },
            ],
          });
        }
        if (r.close) closeAfter = true;
        if (r.switchVoice) switchVoiceAfter = true;
      }
    }
  } catch (err) {
    logEvent('chat-loop-error', { error: String(err && err.message) });
  } finally {
    chatBusy = false;
    chatSend('quackers:chat-typing', false);
    chatSend('quackers:chat-idle'); // re-enable the input box
  }

  if (switchVoiceAfter) {
    endChat({ digest: true });
    chatSend('quackers:chat-switch-voice');
  } else if (closeAfter) {
    endChat({ digest: true, tellRenderer: true });
  }
}

async function runChatTool(tc) {
  const { name, args } = tc;
  try {
    switch (name) {
      case 'emote':
        chatSend('quackers:chat-emote', String(args.emotion || 'happy'));
        return { output: 'ok' };
      case 'recall': {
        const res = await brain.runRecall({ spine, apiKey: loadApiKey(), query: String(args.query || ''), log: logEvent });
        return { output: res.output };
      }
      case 'remember':
        spine.addFact(String(args.note || ''), 'told-directly', 8);
        backfillEmbeddings();
        return { output: 'saved to memory' };
      case 'research_tonight': {
        const request = spine.queueDreamResearch({
          topic: String(args.topic || ''),
          question: String(args.question || ''),
        });
        return {
          output: request
            ? `queued for the next dream: ${request.topic}; it will return with sources and an invitation, not interrupt on its own`
            : 'the research topic was empty',
        };
      }
      case 'offer_dream_thought': {
        const offer = takeDreamOfferForConversation(Boolean(args.prompted));
        return {
          output: offer.ok
            ? `Offer this thought now, briefly: "${offer.opener}" Then ask if they want to hear more.`
            : `${offer.reason}; do not mention the overnight thought right now`,
        };
      }
      case 'scrapbook_moment': {
        const saved = spine.addScrapbookEntry({
          kind: 'moment',
          title: String(args.title || ''),
          body: String(args.body || ''),
          color: String(args.color || 'butter'),
          source: 'chat',
        });
        return { output: saved ? 'pinned into the shared scrapbook' : 'nothing to pin' };
      }
      case 'leave_sticky_note': {
        const reminder = spine.addReminder({
          text: String(args.text || ''),
          dueAt: String(args.due_at || ''),
          color: String(args.color || 'butter'),
        });
        if (reminder && reminder.status === 'open') deliverStickyReminder(reminder);
        notifyReminderWindows();
        return {
          output: reminder
            ? (reminder.status === 'open' ? 'the physical sticky is on the desktop now' : `scheduled for ${reminder.dueAt}`)
            : 'nothing to stick',
        };
      }
      case 'set_work_guard': {
        const guard = spine.setWorkGuard({ minutes: Number(args.minutes), message: String(args.message || '') });
        notifyReminderWindows();
        return { output: `work guard on every ${guard.minutes} active minutes; Focus, calls, and idle time stay quiet` };
      }
      case 'clear_work_guard':
        spine.clearWorkGuard();
        notifyReminderWindows();
        return { output: 'work guard off' };
      case 'remember_name': {
        const clean = String(args.name || '').replace(/[\r\n]+/g, ' ').slice(0, 60).trim();
        if (clean) {
          const first = !spine.userName();
          spine.setUserName(clean);
          if (first) spine.addFact(`The person's name is ${clean}`, 'person', 10);
          backfillEmbeddings();
          logEvent('imprinted-name', { name: clean, first, mode: 'chat' });
        }
        return { output: 'imprinted' };
      }
      case 'look_at_screen':
      case 'look_at_app': {
        // v1 chat routes both through the full-screen grab (+cursor close-up);
        // app-specific isolation is a voice-parity follow-up.
        chatSend('quackers:chat-looking', true);
        let shot;
        try { shot = await captureFullScreen(); } finally { chatSend('quackers:chat-looking', false); }
        if (shot.error) return { output: shot.error };
        return {
          output: `looked — ${spine.userName() || 'your person'}'s screen is attached below; react to what is actually there, specifics not vibes`,
          image: `data:image/jpeg;base64,${shot.jpegBase64}`,
          imageNote: 'This is my screen right now.',
        };
      }
      case 'switch_to_voice':
        return { output: 'switching to voice', switchVoice: true };
      case 'end_chat':
        return { output: 'closing chat', close: true };
      default:
        return { output: `unknown tool ${name}` };
    }
  } catch (err) {
    logEvent('chat-tool-error', { name, error: String(err && err.message) });
    return { output: 'that did not work just now — carry on gracefully' };
  }
}

function endChat({ digest = false, tellRenderer = false } = {}) {
  if (win && !win.isDestroyed()) win.setFocusable(false); // restore the click-through pet
  if (tellRenderer) chatSend('quackers:chat-close');
  if (!chatMessages) return;
  chatMessages = null;
  if (digest && chatTranscript.length >= 2) {
    const lines = chatTranscript.slice();
    logEvent('conversation-transcript', { lines, mode: 'chat' });
    brain.runDigest({ spine, apiKey: loadApiKey(), lines, log: logEvent }).then((d) => {
      if (d) { backfillEmbeddings(); chatSend('quackers:digested'); }
    });
  }
  chatTranscript = [];
  logEvent('chat-close', {});
}

ipcMain.handle('chat-open', () => {
  const apiKey = loadApiKey();
  if (!apiKey) return { error: 'no-voice' };
  spine.touchConversation();
  chatMessages = [
    { role: 'system', content: chat.buildChatInstructions({ spine, ambientLine: senses.ambientLine() }) },
    { role: 'system', content: `Open the chat as yourself — one tiny warm hello text. Use ${spine.userName() || 'your person'}'s name, and if there is a live thread worth touching (yesterday, a plan, a running bit), brush it in a few words. Short.` },
  ];
  chatTranscript = [];
  if (win && !win.isDestroyed()) { win.setFocusable(true); win.focus(); }
  logEvent('chat-open', {});
  runChatLoop(); // greeting streams in; don't block the open
  return { ok: true };
});

ipcMain.handle('chat-send', async (_event, text) => {
  if (!chatMessages) return { error: 'chat not open' };
  if (chatBusy) return { busy: true };
  const clean = String(text || '').slice(0, 4000);
  if (!clean.trim()) return { ok: true };
  chatMessages.push({ role: 'user', content: clean });
  chatTranscript.push({ role: 'user', text: clean });
  await runChatLoop();
  return { ok: true };
});

ipcMain.handle('chat-close', () => { endChat({ digest: true }); return { ok: true }; });

// ---------------------------------------------------------------------------
// Digestion — after each conversation, a background model turns the
// transcript into structured memory (facts, episode, open loops, bits, and a
// fast-decaying read on how he seemed).
// ---------------------------------------------------------------------------

ipcMain.on('digest-transcript', async (_event, lines) => {
  if (!Array.isArray(lines)) return;
  logEvent('conversation-transcript', { lines, mode: 'voice' });
  const digest = await brain.runDigest({ spine, apiKey: loadApiKey(), lines, log: logEvent });
  if (digest) {
    backfillEmbeddings(); // make the new memories retrievable
    if (win) win.webContents.send('quackers:digested');
  }
});

ipcMain.on('happening', (_event, { type, detail }) => {
  if (['pet', 'toss', 'feed', 'chase', 'mischief'].includes(type)) {
    spine.addHappening(type, detail);
    logEvent('happening', { type, detail });
  }
});

ipcMain.handle('spine-get', () => spine.getAll());
ipcMain.handle('spine-delete', (_event, { type, id }) => spine.deleteItem(type, id));
ipcMain.handle('spine-edit', (_event, { id, statement }) => {
  const ok = spine.updateFact(id, statement);
  if (ok) backfillEmbeddings();
  return ok;
});
ipcMain.handle('dream-settings-get', () => spine.dreamSettings());
ipcMain.handle('dream-settings-set', (_event, settings) => {
  const updated = spine.setDreamSettings(settings || {});
  logEvent('dream-settings', { on: updated.researchEnabled });
  return updated;
});
ipcMain.handle('dream-source-open', async (_event, rawUrl) => {
  const url = String(rawUrl || '').slice(0, 1200);
  if (!/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

// ---------------------------------------------------------------------------
// Scrapbook — a local, human-curated layer above memory. Memory helps the duck
// think; scrapbook is for the person to revisit.
// ---------------------------------------------------------------------------

let scrapbookWin = null;

function openScrapbookWindow() {
  if (scrapbookWin) {
    scrapbookWin.focus();
    return;
  }
  scrapbookWin = new BrowserWindow({
    width: 860,
    height: 700,
    minWidth: 600,
    minHeight: 480,
    title: `${spine.duckName()}'s scrapbook`,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  scrapbookWin.loadFile(path.join(__dirname, 'renderer', 'scrapbook.html'));
  scrapbookWin.on('closed', () => { scrapbookWin = null; });
}

ipcMain.handle('scrapbook-add', (_event, entry) => spine.addScrapbookEntry(entry || {}));
ipcMain.handle('scrapbook-list', () => spine.scrapbookEntries());
ipcMain.handle('scrapbook-pin', (_event, { id, pinned }) => spine.setScrapbookPinned(String(id || ''), pinned));
ipcMain.handle('scrapbook-delete', (_event, id) => spine.deleteItem('scrapbook', String(id || '')));
ipcMain.handle('scrapbook-open-asset', async (_event, id) => {
  const entry = spine.scrapbookEntries().find((item) => item.id === id);
  if (!entry || !entry.assetPath || !fs.existsSync(entry.assetPath)) return { ok: false, error: 'that keepsake file is no longer here' };
  const error = await shell.openPath(entry.assetPath);
  return error ? { ok: false, error } : { ok: true };
});

// ---------------------------------------------------------------------------
// Physical reminders — each due reminder becomes its own movable, always-on-top
// sticky. Closing is explicit: done, snooze, or put away.
// ---------------------------------------------------------------------------

let remindersWin = null;
const stickyWindows = new Map();
const stickyDeliveryQueue = [];
let stickyDeliveryActive = null;

function notifyReminderWindows() {
  if (remindersWin && !remindersWin.isDestroyed()) remindersWin.webContents.send('quackers:reminders-changed');
}

function stickyBounds(reminder) {
  const area = screen.getPrimaryDisplay().workArea;
  const fallback = {
    width: 300,
    height: 290,
    x: area.x + area.width - 330 - (stickyWindows.size % 3) * 24,
    y: area.y + 40 + (stickyWindows.size % 5) * 28,
  };
  const wanted = reminder.bounds || fallback;
  const width = Math.max(230, Math.min(520, Number(wanted.width) || fallback.width));
  const height = Math.max(210, Math.min(620, Number(wanted.height) || fallback.height));
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(area.x + area.width - width, Number(wanted.x) || fallback.x)),
    y: Math.max(area.y, Math.min(area.y + area.height - height, Number(wanted.y) || fallback.y)),
  };
}

function closeSticky(id) {
  const noteWin = stickyWindows.get(id);
  if (noteWin && !noteWin.isDestroyed()) noteWin.close();
}

function finishStickyDelivery(id, phase = 'ack') {
  if (!stickyDeliveryActive || stickyDeliveryActive.id !== id) return;
  clearTimeout(stickyDeliveryActive.timer);
  const { notify } = stickyDeliveryActive;
  stickyDeliveryActive = null;
  const reminder = spine.reminders(true).find((item) => item.id === id);
  if (reminder && !['done', 'hidden'].includes(reminder.status)) {
    showStickyReminder(reminder, { notify });
  }
  logEvent('sticky-delivery', { phase });
  setTimeout(pumpStickyDeliveries, 250);
}

function pumpStickyDeliveries() {
  if (stickyDeliveryActive) return;
  let job = null;
  while (stickyDeliveryQueue.length && !job) {
    const candidate = stickyDeliveryQueue.shift();
    const reminder = spine.reminders(true).find((item) => item.id === candidate.id);
    if (reminder && !['done', 'hidden'].includes(reminder.status)) job = { ...candidate, reminder };
  }
  if (!job) return;
  if (!win || win.isDestroyed() || !win.webContents) {
    showStickyReminder(job.reminder, { notify: job.notify });
    setTimeout(pumpStickyDeliveries, 0);
    return;
  }

  stickyDeliveryActive = { id: job.id, notify: job.notify, timer: null };
  const begin = () => {
    if (!stickyDeliveryActive || stickyDeliveryActive.id !== job.id || !win || win.isDestroyed()) {
      finishStickyDelivery(job.id, 'fallback');
      return;
    }
    win.webContents.send('quackers:sticky-delivery', {
      id: job.id,
      text: job.reminder.text,
      color: job.reminder.color,
    });
    stickyDeliveryActive.timer = setTimeout(() => finishStickyDelivery(job.id, 'fallback'), 5200);
  };

  if (!win.isVisible()) {
    win.showInactive();
    win.webContents.send('quackers:arrive');
    setTimeout(begin, 700);
  } else {
    begin();
  }
}

function deliverStickyReminder(reminder, { notify = false } = {}) {
  if (!reminder || ['done', 'hidden'].includes(reminder.status)) return false;
  if (stickyWindows.has(reminder.id)) return showStickyReminder(reminder, { notify });
  if (
    (stickyDeliveryActive && stickyDeliveryActive.id === reminder.id) ||
    stickyDeliveryQueue.some((item) => item.id === reminder.id)
  ) return true;
  stickyDeliveryQueue.push({ id: reminder.id, notify: Boolean(notify) });
  pumpStickyDeliveries();
  return true;
}

function showStickyReminder(reminder, { notify = false } = {}) {
  if (!reminder || reminder.status === 'done') return false;
  const existing = stickyWindows.get(reminder.id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return true;
  }
  const noteWin = new BrowserWindow({
    ...stickyBounds(reminder),
    frame: false,
    transparent: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'A note from Quackers',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  stickyWindows.set(reminder.id, noteWin);
  noteWin.setAlwaysOnTop(true, 'floating');
  noteWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  noteWin.loadFile(path.join(__dirname, 'renderer', 'sticky.html'), { query: { id: reminder.id } });
  let boundsTimer = null;
  const persistBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!noteWin.isDestroyed()) spine.updateReminder(reminder.id, { bounds: noteWin.getBounds() });
    }, 200);
  };
  noteWin.on('move', persistBounds);
  noteWin.on('resize', persistBounds);
  noteWin.on('closed', () => {
    clearTimeout(boundsTimer);
    stickyWindows.delete(reminder.id);
    notifyReminderWindows();
  });
  spine.updateReminder(reminder.id, { status: 'open', shown: true });
  if (notify) {
    new Notification({ title: `${spine.duckName()} left you a note`, body: reminder.text.slice(0, 180) }).show();
  }
  notifyReminderWindows();
  return true;
}

function checkDueReminders() {
  const now = Date.now();
  for (const reminder of spine.reminders()) {
    if (reminder.status === 'scheduled' && Date.parse(reminder.dueAt) <= now) {
      deliverStickyReminder(reminder, { notify: !reminder.lastShownAt });
    }
  }
}

function startReminderLoop() {
  setTimeout(() => {
    for (const reminder of spine.reminders()) {
      if (reminder.status === 'open') showStickyReminder(reminder);
    }
    checkDueReminders();
  }, 2500);
  setInterval(checkDueReminders, 30000);
}

function openRemindersWindow() {
  if (remindersWin) {
    remindersWin.focus();
    return;
  }
  remindersWin = new BrowserWindow({
    width: 620,
    height: 690,
    minWidth: 520,
    minHeight: 500,
    title: 'Sticky notes & work guard',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  remindersWin.loadFile(path.join(__dirname, 'renderer', 'reminders.html'));
  remindersWin.on('closed', () => { remindersWin = null; });
}

ipcMain.handle('reminder-add', (_event, input) => {
  const reminder = spine.addReminder(input || {});
  if (reminder && reminder.status === 'open') deliverStickyReminder(reminder);
  notifyReminderWindows();
  return reminder;
});
ipcMain.on('sticky-delivery-ready', (_event, id) => finishStickyDelivery(String(id || ''), 'animated'));
ipcMain.handle('reminder-list', (_event, includeDone) => spine.reminders(Boolean(includeDone)));
ipcMain.handle('reminder-get', (_event, id) => spine.reminders(true).find((item) => item.id === id) || null);
ipcMain.handle('reminder-show', (_event, id) => {
  const reminder = spine.reminders(true).find((item) => item.id === id);
  if (!reminder || reminder.status === 'done') return false;
  return showStickyReminder(reminder);
});
ipcMain.handle('reminder-done', (_event, id) => {
  const updated = spine.updateReminder(String(id || ''), { status: 'done' });
  closeSticky(String(id || ''));
  notifyReminderWindows();
  return updated;
});
ipcMain.handle('reminder-snooze', (_event, { id, minutes }) => {
  const delay = Math.max(5, Math.min(1440, Number(minutes) || 15));
  const updated = spine.updateReminder(String(id || ''), { dueAt: new Date(Date.now() + delay * 60000).toISOString() });
  closeSticky(String(id || ''));
  notifyReminderWindows();
  return updated;
});
ipcMain.handle('reminder-dismiss', (_event, id) => {
  const updated = spine.updateReminder(String(id || ''), { status: 'hidden' });
  closeSticky(String(id || ''));
  notifyReminderWindows();
  return updated;
});
ipcMain.handle('reminder-delete', (_event, id) => {
  closeSticky(String(id || ''));
  const deleted = spine.deleteItem('reminders', String(id || ''));
  notifyReminderWindows();
  return deleted;
});
ipcMain.handle('work-guard-get', () => spine.workGuard());
ipcMain.handle('work-guard-set', (_event, settings) => {
  const guard = spine.setWorkGuard(settings || {});
  notifyReminderWindows();
  return guard;
});
ipcMain.handle('work-guard-clear', () => {
  const guard = spine.clearWorkGuard();
  notifyReminderWindows();
  return guard;
});

// ---------------------------------------------------------------------------
// Explicit computer primitives — no arbitrary commands and no background use.
// ---------------------------------------------------------------------------

ipcMain.handle('computer-action', async (_event, input) => {
  const checked = computerPrimitives.validateAction(input);
  if (!checked.ok) return checked;
  const action = checked.action;
  if (
    process.platform === 'darwin' &&
    ['press_keys', 'type_text'].includes(action.action) &&
    !systemPreferences.isTrustedAccessibilityClient(false)
  ) {
    return { ok: false, error: `macOS has not given ${spine.duckName()} Accessibility access yet — use “Give it hands” in the menu bar first.` };
  }
  if (computerPrimitives.needsConfirmation(action)) {
    const answer = await dialog.showMessageBox({
      type: 'warning',
      title: `${spine.duckName()} is about to use the keyboard`,
      message: computerPrimitives.describeAction(action),
      detail: 'This happens once in the app that was frontmost when you asked.',
      buttons: ['Cancel', 'Do it'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) return { ok: false, cancelled: true, error: 'cancelled' };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const result = await computerPrimitives.runAction(action);
  logEvent('computer-primitive', { action: action.action, ok: result.ok });
  return result;
});

// ---------------------------------------------------------------------------
// Codex + Claude Code — one-click hook merge, local loopback events only.
// ---------------------------------------------------------------------------

let integrationsWin = null;

function integrationOptions() {
  return { homeDir: app.getPath('home'), userDataDir: app.getPath('userData') };
}

function openIntegrationsWindow() {
  if (integrationsWin) {
    integrationsWin.focus();
    return;
  }
  integrationsWin = new BrowserWindow({
    width: 650,
    height: 560,
    minWidth: 560,
    minHeight: 450,
    title: 'Coding buddy connections',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  integrationsWin.loadFile(path.join(__dirname, 'renderer', 'integrations.html'));
  integrationsWin.on('closed', () => { integrationsWin = null; });
}

ipcMain.handle('integration-status', () =>
  ['codex', 'claude'].map((kind) => integrations.integrationStatus(kind, integrationOptions()))
);
ipcMain.handle('integration-install', (_event, kind) => {
  if (!['codex', 'claude'].includes(kind)) return { error: 'unknown integration' };
  try {
    const result = integrations.installIntegration(kind, integrationOptions());
    logEvent('integration-installed', { kind });
    return result;
  } catch (error) {
    logEvent('integration-install-failed', { kind });
    return { kind, installed: false, error: error.message };
  }
});
ipcMain.handle('integration-remove', (_event, kind) => {
  if (!['codex', 'claude'].includes(kind)) return { error: 'unknown integration' };
  try {
    const result = integrations.removeIntegration(kind, integrationOptions());
    logEvent('integration-removed', { kind });
    return result;
  } catch (error) {
    return { kind, installed: false, error: error.message };
  }
});

// ---------------------------------------------------------------------------
// Memory dashboard — "What Quackers remembers"
// ---------------------------------------------------------------------------

let memWin = null;

function openMemoryWindow() {
  if (memWin) {
    memWin.focus();
    return;
  }
  memWin = new BrowserWindow({
    width: 620,
    height: 720,
    title: 'What Quackers remembers',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  memWin.loadFile(path.join(__dirname, 'renderer', 'memory.html'));
  memWin.on('closed', () => {
    memWin = null;
  });
}

// ---------------------------------------------------------------------------
// "Give Quackers a voice" — tiny key-setup window for keyless installs
// ---------------------------------------------------------------------------

let keyWin = null;

function openKeyWindow() {
  if (keyWin) {
    keyWin.focus();
    return;
  }
  keyWin = new BrowserWindow({
    width: 460,
    height: 320,
    title: 'Give Quackers a voice',
    resizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  keyWin.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  keyWin.on('closed', () => {
    keyWin = null;
  });
}

ipcMain.on('open-key-window', () => openKeyWindow());

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => app.quit());
