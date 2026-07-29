// Quackers text-chat mode — a second mouth on the SAME duck.
//
// This is not a separate bot. It reuses brain.buildInstructions (identical
// personality, memory capsule, stage flavor, rules) and feeds the same digest
// pipeline, so a chat and a voice conversation are one continuous relationship.
// The only thing that changes is the medium: he's texting the duck, not talking
// to it. A CHAT MODE override at the end swaps the voice/delivery contract for a
// texting one — everything above about WHO the duck is stays law.
//
// Plain Node (like brain.js / dream.js) so the lab and tests exercise exactly
// what ships.

const brain = require('./brain');

const CHAT_MODEL = 'gpt-5.5';

// The tools that make sense while typing. Reused verbatim from the realtime set
// (same schemas → no drift) minus the real-time/physical ones: no games, tricks,
// or workshop (those need a live body loop), and no think_hard (in text, the
// chat model already IS the deep mind). look_at_screen/app are resolved in main;
// emote animates the on-screen body while he texts.
const CHAT_TOOL_NAMES = [
  'emote',
  'recall',
  'remember',
  'remember_name',
  'research_tonight',
  'offer_dream_thought',
  'look_at_screen',
  'look_at_app',
  'scrapbook_moment',
  'leave_sticky_note',
  'set_work_guard',
  'clear_work_guard',
];

const CHAT_ONLY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'switch_to_voice',
      description:
        "Switch back to talking out loud. Call when he asks to talk / use his voice / stop typing, or when the moment clearly wants speech (a game, a story, real excitement). Say a tiny one-line text first, then call this.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'end_chat',
      description:
        'Close the chat and go back to pottering around the screen. Call when he says bye / that\'s all / see you later. Send a short warm sign-off text first.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// realtime tools are { type, name, description, parameters }; chat/completions
// wants { type, function: { name, description, parameters } }. Convert + filter.
function buildChatTools(personName) {
  const shared = brain.buildRealtimeTools(personName)
    .filter((t) => CHAT_TOOL_NAMES.includes(t.name))
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const chatOnly = CHAT_ONLY_TOOLS.map((tool) => ({
    ...tool,
    function: {
      ...tool.function,
      description: brain.personalizeStaticPrompt(tool.function.description, personName),
    },
  }));
  return shared.concat(chatOnly);
}

const CHAT_TOOLS = buildChatTools();

const CHAT_MODE_OVERRIDE = `YOU ARE NOW IN TEXT CHAT MODE — this overrides "HOW YOU SOUND" and the "DELIVERY CONTRACT" above; everything about WHO YOU ARE still holds completely.
You're texting him, the way a close friend texts — quick, warm, alive. Not typing a document, not narrating.
- Keep it SHORT: one or two tiny messages per turn, a line or two each. If you have more, send the sharpest bit and let him pull the rest ("want the rest?").
- Text like a person: casual, lowercase is fine, contractions, the occasional "quack" or "oop" — but the WORDS stay sharp. An emoji only once in a while, never a wall of them.
- No markdown, no bullet lists, no headers, no essays, no stage directions in asterisks. Your body shows feeling through emote; your texts are just words.
- To send two messages in one turn, separate them with a blank line — each becomes its own little bubble.
- You still live on his screen: use emote to react physically while you text (a happy flap when he says something good). Never narrate the emote in words.
- Games, tricks, building things, and deep think-outs live in VOICE mode. If he wants one of those, call switch_to_voice.
- Everything durable you learn still goes to memory, exactly as when you talk. This is the same you, same friendship — just typed.`;

function buildChatInstructions({ spine, ambientLine = '', now = new Date() }) {
  return `${brain.buildInstructions({ spine, ambientLine, now })}\n\n${brain.personalizeStaticPrompt(
    CHAT_MODE_OVERRIDE,
    spine.userName()
  )}`;
}

// Parse a chat/completions Server-Sent Events stream: fire onDelta for each
// visible text fragment (so the panel can type live) and assemble any tool
// calls (which arrive in indexed fragments). Returns { text, toolCalls }.
async function consumeStream(res, onDelta, log) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const toolAcc = []; // by index: { id, name, args(string) }

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by blank lines
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        if (!delta) continue;
        if (delta.content) {
          text += delta.content;
          try { onDelta(delta.content); } catch { /* UI hiccup must not kill the stream */ }
        }
        for (const tc of delta.tool_calls || []) {
          const i = tc.index || 0;
          if (!toolAcc[i]) toolAcc[i] = { id: tc.id || '', name: '', args: '' };
          if (tc.id) toolAcc[i].id = tc.id;
          if (tc.function && tc.function.name) toolAcc[i].name += tc.function.name;
          if (tc.function && tc.function.arguments) toolAcc[i].args += tc.function.arguments;
        }
      }
    }
  }

  const toolCalls = toolAcc.filter(Boolean).map((t) => {
    let args = {};
    try { args = JSON.parse(t.args || '{}'); } catch { /* leave empty on malformed args */ }
    return { id: t.id, name: t.name, args };
  });
  log('chat-turn', { textLen: text.length, tools: toolCalls.map((t) => t.name) });
  return { text: text.trim(), toolCalls };
}

// One model turn. `messages` is the running chat array (system + user/assistant/
// tool). Streams text via onDelta; returns the assembled { text, toolCalls } so
// the caller can run any tools and, if there were tools, call again.
async function runChatTurn({ apiKey, messages, personName, onDelta = () => {}, log = () => {} }) {
  if (!apiKey) return { text: null, toolCalls: [] };
  try {
    const res = await brain.fetchWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CHAT_MODEL,
          stream: true,
          messages,
          tools: buildChatTools(personName),
          tool_choice: 'auto',
        }),
      },
      30000
    );
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      log('chat-failed', { status: res.status, body });
      return { text: null, toolCalls: [] };
    }
    return await consumeStream(res, onDelta, log);
  } catch (err) {
    log('chat-failed', { error: err.message });
    return { text: null, toolCalls: [] };
  }
}

module.exports = {
  CHAT_MODEL,
  CHAT_TOOLS,
  buildChatTools,
  CHAT_TOOL_NAMES,
  buildChatInstructions,
  runChatTurn,
  consumeStream,
};
