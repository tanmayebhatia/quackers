// The runtime shim runs inside a sandboxed iframe in the app; here we run its
// source in a vm with a fake canvas to prove the contract without Electron.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const { API_NAMES } = require('../src/stage-api');

function bootRuntime({ state = {} } = {}) {
  const outer = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'stage-runtime.js'), 'utf8'), { window: outer });
  const posted = [];
  const listeners = [];
  const ctx2d = new Proxy({}, { get: () => () => {}, set: () => true });
  const sandbox = {
    window: { __STAGE_STATE__: state, addEventListener: (_ev, fn) => listeners.push(fn), onerror: null },
    parent: { postMessage: (m) => posted.push(m) },
    document: { getElementById: () => ({ getContext: () => ctx2d, width: 340, height: 280 }) },
    Date,
    Math,
    JSON,
    String,
    Number,
  };
  vm.runInNewContext(outer.STAGE_RUNTIME_SOURCE, sandbox);
  return { stage: sandbox.window.__stage, posted, tap: (x, y) => listeners.forEach((fn) => fn({ data: { q: 'tap', x, y } })) };
}

test('runtime exposes the full stage-api contract and posts ready', () => {
  const { stage, posted } = bootRuntime();
  for (const name of API_NAMES) assert.ok(name in stage, `stage.${name} missing`);
  assert.ok(posted.some((m) => m.q === 'ready'));
});

test('taps dispatch to onTap and to grid cells', () => {
  const { stage, tap } = bootRuntime();
  const taps = [];
  const cells = [];
  stage.onTap((t) => taps.push(t));
  stage.grid(3, 3, (c) => cells.push(c));
  tap(170, 140); // board center → middle cell
  assert.equal(taps.length, 1);
  assert.equal(cells.length, 1);
  assert.deepEqual({ col: cells[0].col, row: cells[0].row }, { col: 1, row: 1 });
});

test('state is preloaded; save/score/done/say post the right messages; say throttles', () => {
  const { stage, posted } = bootRuntime({ state: { scores: { duck: 2 } } });
  assert.deepEqual(stage.state, { scores: { duck: 2 } });
  stage.save();
  stage.reportScore('duck');
  stage.reportScore('nobody'); // ignored
  stage.say('quack');
  stage.say('quack again'); // throttled away
  stage.done('all done');
  assert.ok(posted.some((m) => m.q === 'state' && m.state.scores.duck === 2));
  assert.equal(posted.filter((m) => m.q === 'score').length, 1);
  assert.equal(posted.filter((m) => m.q === 'say').length, 1);
  assert.ok(posted.some((m) => m.q === 'done'));
});
