// One-click coding buddy integrations. We merge only our hook commands into
// existing Codex/Claude config, and removal filters only those commands.

const fs = require('fs');
const path = require('path');

const HOOK_BASENAME = 'quackers-hook.sh';
const HOOK_EVENTS = {
  codex: [
    ['Stop', 'codex-stop'],
    ['PermissionRequest', 'codex-attention'],
  ],
  claude: [
    ['Stop', 'claude-stop'],
    ['StopFailure', 'claude-failure'],
    ['Notification', 'claude-attention'],
  ],
};

function configPath(kind, homeDir) {
  if (kind === 'codex') return path.join(homeDir, '.codex', 'hooks.json');
  if (kind === 'claude') return path.join(homeDir, '.claude', 'settings.json');
  throw new Error('unknown integration');
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('root must be an object');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`${file} is not valid JSON (${error.message})`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.quackers-tmp`;
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.quackers-backup`);
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function hookCommand(scriptPath, eventName) {
  return `${shellQuote(scriptPath)} ${eventName}`;
}

function isQuackersHook(hook) {
  return hook && hook.type === 'command' && String(hook.command || '').includes(HOOK_BASENAME);
}

function mergeHooks(config, kind, scriptPath) {
  const next = structuredClone(config);
  if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) next.hooks = {};
  for (const [event, arg] of HOOK_EVENTS[kind]) {
    const groups = Array.isArray(next.hooks[event]) ? next.hooks[event] : [];
    const already = groups.some((group) =>
      Array.isArray(group && group.hooks) && group.hooks.some(isQuackersHook)
    );
    if (!already) {
      groups.push({
        hooks: [{ type: 'command', command: hookCommand(scriptPath, arg), timeout: 3 }],
      });
    }
    next.hooks[event] = groups;
  }
  if (kind === 'codex' && !next.description) {
    next.description = 'Personal Codex hooks, including the local Quackers coding buddy.';
  }
  return next;
}

function removeHooks(config) {
  const next = structuredClone(config);
  if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) return next;
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    next.hooks[event] = groups
      .map((group) => {
        if (!group || !Array.isArray(group.hooks)) return group;
        return { ...group, hooks: group.hooks.filter((hook) => !isQuackersHook(hook)) };
      })
      .filter((group) => !group || !Array.isArray(group.hooks) || group.hooks.length);
    if (!next.hooks[event].length) delete next.hooks[event];
  }
  return next;
}

function scriptContents() {
  return `#!/bin/sh
# Installed by Quackers. Localhost only; hook input is intentionally ignored.
case "$1" in
  codex-stop) payload='{"type":"run-done","detail":"Codex finished a turn"}' ;;
  codex-attention) payload='{"type":"note","detail":"Codex needs your attention"}' ;;
  claude-stop) payload='{"type":"run-done","detail":"Claude Code finished a turn"}' ;;
  claude-failure) payload='{"type":"run-failed","detail":"Claude Code hit an API error"}' ;;
  claude-attention) payload='{"type":"note","detail":"Claude Code needs your attention"}' ;;
  *) exit 0 ;;
esac
/usr/bin/curl --silent --max-time 2 --header 'Content-Type: application/json' \\
  --request POST --data "$payload" http://127.0.0.1:42990/event >/dev/null 2>&1 || true
exit 0
`;
}

function ensureHookScript(userDataDir) {
  const dir = path.join(userDataDir, 'integrations');
  const file = path.join(dir, HOOK_BASENAME);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, scriptContents(), { mode: 0o700 });
  fs.chmodSync(file, 0o700);
  return file;
}

function integrationStatus(kind, options) {
  const file = configPath(kind, options.homeDir);
  try {
    const config = readJson(file);
    const wanted = HOOK_EVENTS[kind].map(([event]) => event);
    const installed = wanted.every((event) =>
      Array.isArray(config.hooks && config.hooks[event]) &&
      config.hooks[event].some((group) => Array.isArray(group && group.hooks) && group.hooks.some(isQuackersHook))
    );
    return { kind, installed, file };
  } catch (error) {
    return { kind, installed: false, file, error: error.message };
  }
}

function installIntegration(kind, options) {
  const scriptPath = ensureHookScript(options.userDataDir);
  const file = configPath(kind, options.homeDir);
  const current = readJson(file);
  writeJson(file, mergeHooks(current, kind, scriptPath));
  return integrationStatus(kind, options);
}

function removeIntegration(kind, options) {
  const file = configPath(kind, options.homeDir);
  const current = readJson(file);
  writeJson(file, removeHooks(current));
  return integrationStatus(kind, options);
}

module.exports = {
  HOOK_BASENAME,
  configPath,
  mergeHooks,
  removeHooks,
  scriptContents,
  integrationStatus,
  installIntegration,
  removeIntegration,
};
