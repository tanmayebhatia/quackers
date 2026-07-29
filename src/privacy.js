// Privacy-safe local diagnostics. Quackers keeps enough event metadata to
// diagnose lifecycle failures without archiving conversations, memories,
// screen contents, names, or model output.

const fs = require('fs');

const SAFE_FIELDS = new Set([
  'ok',
  'status',
  'stage',
  'screenPermission',
  'micPermission',
  'mode',
  'model',
  'kind',
  'phase',
  'action',
  'risky',
  'step',
  'first',
  'on',
  'offset',
  'winner',
  'game',
  'count',
  'turns',
  'chars',
  'kb',
  'width',
  'height',
  'closed',
  'scheduled',
  'rewritten',
  'invalidated',
  'promoted',
  'who_len',
]);

function summarizeLogData(type, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;

  if (type === 'conversation-transcript') {
    const lines = Array.isArray(data.lines) ? data.lines : [];
    return {
      mode: data.mode === 'chat' ? 'chat' : 'voice',
      turns: lines.length,
      chars: lines.reduce((n, line) => n + String(line && line.text || '').length, 0),
    };
  }

  const safe = {};
  for (const [key, value] of Object.entries(data)) {
    if (!SAFE_FIELDS.has(key)) continue;
    if (typeof value === 'string') safe[key] = value.slice(0, 80);
    else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === 'boolean') safe[key] = value;
  }
  return Object.keys(safe).length ? safe : undefined;
}

function privateLogEntry(type, data, at = new Date().toISOString()) {
  const entry = { at, type: String(type || 'unknown').slice(0, 80) };
  const summary = summarizeLogData(entry.type, data);
  if (summary) entry.data = summary;
  return entry;
}

function scrubLogFile(file, maxLines = 5000) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }

  const cleaned = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const old = JSON.parse(line);
      cleaned.push(privateLogEntry(old.type, old.data, old.at));
    } catch {
      // A malformed diagnostic line has no durable value.
    }
  }

  const kept = cleaned.slice(-Math.max(1, maxLines));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, kept.length ? `${kept.map((x) => JSON.stringify(x)).join('\n')}\n` : '', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return kept.length;
}

module.exports = { summarizeLogData, privateLogEntry, scrubLogFile };
