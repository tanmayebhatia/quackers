const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const privacy = require('../src/privacy');

test('conversation diagnostics retain counts, never transcript content', () => {
  const entry = privacy.privateLogEntry('conversation-transcript', {
    mode: 'chat',
    lines: [
      { role: 'user', text: 'private launch plan' },
      { role: 'duck', text: 'private response' },
    ],
  });
  assert.deepEqual(entry.data, { mode: 'chat', turns: 2, chars: 35 });
  assert.ok(!JSON.stringify(entry).includes('launch plan'));
});

test('diagnostics use a strict metadata allowlist', () => {
  const entry = privacy.privateLogEntry('think-hard', {
    status: 200,
    question: 'sensitive question',
    answer: 'sensitive answer',
    body: 'provider response',
  });
  assert.deepEqual(entry.data, { status: 200 });
});

test('startup scrubbing removes sensitive historical payloads and malformed lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackers-privacy-'));
  const file = path.join(dir, 'interactions.jsonl');
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      at: '2026-01-01T00:00:00.000Z',
      type: 'conversation-transcript',
      data: { lines: [{ role: 'user', text: 'do not keep me' }] },
    })}\nnot-json\n`
  );

  assert.equal(privacy.scrubLogFile(file), 1);
  const saved = fs.readFileSync(file, 'utf8');
  assert.ok(!saved.includes('do not keep me'));
  assert.ok(!saved.includes('not-json'));
  assert.match(saved, /"turns":1/);
});
