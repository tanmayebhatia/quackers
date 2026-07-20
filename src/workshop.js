// The Workshop — things the duck BUILDS on request and keeps forever: tap
// games, drawings, writing surfaces (code for the sandboxed stage board), and
// props (pixel specs worn on the body). See docs/workshop-design.md.
//
// Companion-led is enforced HERE, not in the prompt: a build request is
// refused unless check_workshop was called for that name recently — the duck
// physically cannot build something the conversation didn't ask about.

const fs = require('fs');
const path = require('path');
const { API_DOC } = require('./stage-api');

const BUILD_MODEL = 'gpt-5.5';
const CHECK_TTL_MS = 15 * 60 * 1000; // a check "counts" for this long
const KINDS = ['game', 'viz', 'writing', 'prop'];

let deps = null; // { dir, spine, loadApiKey, logEvent, sendToDuck, smokeTest }
let artifacts = []; // in-memory index of everything in userData/workshop/
let recentChecks = new Map(); // normalized name -> timestamp of check_workshop
let building = false;
let buildPromise = null;

function init(d) {
  deps = d;
  building = false;
  buildPromise = null;
  recentChecks = new Map();
  fs.mkdirSync(wdir(), { recursive: true });
  artifacts = [];
  for (const f of fs.readdirSync(wdir())) {
    if (!f.endsWith('.json')) continue;
    try {
      artifacts.push(JSON.parse(fs.readFileSync(path.join(wdir(), f), 'utf8')));
    } catch {
      /* a corrupt artifact file must never break startup */
    }
  }
  syncRefs();
}

function wdir() {
  return path.join(deps.dir, 'workshop');
}

function uid() {
  return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function norm(name) {
  return String(name || '').toLowerCase().trim();
}

function persist(a) {
  fs.writeFileSync(path.join(wdir(), `${a.id}.json`), JSON.stringify(a, null, 2));
}

function syncRefs() {
  deps.spine.setWorkshopRefs(listArtifacts());
}

function listArtifacts() {
  return artifacts.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    timesUsed: a.timesUsed,
    broken: a.status === 'broken',
  }));
}

// fuzzy, spoken-phrase-tolerant lookup — same contract as spine.findTrick
function findArtifact(name) {
  const q = norm(name);
  if (!q) return null;
  return (
    artifacts.find((a) => norm(a.name) === q) ||
    artifacts.find((a) => norm(a.name).includes(q) || q.includes(norm(a.name))) ||
    null
  );
}

// Re-building a name is a revision: same identity, version bumps, use count
// survives — continuity applies to built things exactly like memories.
function saveArtifact({ name, kind, description, code, spec, broken, lastError }) {
  const cleanName = String(name || '').slice(0, 60).trim();
  const existing = findArtifact(cleanName);
  const a = {
    id: existing ? existing.id : uid(),
    name: cleanName,
    kind: KINDS.includes(kind) ? kind : 'game',
    description: String(description || '').slice(0, 500),
    code: code != null ? String(code).slice(0, 20000) : undefined,
    spec: spec || undefined,
    version: existing ? (existing.version || 1) + 1 : 1,
    builtAt: new Date().toISOString(),
    timesUsed: existing ? existing.timesUsed : 0,
    status: broken ? 'broken' : 'ok',
    lastError: broken ? String(lastError || '').slice(0, 300) : null,
    lastState: existing ? existing.lastState : undefined,
  };
  if (existing) artifacts[artifacts.indexOf(existing)] = a;
  else artifacts.push(a);
  persist(a);
  syncRefs();
  return a;
}

function recordUse(id) {
  const a = artifacts.find((x) => x.id === id);
  if (!a) return;
  a.timesUsed++;
  persist(a);
  syncRefs();
}

function saveState(id, state) {
  const a = artifacts.find((x) => x.id === id);
  if (!a) return;
  try {
    if (JSON.stringify(state).length > 32768) return; // a board's memory stays small
  } catch {
    return;
  }
  a.lastState = state;
  persist(a);
}

// ---------------------------------------------------------------------------
// Consent gate — check_workshop is the only door to build_artifact
// ---------------------------------------------------------------------------

function checkWorkshop(name) {
  const cleanName = String(name || '').slice(0, 60).trim();
  recentChecks.set(norm(cleanName), Date.now());
  const a = findArtifact(cleanName);
  if (!a) {
    return {
      exists: false,
      name: cleanName,
      framed: `nothing called "${cleanName}" in your workshop yet. If he wants it, OFFER to build it for the two of you — and call build_artifact ONLY after he clearly says yes.`,
    };
  }
  recentChecks.set(norm(a.name), Date.now()); // a fuzzy hit authorizes the real name too
  const broken = a.status === 'broken';
  return {
    exists: true,
    id: a.id,
    name: a.name,
    kind: a.kind,
    timesUsed: a.timesUsed,
    broken,
    framed: broken
      ? `you HAVE "${a.name}" (${a.kind}) but it broke last time you built it — offer to rebuild it, and call build_artifact only after his clear yes.`
      : `you HAVE "${a.name}" (${a.kind}, ${a.timesUsed ? `used ${a.timesUsed}×` : 'never used yet'}). ${a.kind === 'prop' ? 'Call equip_prop to wear it if he wants.' : 'Call run_artifact to open it if he wants.'}`,
  };
}

function recentCheck(name) {
  const at = recentChecks.get(norm(name));
  return Boolean(at && Date.now() - at < CHECK_TTL_MS);
}

function pendingBuild() {
  return buildPromise;
}

// ---------------------------------------------------------------------------
// Running + props
// ---------------------------------------------------------------------------

function runArtifact(name) {
  const a = findArtifact(name);
  if (!a) return `nothing called "${name}" in your workshop — call check_workshop, then offer to build it.`;
  if (a.kind === 'prop') return `"${a.name}" is a prop you wear, not a board thing — call equip_prop instead.`;
  if (a.status === 'broken') return `"${a.name}" broke last time you built it — offer to rebuild it (build_artifact after his clear yes).`;
  recordUse(a.id);
  deps.sendToDuck('quackers:stage-open', { id: a.id, name: a.name, code: a.code, state: a.lastState || {} });
  deps.logEvent('workshop-run', { name: a.name, kind: a.kind, timesUsed: a.timesUsed });
  return a.kind === 'game'
    ? `The stage board is open with "${a.name}" — play together; he taps the board. The board records scores ITSELF: do NOT call record_game_result for stage games. React out loud to what happens.`
    : `The stage board is open with "${a.name}". Look at it together and talk about it.`;
}

function closeArtifact() {
  deps.sendToDuck('quackers:stage-close', {});
  return 'the board is put away.';
}

function equipProp(name) {
  const a = findArtifact(name);
  if (!a || a.kind !== 'prop') return `no prop called "${name}" in your workshop — check_workshop first.`;
  if (a.status === 'broken' || !a.spec) return `"${a.name}" didn't come out right — offer to rebuild it.`;
  const anchorOf = (id) => {
    const p = artifacts.find((x) => x.id === id);
    return p && p.spec ? p.spec.anchor : null;
  };
  // one prop per anchor: a new hat replaces the old hat, never stacks on it
  const kept = deps.spine.equippedProps().filter((id) => id !== a.id && anchorOf(id) !== a.spec.anchor);
  deps.spine.setEquippedProps([...kept, a.id]);
  recordUse(a.id);
  deps.sendToDuck('quackers:props', { layers: equippedPropLayers() });
  return `you're wearing the ${a.name} now. Feel appropriately fabulous.`;
}

function unequipProp(name) {
  const a = findArtifact(name);
  const ids = deps.spine.equippedProps();
  const next = a ? ids.filter((id) => id !== a.id) : [];
  if (next.length === ids.length && a) return `you weren't wearing the ${a.name}.`;
  deps.spine.setEquippedProps(next);
  deps.sendToDuck('quackers:props', { layers: equippedPropLayers() });
  return a ? `took the ${a.name} off.` : 'took everything off — back to the classic look.';
}

function equippedPropLayers() {
  return deps.spine
    .equippedProps()
    .map((id) => artifacts.find((x) => x.id === id))
    .filter((a) => a && a.spec)
    .map((a) => ({ shift: a.spec.anchor === 'head', px: a.spec.px }));
}

// ---------------------------------------------------------------------------
// Validation — the cheap, deterministic gates generated output must pass
// before it is ever handed to the sandbox
// ---------------------------------------------------------------------------

// Defense in depth: the sandbox+CSP already block these, but code that even
// MENTIONS an escape hatch is wrong code — reject and let the repair round fix it.
const BANNED =
  /\b(fetch|XMLHttpRequest|WebSocket|EventSource|eval|require|localStorage|sessionStorage|indexedDB|postMessage|Worker|SharedWorker)\b|\bimport\s*[(\s]|\bnew\s+Function\b|window\s*\.\s*(parent|top|opener|location)|document\s*\.\s*(cookie|write)|<\/script/i;

function validateCode(code) {
  const src = String(code || '');
  if (!src.trim()) return { ok: false, error: 'empty program' };
  const hit = src.match(BANNED);
  if (hit) return { ok: false, error: `forbidden reference: ${hit[0]}` };
  try {
    new Function(src); // parse-only: compiles, never runs
  } catch (err) {
    return { ok: false, error: `syntax error: ${err.message}` };
  }
  return { ok: true, error: null };
}

function validatePropSpec(spec) {
  if (!spec || !['head', 'back', 'feet'].includes(spec.anchor)) {
    return { ok: false, error: 'anchor must be head|back|feet' };
  }
  const px = Array.isArray(spec.px) ? spec.px : [];
  if (!px.length || px.length > 80) return { ok: false, error: 'px must have 1-80 pixels' };
  for (const p of px) {
    if (!Array.isArray(p) || p.length !== 3) return { ok: false, error: 'each px entry is [col,row,"#rrggbb"]' };
    const [c, r, color] = p;
    if (!Number.isInteger(c) || c < -2 || c > 15) return { ok: false, error: `col ${c} out of range -2..15` };
    if (!Number.isInteger(r) || r < -6 || r > 14) return { ok: false, error: `row ${r} out of range -6..14` };
    if (!/^#[0-9a-f]{6}$/i.test(String(color))) return { ok: false, error: 'colors must be #rrggbb hex' };
  }
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// Building — gpt-5.5 writes the artifact; validation + a smoke test gate it;
// one silent repair round; then either a ta-da or a charming failure. The
// whole build is theater on screen (pet.js 'building' state) narrated through
// WORKSHOP EVENT messages, exactly like tricks.
// ---------------------------------------------------------------------------

const CODE_SYSTEM = `${API_DOC}

Respond with JSON only: {"code": "<the complete program as one string>"}`;

const PROP_SYSTEM = `You design a tiny pixel-art PROP for a 14-wide x 13-tall pixel duck (columns 0-13 left to right, rows 0-12 top to bottom). The duck's head is rows 0-5 (eyes at rows 4-5, columns 3-4 and 9-10), beak rows 6-7 columns 5-8, body rows 8-12, feet at row 13. Rows ABOVE the head are negative (a hat lives around rows -6..-1). Columns may extend slightly outside (-2..15) for brims and boards.

Anchors: "head" (hats, glasses, masks — moves with the face), "back" (capes, backpacks), "feet" (shoes, skateboards — around rows 12-14).

Style: chunky readable pixel art, 10-60 pixels, saturated crayon-adjacent colors. It must read at tiny size.

Respond with JSON only: {"anchor":"head|back|feet","px":[[col,row,"#rrggbb"],...]}`;

async function generate({ apiKey, name, kind, description, existingCode, lastError }) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: BUILD_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: kind === 'prop' ? PROP_SYSTEM : CODE_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              name,
              kind,
              description,
              existing_code_to_revise: existingCode || undefined,
              your_previous_attempt_failed_with: lastError || undefined,
            }),
          },
        ],
      }),
    });
    if (!res.ok) return { error: `model ${res.status}` };
    const out = JSON.parse((await res.json()).choices[0].message.content);
    return kind === 'prop' ? { spec: { anchor: out.anchor, px: out.px } } : { code: String(out.code || '') };
  } catch (err) {
    return { error: err.message };
  }
}

function tell(text) {
  deps.sendToDuck('quackers:workshop-event', { text });
}

// One full attempt-repair-attempt cycle. Exported so workshop-lab can measure
// one-shot success rates without the conversation choreography around it.
async function buildOnce({ name, kind, description, existing }) {
  const apiKey = deps.loadApiKey();
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) tell(`WORKSHOP EVENT: first try wobbled (${String(lastError).slice(0, 80)}) — you're fixing it, one more go. One short line, keep the energy up.`);
    const gen = await generate({ apiKey, name, kind, description, existingCode: existing && existing.code, lastError });
    if (gen.error) {
      lastError = gen.error;
      continue;
    }
    if (kind === 'prop') {
      const v = validatePropSpec(gen.spec);
      if (!v.ok) {
        lastError = v.error;
        continue;
      }
      return { ok: true, artifact: saveArtifact({ name, kind, description, spec: gen.spec }) };
    }
    const v = validateCode(gen.code);
    if (!v.ok) {
      lastError = v.error;
      continue;
    }
    const smoke = await deps.smokeTest(gen.code);
    if (!smoke.ok) {
      lastError = smoke.error || 'failed on the test bench';
      continue;
    }
    return { ok: true, artifact: saveArtifact({ name, kind, description, code: gen.code }) };
  }
  saveArtifact({ name, kind, description, broken: true, lastError });
  return { ok: false, error: lastError };
}

function requestBuild({ name, kind, description } = {}) {
  const cleanName = String(name || '').slice(0, 60).trim();
  const k = KINDS.includes(kind) ? kind : 'game';
  if (!cleanName) return 'the thing needs a name — ask him what to call it.';
  if (!recentCheck(cleanName)) {
    return `you haven't checked your workshop for "${cleanName}" yet — call check_workshop first, and only build after he clearly says yes.`;
  }
  if (building) return 'you are already mid-build — one project at a time.';
  if (!deps.loadApiKey()) return "your workshop needs your voice hooked up first (no API key) — mention the little duck in the menu bar, lightly.";

  building = true;
  const existing = findArtifact(cleanName);
  deps.sendToDuck('quackers:workshop', { phase: 'building', kind: k, name: cleanName });
  deps.logEvent('workshop-build-start', { name: cleanName, kind: k, revision: Boolean(existing) });

  buildPromise = buildOnce({ name: cleanName, kind: k, description: String(description || '').slice(0, 500), existing })
    .then((result) => {
      if (result.ok) {
        deps.sendToDuck('quackers:workshop', { phase: 'done', kind: k, name: cleanName });
        if (k === 'prop') {
          tell(`WORKSHOP EVENT: build finished — the ${cleanName} is ready! Show it off in one breath and offer to put it on (equip_prop only if he says yes).`);
        } else {
          runArtifact(cleanName); // ta-da: the reveal IS the board appearing
          tell(`WORKSHOP EVENT: build finished — "${cleanName}" is ready and OPEN on the stage next to you. Ta-da! ${k === 'game' ? 'Explain how to play in one breath and start — the board records scores itself, never call record_game_result for it.' : 'Show it off in one breath.'}`);
        }
        deps.logEvent('workshop-build-done', { name: cleanName, kind: k });
      } else {
        deps.sendToDuck('quackers:workshop', { phase: 'fail', kind: k, name: cleanName });
        tell(`WORKSHOP EVENT: the build failed twice (${String(result.error).slice(0, 80)}). Fail charmingly — the roof fell off, you'll have another go after you sleep — and move on. Never blame him.`);
        deps.logEvent('workshop-build-failed', { name: cleanName, kind: k, error: result.error });
      }
      return result;
    })
    .finally(() => {
      building = false;
    });

  return `You're building "${cleanName}" now — your body is at the workbench and it'll take you a minute. WORKSHOP EVENT messages will tell you how it's going; narrate them in single short lines. Keep chatting lightly meanwhile.`;
}

module.exports = {
  init,
  BUILD_MODEL,
  checkWorkshop,
  requestBuild,
  pendingBuild,
  buildOnce,
  runArtifact,
  closeArtifact,
  saveState,
  recordUse,
  saveArtifact,
  findArtifact,
  listArtifacts,
  equipProp,
  unequipProp,
  equippedPropLayers,
  validateCode,
  validatePropSpec,
};
