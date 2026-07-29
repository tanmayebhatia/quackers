// Deterministic gates for model-proposed computer actions. The vision model
// can suggest an action; it never gets to define the security boundary.

const ACTIONS = new Set(['click', 'double_click', 'type', 'key', 'scroll', 'menu_item', 'done', 'abort']);
const RISK_WORDS =
  /\b(delete|erase|remove|empty(?:\s+the)?\s+trash|send|submit|publish|post|purchase|buy|pay|transfer|confirm|approve|accept|close|quit|discard|overwrite|replace|install|uninstall|sign\s*out|log\s*out)\b/i;

function text(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max;
}

function validateAction(action, frame) {
  if (!action || typeof action !== 'object' || !ACTIONS.has(action.action)) {
    return { ok: false, error: 'unknown action' };
  }
  if (action.describe != null && !text(action.describe, 160)) {
    return { ok: false, error: 'invalid action description' };
  }

  if (['click', 'double_click'].includes(action.action)) {
    const width = Number(frame && frame.size && frame.size.width);
    const height = Number(frame && frame.size && frame.size.height);
    if (!Number.isFinite(action.x) || !Number.isFinite(action.y) ||
        !Number.isFinite(width) || !Number.isFinite(height) ||
        action.x < 0 || action.y < 0 || action.x > width || action.y > height) {
      return { ok: false, error: 'click coordinates outside the captured screen' };
    }
  }
  if (action.action === 'type' && !text(action.text, 300)) {
    return { ok: false, error: 'typed text must be 1-300 characters' };
  }
  if (action.action === 'key' && (!text(action.key, 40) || !/^[a-z0-9+ _-]+$/i.test(action.key))) {
    return { ok: false, error: 'invalid key chord' };
  }
  if (action.action === 'scroll' && !['up', 'down'].includes(action.direction)) {
    return { ok: false, error: 'scroll direction must be up or down' };
  }
  if (action.action === 'menu_item' &&
      (!text(action.app, 80) || !text(action.menu, 80) || !text(action.item, 80))) {
    return { ok: false, error: 'menu actions need app, menu, and item names' };
  }
  if (action.action === 'abort' && action.reason != null && !text(action.reason, 300)) {
    return { ok: false, error: 'invalid abort reason' };
  }
  return { ok: true, error: null };
}

function actionLooksRisky(action, trick = {}, history = []) {
  if (!action || action.risky === true) return true;
  const description = [
    action.describe,
    action.item,
    action.menu,
    action.text,
  ].filter(Boolean).join(' ');
  if (RISK_WORDS.test(description)) return true;

  const riskyPlan = Array.isArray(trick.steps) && trick.steps.some((step) => step && step.risky);
  const key = String(action.key || '').toLowerCase().replace(/\s+/g, '');
  if (action.action === 'key' && ['return', 'enter'].includes(key)) {
    const priorTyped = history.length && history[history.length - 1].action === 'type';
    if (priorTyped || riskyPlan) return true;
  }
  if (action.action === 'key' && /^(cmd|command)\+(w|q|delete|backspace)$/.test(key)) return true;
  return false;
}

module.exports = { ACTIONS, RISK_WORDS, validateAction, actionLooksRisky };
