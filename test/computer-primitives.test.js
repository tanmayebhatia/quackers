const { test } = require('node:test');
const assert = require('node:assert');

const primitives = require('../src/computer-primitives');

test('computer primitives accept only the bounded action vocabulary', () => {
  assert.equal(primitives.validateAction({ action: 'press_keys', key: 'left', modifiers: ['command'] }).ok, true);
  assert.equal(primitives.validateAction({ action: 'press_keys', key: 'f13' }).ok, false);
  assert.equal(primitives.validateAction({ action: 'run_shell', text: 'rm -rf nope' }).ok, false);
  assert.equal(primitives.validateAction({ action: 'open_url', url: 'javascript:alert(1)' }).ok, false);
  assert.equal(primitives.validateAction({ action: 'open_url', url: 'https://example.com/a' }).ok, true);
  assert.equal(primitives.validateAction({ action: 'open_app', app: 'Visual Studio Code' }).ok, true);
  const normalizedApp = primitives.validateAction({ action: 'open_app', app: 'Code\nTerminal' });
  assert.equal(normalizedApp.ok, true);
  assert.equal(normalizedApp.action.app, 'Code Terminal');
});

test('consequential typing, delete/return, and command chords require confirmation', () => {
  const action = (input) => primitives.validateAction(input).action;
  assert.equal(primitives.needsConfirmation(action({ action: 'type_text', text: 'hello' })), true);
  assert.equal(primitives.needsConfirmation(action({ action: 'press_keys', key: 'return' })), true);
  assert.equal(primitives.needsConfirmation(action({ action: 'press_keys', key: 'w', modifiers: ['command'] })), true);
  assert.equal(primitives.needsConfirmation(action({ action: 'press_keys', key: 'left' })), false);
  assert.equal(primitives.needsConfirmation(action({ action: 'open_app', app: 'Notes' })), false);
});

test('typed text is passed as an osascript argv value, never interpolated into script', async () => {
  const calls = [];
  const execFileImpl = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(null);
  };
  const hostile = 'hello"; do shell script "nope';
  const result = await primitives.runAction(
    { action: 'type_text', text: hostile },
    { execFileImpl }
  );
  assert.equal(result.ok, true);
  assert.equal(calls[0].file, 'osascript');
  assert.equal(calls[0].args.at(-1), hostile);
  assert.ok(!calls[0].args.slice(0, -1).join(' ').includes(hostile));
});

test('key modifiers are normalized and emitted without shell execution', async () => {
  const calls = [];
  const result = await primitives.runAction(
    { action: 'press_keys', key: 'k', modifiers: ['cmd', 'SHIFT', 'bogus'] },
    {
      execFileImpl: (file, args, options, callback) => {
        calls.push({ file, args, options });
        callback(null);
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(calls[0].file, 'osascript');
  assert.match(calls[0].args.join(' '), /command down/);
  assert.match(calls[0].args.join(' '), /shift down/);
  assert.ok(!calls[0].args.join(' ').includes('bogus'));
});
