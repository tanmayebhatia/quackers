const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const integrations = require('../src/integrations');

let root;
let homeDir;
let userDataDir;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'quackers-hooks-'));
  homeDir = path.join(root, 'home');
  userDataDir = path.join(root, 'data');
  fs.mkdirSync(homeDir, { recursive: true });
});

test('Codex hook merge preserves existing hooks and is idempotent', () => {
  const existing = {
    description: 'mine',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: '/usr/local/bin/my-hook', timeout: 9 }] }],
      SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }],
    },
  };
  const once = integrations.mergeHooks(existing, 'codex', '/tmp/Quackers Data/quackers-hook.sh');
  const twice = integrations.mergeHooks(once, 'codex', '/tmp/Quackers Data/quackers-hook.sh');
  assert.equal(twice.description, 'mine');
  assert.equal(twice.hooks.SessionEnd.length, 1);
  assert.equal(twice.hooks.Stop.length, 2, 'existing Stop hook plus Quackers');
  assert.equal(twice.hooks.PermissionRequest.length, 1);
  assert.equal(JSON.stringify(twice).match(/quackers-hook\.sh/g).length, 2, 'one command per event, no duplicates');
});

test('Claude install writes its settings, local bridge, backup, and preserves unrelated config', () => {
  const file = integrations.configPath('claude', homeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { PreToolUse: [] } }));

  const status = integrations.installIntegration('claude', { homeDir, userDataDir });
  assert.equal(status.installed, true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.permissions, { allow: ['Read'] });
  assert.ok(saved.hooks.Stop && saved.hooks.StopFailure && saved.hooks.Notification);
  assert.ok(fs.existsSync(`${file}.quackers-backup`));
  const bridge = path.join(userDataDir, 'integrations', integrations.HOOK_BASENAME);
  assert.ok(fs.statSync(bridge).mode & 0o100, 'bridge is executable');
  assert.match(fs.readFileSync(bridge, 'utf8'), /127\.0\.0\.1:42990/);
});

test('disconnect removes only Quackers hook commands', () => {
  integrations.installIntegration('codex', { homeDir, userDataDir });
  const file = integrations.configPath('codex', homeDir);
  const installed = JSON.parse(fs.readFileSync(file, 'utf8'));
  installed.hooks.Stop.unshift({ hooks: [{ type: 'command', command: 'echo keep-me' }] });
  fs.writeFileSync(file, JSON.stringify(installed));

  const status = integrations.removeIntegration('codex', { homeDir, userDataDir });
  assert.equal(status.installed, false);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.hooks.Stop.length, 1);
  assert.equal(saved.hooks.Stop[0].hooks[0].command, 'echo keep-me');
  assert.equal(JSON.stringify(saved).includes('quackers-hook.sh'), false);
});

test('malformed user config is never overwritten', () => {
  const file = integrations.configPath('codex', homeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ nope');
  assert.throws(
    () => integrations.installIntegration('codex', { homeDir, userDataDir }),
    /not valid JSON/
  );
  assert.equal(fs.readFileSync(file, 'utf8'), '{ nope');
});
