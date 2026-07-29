// Unit tests for the pure parts of text-chat mode: SSE stream parsing, tool-call
// assembly, tool set, and instruction wrapping. No network, no Electron.
const { test } = require('node:test');
const assert = require('node:assert');

const chat = require('../src/chat');

// Build a fake fetch Response whose body streams the given SSE chunks, so we can
// exercise consumeStream exactly as the real chat/completions stream would drive it.
function sseResponse(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          read() {
            if (i < chunks.length) {
              return Promise.resolve({ value: encoder.encode(chunks[i++]), done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    },
  };
}

function frame(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

test('consumeStream assembles text deltas and fires onDelta in order', async () => {
  const res = sseResponse([
    frame({ choices: [{ delta: { content: 'hi' } }] }),
    frame({ choices: [{ delta: { content: ' there' } }] }),
    // deltas can arrive split across network reads mid-frame
    'data: {"choices":[{"delta":{"content":"!"}',
    '}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  const seen = [];
  const out = await chat.consumeStream(res, (d) => seen.push(d), () => {});
  assert.equal(out.text, 'hi there!');
  assert.deepEqual(seen, ['hi', ' there', '!']);
  assert.deepEqual(out.toolCalls, []);
});

test('consumeStream reassembles a tool call from indexed fragments', async () => {
  const res = sseResponse([
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'remem' } }] } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'ber' } }] } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"note":"likes ' } }] } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'otters"}' } }] } }] }),
    'data: [DONE]\n\n',
  ]);
  const out = await chat.consumeStream(res, () => {}, () => {});
  assert.equal(out.text, '');
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, 'remember');
  assert.equal(out.toolCalls[0].id, 'call_1');
  assert.deepEqual(out.toolCalls[0].args, { note: 'likes otters' });
});

test('consumeStream tolerates malformed tool args without throwing', async () => {
  const res = sseResponse([
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'emote', arguments: '{bad json' } }] } }] }),
    'data: [DONE]\n\n',
  ]);
  const out = await chat.consumeStream(res, () => {}, () => {});
  assert.equal(out.toolCalls[0].name, 'emote');
  assert.deepEqual(out.toolCalls[0].args, {}); // degraded to empty, not a crash
});

test('chat tool set includes local keepsakes/reminders but excludes live-body and keyboard actions', () => {
  const names = chat.CHAT_TOOLS.map((t) => t.function.name);
  for (const t of ['emote', 'recall', 'remember', 'remember_name', 'research_tonight', 'offer_dream_thought', 'look_at_screen', 'look_at_app', 'scrapbook_moment', 'leave_sticky_note', 'set_work_guard', 'clear_work_guard', 'switch_to_voice', 'end_chat']) {
    assert.ok(names.includes(t), `expected chat tool ${t}`);
  }
  for (const forbidden of ['think_hard', 'start_chase', 'start_mischief', 'build_artifact', 'learn_trick', 'record_game_result', 'computer_action']) {
    assert.ok(!names.includes(forbidden), `${forbidden} must not be a chat tool`);
  }
  // every tool must be in chat/completions shape
  for (const t of chat.CHAT_TOOLS) {
    assert.equal(t.type, 'function');
    assert.ok(t.function && t.function.name && t.function.parameters, 'well-formed function tool');
  }
});

test('chat instructions keep the character and append the text-mode override', () => {
  const spine = fakeSpine();
  const text = chat.buildChatInstructions({ spine, ambientLine: '', now: new Date('2026-07-25T14:00:00') });
  assert.match(text, /small pixel-art duck/); // the shared character core is present
  assert.match(text, /TEXT CHAT MODE/); // the override is appended
  assert.match(text, /switch_to_voice/); // it tells the duck how to get back to voice
  assert.match(text, /Sam's computer screen/);
  assert.ok(!text.includes('Tanmaye'));
  // the override must come AFTER the base so it wins
  assert.ok(text.indexOf('TEXT CHAT MODE') > text.indexOf('small pixel-art duck'));
});

test('dream prompt uses the locally stored person name', () => {
  const dream = require('../src/dream').buildDreamSystem('Sam');
  assert.match(dream, /Sam's computer screen/);
  assert.match(dream, /portrait of Sam/);
  assert.ok(!dream.includes('Tanmaye'));
});

// Minimal spine stub — just what buildInstructions touches.
function fakeSpine() {
  return {
    userName: () => 'Sam',
    duckName: () => 'Quackers',
    skin: () => 'classic',
    stage: () => 'companion',
    stageInfo: () => ({ stage: 'companion' }),
    sessionsCount: () => 12,
    capsule: () => 'MEMORY CAPSULE (test)',
    understanding: () => ({ who: 'a builder' }),
    lastTalkedDescription: () => '',
  };
}
