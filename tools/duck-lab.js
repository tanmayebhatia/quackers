#!/usr/bin/env node
// Duck Lab — talk to the duck's actual brain without the app.
//
// Drives the EXACT code the app ships: src/brain.js instructions + tools,
// src/spine.js memory, src/dream.js consolidation, real OpenAI calls. Only
// the transport differs: text chat instead of realtime audio, and the body
// is simulated as printed actions. Runs against a sandboxed spine in .lab/
// so the real duck's memory is never touched.
//
// Usage:
//   node tools/duck-lab.js chat "hey quackers"     # talk (session persists)
//   node tools/duck-lab.js event "GAME EVENT: ..." # inject a system event
//   node tools/duck-lab.js screen "desc of screen" # what look_at_screen sees
//   node tools/duck-lab.js end                     # end conversation → digest
//   node tools/duck-lab.js dream                   # force a dream cycle
//   node tools/duck-lab.js capsule                 # print the live capsule
//   node tools/duck-lab.js spine                   # dump memory (no vectors)
//   node tools/duck-lab.js seed <file.json>        # seed facts/bits/loops
//   node tools/duck-lab.js hatch                   # egg → duckling
//   node tools/duck-lab.js reset                   # wipe the lab spine
//   node tools/duck-lab.js scenario <file.json>    # scripted multi-turn run

const fs = require('fs');
const path = require('path');

const spine = require('../src/spine');
const brain = require('../src/brain');
const dreamer = require('../src/dream');
const workshop = require('../src/workshop');
const { vmSmokeTest } = require('./vm-smoke');

const REPO = path.join(__dirname, '..');
const LAB = process.env.DUCK_LAB_DIR || path.join(REPO, '.lab');
const SESSION_FILE = path.join(LAB, 'session.json');
const MOUTH_MODEL = process.env.LAB_MOUTH_MODEL || 'gpt-5-mini';

fs.mkdirSync(LAB, { recursive: true });
spine.init(LAB);

function log(type, data) {
  fs.appendFileSync(path.join(LAB, 'lab-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), type, data }) + '\n');
}

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  try {
    const txt = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
    const m = txt.match(/^\s*OPENAI_API_KEY\s*=\s*(.+)\s*$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    return null;
  }
}
const API_KEY = loadApiKey();
if (!API_KEY) {
  console.error('no OPENAI_API_KEY (env or repo .env)');
  process.exit(1);
}

// The REAL workshop, against the lab spine — builds run gpt-5.5 for real and
// smoke-test in a vm instead of the app's iframe bench.
const workshopEvents = []; // WORKSHOP EVENT texts queued for injection
workshop.init({
  dir: LAB,
  spine,
  loadApiKey: () => API_KEY,
  logEvent: log,
  sendToDuck: (channel, payload) => {
    if (channel === 'quackers:workshop-event') workshopEvents.push(payload.text);
    else console.log(`      [body] ${channel.replace('quackers:', '')}${payload && payload.phase ? ` (${payload.phase})` : ''}`);
  },
  smokeTest: async (code) => vmSmokeTest(code),
});

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

function loadSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveSession(s) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2));
}

function newSession() {
  spine.touchConversation(); // mirrors realtime-connect
  const instructions = brain.buildInstructions({ spine, ambientLine: '' });
  return {
    startedAt: new Date().toISOString(),
    messages: [{ role: 'system', content: instructions }],
    transcript: [],
    pendingScreen: null,
    ended: false,
  };
}

// chat-completions tool format
const CHAT_TOOLS = brain.REALTIME_TOOLS.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

// ---------------------------------------------------------------------------
// Tool execution — mirrors voice.js execTool, body simulated
// ---------------------------------------------------------------------------

async function execTool(session, name, args) {
  const body = (s) => console.log(`      [body] ${s}`);
  switch (name) {
    case 'emote':
      body(`emotes: ${args.emotion}`);
      session._emotes = (session._emotes || 0) + 1;
      return session._emotes > 2
        ? 'your body is tired of emoting — no more emotes this turn, use your WORDS now'
        : 'ok';
    case 'follow_cursor':
      body(args.follow ? 'starts following the cursor' : 'stops following');
      return args.follow ? 'now following the cursor' : 'stopped following';
    case 'start_chase': {
      body('CHASE! duck flees the cursor');
      const outcome =
        session.chaseOutcome ||
        (Math.random() < 0.5 ? 'he caught you after 21 seconds' : 'you escaped — he never caught you');
      session._inject.push({ role: 'system', content: `GAME EVENT: Chase game ended: ${outcome}.` });
      return 'Chase started — you are now running from his cursor. You will get a GAME EVENT message when it ends; react to it out loud.';
    }
    case 'start_mischief':
      body('goes FERAL — footprints and doodles everywhere for a minute');
      return 'You are now rampaging around his screen for a minute — footprints, doodles, crimes. Narrate gleefully while you do it.';
    case 'record_game_result': {
      const tally = spine.recordGameResult(String(args.game || ''), String(args.winner || ''));
      return tally
        ? `Recorded. All-time ${args.game}: you ${tally.duck} — him ${tally.user}. React accordingly.`
        : 'could not record that (unknown winner?)';
    }
    case 'remember_name': {
      const isFirst = !spine.userName();
      spine.setUserName(String(args.name || ''));
      if (isFirst && spine.userName()) spine.addFact(`His name is ${spine.userName()}`, 'person', 10);
      return 'imprinted. that is his name now.';
    }
    case 'remember':
      spine.addFact(String(args.note || ''), 'told-directly', 8);
      return 'saved to memory';
    case 'recall': {
      // same pipeline and same model-facing words as the shipped app
      const res = await brain.runRecall({ spine, apiKey: API_KEY, query: args.query, log });
      return res.output;
    }
    case 'think_hard': {
      const res = await brain.runThinkHard({
        spine,
        apiKey: API_KEY,
        question: String(args.question || ''),
        recent: String(args.recent || ''),
        log,
      });
      return brain.frameThinkHard(res.answer);
    }
    case 'look_at_screen':
    case 'look_at_app': {
      body(`waddles out and PEERS at the screen${name === 'look_at_app' ? ` (${args.app_name})` : ''}`);
      if (session.pendingScreen) {
        const desc = session.pendingScreen;
        session.pendingScreen = null; // each look sees fresh pixels, like the app
        session._inject.push({
          role: 'user',
          content: `[SCREEN SNAPSHOT — this is what you can see: ${desc}]`,
        });
        return "Snapshot attached (next message). Actually look and react to the substance of what's on screen — specific things you notice — not vague impressions.";
      }
      return "Tell him, in character, that you can't see the screen yet — your eyes aren't hooked up. Don't mention settings or permissions. Keep it light and move on.";
    }
    case 'check_workshop':
      return workshop.checkWorkshop(String(args.name || '')).framed;
    case 'build_artifact': {
      body(`heads to the workbench: "${args.name}" (${args.kind})`);
      const out = workshop.requestBuild({ name: args.name, kind: args.kind, description: args.description });
      const p = workshop.pendingBuild();
      if (p) await p; // lab is synchronous: let the build land, then inject its events
      while (workshopEvents.length) session._inject.push({ role: 'system', content: workshopEvents.shift() });
      return out;
    }
    case 'run_artifact':
      body('opens the stage board');
      return workshop.runArtifact(String(args.name || ''));
    case 'close_artifact':
      return workshop.closeArtifact();
    case 'equip_prop':
      body(`puts on the ${args.name}`);
      return workshop.equipProp(String(args.name || ''));
    case 'unequip_prop':
      return workshop.unequipProp(String(args.name || ''));
    case 'end_conversation':
      session.ended = true;
      return 'ok — say your goodbye now';
    default:
      return `unknown tool ${name}`;
  }
}

// ---------------------------------------------------------------------------
// One user turn → duck reply (with tool loop)
// ---------------------------------------------------------------------------

async function completion(messages, { withTools = true } = {}) {
  const body = {
    model: MOUTH_MODEL,
    messages,
    // the mouth is charm, not chain-of-thought — mirror the realtime setup
    reasoning_effort: 'low',
    max_completion_tokens: 2000,
  };
  if (withTools) {
    body.tools = CHAT_TOOLS;
    body.tool_choice = 'auto';
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`mouth model ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).choices[0].message;
}

async function duckTurn(session, userText, { screen } = {}) {
  if (screen !== undefined) session.pendingScreen = screen;
  if (userText != null) {
    session.messages.push({ role: 'user', content: userText });
    session.transcript.push({ role: 'user', text: userText });
    console.log(`\n  YOU: ${userText}`);
  }

  let spokeThisTurn = false;
  session._emotes = 0;
  for (let hop = 0; hop < 6; hop++) {
    const msg = await completion(session.messages);
    session.messages.push(msg);

    if (msg.content && msg.content.trim()) {
      spokeThisTurn = true;
      session.transcript.push({ role: 'duck', text: msg.content.trim() });
      console.log(`  🦆 : ${msg.content.trim()}`);
    }
    if (!msg.tool_calls || !msg.tool_calls.length) break;

    // tool responses must directly follow the tool_calls message; anything a
    // tool wants to inject (snapshots, game events) queues up and lands after
    session._inject = [];
    for (const tc of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* noop */ }
      console.log(`      [tool] ${tc.function.name}(${JSON.stringify(args).slice(0, 120)})`);
      const output = await execTool(session, tc.function.name, args);
      log('tool-call', { name: tc.function.name, args, output: String(output).slice(0, 200) });
      session.messages.push({ role: 'tool', tool_call_id: tc.id, content: String(output) });
    }
    session.messages.push(...session._inject);
    session._inject = [];
  }

  // a duck that only emoted is a broken duck — force it to actually speak
  if (!spokeThisTurn) {
    const msg = await completion(
      [...session.messages, { role: 'system', content: 'Say your reply out loud now — words only, no tools.' }],
      { withTools: false }
    );
    const text = (msg.content || '').trim();
    if (text && !text.startsWith('{')) {
      // (a '{' reply is the model leaking tool-args as speech — drop it)
      session.messages.push({ role: 'assistant', content: text });
      session.transcript.push({ role: 'duck', text });
      console.log(`  🦆 : ${text}  (forced-speech fallback)`);
    }
  }
  saveSession(session);
}

async function endConversation() {
  const session = loadSession();
  if (!session || session.transcript.length < 2) {
    console.log('(no conversation to digest)');
    fs.rmSync(SESSION_FILE, { force: true });
    return;
  }
  console.log('\n— conversation over. digesting… —');
  const digest = await brain.runDigest({ spine, apiKey: API_KEY, lines: session.transcript, log });
  console.log(JSON.stringify(digest, null, 2));
  await brain.backfillEmbeddings({ spine, apiKey: API_KEY, log });
  fs.rmSync(SESSION_FILE, { force: true });
}

async function runDreamNow() {
  console.log('\n— dreaming… —');
  const ok = await dreamer.dream({ spine, apiKey: API_KEY, model: brain.DREAM_MODEL, logEvent: log });
  if (!ok) {
    console.log('(dream failed — see lab-log.jsonl)');
    return;
  }
  const all = spine.getAll();
  console.log('understanding.who:', all.understanding && all.understanding.who);
  console.log('understanding.us:', all.understanding && all.understanding.us);
  console.log('duck traits:', all.duck_self.map((t) => t.trait));
  console.log('diary:', all.diary.slice(-1).map((d) => d.note));
  console.log('open loops:', all.open_loops.map((l) => `${l.description} [${l.status}${l.dueAt ? ` due ${l.dueAt}` : ''}]`));
}

function seed(data) {
  if (data.hatch) spine.hatch();
  if (data.userName) spine.setUserName(data.userName);
  for (const f of data.facts || []) spine.addFact(f.statement || f, f.category || 'general', f.importance || 6);
  if (data.bits || data.loops || data.user_state) {
    spine.applyDigest({
      relationship_bits: data.bits || [],
      new_open_loops: (data.loops || []).map((l) => ({ description: l.description || l, due_hint: l.due_hint || '' })),
      user_state: data.user_state || '',
    });
  }
  for (const h of data.happenings || []) spine.addHappening(h.type, h.detail || '');
  for (const s of data.sessions ? Array(data.sessions) : []) spine.touchConversation();
  if (data.understanding || data.duck_traits || data.diary_note) {
    spine.applyDream({
      understanding: data.understanding,
      duck_traits: data.duck_traits,
      diary_note: data.diary_note || '',
    });
  }
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

async function runScenario(file) {
  const sc = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`\n=== SCENARIO: ${sc.name} ===`);
  if (sc.fresh !== false) {
    fs.rmSync(path.join(LAB, 'spine.json'), { force: true });
    fs.rmSync(SESSION_FILE, { force: true });
    spine.init(LAB);
  }
  if (sc.seed) {
    seed(sc.seed);
    await brain.backfillEmbeddings({ spine, apiKey: API_KEY, log });
    console.log('(seeded)');
  }

  let session = null;
  for (const step of sc.steps) {
    if (step.user != null) {
      if (!session) {
        session = newSession();
        saveSession(session);
        console.log('\n--- new conversation ---');
      }
      if (step.chaseOutcome) session.chaseOutcome = step.chaseOutcome;
      await duckTurn(session, step.user, { screen: step.screen });
    } else if (step.event) {
      if (session) {
        session.messages.push({ role: 'system', content: step.event });
        await duckTurn(session, null);
      }
    } else if (step.end) {
      saveSession(session);
      await endConversation();
      session = null;
    } else if (step.dream) {
      await runDreamNow();
    } else if (step.print === 'capsule') {
      console.log('\n--- CAPSULE ---\n' + spine.capsule());
    }
  }
  if (session) {
    saveSession(session);
    await endConversation();
  }
  console.log('\n--- FINAL CAPSULE ---\n' + spine.capsule());
  console.log(`\n=== END: ${sc.name} ===`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'chat': {
      let session = loadSession();
      if (!session || session.ended) {
        session = newSession();
        console.log('--- new conversation ---');
      }
      await duckTurn(session, arg || 'hey');
      if (session.ended) await endConversation();
      break;
    }
    case 'event': {
      const session = loadSession();
      if (!session) return console.log('(no open conversation)');
      session.messages.push({ role: 'system', content: arg });
      await duckTurn(session, null);
      break;
    }
    case 'screen': {
      const session = loadSession() || newSession();
      session.pendingScreen = arg || null;
      saveSession(session);
      console.log(`(next look_at_screen will see: ${arg ? arg.slice(0, 80) : 'nothing'})`);
      break;
    }
    case 'end':
      await endConversation();
      break;
    case 'dream':
      await runDreamNow();
      break;
    case 'capsule':
      console.log(brain.buildInstructions({ spine, ambientLine: '' }));
      break;
    case 'spine':
      console.log(JSON.stringify(spine.getAll(), null, 2));
      break;
    case 'seed':
      seed(JSON.parse(fs.readFileSync(arg, 'utf8')));
      await brain.backfillEmbeddings({ spine, apiKey: API_KEY, log });
      console.log('seeded.');
      break;
    case 'hatch':
      spine.hatch();
      console.log(spine.stageInfo());
      break;
    case 'reset':
      fs.rmSync(LAB, { recursive: true, force: true });
      console.log('lab wiped.');
      break;
    case 'scenario':
      await runScenario(arg);
      break;
    default:
      console.log('commands: chat|event|screen|end|dream|capsule|spine|seed|hatch|reset|scenario');
  }
})().catch((err) => {
  console.error('lab error:', err.message);
  process.exit(1);
});
