// Unit tests for the workshop: storage, validation, consent gate, props, and
// the build pipeline (with a stubbed model + smoke bench).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const spine = require('../src/spine');
const workshop = require('../src/workshop');
const stageApi = require('../src/stage-api');

let dir;
let sent;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackers-wshop-'));
  spine.init(dir);
  sent = [];
  workshop.init({
    dir,
    spine,
    loadApiKey: () => 'sk-test',
    logEvent: () => {},
    sendToDuck: (channel, payload) => sent.push({ channel, payload }),
    smokeTest: async () => ({ ok: true, error: null }),
  });
});

test('stage-api doc mentions every API name', () => {
  for (const name of stageApi.API_NAMES) {
    assert.ok(stageApi.API_DOC.includes(name), `API_DOC missing ${name}`);
  }
});

test('artifacts: save, fuzzy find, reload round-trip, spine refs sync', () => {
  const a = workshop.saveArtifact({ name: 'Tic Tac Toe', kind: 'game', description: 'x and o', code: 'stage.onTap(() => {})' });
  assert.ok(a.id);
  assert.equal(a.status, 'ok');
  assert.ok(workshop.findArtifact('tic tac toe'));
  assert.ok(workshop.findArtifact('play tic tac toe please'), 'fuzzy within a spoken phrase');
  assert.ok(workshop.findArtifact('tic tac'), 'partial name matches');
  assert.equal(workshop.findArtifact('chess'), null);
  assert.equal(spine.workshopRefs()[0].name, 'Tic Tac Toe');
  // reload from disk
  workshop.init({ dir, spine, loadApiKey: () => 'sk', logEvent: () => {}, sendToDuck: () => {}, smokeTest: async () => ({ ok: true }) });
  assert.ok(workshop.findArtifact('tic tac toe'));
});

test('re-saving the same name is a revision: same id, version bumps, use count kept', () => {
  const a = workshop.saveArtifact({ name: 'doodle', kind: 'viz', description: '', code: '1' });
  workshop.recordUse(a.id);
  const b = workshop.saveArtifact({ name: 'Doodle', kind: 'viz', description: '', code: '2' });
  assert.equal(b.id, a.id);
  assert.equal(b.version, 2);
  assert.equal(b.timesUsed, 1);
  assert.equal(workshop.listArtifacts().length, 1);
});

test('validateCode blocks escape hatches and broken syntax', () => {
  assert.equal(workshop.validateCode('stage.onTap(() => stage.say("hi"))').ok, true);
  for (const bad of [
    'fetch("http://x")',
    'window.parent.postMessage({}, "*")',
    'new Function("alert(1)")()',
    'const x = eval("1")',
    'localStorage.setItem("a", 1)',
    'import("x")',
    'document.cookie',
    'stage.onTap(() => {', // syntax error
  ]) {
    assert.equal(workshop.validateCode(bad).ok, false, `should reject: ${bad}`);
  }
});

test('validatePropSpec enforces anchor, bounds, size, hex colors', () => {
  assert.equal(workshop.validatePropSpec({ anchor: 'head', px: [[7, -2, '#5e35b1']] }).ok, true);
  assert.equal(workshop.validatePropSpec({ anchor: 'hand', px: [[0, 0, '#fff000']] }).ok, false);
  assert.equal(workshop.validatePropSpec({ anchor: 'head', px: [] }).ok, false);
  assert.equal(workshop.validatePropSpec({ anchor: 'head', px: [[99, 0, '#fff000']] }).ok, false);
  assert.equal(workshop.validatePropSpec({ anchor: 'head', px: [[0, 0, 'red']] }).ok, false);
  assert.equal(workshop.validatePropSpec({ anchor: 'head', px: Array.from({ length: 81 }, () => [0, 0, '#111111']) }).ok, false);
});

test('consent gate: build refused without a recent check_workshop', () => {
  const out = workshop.requestBuild({ name: 'tic tac toe', kind: 'game', description: 'x o' });
  assert.match(out, /check_workshop/);
  assert.equal(workshop.pendingBuild(), null, 'no build may start ungated');
});

test('checkWorkshop returns framed strings for hit and miss', () => {
  const miss = workshop.checkWorkshop('tic tac toe');
  assert.equal(miss.exists, false);
  assert.match(miss.framed, /OFFER to build/);
  workshop.saveArtifact({ name: 'tic tac toe', kind: 'game', description: '', code: '1' });
  const hit = workshop.checkWorkshop('tic tac toe');
  assert.equal(hit.exists, true);
  assert.match(hit.framed, /run_artifact/);
});

test('props: equip replaces same-anchor, layers convert for the renderer, persists', () => {
  workshop.saveArtifact({ name: 'wizard hat', kind: 'prop', description: '', spec: { anchor: 'head', px: [[7, -2, '#5e35b1']] } });
  workshop.saveArtifact({ name: 'party hat', kind: 'prop', description: '', spec: { anchor: 'head', px: [[7, -3, '#ff6b81']] } });
  workshop.saveArtifact({ name: 'skateboard', kind: 'prop', description: '', spec: { anchor: 'feet', px: [[4, 14, '#6db7ff']] } });
  workshop.equipProp('wizard hat');
  workshop.equipProp('skateboard');
  assert.equal(workshop.equippedPropLayers().length, 2);
  workshop.equipProp('party hat'); // replaces the other head-anchored prop
  const layers = workshop.equippedPropLayers();
  assert.equal(layers.length, 2);
  assert.ok(layers.some((l) => l.shift === true && l.px[0][2] === '#ff6b81'), 'head props shift with the face');
  assert.ok(layers.some((l) => l.shift === false), 'feet props are body-fixed');
  assert.ok(sent.some((s) => s.channel === 'quackers:props'), 'renderer told about outfit change');
  const out = workshop.unequipProp('party hat');
  assert.match(out, /took|off/i);
  assert.equal(workshop.equippedPropLayers().length, 1);
});

test('runArtifact opens the stage and records use; props and broken redirect', () => {
  const a = workshop.saveArtifact({ name: 'tic tac toe', kind: 'game', description: '', code: 'stage.onTap(()=>{})' });
  const out = workshop.runArtifact('tic tac toe');
  assert.match(out, /do NOT call record_game_result/);
  assert.ok(sent.some((s) => s.channel === 'quackers:stage-open' && s.payload.id === a.id));
  assert.equal(workshop.findArtifact('tic tac toe').timesUsed, 1);
  workshop.saveArtifact({ name: 'hat', kind: 'prop', description: '', spec: { anchor: 'head', px: [[0, 0, '#111111']] } });
  assert.match(workshop.runArtifact('hat'), /equip_prop/);
  workshop.saveArtifact({ name: 'busted', kind: 'game', description: '', code: '1', broken: true, lastError: 'x' });
  assert.match(workshop.runArtifact('busted'), /rebuild/);
});

test('saveState clamps and persists into the artifact file', () => {
  const a = workshop.saveArtifact({ name: 'ttt', kind: 'game', description: '', code: '1' });
  workshop.saveState(a.id, { scores: { duck: 1 } });
  workshop.init({ dir, spine, loadApiKey: () => 'sk', logEvent: () => {}, sendToDuck: () => {}, smokeTest: async () => ({ ok: true }) });
  assert.deepEqual(workshop.findArtifact('ttt').lastState, { scores: { duck: 1 } });
});

// ---------------------------------------------------------------------------
// Build pipeline (stubbed model + bench)
// ---------------------------------------------------------------------------

function fetchReturning(bodies) {
  // sequential canned chat-completions responses
  let i = 0;
  return async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(bodies[Math.min(i++, bodies.length - 1)]) } }] }),
  });
}

test('build pipeline: gated request → codegen → smoke → saved ok + events', async () => {
  const realFetch = global.fetch;
  global.fetch = fetchReturning([{ code: 'stage.onTap(() => stage.say("hi"))' }]);
  try {
    workshop.checkWorkshop('tic tac toe');
    const out = workshop.requestBuild({ name: 'tic tac toe', kind: 'game', description: '3x3 grid' });
    assert.match(out, /WORKSHOP EVENT/);
    await workshop.pendingBuild();
    const a = workshop.findArtifact('tic tac toe');
    assert.equal(a.status, 'ok');
    assert.match(a.code, /onTap/);
    assert.ok(sent.some((s) => s.channel === 'quackers:workshop' && s.payload.phase === 'building'));
    assert.ok(sent.some((s) => s.channel === 'quackers:workshop' && s.payload.phase === 'done'));
    assert.ok(sent.some((s) => s.channel === 'quackers:stage-open'), 'a fresh build opens the stage');
    assert.ok(sent.some((s) => s.channel === 'quackers:workshop-event' && /build finished/.test(s.payload.text)));
  } finally {
    global.fetch = realFetch;
  }
});

test('repair round: first output invalid, second passes — two model calls', async () => {
  const realFetch = global.fetch;
  let calls = 0;
  const canned = fetchReturning([{ code: 'fetch("http://evil")' }, { code: 'stage.onTap(() => {})' }]);
  global.fetch = async (...a) => { calls++; return canned(...a); };
  try {
    workshop.checkWorkshop('doodler');
    workshop.requestBuild({ name: 'doodler', kind: 'viz', description: 'draws' });
    await workshop.pendingBuild();
    assert.equal(calls, 2);
    assert.equal(workshop.findArtifact('doodler').status, 'ok');
  } finally {
    global.fetch = realFetch;
  }
});

test('double failure: saved broken + charming-fail event, no stage-open', async () => {
  const realFetch = global.fetch;
  global.fetch = fetchReturning([{ code: 'not valid js ((' }, { code: 'also (( not valid' }]);
  try {
    workshop.checkWorkshop('cursed thing');
    workshop.requestBuild({ name: 'cursed thing', kind: 'game', description: '' });
    await workshop.pendingBuild();
    const a = workshop.findArtifact('cursed thing');
    assert.equal(a.status, 'broken');
    assert.ok(a.lastError);
    assert.ok(sent.some((s) => s.channel === 'quackers:workshop' && s.payload.phase === 'fail'));
    assert.ok(!sent.some((s) => s.channel === 'quackers:stage-open'));
  } finally {
    global.fetch = realFetch;
  }
});

test('prop build: validated spec saved, no smoke test, equip offered', async () => {
  const realFetch = global.fetch;
  global.fetch = fetchReturning([{ anchor: 'head', px: [[7, -2, '#5e35b1'], [6, -1, '#5e35b1']] }]);
  try {
    workshop.checkWorkshop('wizard hat');
    workshop.requestBuild({ name: 'wizard hat', kind: 'prop', description: 'pointy, purple' });
    await workshop.pendingBuild();
    const a = workshop.findArtifact('wizard hat');
    assert.equal(a.status, 'ok');
    assert.equal(a.spec.anchor, 'head');
    assert.ok(sent.some((s) => s.channel === 'quackers:workshop-event' && /equip_prop/.test(s.payload.text)));
  } finally {
    global.fetch = realFetch;
  }
});

test('smoke failure feeds the repair round', async () => {
  const realFetch = global.fetch;
  global.fetch = fetchReturning([{ code: 'stage.onTap(() => {})' }, { code: 'stage.grid(3, 3, () => {})' }]);
  let smokes = 0;
  workshop.init({
    dir, spine, loadApiKey: () => 'sk', logEvent: () => {},
    sendToDuck: (channel, payload) => sent.push({ channel, payload }),
    smokeTest: async () => (++smokes === 1 ? { ok: false, error: 'blew up on the bench' } : { ok: true, error: null }),
  });
  try {
    workshop.checkWorkshop('ttt');
    workshop.requestBuild({ name: 'ttt', kind: 'game', description: '' });
    await workshop.pendingBuild();
    assert.equal(smokes, 2);
    assert.equal(workshop.findArtifact('ttt').status, 'ok');
  } finally {
    global.fetch = realFetch;
  }
});

test('one build at a time', async () => {
  const realFetch = global.fetch;
  global.fetch = fetchReturning([{ code: 'stage.onTap(() => {})' }]);
  try {
    workshop.checkWorkshop('a');
    workshop.checkWorkshop('b');
    workshop.requestBuild({ name: 'a', kind: 'game', description: '' });
    assert.match(workshop.requestBuild({ name: 'b', kind: 'game', description: '' }), /one project at a time/);
    await workshop.pendingBuild();
  } finally {
    global.fetch = realFetch;
  }
});
