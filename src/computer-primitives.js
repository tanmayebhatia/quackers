// Small, bounded "hands" for direct user requests. These are deliberately not
// a shell: one request becomes one keystroke/type/open action, with strict
// validation before macOS automation is touched.

const { execFile } = require('child_process');

const MODIFIERS = new Map([
  ['command', 'command down'],
  ['cmd', 'command down'],
  ['control', 'control down'],
  ['ctrl', 'control down'],
  ['option', 'option down'],
  ['alt', 'option down'],
  ['shift', 'shift down'],
]);

const KEY_CODES = new Map([
  ['return', 36],
  ['enter', 36],
  ['tab', 48],
  ['space', 49],
  ['backspace', 51],
  ['delete', 51],
  ['escape', 53],
  ['esc', 53],
  ['left', 123],
  ['right', 124],
  ['down', 125],
  ['up', 126],
  ['home', 115],
  ['end', 119],
  ['pageup', 116],
  ['pagedown', 121],
]);

function cleanAction(input = {}) {
  const action = String(input.action || '').toLowerCase().trim();
  const modifiers = [...new Set(
    (Array.isArray(input.modifiers) ? input.modifiers : [])
      .map((value) => String(value).toLowerCase().trim())
      .filter((value) => MODIFIERS.has(value))
      .map((value) => MODIFIERS.get(value).split(' ')[0])
  )].slice(0, 4);
  return {
    action,
    key: String(input.key || '').toLowerCase().trim().slice(0, 30),
    modifiers,
    text: String(input.text || '').slice(0, 2000),
    app: String(input.app || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120),
    url: String(input.url || '').trim().slice(0, 2000),
  };
}

function validateAction(input) {
  const action = cleanAction(input);
  if (!['press_keys', 'type_text', 'open_app', 'open_url'].includes(action.action)) {
    return { ok: false, error: 'unknown computer action' };
  }
  if (action.action === 'press_keys') {
    const isCharacter = /^[a-z0-9]$/.test(action.key);
    if (!isCharacter && !KEY_CODES.has(action.key)) return { ok: false, error: 'that key is not in the safe key set' };
  }
  if (action.action === 'type_text' && !action.text) return { ok: false, error: 'there is no text to type' };
  if (action.action === 'open_app' && !/^[\p{L}\p{N} ._+()'-]+$/u.test(action.app)) {
    return { ok: false, error: 'that app name is not valid' };
  }
  if (action.action === 'open_url') {
    let url;
    try { url = new URL(action.url); } catch { return { ok: false, error: 'that URL is not valid' }; }
    if (!['https:', 'http:'].includes(url.protocol)) return { ok: false, error: 'only web links can be opened' };
    action.url = url.toString();
  }
  return { ok: true, action };
}

function needsConfirmation(action) {
  if (action.action === 'type_text') return true;
  if (action.action !== 'press_keys') return false;
  return ['return', 'enter', 'delete', 'backspace'].includes(action.key) ||
    action.modifiers.includes('command');
}

function describeAction(action) {
  if (action.action === 'type_text') {
    const preview = action.text.replace(/\s+/g, ' ').slice(0, 90);
    return `Type “${preview}${action.text.length > 90 ? '…' : ''}” into the frontmost app`;
  }
  if (action.action === 'press_keys') {
    return `Press ${[...action.modifiers, action.key].join(' + ')} in the frontmost app`;
  }
  if (action.action === 'open_app') return `Open ${action.app}`;
  return `Open ${action.url}`;
}

function runExec(file, args, execFileImpl = execFile) {
  return new Promise((resolve) => {
    execFileImpl(file, args, { timeout: 8000 }, (error) => {
      resolve(error ? { ok: false, error: error.message } : { ok: true });
    });
  });
}

async function runAction(input, options = {}) {
  const checked = validateAction(input);
  if (!checked.ok) return checked;
  const action = checked.action;
  const execFileImpl = options.execFileImpl || execFile;

  if (action.action === 'open_app') return runExec('open', ['-a', action.app], execFileImpl);
  if (action.action === 'open_url') return runExec('open', [action.url], execFileImpl);

  const using = action.modifiers.length
    ? ` using {${action.modifiers.map((value) => `${value} down`).join(', ')}}`
    : '';
  if (action.action === 'type_text') {
    return runExec(
      'osascript',
      ['-e', 'on run argv', '-e', 'tell application "System Events" to keystroke (item 1 of argv)', '-e', 'end run', action.text],
      execFileImpl
    );
  }
  if (KEY_CODES.has(action.key)) {
    return runExec(
      'osascript',
      ['-e', `tell application "System Events" to key code ${KEY_CODES.get(action.key)}${using}`],
      execFileImpl
    );
  }
  return runExec(
    'osascript',
    ['-e', `tell application "System Events" to keystroke "${action.key}"${using}`],
    execFileImpl
  );
}

module.exports = {
  cleanAction,
  validateAction,
  needsConfirmation,
  describeAction,
  runAction,
};
