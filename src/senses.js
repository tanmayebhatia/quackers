// Tier-0 ambient senses — the duck's awareness of its world WITHOUT any
// macOS permissions and without ever reading screen content. Everything here
// is metadata the OS hands out freely: which app is frontmost, whether Do Not
// Disturb is on, battery, idle time. This is what makes the duck feel present
// ("you've been in Figma for two hours") while keeping the hard promise that
// it never *looks* unless asked.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const state = {
  app: null, // frontmost app name
  appSince: null, // when the current frontmost app took focus
  dnd: false,
  battery: null, // 0-100
  charging: null,
  lastCallOnTop: 0, // last time a call app was frontmost
  music: null, // { track, artist, app } while a player is playing (consent-gated)
  updatedAt: 0,
};

// Video calls: the frontmost-app sense already knows when a meeting app is up.
// Detection stays sticky for a bit after the call app leaves the front — people
// alt-tab to notes mid-call, and the duck barging in then is exactly as rude.
const CALL_LINGER_MS = 2 * 60 * 1000;
const CALL_APP_TOKENS = ['zoom', 'facetime', 'webex', 'microsoft teams', 'teams'];

function isCallApp(name) {
  const n = String(name || '').toLowerCase();
  return CALL_APP_TOKENS.some((t) => (t.includes(' ') ? n === t : n === t || n.includes(t)));
}

function onCallNow() {
  return (state.app && isCallApp(state.app)) || Date.now() - state.lastCallOnTop < CALL_LINGER_MS;
}

// lsappinfo reads the launch-services list WITHOUT any TCC permission —
// osascript-into-System-Events would pop an Apple Events consent dialog,
// which would break the "tier-0 asks for nothing" promise on first launch.
function pollFrontmostApp() {
  execFile('lsappinfo', ['front'], { timeout: 4000 }, (err, asnOut) => {
    const asn = !err && asnOut && asnOut.trim();
    if (!asn) return;
    execFile('lsappinfo', ['info', '-only', 'name', asn], { timeout: 4000 }, (err2, stdout) => {
      if (err2 || !stdout) return;
      const m = stdout.match(/"LSDisplayName"\s*=\s*"([^"]+)"/);
      const name = m && m[1];
      if (name && name !== state.app) {
        state.app = name;
        state.appSince = Date.now();
      }
      if (name && isCallApp(name)) state.lastCallOnTop = Date.now();
    });
  });
}

// ---------------------------------------------------------------------------
// Music (tier-1: explicitly consented via the tray toggle). Asking a player
// for its state is an Apple Event, which pops a one-time macOS consent dialog
// per player — that's the visible-consent moment, not a cost to hide. We check
// the player is even running first (pgrep needs no TCC) so the prompt only
// ever appears for an app the user actually uses.
// ---------------------------------------------------------------------------

let musicEnabled = false;
let musicListener = null;
let lastMusicKey = '';

// main subscribes once; fires immediately on every play/pause/track change so
// the headphones go on and off with the music, not with a polling tick
function onMusicChange(cb) {
  musicListener = cb;
}

function setMusic(music) {
  state.music = music;
  const key = music ? `${music.track}|${music.artist}` : '';
  if (key !== lastMusicKey) {
    lastMusicKey = key;
    if (musicListener) musicListener(music);
  }
}

const PLAYERS = [
  { app: 'Spotify', process: 'Spotify' },
  { app: 'Music', process: 'Music' },
];

function queryPlayer(player, cb) {
  execFile('pgrep', ['-x', player.process], { timeout: 4000 }, (err) => {
    if (err) return cb(null); // not running — never wake an app to interrogate it
    const script = `tell application "${player.app}" to if player state is playing then return (name of current track) & "|||" & (artist of current track)`;
    execFile('osascript', ['-e', script], { timeout: 6000 }, (err2, out) => {
      if (err2 || !out || !out.includes('|||')) return cb(null);
      const [track, artist] = out.trim().split('|||');
      cb({
        track: String(track || '').trim().slice(0, 80),
        artist: String(artist || '').trim().slice(0, 80),
        app: player.app,
      });
    });
  });
}

function pollMusic() {
  if (!musicEnabled) return;
  queryPlayer(PLAYERS[0], (hit) => {
    if (hit) {
      setMusic(hit);
      return;
    }
    queryPlayer(PLAYERS[1], (hit2) => {
      setMusic(hit2);
    });
  });
}

function setMusicEnabled(on) {
  musicEnabled = !!on;
  if (!musicEnabled) setMusic(null);
  else pollMusic();
}

// macOS (Monterey+) records active Focus assertions here; presence of an
// assertion record = a Focus mode (incl. DND) is on. Best-effort — any
// parse failure just reads as "not in DND". Async so the main process never
// blocks on disk for an ambient signal.
function pollDnd() {
  const p = path.join(os.homedir(), 'Library', 'DoNotDisturb', 'DB', 'Assertions.json');
  fs.promises
    .readFile(p, 'utf8')
    .then((txt) => {
      const data = JSON.parse(txt);
      const records = data && data.data && data.data[0] && data.data[0].storeAssertionRecords;
      state.dnd = Array.isArray(records) && records.length > 0;
    })
    .catch(() => {
      state.dnd = false;
    });
}

function pollBattery() {
  execFile('pmset', ['-g', 'batt'], { timeout: 4000 }, (err, stdout) => {
    if (err || !stdout) return;
    const m = stdout.match(/(\d{1,3})%;\s*(\w+)/);
    if (m) {
      state.battery = Number(m[1]);
      state.charging = m[2] !== 'discharging';
    }
  });
}

let timers = [];

function start() {
  if (process.platform !== 'darwin') return;
  stop();
  pollFrontmostApp();
  pollDnd();
  pollBattery();
  timers = [
    setInterval(pollFrontmostApp, 30000), // minutes-granularity signal; no need to poll harder
    setInterval(pollDnd, 20000),
    setInterval(pollBattery, 60000),
    setInterval(pollMusic, 8000), // cheap (pgrep-gated); no-ops unless the tray toggle consented
  ];
  timers.forEach((t) => t.unref && t.unref());
}

function stop() {
  timers.forEach(clearInterval);
  timers = [];
}

function snapshot() {
  return {
    app: state.app,
    appMinutes: state.appSince ? Math.round((Date.now() - state.appSince) / 60000) : null,
    dnd: state.dnd,
    battery: state.battery,
    charging: state.charging,
    onCall: onCallNow(),
    music: state.music,
  };
}

// One line for the live prompt: the duck's sense of "now".
// Pure over a snapshot so the lab/tests can exercise it without polling.
function ambientLineFrom(s) {
  const bits = [];
  if (s.app) bits.push(`he's in ${s.app}${s.appMinutes >= 20 ? ` (for ${s.appMinutes} min straight)` : ''}`);
  if (s.onCall) bits.push("he seems to be on a call — if he talks to you, keep it extra brief and quiet");
  if (s.music) bits.push(`there's music on — "${s.music.track}" by ${s.music.artist}`);
  if (s.battery != null && !s.charging && s.battery <= 20) bits.push(`his battery is at ${s.battery}% and falling`);
  if (!bits.length) return '';
  return `AMBIENT NOW (what you can sense without looking): ${bits.join('; ')}.`;
}

function ambientLine() {
  return ambientLineFrom(snapshot());
}

module.exports = { start, stop, snapshot, ambientLine, ambientLineFrom, setMusicEnabled, onMusicChange, isCallApp };
