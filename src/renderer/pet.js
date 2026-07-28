// Quackers — a little egg-duck that lives on your screen.
// Everything is drawn as chunky pixels on one transparent canvas.

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// Canvas / DPI
// ---------------------------------------------------------------------------

let W = 0; // CSS pixel width
let H = 0; // CSS pixel height

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Sprite
// ---------------------------------------------------------------------------

const PX = 6; // screen pixels per sprite pixel
const COLS = 14;
const ROWS = 13; // body only; feet are drawn separately

const COLORS = {
  C: '#fff4da', // shell cream
  O: '#e8d5ac', // soft outline
  E: '#33302e', // eyes
  B: '#f79e2d', // beak
  b: '#d97f14', // beak underside
  K: '#ffc9c4', // cheeks
  F: '#e8891a', // feet
};

// the chosen quacker (set at boot from the spine; every egg is classic cream —
// what hatches out of it is yours)
let activeSkin = window.QUACKERS_SKINS.SKINS.classic;
let SKIN_COLORS = { ...COLORS };

function applySkin(id) {
  activeSkin = window.QUACKERS_SKINS.SKINS[id] || window.QUACKERS_SKINS.SKINS.classic;
  SKIN_COLORS = { ...COLORS, ...activeSkin.colors };
}

// Egg body, 14x13. '.' = transparent.
const BODY = [
  '.....OCCCCO...',
  '...OCCCCCCCO..',
  '..OCCCCCCCCCO.',
  '..OCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '..OCCCCCCCCO..',
  '..OCCCCCCCCO..',
  '...OCCCCCCO...',
];

// Face overlays (drawn on top of BODY, shifted by faceDir to "look" left/right)
const EYES = {
  open: [[3, 4], [4, 4], [3, 5], [4, 5], [9, 4], [10, 4], [9, 5], [10, 5]],
  blink: [[3, 5], [4, 5], [9, 5], [10, 5]],
  happy: [[3, 5], [4, 4], [5, 5], [8, 5], [9, 4], [10, 5]],
  sleep: [[3, 5], [4, 5], [9, 5], [10, 5]],
  wide: [[3, 3], [4, 3], [9, 3], [10, 3], [3, 4], [4, 4], [3, 5], [4, 5], [9, 4], [10, 4], [9, 5], [10, 5]],
};

// hairline cracks that spread as the egg gets close to hatching
const CRACKS = [
  [[7, 3], [6, 4], [7, 5]],
  [[4, 7], [5, 8], [4, 9], [9, 2], [10, 3]],
  [[8, 7], [9, 8], [8, 9], [3, 4], [2, 5], [11, 6], [10, 7]],
];
const CRACK_COLOR = '#c9b689';
const BEAK = { B: [[5, 6], [6, 6], [7, 6], [8, 6]], b: [[6, 7], [7, 7]] };
const CHEEKS = [[2, 8], [3, 8], [10, 8], [11, 8]];

const DUCK_W = COLS * PX;
const DUCK_H = ROWS * PX;

// ---------------------------------------------------------------------------
// Duck state
// ---------------------------------------------------------------------------

const GROUND_PAD = 2;
const MARGIN = 30;

const duck = {
  x: 0,
  y: 0, // bottom of body
  vx: 0,
  vy: 0,
  // idle | wander | approach | peck | preen | hop | look | sleep |
  // jump | dragged | falling | poof
  state: 'idle',
  stateT: 0,
  stateDur: 2,
  targetX: null,
  speed: 55,
  hopsLeft: 0,
  hopPause: 0,
  faceDir: 0, // -1 left, 0 center, 1 right
  walkPhase: 0,
  rock: 0,
  squashX: 1,
  squashY: 1,
  alpha: 1,
  eyes: 'open',
  blinkIn: 3,
  blinkT: 0,
  happyT: 0,
  zIn: 0,
  bubble: null,
  bubbleT: 0,
  quackIn: 12 + Math.random() * 15,
  greetOnLand: false,
  lastPlan: 'idle',
};

// The dock is a moving floor. main.js measures the auto-hiding dock's resting
// height (0 if the dock is always-visible or not at the bottom); the renderer
// mirrors the dock's own show/hide trigger — cursor hits the bottom edge —
// and smoothly lifts the ground so the duck rides up ON TOP of the dock when
// it slides out, and settles back to the true bottom when it hides.
let dockOffset = 0; // measured dock height (0 = no dynamic dock at the bottom)
let dockLift = 0; // current animated ground lift
let dockShown = false;
let dockHideAt = 0;

function groundY() {
  return H - GROUND_PAD - PX - dockLift; // leave room for feet (and the dock)
}

function setDockOffset(offset) {
  dockOffset = Math.max(0, Number(offset) || 0);
}

const GROUNDED_STATES = [
  'idle', 'wander', 'approach', 'peck', 'preen', 'look', 'sleep',
  'goToCrumb', 'eatCrumb', 'looking', 'trip', 'hatching',
];

function updateDockLift(dt) {
  if (dockOffset > 0) {
    const cursorFresh = cursor.y != null && performance.now() - cursor.seenAt < 2000;
    if (cursorFresh && cursor.y >= H - 3) {
      dockShown = true; // cursor slammed the bottom edge — the dock is coming
      dockHideAt = 0;
    } else if (dockShown && (!cursorFresh || cursor.y < H - dockOffset - 12)) {
      // cursor left the dock zone — the dock hides after a beat
      if (!dockHideAt) dockHideAt = performance.now() + 500;
      else if (performance.now() > dockHideAt) {
        dockShown = false;
        dockHideAt = 0;
      }
    } else {
      dockHideAt = 0;
    }
  } else {
    dockShown = false;
  }

  const target = dockShown ? dockOffset : 0;
  if (Math.abs(target - dockLift) > 0.5) {
    dockLift += (target - dockLift) * Math.min(1, dt * 9); // ~dock animation speed
    // the floor moved: grounded things ride it
    if (GROUNDED_STATES.includes(duck.state) || (egg.mode && duck.state !== 'falling' && duck.state !== 'dragged')) {
      duck.y = groundY();
    }
    for (const c of crumbs) if (c.landed) c.y = groundY() + PX;
  } else if (dockLift !== target) {
    dockLift = target;
  }
}
duck.x = W * 0.3;
duck.y = groundY();

// The very first thing that ever happens: an egg falls out of the sky.
function dropEgg() {
  egg.mode = true;
  duck.x = clampX(W * 0.38);
  duck.y = groundY() - Math.max(260, H * 0.45);
  duck.vy = 0;
  duck.state = 'falling';
  duck.stateT = 0;
}

// after the pick-your-quacker window: the chosen egg drops
window.quackers.onEggDrop(async () => {
  const info = await window.quackers.stageGet();
  applySkin(info.skin);
  if (info.stage === 'egg') dropEgg();
});

// Find out who we are before drawing a single frame: a duck, an egg —
// or (first run) nothing yet, waiting for onboarding to finish.
(async () => {
  try {
    const [info, hasKey] = await Promise.all([window.quackers.stageGet(), window.quackers.keyStatus()]);
    egg.hasVoice = !!hasKey;
    setDockOffset(info.groundOffset);
    applySkin(info.skin);
    musicNow = info.music || null; // music may already be playing at boot
    if (info.stage === 'egg' && !info.onboarded) {
      duck.state = 'hidden'; // the picker window is up; the egg waits
    } else if (info.stage === 'egg') {
      dropEgg();
    }
  } catch {
    /* default to duck */
  }
  stageKnown = true;
})();

const QUACKS = ['quack!', 'quack quack', 'quack?', '*preens*', 'quaaack', '...quack'];
const GREETS = ['quack!', 'quack quack!', '*happy quack*'];

const cursor = { x: null, y: null, seenAt: -Infinity };

// voice-layer state (driven by voice.js through window.duckAPI)
let voiceState = 'idle'; // idle | connecting | listening | speaking
let speakLevel = 0;
let followMode = false;
let followHopAt = 0; // last excited "I see you up there" hop while following
let thinking = false; // consulting the deeper brain (think_hard)

// crumbs (right-click the duck to toss one)
const crumbs = []; // {x, y, vy, landed}

// chase game
let chaseStartAt = 0;
let fleeJump = null; // {vx, vy} while mid-leap

// interaction throttles
let lastQuickClickAt = 0;
let lastPetReportAt = 0;
let lastTossReportAt = 0;

// ambient states from the main process
let quietMode = false; // Do Not Disturb — the duck goes librarian
let callMode = false; // he's in a meeting — the duck goes VERY librarian
let chatting = false; // text-chat panel is open — stay put so the panel doesn't drift
let musicNow = null; // {track, artist} while his music plays — headphones on
let noteIn = 0; // cadence for the little ♪ particles while bobbing
let dreamGlow = false; // the slow mind is dreaming (memory consolidation)
let dreamSparkIn = 0;

// night owl: past 11pm the duck gets ready for bed (cap on, yawns, heavier
// eyelids) — body language only; the one spoken nudge is impulse-budgeted
function isNightNow() {
  const h = new Date().getHours();
  return h >= 23 || h < 5;
}
let yawnT = 0; // >0 while mid-yawn (beak open, eyes closed)
let yawnIn = 20 + Math.random() * 30;

// the egg — everyone starts somewhere
const egg = {
  mode: false, // true until hatched
  progress: 0, // 0..1 toward hatching (pets + attention + time)
  wobbleT: 0,
  peepIn: 8,
  hasVoice: true,
  hintTimers: [],
};
let stageKnown = false; // don't draw anything until we know egg vs duck

// mischief mode — sixty seconds of consequence-free crimes
const mischief = { active: false, until: 0, tx: 0, ty: 0, stepIn: 0, doodle: null, prideOnLand: false };

// tricks — watching a lesson / performing: the duck flies to each click and pecks it
const trick = { watching: false, performing: false, tx: 0, ty: 0, arrived: false, peckT: 0 };

// the workshop build is pure theater: the model is generating code while the
// body hammers/paints/types — latency converted into character
const build = { kind: null, quipIn: 0, sparkIn: 0 };
const BUILD_QUIPS = {
  game: ['*hammering*', 'the corners keep escaping', 'almost… steady…', '*measures twice, cuts thrice*'],
  viz: ['*squints artistically*', 'needs more orange', '*steps back to consider*'],
  writing: ['*tap tap tap*', 'no. crumple. again.', '*chews the pencil*'],
  prop: ['*snip snip*', 'does this go on the front?', '*tries it on backwards*'],
};
let propLayers = []; // equipped workshop props, drawn like skin accessories
const marks = []; // {type:'footprint'|'doodle', t, ...} drawn under the duck, fade out
const DOODLE_COLORS = ['#f79e2d', '#ff6b81', '#6db7ff', '#8bd66e'];

// wearables — drawn like skin accessories (shift with the face), but driven by
// ambient state instead of the chosen outfit
// crimson, never charcoal — dark cups beside dark eyes fuse into a blindfold.
// Cups stay OUTSIDE the face (cols 0-1 / 12-13) so a column of cream always
// separates cup from eye. No band: it floats weirdly over the round egg body.
const HP = '#c0392b';
const HPD = '#8e2b20';
const HEADPHONES_PX = [
  // left cup (outer shell bright, inner pad dark against the head)
  [0, 4, HP], [0, 5, HP], [0, 6, HP],
  [1, 4, HPD], [1, 5, HPD], [1, 6, HPD],
  // right cup
  [13, 4, HP], [13, 5, HP], [13, 6, HP],
  [12, 4, HPD], [12, 5, HPD], [12, 6, HPD],
];
const NC = '#5b6abf';
const NCD = '#48549e';
const NCW = '#f6f1e3';
const NIGHTCAP_PX = [
  // brim
  [4, -1, NCW], [5, -1, NCW], [6, -1, NCW], [7, -1, NCW], [8, -1, NCW], [9, -1, NCW], [10, -1, NCW],
  // cone, flopped to the right
  [5, -2, NC], [6, -2, NC], [7, -2, NC], [8, -2, NC], [9, -2, NC],
  [6, -3, NC], [7, -3, NCD], [8, -3, NC], [9, -3, NC],
  [8, -4, NC], [9, -4, NC], [10, -4, NC],
  // pompom
  [11, -4, NCW], [11, -5, NCW], [12, -5, NCW], [12, -4, NCW],
];

const particles = []; // {type:'heart'|'z'|'spark'|'confetti', x, y, t, life, drift, color}

function spawnParticle(type, x, y) {
  particles.push({
    type,
    x,
    y,
    t: 0,
    life: type === 'heart' ? 1.4 : type === 'z' ? 2.2 : type === 'note' ? 1.9 : type === 'confetti' ? 1.3 + Math.random() * 0.7 : 0.7,
    drift: (Math.random() - 0.5) * (type === 'spark' ? 90 : type === 'confetti' ? 260 : 30),
    color: type === 'confetti' ? DOODLE_COLORS[Math.floor(Math.random() * DOODLE_COLORS.length)] : null,
  });
}

function spawnConfettiBurst(x, y) {
  for (let i = 0; i < 26; i++) spawnParticle('confetti', x + (Math.random() - 0.5) * 30, y - Math.random() * 20);
  for (let i = 0; i < 8; i++) spawnParticle('spark', x + (Math.random() - 0.5) * 50, y - Math.random() * 30);
}

function say(text) {
  duck.bubble = text;
  duck.bubbleT = 2.5;
}

// ---------------------------------------------------------------------------
// Behavior planner — destinations and small rituals, not pacing
// ---------------------------------------------------------------------------

function clampX(x) {
  return Math.max(MARGIN + DUCK_W / 2, Math.min(W - MARGIN - DUCK_W / 2, x));
}

function startWalkTo(x, arriveState) {
  duck.targetX = clampX(x);
  duck.speed = 40 + Math.random() * 30;
  duck.faceDir = duck.targetX > duck.x ? 1 : -1;
  duck.state = arriveState;
  duck.stateT = 0;
}

function plan() {
  duck.rock = 0;
  duck.targetX = null;

  if (egg.mode) {
    // an egg's social calendar: sit, wobble, nap
    const r = Math.random();
    if (r < 0.15) {
      duck.state = 'hop';
      duck.hopsLeft = 1;
      duck.hopPause = 0;
    } else if (r < 0.3) {
      duck.state = 'sleep';
      duck.stateDur = 6 + Math.random() * 6;
      duck.zIn = 0.5;
    } else {
      duck.state = 'idle';
      duck.stateDur = 2 + Math.random() * 4;
      if (Math.random() < 0.5) egg.wobbleT = 0.5; // a thought occurred to it
    }
    duck.stateT = 0;
    return;
  }

  if (followMode) {
    duck.state = 'follow';
    duck.stateT = 0;
    return;
  }

  // during a conversation (voice OR text chat), stay present: no wandering off
  // or napping — and for chat it also keeps the panel anchored above a still duck
  if (voiceState !== 'idle' || chatting) {
    duck.state = 'idle';
    duck.stateT = 0;
    duck.stateDur = 2 + Math.random() * 3;
    duck.faceDir = 0;
    return;
  }

  const cursorFresh = performance.now() - cursor.seenAt < 30000;
  const cursorFar = cursorFresh && Math.abs(cursor.x - duck.x) > 180;

  // build a weighted deck, skipping whatever we just did
  const night = isNightNow();
  const deck = [
    ['wander', callMode ? 6 : 24], // on a call: mostly sit tight
    ['idle', callMode ? 30 : 22],
    ['peck', callMode ? 4 : 13],
    ['preen', 10],
    ['hop', callMode ? 0 : night ? 4 : 10], // no bouncing at bedtime or in meetings
    ['look', 8],
    ['approach', cursorFar && !callMode ? 8 : 0],
    ['sleep', quietMode || callMode ? 18 : night ? 16 : 5], // DND/calls/late night: heavier eyelids
  ].filter(([name, w]) => w > 0 && name !== duck.lastPlan);

  const total = deck.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  let choice = deck[0][0];
  for (const [name, w] of deck) {
    r -= w;
    if (r <= 0) { choice = name; break; }
  }
  duck.lastPlan = choice;
  duck.stateT = 0;

  switch (choice) {
    case 'wander': {
      const dist = (120 + Math.random() * 380) * (Math.random() < 0.5 ? -1 : 1);
      startWalkTo(duck.x + dist, 'wander');
      break;
    }
    case 'approach': {
      startWalkTo(cursor.x, 'approach');
      break;
    }
    case 'peck': {
      duck.state = 'peck';
      duck.stateDur = 1 + Math.random() * 1.2;
      if (duck.faceDir === 0) duck.faceDir = Math.random() < 0.5 ? -1 : 1;
      break;
    }
    case 'preen': {
      duck.state = 'preen';
      duck.stateDur = 1.6 + Math.random() * 1.2;
      break;
    }
    case 'hop': {
      duck.state = 'hop';
      duck.hopsLeft = 1 + Math.floor(Math.random() * 3);
      duck.hopPause = 0;
      if (duck.faceDir === 0) duck.faceDir = Math.random() < 0.5 ? -1 : 1;
      break;
    }
    case 'look': {
      duck.state = 'look';
      duck.stateDur = 2 + Math.random() * 1.5;
      break;
    }
    case 'sleep': {
      duck.state = 'sleep';
      // at night, naps run long — left alone, the duck properly falls asleep
      duck.stateDur = (8 + Math.random() * 8) * (night ? 3 : 1);
      duck.zIn = 0.5;
      duck.faceDir = 0;
      break;
    }
    default: {
      duck.state = 'idle';
      duck.stateDur = 1.5 + Math.random() * 3;
      if (Math.random() < 0.4) duck.faceDir = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

function walkTowardTarget(dt) {
  const dx = duck.targetX - duck.x;
  const dir = Math.sign(dx);
  duck.faceDir = dir || duck.faceDir;
  // ease out near the destination
  const speed = Math.min(duck.speed, Math.abs(dx) * 3 + 12);
  duck.x += dir * speed * dt;
  duck.walkPhase += dt * 11;
  duck.rock = Math.sin(duck.walkPhase) * 0.07;
  return Math.abs(dx) < 6;
}

function settle() {
  duck.rock = 0;
  duck.squashY = 0.92;
  duck.squashX = 1.05;
}

function update(dt) {
  duck.stateT += dt;
  updateDockLift(dt);

  if (duck.state !== 'sleep') {
    duck.blinkIn -= dt;
    if (duck.blinkIn <= 0) {
      duck.blinkT = 0.13;
      duck.blinkIn = 2 + Math.random() * 4;
    }
    duck.blinkT = Math.max(0, duck.blinkT - dt);
  }

  duck.squashX += (1 - duck.squashX) * Math.min(1, dt * 10);
  duck.squashY += (1 - duck.squashY) * Math.min(1, dt * 10);

  duck.happyT = Math.max(0, duck.happyT - dt);
  duck.bubbleT = Math.max(0, duck.bubbleT - dt);
  if (duck.bubbleT === 0) duck.bubble = null;

  if ((duck.state === 'idle' || duck.state === 'wander') && !duck.bubble && !quietMode && !callMode && !egg.mode) {
    duck.quackIn -= dt;
    if (duck.quackIn <= 0) {
      say(QUACKS[Math.floor(Math.random() * QUACKS.length)]);
      duck.quackIn = 15 + Math.random() * 25;
    }
  }

  // music on: bob to the beat and shed the occasional ♪ — a free visual state,
  // never a word
  if (musicNow && !egg.mode && ['idle', 'wander', 'look', 'preen', 'peck'].includes(duck.state)) {
    duck.rock += Math.sin(performance.now() / 240) * 0.045;
    noteIn -= dt;
    if (noteIn <= 0) {
      spawnParticle('note', duck.x + (Math.random() - 0.5) * DUCK_W, duck.y - DUCK_H - 8);
      noteIn = 2.6 + Math.random() * 2.4;
    }
  }

  // deep-night yawns (visual only; the spoken nudge is budgeted in main)
  yawnT = Math.max(0, yawnT - dt);
  if (isNightNow() && !egg.mode && voiceState === 'idle' && ['idle', 'look', 'preen', 'peck'].includes(duck.state)) {
    yawnIn -= dt;
    if (yawnIn <= 0) {
      yawnT = 1.1;
      duck.squashY = 0.93;
      yawnIn = 40 + Math.random() * 50;
    }
  }

  // the egg's inner life: slow passive progress toward hatching, wobbles, peeps
  if (egg.mode) {
    egg.wobbleT = Math.max(0, egg.wobbleT - dt);
    // the wobble is the egg's only body language — render it
    if (egg.wobbleT > 0 && duck.state !== 'hatching' && duck.state !== 'falling' && duck.state !== 'dragged') {
      duck.rock = Math.sin(performance.now() / 40) * 0.22 * Math.min(1, egg.wobbleT * 2);
    }
    if (duck.state !== 'sleep') egg.progress += dt / 240; // ~4 min of ambient warmth
    egg.peepIn -= dt;
    if (egg.peepIn <= 0 && !duck.bubble && !quietMode) {
      say(Math.random() < 0.5 ? '…peep?' : '*wobble*');
      if (Math.random() < 0.7) egg.wobbleT = 0.6;
      egg.peepIn = 12 + Math.random() * 18;
    }
    if (egg.progress >= 1 && duck.state !== 'hatching') beginHatch();
  }

  // dream sparkles while the slow mind tidies memory
  if (dreamGlow && duck.state === 'sleep') {
    dreamSparkIn -= dt;
    if (dreamSparkIn <= 0) {
      spawnParticle('spark', duck.x + (Math.random() - 0.5) * DUCK_W, duck.y - DUCK_H - 8);
      dreamSparkIn = 1.2;
    }
  }

  // marks (footprints, doodles) fade away on their own
  for (let i = marks.length - 1; i >= 0; i--) {
    marks[i].t += dt;
    if (marks[i].t > 25) marks.splice(i, 1);
  }

  switch (duck.state) {
    case 'idle': {
      duck.rock = Math.sin(duck.stateT * 2) * 0.02;
      if (voiceState === 'speaking') {
        duck.rock += Math.sin(performance.now() / 90) * 0.05 * Math.min(1, speakLevel * 10);
      }
      if (duck.stateT > duck.stateDur) plan();
      break;
    }
    case 'goToCrumb': {
      if (!crumbs.includes(duck.crumb)) { duck.crumb = null; plan(); break; }
      duck.targetX = clampX(duck.crumb.x);
      if (walkTowardTarget(dt)) {
        duck.state = 'eatCrumb';
        duck.stateT = 0;
        duck.faceDir = Math.sign(duck.crumb.x - duck.x) || duck.faceDir;
      }
      break;
    }
    case 'eatCrumb': {
      duck.rock = duck.faceDir * Math.max(0, Math.sin(duck.stateT * 12)) * 0.3;
      duck.squashY = 1 - Math.max(0, Math.sin(duck.stateT * 12)) * 0.06;
      if (duck.stateT > 1.1) {
        const i = crumbs.indexOf(duck.crumb);
        if (i !== -1) crumbs.splice(i, 1);
        duck.crumb = null;
        duck.happyT = 1.6;
        spawnParticle('heart', duck.x, duck.y - DUCK_H + 6);
        say('*nom*');
        window.quackers.happening('feed');
        duck.state = 'idle';
        duck.stateT = 0;
        duck.stateDur = 2;
      }
      break;
    }
    case 'flee': {
      const elapsed = (performance.now() - chaseStartAt) / 1000;
      if (elapsed > 35) { endChase(false); break; }

      if (fleeJump) {
        fleeJump.vy += 1500 * dt;
        duck.y += fleeJump.vy * dt;
        duck.x = clampX(duck.x + fleeJump.vx * dt);
        duck.rock += fleeJump.vx * dt * 0.001;
        if (duck.y >= groundY() && fleeJump.vy > 0) {
          duck.y = groundY();
          duck.squashY = 0.8;
          duck.squashX = 1.15;
          duck.rock = 0;
          fleeJump = null;
        }
        break;
      }

      const cx = cursor.x != null ? cursor.x : W / 2;
      const dx = duck.x - cx;
      const dist = Math.abs(dx);
      let dir = Math.sign(dx) || 1;
      const nearLeft = duck.x < MARGIN + DUCK_W / 2 + 30;
      const nearRight = duck.x > W - MARGIN - DUCK_W / 2 - 30;

      if ((nearLeft && dir < 0) || (nearRight && dir > 0)) {
        if (dist < 220) {
          // cornered — big panicked leap over the cursor
          fleeJump = { vx: -dir * (360 + Math.random() * 120), vy: -380 };
          duck.squashY = 0.75;
          break;
        }
        dir = -dir;
      }

      const speed = dist < 280 ? 130 + (280 - dist) * 0.85 : 80;
      duck.x = clampX(duck.x + dir * speed * dt);
      duck.faceDir = dir;
      duck.walkPhase += dt * 17;
      duck.rock = Math.sin(duck.walkPhase) * 0.09;
      break;
    }
    case 'follow': {
      if (!followMode) { plan(); break; }
      if (cursor.x != null) {
        duck.targetX = clampX(cursor.x);
        const dx = duck.targetX - duck.x;
        if (Math.abs(dx) > 90) {
          walkTowardTarget(dt);
        } else {
          duck.rock = 0;
          if (dx !== 0) duck.faceDir = Math.sign(dx);
          // caught up underneath the cursor — if it's hovering high above, hop
          // up toward it now and then ("I see you up there"). Hop's exit calls
          // plan(), which returns us to follow, so this self-recovers.
          const high = cursor.y != null && groundY() - cursor.y > 220;
          if (high && performance.now() - followHopAt > 2600) {
            followHopAt = performance.now();
            duck.state = 'hop';
            duck.stateT = 0;
            duck.hopsLeft = 1; // one eager bounce, not a whole hopping fit
            duck.hopPause = 0;
          }
        }
      }
      break;
    }
    case 'wander': {
      // designed imperfection: every so often the duck just… eats it
      if (Math.random() < dt * 0.012) {
        duck.state = 'trip';
        duck.stateT = 0;
        break;
      }
      if (walkTowardTarget(dt)) { settle(); plan(); }
      break;
    }
    case 'trip': {
      if (duck.stateT < 0.35) {
        // the faceplant
        duck.rock = (duck.faceDir || 1) * Math.min(0.7, duck.stateT * 4);
        duck.squashY = 0.85;
        if (duck.stateT + dt >= 0.35) {
          duck.squashY = 0.7;
          duck.squashX = 1.25;
          spawnParticle('spark', duck.x + (duck.faceDir || 1) * 14, duck.y - 6);
        }
      } else if (duck.stateT < 1.2) {
        duck.rock = (duck.faceDir || 1) * 0.7; // lying there, processing
      } else if (duck.stateT < 1.8) {
        duck.rock = Math.sin(duck.stateT * 22) * 0.12; // shake it off
      } else {
        duck.rock = 0;
        if (Math.random() < 0.35) say('meant to do that');
        plan();
      }
      break;
    }
    case 'hatching': {
      // violent, escalating wobble — then the world gets a duck
      const k = Math.min(1, duck.stateT / 1.5);
      duck.rock = Math.sin(duck.stateT * (18 + k * 22)) * (0.12 + k * 0.22);
      if (Math.random() < dt * (2 + k * 6)) {
        spawnParticle('spark', duck.x + (Math.random() - 0.5) * DUCK_W, duck.y - Math.random() * DUCK_H);
      }
      if (duck.stateT > 1.6) finishHatch();
      break;
    }
    case 'looking': {
      // visibly, theatrically LOOKING — the privacy line as animation.
      // First hustle toward the cursor (he's pointing at the thing he means),
      // then peer around right where he's pointing.
      if (duck.targetX != null && Math.abs(duck.targetX - duck.x) > 40) {
        const dir = Math.sign(duck.targetX - duck.x);
        duck.x = clampX(duck.x + dir * 380 * dt);
        duck.faceDir = dir;
        duck.walkPhase += dt * 15;
        duck.rock = Math.sin(duck.walkPhase) * 0.1;
      } else {
        duck.targetX = null;
        duck.faceDir = Math.sin(duck.stateT * 5) > 0 ? 1 : -1;
        duck.rock = duck.faceDir * 0.06;
      }
      if (duck.stateT > 6) plan(); // safety: never stuck mid-look
      break;
    }
    case 'trickmove': {
      // fly to the action point, peck it, hover until the next action
      const dx = trick.tx - duck.x;
      const dy = trick.ty - duck.y;
      const dist = Math.hypot(dx, dy);
      if (!trick.arrived && dist > 16) {
        duck.x = clampX(duck.x + (dx / dist) * 430 * dt);
        duck.y += (dy / dist) * 430 * dt;
        duck.faceDir = Math.sign(dx) || duck.faceDir;
        duck.walkPhase += dt * 18;
        duck.rock = Math.sin(duck.walkPhase) * 0.12;
      } else {
        if (!trick.arrived) {
          trick.arrived = true;
          trick.peckT = 0.5;
        }
        if (trick.peckT > 0) {
          trick.peckT -= dt;
          // the peck: bow hard toward the target
          duck.rock = (duck.faceDir || 1) * Math.max(0, Math.sin(trick.peckT * 12)) * 0.35;
          duck.squashY = 0.88;
          if (trick.peckT <= 0) spawnParticle('spark', trick.tx, trick.ty);
        } else {
          duck.rock = Math.sin(duck.stateT * 3) * 0.04; // hover-bob, waiting
        }
      }
      break;
    }
    case 'building': {
      duck.faceDir = 1;
      const tempo = build.kind === 'game' ? 14 : build.kind === 'viz' ? 5 : 9;
      duck.rock = Math.sin(duck.stateT * tempo) * (build.kind === 'viz' ? 0.08 : 0.22);
      build.sparkIn -= dt;
      if (build.sparkIn <= 0) {
        spawnParticle(build.kind === 'viz' ? 'note' : 'spark', duck.x + 26, duck.y - 14);
        build.sparkIn = build.kind === 'game' ? 0.3 : 0.7;
      }
      build.quipIn -= dt;
      if (build.quipIn <= 0 && !duck.bubble) {
        const quips = BUILD_QUIPS[build.kind] || BUILD_QUIPS.game;
        say(quips[Math.floor(Math.random() * quips.length)]);
        build.quipIn = 6 + Math.random() * 4;
      }
      break;
    }
    case 'mischief': {
      if (performance.now() > mischief.until) {
        mischief.active = false;
        mischief.doodle = null;
        mischief.prideOnLand = true;
        duck.state = 'falling';
        duck.stateT = 0;
        duck.vx = 0;
        duck.vy = 0;
        break;
      }
      const dx = mischief.tx - duck.x;
      const dy = mischief.ty - duck.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 24) {
        pickMischiefTarget();
        if (Math.random() < 0.3) {
          const quips = ['hehehe.', 'crime.', 'parkour!', 'no laws up here', '*unhinged quacking*'];
          say(quips[Math.floor(Math.random() * quips.length)]);
        }
        break;
      }
      const speed = 330;
      duck.x += (dx / dist) * speed * dt;
      duck.y += (dy / dist) * speed * dt;
      duck.faceDir = Math.sign(dx) || duck.faceDir;
      duck.walkPhase += dt * 16;
      duck.rock = Math.sin(duck.walkPhase) * 0.14;
      // leave evidence: footprints along the ground, crayon doodles in the air
      mischief.stepIn -= dt;
      if (duck.y > groundY() - 14) {
        if (mischief.stepIn <= 0) {
          marks.push({ type: 'footprint', x: duck.x, y: groundY() + PX, dir: duck.faceDir || 1, t: 0 });
          mischief.stepIn = 0.14;
        }
        mischief.doodle = null;
      } else {
        if (!mischief.doodle) {
          mischief.doodle = {
            type: 'doodle',
            pts: [],
            color: DOODLE_COLORS[Math.floor(Math.random() * DOODLE_COLORS.length)],
            t: 0,
          };
          marks.push(mischief.doodle);
        }
        if (mischief.stepIn <= 0) {
          mischief.doodle.pts.push({ x: duck.x, y: duck.y - DUCK_H / 2 + Math.sin(duck.walkPhase * 2) * 14 });
          mischief.stepIn = 0.05;
        }
      }
      break;
    }
    case 'approach': {
      // chase the cursor's x, stop politely short of it
      duck.targetX = clampX(cursor.x);
      const dx = duck.targetX - duck.x;
      if (Math.abs(dx) < 80) {
        settle();
        say(GREETS[Math.floor(Math.random() * GREETS.length)]);
        duck.happyT = 1.2;
        duck.state = 'idle';
        duck.stateT = 0;
        duck.stateDur = 2.5;
        duck.lastPlan = 'approach';
      } else {
        walkTowardTarget(dt);
        if (duck.stateT > 12) plan(); // give up eventually
      }
      break;
    }
    case 'peck': {
      // quick bows toward the ground
      duck.rock = duck.faceDir * Math.max(0, Math.sin(duck.stateT * 12)) * 0.3;
      duck.squashY = 1 - Math.max(0, Math.sin(duck.stateT * 12)) * 0.06;
      if (duck.stateT > duck.stateDur) plan();
      break;
    }
    case 'preen': {
      duck.rock = duck.faceDir * 0.14 + Math.sin(duck.stateT * 9) * 0.04;
      if (Math.random() < dt * 3) {
        spawnParticle('spark', duck.x + (Math.random() - 0.5) * DUCK_W, duck.y - DUCK_H * 0.6);
      }
      if (duck.stateT > duck.stateDur) plan();
      break;
    }
    case 'hop': {
      if (duck.hopPause > 0) {
        duck.hopPause -= dt;
        if (duck.hopPause <= 0 && duck.hopsLeft <= 0) { plan(); break; }
        if (duck.hopPause <= 0) {
          duck.vy = -190 - Math.random() * 40;
          duck.squashY = 0.85;
        }
        break;
      }
      if (duck.vy === 0 && duck.y >= groundY()) {
        duck.vy = -190 - Math.random() * 40;
        duck.squashY = 0.85;
      }
      duck.vy += 1400 * dt;
      duck.y += duck.vy * dt;
      duck.x = clampX(duck.x + duck.faceDir * 60 * dt);
      if (duck.y >= groundY() && duck.vy > 0) {
        duck.y = groundY();
        duck.vy = 0;
        duck.squashY = 0.85;
        duck.squashX = 1.12;
        duck.hopsLeft--;
        duck.hopPause = 0.18;
      }
      break;
    }
    case 'look': {
      // glance around: flip facing every ~0.8s
      duck.faceDir = Math.sin(duck.stateT * 4) > 0 ? 1 : -1;
      duck.rock = duck.faceDir * 0.03;
      if (duck.stateT > duck.stateDur) plan();
      break;
    }
    case 'sleep': {
      duck.rock = Math.sin(duck.stateT * 1.2) * 0.015;
      duck.zIn -= dt;
      if (duck.zIn <= 0) {
        spawnParticle('z', duck.x + DUCK_W * 0.4, duck.y - DUCK_H);
        duck.zIn = 1.3;
      }
      if (duck.stateT > duck.stateDur) plan();
      break;
    }
    case 'jump': {
      duck.vy += 1400 * dt;
      duck.y += duck.vy * dt;
      if (duck.y >= groundY()) {
        duck.y = groundY();
        duck.vy = 0;
        duck.squashY = 0.78;
        duck.squashX = 1.2;
        duck.state = 'idle';
        duck.stateT = 0;
        duck.stateDur = 1 + Math.random() * 2;
      }
      break;
    }
    case 'dragged': {
      duck.rock = Math.sin(performance.now() / 180) * 0.09;
      break;
    }
    case 'falling': {
      duck.vy += 2400 * dt;
      duck.x += duck.vx * dt;
      duck.y += duck.vy * dt;
      duck.vx *= 1 - Math.min(1, dt * 1.5);
      duck.rock += duck.vx * dt * 0.002;
      if (duck.x < DUCK_W / 2) { duck.x = DUCK_W / 2; duck.vx = Math.abs(duck.vx) * 0.5; }
      if (duck.x > W - DUCK_W / 2) { duck.x = W - DUCK_W / 2; duck.vx = -Math.abs(duck.vx) * 0.5; }
      if (duck.y >= groundY()) {
        duck.y = groundY();
        if (Math.abs(duck.vy) > 450) {
          duck.vy = -duck.vy * 0.35;
          duck.squashY = 0.7;
          duck.squashX = 1.25;
        } else {
          duck.vy = 0;
          duck.vx = 0;
          duck.rock = 0;
          duck.squashY = 0.75;
          duck.squashX = 1.2;
          duck.state = 'idle';
          duck.stateT = 0;
          duck.stateDur = 1.5;
          if (duck.greetOnLand) {
            duck.greetOnLand = false;
            say('quack!');
            duck.happyT = 1.2;
          }
          if (mischief.prideOnLand) {
            mischief.prideOnLand = false;
            duck.state = 'preen';
            duck.stateT = 0;
            duck.stateDur = 2.2;
            say('*no regrets*');
            window.quackers.happening('mischief', 'went feral for a minute — footprints and doodles everywhere');
          }
        }
      }
      break;
    }
    case 'poof': {
      const k = Math.min(1, duck.stateT / 0.3);
      duck.alpha = 1 - k;
      if (k >= 1) {
        duck.state = 'hidden';
        window.quackers.hideNow();
      }
      break;
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    if (p.t > p.life) particles.splice(i, 1);
  }

  // crumbs fall, then tempt the duck
  for (const c of crumbs) {
    if (!c.landed) {
      c.vy += 1200 * dt;
      c.y += c.vy * dt;
      if (c.y >= groundY() + PX) {
        c.y = groundY() + PX;
        c.landed = true;
      }
    }
  }
  const treat = crumbs.find((c) => c.landed);
  if (
    treat &&
    !egg.mode &&
    ['idle', 'wander', 'look', 'peck', 'preen', 'sleep'].includes(duck.state) &&
    !followMode
  ) {
    duck.crumb = treat;
    startWalkTo(treat.x, 'goToCrumb');
  }
}

// ---------------------------------------------------------------------------
// Hatching — the first three minutes are the product
// ---------------------------------------------------------------------------

function beginHatch() {
  if (!egg.mode || duck.state === 'hatching') return;
  duck.state = 'hatching';
  duck.stateT = 0;
  duck.bubble = null;
  duck.y = groundY();
  duck.vy = 0;
}

function finishHatch() {
  egg.mode = false;
  window.quackers.hatch();
  window.quackers.logEvent('hatch-animation', {});
  spawnConfettiBurst(duck.x, duck.y - DUCK_H / 2);
  duck.state = 'jump';
  duck.stateT = 0;
  duck.vy = -330;
  duck.squashY = 0.8;
  duck.happyT = 3;
  say('…hi.');

  // a hatchling's first thoughts — cancelled the moment a conversation starts
  // (cancelTimers is called from setVoiceState)
  const later = (ms, fn) => egg.hintTimers.push(setTimeout(() => { if (voiceState === 'idle') fn(); }, ms));
  later(6000, () => say("you're very big."));
  later(14000, () => say('I live here now. I think.'));
  later(22000, () => { say('*inspects everything*'); duck.happyT = 1.5; });
  if (!egg.hasVoice) {
    later(32000, () => {
      say('I feel like I should have a voice…');
      duck.bubbleT = 6;
    });
    later(40000, () => {
      say('(the little duck in your menu bar knows how)');
      duck.bubbleT = 7;
    });
  } else {
    later(32000, () => {
      say('double-click me. I have so many questions.');
      duck.bubbleT = 6;
    });
  }
}

function pickMischiefTarget() {
  const airborne = Math.random() < 0.6;
  mischief.tx = MARGIN + DUCK_W + Math.random() * (W - 2 * MARGIN - 2 * DUCK_W);
  mischief.ty = airborne ? H * 0.2 + Math.random() * (H * 0.55) : groundY();
}

function endChase(caught) {
  const secs = Math.round((performance.now() - chaseStartAt) / 1000);
  fleeJump = null;
  duck.y = groundY();
  duck.vy = 0;
  let report;
  if (caught) {
    report = `he caught you after ${secs} seconds`;
    duck.squashY = 0.7;
    duck.squashX = 1.25;
    duck.happyT = 2.5;
    for (let i = 0; i < 5; i++) {
      spawnParticle('heart', duck.x + (Math.random() - 0.5) * 60, duck.y - DUCK_H + 8);
    }
    say('you got me!');
  } else {
    report = 'you escaped — he never caught you';
    duck.state = 'hop';
    duck.stateT = 0;
    duck.hopsLeft = 4;
    duck.hopPause = 0;
    duck.happyT = 3;
    say('*victory waddle*');
  }
  window.quackers.happening('chase', report);
  if (window.reportGameEvent) window.reportGameEvent(`Chase game ended: ${report}.`);
  if (caught) {
    duck.state = 'idle';
    duck.stateT = 0;
    duck.stateDur = 2.5;
  }
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

function px(col, row, color) {
  ctx.fillStyle = color;
  ctx.fillRect(
    Math.round((col - COLS / 2) * PX),
    Math.round((row - ROWS) * PX),
    PX + 0.5,
    PX + 0.5
  );
}

function drawFeet() {
  const dangling =
    duck.state === 'dragged' ||
    duck.state === 'falling' ||
    (duck.state === 'mischief' && duck.y < groundY() - 10) ||
    (duck.state === 'trickmove' && duck.y < groundY() - 10);
  const moving =
    duck.state === 'wander' ||
    duck.state === 'approach' ||
    duck.state === 'goToCrumb' ||
    (duck.state === 'flee' && !fleeJump) ||
    (duck.state === 'follow' && duck.targetX != null && Math.abs(duck.targetX - duck.x) > 90);
  let stepL = 0;
  let stepR = 0;
  if (moving) {
    stepL = Math.sin(duck.walkPhase) > 0 ? -1 : 0;
    stepR = Math.sin(duck.walkPhase) > 0 ? 0 : -1;
  }
  const drop = dangling ? 1 : 0;
  for (const c of [3, 4, 5]) px(c, 13 + drop + stepL, SKIN_COLORS.F);
  for (const c of [8, 9, 10]) px(c, 13 + drop + stepR, SKIN_COLORS.F);
}

function currentEyes() {
  if (duck.state === 'looking') return 'wide';
  if (duck.state === 'follow') return 'wide'; // locked onto the cursor, attentive
  if (duck.state === 'sleep') return 'sleep';
  if (yawnT > 0) return 'sleep'; // eyes squeeze shut mid-yawn
  if (duck.happyT > 0) return 'happy';
  if (duck.blinkT > 0) return 'blink';
  return 'open';
}

function drawDuck() {
  if (duck.state === 'hidden' || !stageKnown) return;
  ctx.save();
  ctx.globalAlpha = duck.alpha;
  ctx.translate(duck.x, duck.y);
  ctx.rotate(duck.rock);
  const poofK = duck.state === 'poof' ? 1 - Math.min(1, duck.stateT / 0.3) * 0.5 : 1;
  ctx.scale(duck.squashX * poofK, duck.squashY * poofK);

  // every egg is classic cream; the chosen skin is what's inside
  const pal = egg.mode || duck.state === 'hatching' ? COLORS : SKIN_COLORS;

  for (let r = 0; r < ROWS; r++) {
    const row = BODY[r];
    for (let c = 0; c < COLS; c++) {
      const ch = row[c];
      if (ch !== '.' && pal[ch]) px(c, r, pal[ch]);
    }
  }

  // pre-hatch: a plain egg — no face, no feet, just cracks and potential
  if (egg.mode || duck.state === 'hatching') {
    const stage =
      duck.state === 'hatching' ? 3 : egg.progress > 0.85 ? 3 : egg.progress > 0.55 ? 2 : egg.progress > 0.25 ? 1 : 0;
    for (let s = 0; s < stage; s++) {
      for (const [c, r] of CRACKS[s]) px(c, r, CRACK_COLOR);
    }
    ctx.restore();
    return;
  }

  // face shifts one sprite-pixel toward where it's looking
  const f = duck.faceDir;
  for (const [c, r] of EYES[currentEyes()]) px(c + f, r, pal.E);
  for (const [c, r] of BEAK.B) px(c + f, r, pal.B);
  // beak flaps while the duck is speaking; held wide open mid-yawn
  const beakOpen =
    (voiceState === 'speaking' && speakLevel > 0.03 && Math.sin(performance.now() / 55) > 0) ||
    yawnT > 0.25;
  if (beakOpen) {
    for (const c of [5, 6, 7, 8]) px(c + f, 7, pal.b);
    for (const c of [6, 7]) px(c + f, 8, pal.b);
  } else {
    for (const [c, r] of BEAK.b) px(c + f, r, pal.b);
  }
  for (const [c, r] of CHEEKS) px(c + f, r, pal.K);

  drawFeet();

  // the outfit: accessory layers on top (hats shift with the face; capes don't)
  const nightcapOn = isNightNow();
  for (const layer of activeSkin.accessories) {
    if (nightcapOn && layer.shift) continue; // the hat comes off at bedtime
    const shift = layer.shift ? f : 0;
    for (const [c, r, color] of layer.px) px(c + shift, r, color);
  }
  if (nightcapOn) {
    for (const [c, r, color] of NIGHTCAP_PX) px(c + f, r, color);
  }
  // workshop props on top of the outfit — built things are part of who it is
  for (const layer of propLayers) {
    const shift = layer.shift ? f : 0;
    for (const [c, r, color] of layer.px) px(c + shift, r, color);
  }
  // headphones go on over everything — that's how headphones work
  if (musicNow) {
    for (const [c, r, color] of HEADPHONES_PX) px(c + f, r, color);
  }

  ctx.restore();
}

function drawShadow() {
  if (duck.state === 'hidden' || duck.state === 'poof') return;
  const h = groundY() - duck.y;
  const k = Math.max(0.25, 1 - h / 400);
  ctx.save();
  ctx.globalAlpha = 0.14 * k * duck.alpha;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(duck.x, groundY() + PX + 2, (DUCK_W / 2) * k, 5 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    const k = p.t / p.life;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    if (p.type === 'heart') {
      ctx.font = `${16 + k * 6}px -apple-system, sans-serif`;
      ctx.fillStyle = '#ff6b81';
      ctx.fillText('♥', p.x + Math.sin(p.t * 6) * 6 + p.drift * k, p.y - k * 55);
    } else if (p.type === 'z') {
      ctx.font = `italic ${13 + k * 10}px Georgia, serif`;
      ctx.fillStyle = '#8aa3b8';
      ctx.fillText('z', p.x + k * 22, p.y - k * 40);
    } else if (p.type === 'note') {
      ctx.font = `${13 + k * 4}px -apple-system, sans-serif`;
      ctx.fillStyle = '#8f7fd6';
      ctx.fillText(Math.round(p.drift) % 2 ? '♪' : '♫', p.x + Math.sin(p.t * 4) * 8 + p.drift * k, p.y - k * 45);
    } else if (p.type === 'confetti') {
      ctx.translate(p.x + p.drift * k, p.y - (1 - (k - 0.5) * (k - 0.5) * 4) * 70 + k * k * 160);
      ctx.rotate(p.t * 7 + p.drift);
      ctx.fillStyle = p.color || '#f79e2d';
      ctx.fillRect(-2.5, -4, 5, 8);
    } else {
      ctx.font = `${11 + k * 4}px -apple-system, sans-serif`;
      ctx.fillStyle = '#ffd66e';
      ctx.fillText('✦', p.x + p.drift * k, p.y - k * 30);
    }
    ctx.restore();
  }
}

// footprints and crayon doodles the duck leaves during mischief — they fade
function drawMarks() {
  for (const m of marks) {
    const alpha = Math.max(0, 1 - m.t / 25);
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    if (m.type === 'footprint') {
      ctx.fillStyle = COLORS.F;
      const d = m.dir || 1;
      ctx.fillRect(Math.round(m.x - 4), Math.round(m.y), 3, 2);
      ctx.fillRect(Math.round(m.x - 4 + d * 2), Math.round(m.y + 2), 3, 2);
      ctx.fillRect(Math.round(m.x + 3), Math.round(m.y), 3, 2);
      ctx.fillRect(Math.round(m.x + 3 + d * 2), Math.round(m.y + 2), 3, 2);
    } else if (m.type === 'doodle' && m.pts.length > 1) {
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(m.pts[0].x, m.pts[0].y);
      for (let i = 1; i < m.pts.length; i++) ctx.lineTo(m.pts[i].x, m.pts[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawBubble() {
  if (!duck.bubble || duck.state === 'hidden' || duck.state === 'poof') return;
  const fade = Math.min(1, duck.bubbleT / 0.3);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.font = '14px -apple-system, sans-serif';
  const tw = ctx.measureText(duck.bubble).width;
  const bw = tw + 20;
  const bh = 28;
  const bx = duck.x - bw / 2;
  const by = duck.y - DUCK_H - bh - 18;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e3d9c2';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 12);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(duck.x - 5, by + bh - 1);
  ctx.lineTo(duck.x + 5, by + bh - 1);
  ctx.lineTo(duck.x, by + bh + 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#e3d9c2';
  ctx.beginPath();
  ctx.moveTo(duck.x - 5, by + bh);
  ctx.lineTo(duck.x, by + bh + 7);
  ctx.lineTo(duck.x + 5, by + bh);
  ctx.stroke();

  ctx.fillStyle = '#4a4437';
  ctx.fillText(duck.bubble, bx + 10, by + 18);
  ctx.restore();
}

function drawCrumbs() {
  ctx.fillStyle = '#b8874a';
  for (const c of crumbs) {
    ctx.fillRect(Math.round(c.x) - 3, Math.round(c.y) - 3, 4, 4);
    ctx.fillRect(Math.round(c.x) + 2, Math.round(c.y) - 1, 3, 3);
    ctx.fillRect(Math.round(c.x) - 1, Math.round(c.y) + 1, 3, 3);
  }
}

function drawThinkingDots() {
  if (!thinking || duck.state === 'hidden' || duck.state === 'poof') return;
  const bx = duck.x;
  const by = duck.y - DUCK_H - 16;
  for (let i = 0; i < 3; i++) {
    const a = 0.35 + 0.55 * Math.sin(performance.now() / 260 - i * 0.7);
    ctx.save();
    ctx.globalAlpha = Math.max(0.15, a) * duck.alpha;
    ctx.fillStyle = '#9a8fb8';
    ctx.beginPath();
    ctx.arc(bx - 10 + i * 10, by - Math.max(0, Math.sin(performance.now() / 260 - i * 0.7)) * 4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// a small pulsing red dot above the head while the duck is watching a lesson —
// consented recording, visibly indicated
function drawWatchDot() {
  if (!trick.watching || duck.state === 'hidden' || duck.state === 'poof') return;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
  ctx.save();
  ctx.globalAlpha = (0.5 + 0.5 * pulse) * duck.alpha;
  ctx.fillStyle = '#e05a4e';
  ctx.beginPath();
  ctx.arc(duck.x - DUCK_W / 2 - 6, duck.y - DUCK_H - 4, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawVoiceDot() {
  if (voiceState === 'idle' || duck.state === 'hidden' || duck.state === 'poof') return;
  const colors = { connecting: '#f5c542', listening: '#5dd66e', speaking: '#6db7ff' };
  const pulse = 0.55 + 0.45 * Math.sin(performance.now() / (voiceState === 'connecting' ? 150 : 400));
  ctx.save();
  ctx.globalAlpha = pulse * duck.alpha;
  ctx.fillStyle = colors[voiceState] || '#5dd66e';
  ctx.beginPath();
  ctx.arc(duck.x + DUCK_W / 2 + 4, duck.y - DUCK_H - 4, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// duckAPI — the voice layer's handle on the body (voice.js, same renderer)
// ---------------------------------------------------------------------------

window.duckAPI = {
  startChase() {
    if (['dragged', 'poof', 'hidden', 'flee', 'hatching', 'trickmove', 'building'].includes(duck.state) || egg.mode) return;
    mischief.active = false;
    chaseStartAt = performance.now();
    fleeJump = null;
    duck.state = 'flee';
    duck.stateT = 0;
    duck.bubble = null;
    duck.crumb = null;
    say('catch me if you can!');
  },
  startMischief() {
    if (['dragged', 'poof', 'hidden', 'flee', 'hatching', 'trickmove', 'building'].includes(duck.state) || egg.mode) return;
    // self-heal: if a previous rampage was interrupted mid-flight (state moved
    // on without the falling cleanup), don't let the stale flag wedge the feature
    if (mischief.active && duck.state !== 'mischief') mischief.active = false;
    if (mischief.active) return;
    mischief.active = true;
    mischief.until = performance.now() + 60000;
    mischief.stepIn = 0;
    mischief.doodle = null;
    duck.state = 'mischief';
    duck.stateT = 0;
    duck.bubble = null;
    duck.crumb = null;
    pickMischiefTarget();
    say('hehehe.');
  },
  isEgg() {
    return egg.mode;
  },
  // where the body is right now, in CSS px — the chat panel reads this to hover
  // next to the duck and follow it around the screen.
  duckRect() {
    return duckBounds();
  },
  // chat panel open/closed — keeps the duck present and still while typing
  setChatting(on) {
    chatting = !!on;
    if (on) { duck.state = 'idle'; duck.stateT = 0; duck.crumb = null; }
  },
  hatchNow() {
    if (!egg.mode) return;
    // commit the hatch to the spine IMMEDIATELY — the voice session builds its
    // instructions right now, and the one-time imprinting script only exists
    // while stage is 'duckling' with sessions <= 1. The animation catches up.
    window.quackers.hatch();
    egg.progress = 1;
    beginHatch();
  },
  startLooking() {
    if (['dragged', 'poof', 'hidden', 'flee', 'hatching', 'trickmove', 'building'].includes(duck.state) || egg.mode) return;
    duck.state = 'looking';
    duck.stateT = 0;
    duck.rock = 0;
    duck.squashY = 0.92;
    // head for where he's pointing — that's what he wants seen
    duck.targetX = cursor.x != null ? clampX(cursor.x) : null;
    say('*peers at the screen*');
  },
  stopLooking() {
    if (duck.state === 'looking') plan();
  },
  emote(name) {
    if (['dragged', 'poof', 'hidden', 'flee', 'goToCrumb', 'eatCrumb', 'hatching', 'mischief', 'trickmove', 'building'].includes(duck.state) || egg.mode) return;
    // model emote-flurries would look like a seizure — the body sets its own pace
    const nowT = performance.now();
    if (this._lastEmoteAt && nowT - this._lastEmoteAt < 1200) return;
    this._lastEmoteAt = nowT;
    switch (name) {
      case 'happy':
        duck.happyT = 2;
        for (let i = 0; i < 3; i++) {
          spawnParticle('heart', duck.x + (Math.random() - 0.5) * 40, duck.y - DUCK_H + 8);
        }
        break;
      case 'dance':
        duck.state = 'hop';
        duck.stateT = 0;
        duck.hopsLeft = 5;
        duck.hopPause = 0;
        duck.happyT = 3;
        duck.faceDir = Math.random() < 0.5 ? -1 : 1;
        break;
      case 'jump':
        duck.state = 'jump';
        duck.stateT = 0;
        duck.vy = -300;
        duck.squashY = 0.8;
        break;
      case 'preen':
        duck.state = 'preen';
        duck.stateT = 0;
        duck.stateDur = 2;
        break;
      case 'sleepy':
        duck.state = 'sleep';
        duck.stateT = 0;
        duck.stateDur = 6;
        duck.zIn = 0.4;
        duck.faceDir = 0;
        break;
    }
  },
  setFollow(follow) {
    if (followMode === !!follow) return;
    followMode = !!follow;
    if (followMode) {
      duck.state = 'follow';
      duck.stateT = 0;
      duck.bubble = null;
    } else if (duck.state === 'follow') {
      plan();
    }
  },
  setVoiceState(state) {
    if (voiceState === state) return;
    voiceState = state;
    if (state !== 'idle') {
      // a live conversation supersedes the scripted hatchling hints
      egg.hintTimers.forEach(clearTimeout);
      egg.hintTimers = [];
      // perk up: stop mid-wander/nap and pay attention
      if (['wander', 'approach', 'peck', 'preen', 'look', 'sleep', 'hop'].includes(duck.state)) {
        duck.state = followMode ? 'follow' : 'idle';
        duck.stateT = 0;
        duck.stateDur = 3;
        duck.rock = 0;
        duck.faceDir = 0;
      }
      if (state === 'listening') duck.squashY = 0.9; // attentive little bounce
    }
  },
  setSpeakLevel(level) {
    speakLevel = level;
  },
  setThinking(on) {
    thinking = !!on;
    if (on) {
      duck.state = 'idle';
      duck.stateT = 0;
      duck.stateDur = 30; // hold until thinking clears
      duck.faceDir = 0;
    }
  },
  sayBubble(text) {
    say(text);
  },
  pos() {
    return { x: duck.x, y: duck.y, ground: groundY() };
  },
};

// ---------------------------------------------------------------------------
// Show / hide (global hotkey lives in the main process)
// ---------------------------------------------------------------------------

window.quackers.onDismiss(() => {
  if (duck.state === 'poof' || duck.state === 'hidden') return;
  duck.state = 'poof';
  duck.stateT = 0;
  duck.bubble = null;
  for (let i = 0; i < 6; i++) {
    spawnParticle('spark', duck.x + (Math.random() - 0.5) * DUCK_W, duck.y - Math.random() * DUCK_H);
  }
});

// proactive moments — bubble-only, pre-governed in the main process
window.quackers.onImpulse((data) => {
  if (['dragged', 'poof', 'hidden', 'flee', 'hatching', 'mischief', 'looking', 'trickmove', 'building'].includes(duck.state)) return;
  if (voiceState !== 'idle') return; // never interrupt a conversation
  if (egg.mode) return; // eggs don't do small talk
  // confirm delivery so the main process charges the daily budget only for
  // impulses that were actually shown
  if (['welcome', 'loop-due', 'loop', 'stretch', 'battery', 'latenight'].includes(data.kind)) {
    window.quackers.impulseShown(data.kind);
  }
  if (data.kind === 'welcome') {
    duck.state = 'jump';
    duck.stateT = 0;
    duck.vy = -280;
    duck.happyT = 2;
    if (Math.random() < 0.45) {
      // the shame-free need loop: it did something while you were gone
      const finds = ['🍂', '🪙', '📎', '🫧', '🧦'];
      say(`you're back! look what I found ${finds[Math.floor(Math.random() * finds.length)]}`);
      duck.bubbleT = 5;
    } else {
      const greetings = ['welcome back!', "you're back! quack!", '*happy flapping*', 'missed you'];
      say(greetings[Math.floor(Math.random() * greetings.length)]);
    }
  } else if (data.kind === 'loop-due' && data.text) {
    duck.state = 'jump';
    duck.stateT = 0;
    duck.vy = -240;
    say(`it's nearly time — ${String(data.text).slice(0, 52)}`);
    duck.bubbleT = 7;
  } else if (data.kind === 'loop' && data.text) {
    duck.happyT = 1;
    say(`psst… ${String(data.text).slice(0, 58)}`);
    duck.bubbleT = 5; // linger a bit longer than a quack
  } else if (data.kind === 'stretch') {
    duck.happyT = 1;
    say('two hours straight. blink! stretch! *supervises*');
    duck.bubbleT = 6;
  } else if (data.kind === 'battery') {
    duck.state = 'jump';
    duck.stateT = 0;
    duck.vy = -260;
    say(`⚡ battery's at ${String(data.text).slice(0, 3)}%!`);
    duck.bubbleT = 6;
  } else if (data.kind === 'latenight') {
    const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const nudges = [
      `it's ${t}. even ducks have a bedtime.`,
      `${t}?? I'm getting my cap. you should wind down too.`,
      `psst. it's ${t}. the code will still be there tomorrow.`,
    ];
    say(nudges[Math.floor(Math.random() * nudges.length)]);
    duck.bubbleT = 7;
    yawnT = 1.1;
    duck.squashY = 0.93;
  }
});

// coding-buddy events (Claude Code hooks, CI scripts) — the duck cares
window.quackers.onBuddy((data) => {
  if (['dragged', 'poof', 'hidden', 'flee', 'hatching', 'mischief', 'looking', 'trickmove', 'building'].includes(duck.state) || egg.mode) return;
  if (voiceState !== 'idle') {
    // mid-conversation: feed it into the talk instead of bubbling over it
    if (window.reportAmbientEvent) window.reportAmbientEvent(`CODING EVENT: ${data.type}${data.detail ? ` — ${data.detail}` : ''}`);
    return;
  }
  if (data.type === 'run-done') {
    duck.state = 'jump';
    duck.stateT = 0;
    duck.vy = -300;
    duck.happyT = 2;
    say("run's done! quack!");
  } else if (data.type === 'pr-opened') {
    // PR praise lands because it's SPECIFIC — the title rides in on detail
    spawnConfettiBurst(duck.x, duck.y - DUCK_H / 2);
    duck.state = 'hop';
    duck.stateT = 0;
    duck.hopsLeft = 5;
    duck.hopPause = 0;
    duck.happyT = 3;
    const title = String(data.detail || '').slice(0, 42);
    say(title ? `PR's up — "${title}" — nice one!` : 'PR is UP! quack!');
    duck.bubbleT = 6;
  } else if (data.type === 'tests-passed') {
    duck.state = 'hop';
    duck.stateT = 0;
    duck.hopsLeft = 4;
    duck.hopPause = 0;
    duck.happyT = 2.5;
    say('green! all green!');
  } else if (data.type === 'run-failed' || data.type === 'tests-failed') {
    duck.squashY = 0.8;
    duck.squashX = 1.15;
    say('uh oh. red.');
    duck.bubbleT = 5;
  } else {
    say(String(data.detail || 'something happened!').slice(0, 58));
  }
});

// Do Not Disturb: the duck respects the library
window.quackers.onDnd((on) => {
  quietMode = !!on;
  if (quietMode && duck.bubble) duck.bubble = null;
});

// he's on a call: freeze the antics, sit like a very good duck
window.quackers.onCall((on) => {
  callMode = !!on;
  if (callMode) {
    duck.bubble = null;
    if (!egg.mode && voiceState === 'idle' && ['wander', 'approach', 'hop', 'peck', 'look'].includes(duck.state)) {
      duck.state = 'idle';
      duck.stateT = 0;
      duck.stateDur = 6 + Math.random() * 4;
      duck.rock = 0;
    }
  }
});

// his music: headphones on/off (track changes arrive here too)
window.quackers.onMusic((music) => {
  const wasOff = !musicNow;
  musicNow = music || null;
  if (musicNow && wasOff && !egg.mode) {
    duck.happyT = 1.5;
    noteIn = 0.3; // first ♪ almost immediately — the reveal should read
  }
});

// he's gone / he's back — nap and wake accordingly
window.quackers.onUserAway(() => {
  if (voiceState !== 'idle' || egg.mode) return;
  if (['idle', 'wander', 'look', 'peck', 'preen', 'hop'].includes(duck.state)) {
    duck.state = 'sleep';
    duck.stateT = 0;
    duck.stateDur = 3600; // sleeps until something happens
    duck.zIn = 0.5;
    duck.faceDir = 0;
    duck.bubble = null;
  }
});
window.quackers.onUserBack(() => {
  if (duck.state === 'sleep') {
    duck.state = 'idle';
    duck.stateT = 0;
    duck.stateDur = 3;
  }
});

// the dock's resting height changed (settings edit, display change)
window.quackers.onGround((offset) => setDockOffset(offset));

// tricks: lesson-watching + live performance choreography
window.quackers.onTrick((data) => {
  if (egg.mode) return;
  if (data.phase === 'watching') {
    trick.watching = true;
    if (['idle', 'wander', 'peck', 'preen', 'look', 'sleep', 'hop'].includes(duck.state)) {
      duck.state = 'idle';
      duck.stateT = 0;
      duck.stateDur = 3600; // sit attentively for the whole lesson
      duck.faceDir = 0;
    }
    say('*watching closely*');
  } else if (data.phase === 'action') {
    trick.performing = true;
    trick.tx = clampX(data.x);
    trick.ty = Math.max(DUCK_H, Math.min(groundY(), data.y));
    trick.arrived = false;
    duck.state = 'trickmove';
    duck.stateT = 0;
    duck.bubble = null;
    if (data.label) {
      say(String(data.label).slice(0, 48));
      duck.bubbleT = 3;
    }
  } else if (data.phase === 'confirm') {
    duck.faceDir = 0;
    duck.squashY = 0.9; // attentive bounce: awaiting his word
  } else if (data.phase === 'done' || data.phase === 'abort') {
    const wasPerforming = trick.performing;
    trick.watching = false;
    trick.performing = false;
    if (duck.state === 'trickmove') {
      if (data.phase === 'done') spawnConfettiBurst(duck.x, duck.y - DUCK_H / 2);
      mischief.prideOnLand = data.phase === 'done';
      duck.state = 'falling';
      duck.stateT = 0;
      duck.vx = 0;
      duck.vy = 0;
    } else if (wasPerforming || data.phase === 'done') {
      duck.state = 'preen';
      duck.stateT = 0;
      duck.stateDur = 2;
    }
  }
});

// workshop phases: the build performance, the ta-da, the charming failure
window.quackers.onWorkshop((data) => {
  if (egg.mode) return;
  if (data.phase === 'building') {
    if (['dragged', 'poof', 'hidden', 'flee', 'hatching', 'trickmove'].includes(duck.state)) return;
    mischief.active = false;
    build.kind = data.kind || 'game';
    build.quipIn = 1.5;
    build.sparkIn = 0.3;
    duck.state = 'building';
    duck.stateT = 0;
    duck.stateDur = 3600; // holds until done/fail arrives
    duck.bubble = null;
  } else if (data.phase === 'done') {
    if (duck.state !== 'building') return;
    spawnConfettiBurst(duck.x, duck.y - DUCK_H / 2);
    duck.state = 'preen';
    duck.stateT = 0;
    duck.stateDur = 2;
    say('ta-da!');
  } else if (data.phase === 'fail') {
    if (duck.state !== 'building') return;
    duck.state = 'idle';
    duck.stateT = 0;
    duck.stateDur = 3;
    duck.squashY = 0.8;
    duck.squashX = 1.15;
    say('…the roof fell off.');
  }
});

// equipped workshop props: load at boot, refresh on outfit changes
window.quackers.propsGet().then((layers) => { propLayers = layers || []; }).catch(() => {});
window.quackers.onProps((data) => { propLayers = (data && data.layers) || []; });

// the visible act of looking — plays before every screen capture
window.quackers.onLooking(() => window.duckAPI.startLooking());
window.quackers.onLookingDone(() => window.duckAPI.stopLooking());

// the slow mind at work
window.quackers.onDreaming((on) => {
  dreamGlow = !!on;
  if (on && !egg.mode && voiceState === 'idle' && ['idle', 'wander', 'look', 'peck', 'preen'].includes(duck.state)) {
    duck.state = 'sleep';
    duck.stateT = 0;
    duck.stateDur = 60;
    duck.zIn = 0.4;
  }
});
window.quackers.onDreamed(() => {
  if (voiceState !== 'idle' || egg.mode) return;
  duck.state = 'preen';
  duck.stateT = 0;
  duck.stateDur = 2;
  say('*sorted my thoughts*');
});

// the voice arrives (key was just saved)
window.quackers.onVoiceGranted(() => {
  egg.hasVoice = true;
  if (egg.mode) return;
  duck.state = 'hop';
  duck.stateT = 0;
  duck.hopsLeft = 5;
  duck.hopPause = 0;
  duck.happyT = 3;
  say('I CAN TALK. quack. QUACK. double-click me!');
  duck.bubbleT = 7;
});

window.quackers.onArrive(() => {
  duck.alpha = 1;
  duck.x = clampX(duck.x);
  duck.y = groundY() - 320;
  duck.vx = 0;
  duck.vy = 0;
  duck.rock = 0;
  duck.state = 'falling';
  duck.stateT = 0;
  duck.greetOnLand = true;
});

// ---------------------------------------------------------------------------
// Mouse: click-through window, interactive only over the duck
// ---------------------------------------------------------------------------

let interactive = false;
let dragging = false;
let mouseDown = false;
let downAt = { x: 0, y: 0, t: 0 };
const recent = [];

function duckBounds() {
  const pad = duck.state === 'flee' ? 28 : 12; // fair hitbox at chase speed
  return {
    left: duck.x - DUCK_W / 2 - pad,
    right: duck.x + DUCK_W / 2 + pad,
    top: duck.y - DUCK_H - pad,
    bottom: duck.y + PX * 2 + 8,
  };
}

function overDuck(x, y) {
  if (duck.state === 'hidden' || duck.state === 'poof') return false;
  const b = duckBounds();
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
}

function setInteractive(v) {
  if (interactive === v) return;
  interactive = v;
  window.quackers.setInteractive(v);
  canvas.style.cursor = v ? 'grab' : 'default';
}

window.addEventListener('mousemove', (e) => {
  const { clientX: x, clientY: y } = e;
  cursor.x = x;
  cursor.y = y;
  cursor.seenAt = performance.now();

  if (dragging) {
    duck.x = x;
    duck.y = y + DUCK_H / 2;
    recent.push({ x, y, t: performance.now() });
    while (recent.length > 6) recent.shift();
    return;
  }

  if (mouseDown) {
    const moved = Math.hypot(x - downAt.x, y - downAt.y);
    if (moved > 6) {
      dragging = true;
      duck.state = 'dragged';
      duck.bubble = null;
      canvas.style.cursor = 'grabbing';
    }
    return;
  }

  setInteractive(
    overDuck(x, y) ||
      (window.stageAPI && window.stageAPI.overStage(x, y)) ||
      (window.chatAPI && window.chatAPI.overPanel(x, y))
  );
});

window.addEventListener('mousedown', (e) => {
  if (!overDuck(e.clientX, e.clientY)) return;
  if (duck.state === 'flee') {
    endChase(true); // gotcha
    return;
  }
  mouseDown = true;
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  recent.length = 0;
});

// right-click the duck: toss it a crumb
window.addEventListener('contextmenu', (e) => {
  if (!overDuck(e.clientX, e.clientY)) return;
  e.preventDefault();
  const side = Math.random() < 0.5 ? -1 : 1;
  crumbs.push({
    x: clampX(duck.x + side * (140 + Math.random() * 160)),
    y: duck.y - DUCK_H - 220,
    vy: 0,
    landed: false,
  });
  if (crumbs.length > 5) crumbs.shift();
});

window.addEventListener('mouseup', (e) => {
  if (!mouseDown) return;
  mouseDown = false;

  if (dragging) {
    dragging = false;
    let vx = 0;
    let vy = 0;
    if (recent.length >= 2) {
      const a = recent[0];
      const b = recent[recent.length - 1];
      const dtm = Math.max(16, b.t - a.t);
      vx = ((b.x - a.x) / dtm) * 1000;
      vy = ((b.y - a.y) / dtm) * 1000;
    }
    duck.vx = Math.max(-900, Math.min(900, vx * 0.6));
    duck.vy = Math.max(-600, Math.min(600, vy * 0.4));
    duck.state = 'falling';
    duck.stateT = 0;
    canvas.style.cursor = 'grab';
    if (performance.now() - lastTossReportAt > 10000) {
      lastTossReportAt = performance.now();
      window.quackers.happening('toss');
    }
    return;
  }

  // quick click = pet; two quick clicks = start/stop talking
  const quick = performance.now() - downAt.t < 300;
  if (quick && performance.now() - lastQuickClickAt < 400) {
    lastQuickClickAt = 0;
    if (window.voiceToggle) window.voiceToggle();
    return;
  }
  if (quick) {
    lastQuickClickAt = performance.now();
    if (performance.now() - lastPetReportAt > 20000) {
      lastPetReportAt = performance.now();
      window.quackers.happening('pet');
    }
    duck.happyT = 1.6;
    if (egg.mode) {
      // petting warms the egg toward hatching
      egg.progress += 0.12;
      egg.wobbleT = 0.7;
      if (Math.random() < 0.4 && !duck.bubble) say(Math.random() < 0.5 ? '*wobbles happily*' : '…peep!');
    }
    if (duck.state === 'sleep') {
      duck.state = 'idle';
      duck.stateT = 0;
      duck.stateDur = 2;
      say('quack?!');
    }
    for (let i = 0; i < 3; i++) {
      spawnParticle('heart', duck.x + (Math.random() - 0.5) * 40, duck.y - DUCK_H + 8);
    }
    duck.squashY = 0.88;
    duck.squashX = 1.08;
  }
});

document.addEventListener('mouseleave', () => {
  if (!dragging) setInteractive(false);
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  update(dt);

  // while fleeing, the duck moves under a possibly-stationary cursor —
  // re-evaluate interactivity every frame so the catch-click always lands
  if (duck.state === 'flee' && !mouseDown && !dragging && cursor.x != null) {
    setInteractive(overDuck(cursor.x, cursor.y));
  }

  ctx.clearRect(0, 0, W, H);
  drawMarks();
  drawCrumbs();
  drawShadow();
  drawDuck();
  drawVoiceDot();
  drawWatchDot();
  drawThinkingDots();
  drawParticles();
  drawBubble();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
