// The memory spine — Quackers' structured, local memory.
// JSON-backed (single user, small data); the schema is the design-doc one so
// a SQLite swap later is mechanical. All access happens in the main process.
//
// Layers (who writes what):
//   digester (post-conversation)  → facts, episodes, open_loops, bits, user_state
//   dream loop (idle, nightly-ish) → understanding prose, diary, loop closing,
//                                    fact merging/decay, duck_self traits
//   live tools                     → remember(), recall touch, game scores
//   the body                       → happenings (pets, crumbs, tosses, games)

const fs = require('fs');
const path = require('path');

let userDataDir = null;
let cache = null;
let vecs = {}; // id → embedding vector, stored in a sidecar file so spine.json stays human-readable and small

const EMPTY = {
  facts: [],
  episodes: [],
  open_loops: [],
  relationship: [],
  duck_self: [],
  diary: [],
  happenings: [],
  game_scores: {},
  tricks: [],
  workshop: [],
  user_state: null,
  understanding: null,
  meta: {},
};

function init(dir) {
  userDataDir = dir;
  load();
  migrateLegacyNotes();
  if (!cache.meta.firstRunAt) {
    cache.meta.firstRunAt = new Date().toISOString();
    // pre-hatching-arc installs have already met the duck — never re-egg a
    // spine that has lived (breaking continuity is the one unforgivable sin)
    const lived =
      cache.facts.length > 0 || cache.episodes.length > 0 || Boolean(cache.meta.lastConversationAt);
    cache.meta.stage = lived ? 'duckling' : 'egg';
    save();
  }
  if (!cache.meta.stage) {
    cache.meta.stage = 'duckling';
    save();
  }
  // pre-onboarding installs (and anyone already hatched) keep their duck as-is
  // and must never be shown the pick-your-quacker screen
  if (!cache.meta.onboarded && cache.meta.stage !== 'egg') {
    cache.meta.onboarded = true;
    cache.meta.skin = cache.meta.skin || 'classic';
    cache.meta.duckName = cache.meta.duckName || 'Quackers';
    save();
  }
}

function spinePath() {
  return path.join(userDataDir, 'spine.json');
}

function vecsPath() {
  return path.join(userDataDir, 'embeddings.json');
}

function load() {
  cache = readSpineOrBackup();
  try {
    vecs = JSON.parse(fs.readFileSync(vecsPath(), 'utf8'));
  } catch {
    vecs = {};
  }
  // migrate legacy inline embeddings into the sidecar
  let migrated = false;
  for (const list of [cache.facts, cache.episodes, cache.relationship, cache.open_loops]) {
    for (const item of list) {
      if (item.embedding) {
        vecs[item.id] = item.embedding;
        delete item.embedding;
        migrated = true;
      }
    }
  }
  if (migrated) {
    save();
    saveVecs();
  }
  return cache;
}

// Reading a truncated spine.json and silently resetting to EMPTY is the one
// unforgivable failure — an empty spine re-eggs a duck that has lived. So a
// PARSE failure on a non-empty file is treated as corruption: fall back to the
// last-known-good .bak before ever accepting an empty memory. A missing file is
// a genuine fresh install and correctly yields EMPTY.
function readSpineOrBackup() {
  const merge = (txt) => ({ ...JSON.parse(JSON.stringify(EMPTY)), ...JSON.parse(txt) });
  try {
    return merge(fs.readFileSync(spinePath(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return JSON.parse(JSON.stringify(EMPTY)); // fresh install
    // the file exists but won't parse — corruption. Try the backup.
    try {
      const recovered = merge(fs.readFileSync(spinePath() + '.bak', 'utf8'));
      // eslint-disable-next-line no-console
      console.error('spine.json unreadable — recovered from .bak');
      return recovered;
    } catch {
      // eslint-disable-next-line no-console
      console.error('spine.json unreadable and no usable .bak — starting empty');
      return JSON.parse(JSON.stringify(EMPTY));
    }
  }
}

// Atomic save: write a temp file, fsync, then rename over the target (rename is
// atomic on the same filesystem), keeping the prior good copy as .bak. A crash,
// power loss, or a racing second instance can never leave a half-written
// spine.json — the reader sees either the old file or the fully new one.
function save() {
  const target = spinePath();
  const tmp = target + '.tmp';
  const data = JSON.stringify(cache, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak');
  } catch {
    /* a missing/locked .bak must never block the real save */
  }
  fs.renameSync(tmp, target);
}

function saveVecs() {
  fs.writeFileSync(vecsPath(), JSON.stringify(vecs));
}

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// one-time: pull notes from the old flat memory.json into facts
function migrateLegacyNotes() {
  if (cache.facts.length > 0) return;
  try {
    const legacy = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'memory.json'), 'utf8')
    ).notes;
    for (const n of legacy || []) {
      cache.facts.push({
        id: uid('f'),
        statement: n.text,
        category: 'general',
        importance: 6,
        createdAt: n.at || new Date().toISOString(),
        invalidAt: null,
        lastSeen: n.at || new Date().toISOString(),
      });
    }
    if (cache.facts.length) save();
  } catch {
    /* no legacy notes */
  }
}

function addFact(statement, category = 'general', importance = 7) {
  const text = String(statement || '').slice(0, 400).trim();
  if (!text) return;
  cache.facts.push({
    id: uid('f'),
    statement: text,
    category,
    importance: Math.max(1, Math.min(10, importance)),
    createdAt: new Date().toISOString(),
    invalidAt: null,
    lastSeen: new Date().toISOString(),
  });
  save();
}

function updateFact(id, statement) {
  const fact = cache.facts.find((f) => f.id === id);
  const text = String(statement || '').slice(0, 400).trim();
  if (!fact || !text) return false;
  fact.statement = text;
  fact.lastSeen = new Date().toISOString();
  delete vecs[id]; // re-embed on next backfill
  save();
  saveVecs();
  return true;
}

// Apply a digestion result (LLM output). Everything is optional and clamped.
function applyDigest(d) {
  if (!d || typeof d !== 'object') return;
  const now = new Date().toISOString();
  const str = (v, n) => String(v || '').slice(0, n).trim();

  for (const f of (d.new_facts || []).slice(0, 12)) {
    if (str(f.statement, 400)) {
      cache.facts.push({
        id: uid('f'),
        statement: str(f.statement, 400),
        category: str(f.category, 30) || 'general',
        importance: Math.max(1, Math.min(10, Number(f.importance) || 5)),
        createdAt: now,
        invalidAt: null,
        lastSeen: now,
      });
    }
  }
  for (const u of (d.update_facts || []).slice(0, 12)) {
    const fact = cache.facts.find((f) => f.id === u.id);
    if (fact && str(u.statement, 400)) {
      fact.statement = str(u.statement, 400);
      fact.lastSeen = now;
      delete vecs[fact.id]; // re-embed on next backfill
    }
  }
  for (const id of (d.invalidate_fact_ids || []).slice(0, 12)) {
    const fact = cache.facts.find((f) => f.id === id);
    if (fact) fact.invalidAt = now;
  }
  if (d.episode && str(d.episode.summary, 500)) {
    cache.episodes.push({
      id: uid('e'),
      date: now,
      summary: str(d.episode.summary, 500),
      tone: str(d.episode.tone, 60),
    });
    if (cache.episodes.length > 60) cache.episodes = cache.episodes.slice(-60);
  }
  for (const l of (d.new_open_loops || []).slice(0, 6)) {
    if (str(l.description, 300)) {
      cache.open_loops.push({
        id: uid('l'),
        description: str(l.description, 300),
        dueHint: str(l.due_hint, 100),
        dueAt: null,
        status: 'open',
        createdAt: now,
      });
    }
  }
  for (const id of (d.resolved_loop_ids || []).slice(0, 12)) {
    const loop = cache.open_loops.find((l) => l.id === id);
    if (loop) loop.status = 'resolved';
  }
  for (const b of (d.relationship_bits || []).slice(0, 6)) {
    if (str(b, 300)) {
      cache.relationship.push({ id: uid('r'), note: str(b, 300), createdAt: now });
    }
  }
  // current read on the user — a fast-decaying hypothesis, never a fact
  if (d.user_state && str(d.user_state, 300)) {
    cache.user_state = { text: str(d.user_state, 300), at: now };
  }
  // safety net: the digester caught his name even if the live duck forgot to save it
  if (!cache.meta.userName && str(d.user_name, 60)) {
    cache.meta.userName = str(d.user_name, 60);
  }
  // a digested conversation is a real session — connects alone don't count
  cache.meta.sessionsCount = (cache.meta.sessionsCount || 0) + 1;
  save();
}

// ---------------------------------------------------------------------------
// The dream loop's write path — consolidation, understanding, diary, growth.
// Everything optional and clamped; the dream may only reshape, never explode.
// ---------------------------------------------------------------------------

function applyDream(d) {
  if (!d || typeof d !== 'object') return;
  const now = new Date().toISOString();
  const str = (v, n) => String(v || '').slice(0, n).trim();

  for (const id of (d.close_loop_ids || []).slice(0, 20)) {
    const loop = cache.open_loops.find((l) => l.id === id);
    if (loop) loop.status = 'resolved';
  }
  for (const s of (d.schedule_loops || []).slice(0, 20)) {
    const loop = cache.open_loops.find((l) => l.id === s.id);
    const t = Date.parse(s.due_at);
    if (loop && !Number.isNaN(t)) {
      loop.dueAt = new Date(t).toISOString();
      loop.dueGranularity = s.granularity === 'day' ? 'day' : 'time';
    }
  }
  for (const u of (d.rewrite_facts || []).slice(0, 25)) {
    const fact = cache.facts.find((f) => f.id === u.id);
    if (!fact) continue;
    if (str(u.statement, 400)) {
      fact.statement = str(u.statement, 400);
      delete vecs[fact.id];
    }
    if (u.importance) fact.importance = Math.max(1, Math.min(10, Number(u.importance)));
    fact.lastSeen = fact.lastSeen || now;
  }
  for (const id of (d.invalidate_fact_ids || []).slice(0, 25)) {
    const fact = cache.facts.find((f) => f.id === id);
    if (fact) fact.invalidAt = now;
  }
  for (const f of (d.new_facts || []).slice(0, 8)) {
    // promotions: recurring episodic themes distilled into durable facts
    if (str(f.statement, 400)) {
      cache.facts.push({
        id: uid('f'),
        statement: str(f.statement, 400),
        category: str(f.category, 30) || 'general',
        importance: Math.max(1, Math.min(10, Number(f.importance) || 5)),
        createdAt: now,
        invalidAt: null,
        lastSeen: now,
      });
    }
  }
  for (const id of (d.prune_bit_ids || []).slice(0, 10)) {
    const i = cache.relationship.findIndex((r) => r.id === id);
    if (i !== -1) cache.relationship.splice(i, 1);
  }
  if (d.understanding && (str(d.understanding.who, 1200) || str(d.understanding.us, 800))) {
    cache.understanding = {
      who: str(d.understanding.who, 1200) || (cache.understanding && cache.understanding.who) || '',
      us: str(d.understanding.us, 800) || (cache.understanding && cache.understanding.us) || '',
      updatedAt: now,
    };
  }
  // the duck's grown identity is precious: a thin dream returning [] must
  // never erase it — only a non-empty list may evolve the traits
  const newTraits = (Array.isArray(d.duck_traits) ? d.duck_traits : [])
    .slice(0, 8)
    .map((t) => str(t, 200))
    .filter(Boolean);
  if (newTraits.length) {
    cache.duck_self = newTraits.map((trait) => ({ id: uid('t'), trait, createdAt: now }));
  }
  if (str(d.diary_note, 400)) {
    cache.diary.push({ id: uid('d'), date: now, note: str(d.diary_note, 400) });
    if (cache.diary.length > 120) cache.diary = cache.diary.slice(-120);
  }
  cache.meta.lastDreamAt = now;
  save();
}

function lastDreamAt() {
  return cache.meta.lastDreamAt || null;
}

function activeFacts() {
  return cache.facts
    .filter((f) => !f.invalidAt)
    .sort((a, b) => b.importance - a.importance || b.lastSeen.localeCompare(a.lastSeen));
}

function openLoops() {
  // soonest-due first, then newest — dueAt is stamped by the dream loop
  return cache.open_loops
    .filter((l) => l.status === 'open')
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

// Compact snapshot handed to the digester so it can dedupe/update/invalidate.
function snapshotForDigest() {
  return {
    facts: activeFacts().slice(0, 60).map((f) => ({ id: f.id, statement: f.statement })),
    open_loops: openLoops().slice(0, 20).map((l) => ({ id: l.id, description: l.description })),
    relationship: cache.relationship.slice(-15).map((r) => r.note),
  };
}

// Full structured snapshot for the dream loop (ids everywhere so it can rewrite).
function snapshotForDream() {
  return {
    stage: stageInfo(),
    understanding: cache.understanding,
    facts: activeFacts().map((f) => ({
      id: f.id,
      statement: f.statement,
      category: f.category,
      importance: f.importance,
      createdAt: f.createdAt,
      lastSeen: f.lastSeen,
    })),
    open_loops: openLoops().map((l) => ({
      id: l.id,
      description: l.description,
      dueHint: l.dueHint,
      dueAt: l.dueAt,
      createdAt: l.createdAt,
    })),
    relationship_bits: cache.relationship.map((r) => ({ id: r.id, note: r.note, createdAt: r.createdAt })),
    duck_traits: cache.duck_self.map((t) => t.trait),
    recent_episodes: cache.episodes.slice(-20),
    recent_diary: cache.diary.slice(-7),
    user_state: cache.user_state,
  };
}

// ---------------------------------------------------------------------------
// Growth — relationship depth and the hatching arc.
// Depth is earned, never bought: conversations, distinct days, what it knows.
// ---------------------------------------------------------------------------

const STAGES = [
  { name: 'egg', at: 0 },
  { name: 'duckling', at: 0 }, // entered by hatching, not by score
  { name: 'fledgling', at: 25 },
  { name: 'companion', at: 60 },
];

function depthScore() {
  const sessions = cache.meta.sessionsCount || 0;
  const days = (cache.meta.talkedDays || []).length;
  return sessions + Math.min(40, activeFacts().length) + cache.relationship.length * 2 + days * 2;
}

function stageInfo() {
  let stage = cache.meta.stage || 'egg';
  if (stage !== 'egg') {
    const depth = depthScore();
    for (const s of STAGES) {
      if (s.name !== 'egg' && depth >= s.at) stage = s.name;
    }
    if (cache.meta.stage !== stage) {
      cache.meta.stage = stage;
      save();
    }
  }
  return { stage, depth: depthScore(), hatchedAt: cache.meta.hatchedAt || null };
}

function hatch() {
  if (cache.meta.stage !== 'egg') return false;
  cache.meta.stage = 'duckling';
  cache.meta.hatchedAt = new Date().toISOString();
  save();
  return true;
}

// ---------------------------------------------------------------------------
// The context capsule — what the live voice session knows.
// Understanding first (prose), evidence second (facts), manners always.
// ---------------------------------------------------------------------------

function userStateFresh() {
  if (!cache.user_state) return null;
  const age = Date.now() - new Date(cache.user_state.at).getTime();
  return age < 72 * 3600 * 1000 ? cache.user_state : null;
}

function capsule() {
  const parts = [];

  if (cache.understanding && cache.understanding.who) {
    parts.push('WHO HE IS (your considered understanding — this is the important part)\n' + cache.understanding.who);
  }
  if (cache.understanding && cache.understanding.us) {
    parts.push('WHERE THINGS STAND BETWEEN YOU\n' + cache.understanding.us);
  }

  const state = userStateFresh();
  if (state) {
    const when = new Date(state.at).toLocaleDateString('en-US', { weekday: 'long' });
    parts.push(
      `YOUR CURRENT READ ON HIM (a hypothesis from ${when}, not a fact — verify by feel, never announce it)\n` + state.text
    );
  }

  const facts = scoreFactsForCapsule().slice(0, 18);
  parts.push(
    'WHAT YOU REMEMBER ABOUT TANMAYE\n' +
      (facts.length ? facts.map((f) => `- ${f.statement}`).join('\n') : '- (nothing yet — you just met)')
  );

  const loops = openLoops().slice(0, 8);
  if (loops.length) {
    parts.push(
      'THREADS TO PICK UP (bring up at most ONE, and only if it fits naturally)\n' +
        loops
          .map((l) => {
            let due = '';
            if (l.dueAt) {
              // day-granularity loops never render a clock time — an invented
              // "9am" spoken back as fact is a trust-destroying hallucination
              due =
                l.dueGranularity === 'day'
                  ? ` (${new Date(l.dueAt).toLocaleDateString('en-US', { weekday: 'long' })} — day known, time not)`
                  : ` (due ${new Date(l.dueAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })})`;
            } else if (l.dueHint) {
              due = ` (${l.dueHint})`;
            }
            return `- ${l.description}${due}`;
          })
          .join('\n')
    );
  }

  const bits = cache.relationship.slice(-8);
  if (bits.length) {
    parts.push('YOUR RUNNING BITS WITH HIM\n' + bits.map((b) => `- ${b.note}`).join('\n'));
  }

  if (cache.duck_self.length) {
    parts.push(
      'WHO YOU ARE BECOMING (your own quirks, grown from your life together — stay true to them)\n' +
        cache.duck_self.map((t) => `- ${t.trait}`).join('\n')
    );
  }

  const tricks = trickLines();
  if (tricks) parts.push(tricks);

  const shop = workshopLines();
  if (shop) parts.push(shop);

  const scores = gameScoreLines();
  if (scores) parts.push(scores);

  const happenings = happeningsSummary();
  if (happenings) parts.push(happenings);

  const eps = cache.episodes.slice(-2);
  if (eps.length) {
    parts.push(
      'LATELY\n' +
        eps
          .map((e) => `- ${new Date(e.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}: ${e.summary}`)
          .join('\n')
    );
  }

  parts.push(
    'MEMORY MANNERS (non-negotiable)\n' +
      '- At most ONE unprompted callback to a memory per conversation. Being remembered is magic; being monitored is creepy.\n' +
      "- Never quote his own sensitive words back at him verbatim; refer to things lightly and let him elaborate.\n" +
      '- Your memories are observations, not verdicts about him. Hold them loosely; he is the authority on his own life.\n' +
      "- If you're unsure whether bringing something up is welcome, ask a small open question instead."
  );

  return parts.join('\n\n');
}

// Facts for the capsule: importance + freshness, not importance alone —
// what mattered lately should beat what mattered once.
function scoreFactsForCapsule() {
  const now = Date.now();
  return activeFacts()
    .map((f) => {
      const ageDays = (now - new Date(f.lastSeen).getTime()) / 86400000;
      return { ...f, _score: f.importance / 10 + Math.exp(-ageDays / 21) };
    })
    .sort((a, b) => b._score - a._score);
}

// ---------------------------------------------------------------------------
// Tricks — workflows he TAUGHT the duck by demonstrating. A trick is a
// semantic plan (goal + natural-language steps + risk flags), never pixel
// coordinates: performing re-grounds the plan against a fresh screenshot.
// ---------------------------------------------------------------------------

function addTrick(spec) {
  if (!spec || !String(spec.name || '').trim()) return null;
  const name = String(spec.name).slice(0, 60).trim();
  // re-teaching a trick replaces it — the newest lesson wins
  const existing = cache.tricks.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
  const trick = {
    id: existing !== -1 ? cache.tricks[existing].id : uid('k'),
    name,
    goal: String(spec.goal || '').slice(0, 300),
    steps: (Array.isArray(spec.steps) ? spec.steps : []).slice(0, 15).map((s) => ({
      what: String(s.what || s).slice(0, 300),
      risky: Boolean(s.risky),
    })),
    notes: String(spec.notes || '').slice(0, 400),
    learnedAt: new Date().toISOString(),
    timesPerformed: existing !== -1 ? cache.tricks[existing].timesPerformed : 0,
  };
  if (!trick.steps.length) return null;
  if (existing !== -1) cache.tricks[existing] = trick;
  else cache.tricks.push(trick);
  if (cache.tricks.length > 40) cache.tricks = cache.tricks.slice(-40);
  save();
  return trick;
}

function findTrick(name) {
  const q = String(name || '').toLowerCase().trim();
  if (!q) return null;
  return (
    cache.tricks.find((t) => t.name.toLowerCase() === q) ||
    cache.tricks.find((t) => t.name.toLowerCase().includes(q) || q.includes(t.name.toLowerCase())) ||
    null
  );
}

function touchTrick(id) {
  const t = cache.tricks.find((x) => x.id === id);
  if (t) {
    t.timesPerformed++;
    t.lastPerformedAt = new Date().toISOString();
    save();
  }
}

function trickLines() {
  if (!cache.tricks.length) return '';
  return (
    'TRICKS HE HAS TAUGHT YOU (call perform_trick when he asks for one by name — you are very proud of these)\n' +
    cache.tricks.map((t) => `- "${t.name}": ${t.goal}${t.timesPerformed ? ` (performed ${t.timesPerformed}×)` : ' (never performed yet!)'}`).join('\n')
  );
}

// ---------------------------------------------------------------------------
// Workshop — lightweight refs to things the duck has BUILT (full artifacts
// live in userData/workshop/, owned by workshop.js; the spine only knows
// enough for the capsule to talk about them).
// ---------------------------------------------------------------------------

function setWorkshopRefs(refs) {
  cache.workshop = (Array.isArray(refs) ? refs : []).slice(0, 60).map((r) => ({
    id: String(r.id || ''),
    name: String(r.name || '').slice(0, 60),
    kind: String(r.kind || '').slice(0, 12),
    timesUsed: Number(r.timesUsed) || 0,
    broken: Boolean(r.broken),
  }));
  save();
}

function workshopRefs() {
  return cache.workshop || [];
}

function workshopLines() {
  const refs = workshopRefs();
  if (!refs.length) return '';
  return (
    'YOUR WORKSHOP (things you have BUILT together — call check_workshop/run_artifact when he asks for one; offer to build what is missing, but NEVER build without his clear yes)\n' +
    refs
      .map((w) => `- "${w.name}" (${w.kind}${w.broken ? ', broken — offer to rebuild' : ''}${w.timesUsed ? `, used ${w.timesUsed}×` : ', never used yet'})`)
      .join('\n')
  );
}

function setEquippedProps(ids) {
  cache.meta.equippedProps = (Array.isArray(ids) ? ids : []).slice(0, 4).map(String);
  save();
}

function equippedProps() {
  return cache.meta.equippedProps || [];
}

// ---------------------------------------------------------------------------
// Games — running score across days is memory as gameplay.
// ---------------------------------------------------------------------------

function recordGameResult(game, winner) {
  const key = String(game || '').slice(0, 40).toLowerCase().replace(/[^a-z0-9_ -]/g, '').trim();
  if (!key || !['duck', 'user'].includes(winner)) return null;
  if (!cache.game_scores[key]) cache.game_scores[key] = { duck: 0, user: 0, lastAt: null };
  cache.game_scores[key][winner]++;
  cache.game_scores[key].lastAt = new Date().toISOString();
  save();
  return cache.game_scores[key];
}

function gameScoreLines() {
  const keys = Object.keys(cache.game_scores);
  if (!keys.length) return '';
  const lines = keys.map((k) => {
    const s = cache.game_scores[k];
    return `- ${k}: you ${s.duck} — him ${s.user}`;
  });
  return 'ALL-TIME GAME SCORES (you keep score and you are competitive about it)\n' + lines.join('\n');
}

// Physical-world events (petted, fed, tossed, chase results) so the next
// conversation knows what happened to the duck between talks.
function addHappening(type, detail = '') {
  cache.happenings.push({ type, detail: String(detail).slice(0, 120), at: new Date().toISOString() });
  if (cache.happenings.length > 200) cache.happenings = cache.happenings.slice(-200);
  save();
}

function touchConversation() {
  const now = new Date();
  cache.meta.lastConversationAt = now.toISOString();
  // NOTE: sessionsCount is incremented by applyDigest (a real conversation),
  // not here — rapid connect attempts must never age the duck
  const day = now.toISOString().slice(0, 10);
  if (!cache.meta.talkedDays) cache.meta.talkedDays = [];
  if (!cache.meta.talkedDays.includes(day)) {
    cache.meta.talkedDays.push(day);
    if (cache.meta.talkedDays.length > 400) cache.meta.talkedDays = cache.meta.talkedDays.slice(-400);
  }
  // prune stale happenings while we're here
  const cutoff = Date.now() - 48 * 3600 * 1000;
  cache.happenings = cache.happenings.filter((h) => new Date(h.at).getTime() > cutoff);
  save();
}

function lastTalkedDescription() {
  const at = cache.meta.lastConversationAt;
  if (!at) return 'This is your very first conversation with him.';
  const hours = (Date.now() - new Date(at).getTime()) / 3600000;
  if (hours < 1) return 'You last talked less than an hour ago.';
  if (hours < 24) return `You last talked about ${Math.round(hours)} hours ago.`;
  return `You last talked ${Math.round(hours / 24)} day(s) ago — greet him like you missed him.`;
}

function happeningsSummary() {
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const recent = cache.happenings.filter((h) => new Date(h.at).getTime() > cutoff);
  if (!recent.length) return '';
  const count = (t) => recent.filter((h) => h.type === t).length;
  const lines = [];
  if (count('pet')) lines.push(`- he petted you ${count('pet')} time(s)`);
  if (count('feed')) lines.push(`- he fed you ${count('feed')} crumb(s)`);
  if (count('toss')) lines.push(`- he picked you up and threw you ${count('toss')} time(s) (you have opinions about this)`);
  if (count('mischief')) lines.push(`- he let you go feral ${count('mischief')} time(s) — footprints and doodles everywhere (zero regrets)`);
  for (const h of recent.filter((x) => x.type === 'trick')) lines.push(`- ${h.detail} (you're still proud)`);
  for (const h of recent.filter((x) => x.type === 'chase')) lines.push(`- chase game: ${h.detail}`);
  for (const h of recent.filter((x) => x.type === 'coding')) lines.push(`- while he was coding: ${h.detail}`);
  const music = recent.filter((x) => x.type === 'music');
  if (music.length) {
    // one aggregated line, artists deduped — never a track-by-track ledger
    const artists = [...new Set(music.map((h) => h.detail.split(' — ').pop()).filter(Boolean))].slice(0, 4);
    if (artists.length) lines.push(`- music was on while you hung out (${artists.join(', ')}) — you bobbed along in your little headphones`);
  }
  if (!lines.length) return '';
  return 'SINCE YOU LAST TALKED (react to these naturally, don\'t list them)\n' + lines.join('\n');
}

// Proactivity governance — every failed companion failed on frequency.
// HARD RULES for all impulse kinds: max 4/day total, 90 minutes between any
// two. Loop nudges additionally need 6h between themselves. Battery-critical
// is the one exemption from the daily cap (still gapped, still 1/day itself)
// because a dead laptop is worse than a fifth chirp.
//
// Two-phase: canImpulse() checks, recordImpulse() charges the budget — the
// renderer may still decline to show an impulse (mid-conversation, dragging),
// and an unshown impulse must not burn one of the four daily slots.
function prunedImpulses() {
  if (!cache.meta.impulses) cache.meta.impulses = [];
  const now = Date.now();
  cache.meta.impulses = cache.meta.impulses.filter((i) => now - i.at < 24 * 3600 * 1000);
  return cache.meta.impulses;
}

function canImpulse(kind) {
  const now = Date.now();
  const all = prunedImpulses();

  if (kind !== 'battery' && all.length >= 4) return false;
  const lastAny = all.length ? Math.max(...all.map((i) => i.at)) : 0;
  if (now - lastAny < 90 * 60 * 1000) return false;

  const sameKind = all.filter((i) => i.kind === kind);
  const lastSame = sameKind.length ? Math.max(...sameKind.map((i) => i.at)) : 0;
  if (kind === 'loop' && now - lastSame < 6 * 3600 * 1000) return false;
  if (kind === 'battery' && now - lastSame < 12 * 3600 * 1000) return false;
  if (kind === 'latenight' && now - lastSame < 20 * 3600 * 1000) return false; // once a night, ever
  if (kind === 'loop' && !openLoops().length) return false;
  return true;
}

function recordImpulse(kind) {
  prunedImpulses().push({ kind, at: Date.now() });
  save();
}

// legacy one-shot form (kept for callers/tests that don't need the ack split)
function allowImpulse(kind) {
  if (!canImpulse(kind)) return false;
  recordImpulse(kind);
  return true;
}

// The loop worth nudging about right now: a loop due within the window wins;
// otherwise a random undated loop. A dated-but-distant (or overdue) loop must
// never shadow the others.
function dueSoonLoop(windowMinutes = 45) {
  const now = Date.now();
  return (
    openLoops().find((l) => {
      if (!l.dueAt) return false;
      const mins = (new Date(l.dueAt).getTime() - now) / 60000;
      return mins > 0 && mins < windowMinutes;
    }) || null
  );
}

function undatedLoop() {
  const loops = openLoops().filter((l) => !l.dueAt);
  return loops.length ? loops[Math.floor(Math.random() * loops.length)] : null;
}

function deleteItem(type, id) {
  const list = cache[type];
  if (!Array.isArray(list)) return false;
  const i = list.findIndex((x) => x.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  delete vecs[id];
  save();
  saveVecs();
  return true;
}

// Dashboard/introspection view — everything human-readable, no vectors.
function getAll() {
  return {
    facts: cache.facts,
    episodes: cache.episodes,
    open_loops: cache.open_loops,
    relationship: cache.relationship,
    duck_self: cache.duck_self,
    diary: cache.diary,
    happenings: cache.happenings,
    game_scores: cache.game_scores,
    tricks: cache.tricks,
    workshop: workshopRefs(),
    user_state: userStateFresh(),
    understanding: cache.understanding,
    meta: {
      stage: cache.meta.stage || 'egg',
      depth: depthScore(),
      lastDreamAt: cache.meta.lastDreamAt || null,
      lastConversationAt: cache.meta.lastConversationAt || null,
      hatchedAt: cache.meta.hatchedAt || null,
      userName: cache.meta.userName || null,
      duckName: cache.meta.duckName || 'Quackers',
      skin: cache.meta.skin || 'classic',
      sessionsCount: cache.meta.sessionsCount || 0,
    },
  };
}

// Cheap accessors so hot paths don't build the full getAll() copy.
function sessionsCount() {
  return cache.meta.sessionsCount || 0;
}

function understanding() {
  return cache.understanding;
}

function hasMemories() {
  return cache.facts.length > 0 || cache.episodes.length > 0;
}

function stage() {
  return cache.meta.stage || 'egg';
}

function userName() {
  return cache.meta.userName || null;
}

function setUserName(name) {
  const clean = String(name || '').slice(0, 60).trim();
  if (!clean) return false;
  cache.meta.userName = clean;
  save();
  return true;
}

// ---------------------------------------------------------------------------
// Identity — chosen once at onboarding: which quacker, and its name.
// ---------------------------------------------------------------------------

function setIdentity(skin, duckName) {
  cache.meta.skin = String(skin || 'classic').slice(0, 30);
  cache.meta.duckName = String(duckName || 'Quackers').slice(0, 40).trim() || 'Quackers';
  cache.meta.onboarded = true;
  save();
  return true;
}

function identity() {
  return {
    onboarded: Boolean(cache.meta.onboarded),
    skin: cache.meta.skin || 'classic',
    duckName: cache.meta.duckName || 'Quackers',
  };
}

function duckName() {
  return cache.meta.duckName || 'Quackers';
}

function skin() {
  return cache.meta.skin || 'classic';
}

// Consent flag for the music sense (tray toggle). Off by default — the duck
// only listens along when explicitly invited.
function setMusicSense(on) {
  cache.meta.musicSense = Boolean(on);
  save();
}

function musicSense() {
  return Boolean(cache.meta.musicSense);
}

// ---------------------------------------------------------------------------
// Retrieval memory — embeddings + scored search. Relevance is the backbone,
// recency and importance tilt the ranking (generative-agents style), and
// exact entity mentions get a deterministic boost so names never miss.
// ---------------------------------------------------------------------------

// Every embeddable memory as {kind, id, text, embedding?}
function embeddableItems() {
  const out = [];
  for (const f of cache.facts) if (!f.invalidAt) out.push({ kind: 'facts', id: f.id, text: f.statement, embedding: vecs[f.id], importance: f.importance, lastSeen: f.lastSeen });
  for (const e of cache.episodes) out.push({ kind: 'episodes', id: e.id, text: e.summary, embedding: vecs[e.id], importance: 4, lastSeen: e.date });
  for (const r of cache.relationship) out.push({ kind: 'relationship', id: r.id, text: r.note, embedding: vecs[r.id], importance: 7, lastSeen: r.createdAt });
  for (const l of cache.open_loops) if (l.status === 'open') out.push({ kind: 'open_loops', id: l.id, text: l.description, embedding: vecs[l.id], importance: 6, lastSeen: l.createdAt });
  return out;
}

function itemsMissingEmbedding() {
  return embeddableItems().filter((i) => !i.embedding);
}

function setEmbedding(kind, id, embedding) {
  const item = (cache[kind] || []).find((x) => x.id === id);
  if (item) {
    vecs[id] = embedding;
    saveVecs();
    return true;
  }
  return false;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'about', 'what', 'when', 'where',
  'does', 'did', 'his', 'her', 'him', 'she', 'has', 'have', 'was', 'were', 'you',
  'your', 'their', 'them', 'they', 'like', 'want', 'wants', 'from', 'into', 'been',
]);

function queryTerms(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// Return the top-k most relevant memories for a query.
// score = relevance + 0.15·recency(21d half-ish decay) + 0.15·importance + 0.2·exact term hit
function searchByEmbedding(queryVec, k = 5, queryText = '') {
  const now = Date.now();
  // whole-word matches only — a substring hit ("run" inside "brunch") would
  // let recency+importance smuggle irrelevant memories past the floor
  const termRes = queryTerms(queryText).map(
    (t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  );
  const scored = embeddableItems()
    .filter((i) => i.embedding)
    .map((i) => {
      const relevance = cosine(queryVec, i.embedding);
      const ageDays = (now - new Date(i.lastSeen).getTime()) / 86400000;
      const recency = Math.exp(-Math.max(0, ageDays) / 21);
      const importance = (i.importance || 5) / 10;
      const termHit = termRes.some((re) => re.test(i.text)) ? 1 : 0;
      return {
        text: i.text,
        kind: i.kind,
        id: i.id,
        relevance,
        termHit,
        score: relevance + 0.15 * recency + 0.15 * importance + 0.2 * termHit,
      };
    })
    .sort((a, b) => b.score - a.score);
  // require a semantic or exact-word signal; ranking does the real filtering
  return scored.filter((s) => s.relevance > 0.15 || s.termHit).slice(0, k);
}

// Recalled memories stay fresh — use strengthens, like real memory.
function touchItems(hits) {
  const now = new Date().toISOString();
  let touched = false;
  for (const h of hits || []) {
    const item = (cache[h.kind] || []).find((x) => x.id === h.id);
    if (item && 'lastSeen' in item) {
      item.lastSeen = now;
      touched = true;
    }
  }
  if (touched) save();
}

module.exports = {
  init,
  addFact,
  updateFact,
  applyDigest,
  applyDream,
  lastDreamAt,
  snapshotForDigest,
  snapshotForDream,
  capsule,
  getAll,
  deleteItem,
  addHappening,
  touchConversation,
  lastTalkedDescription,
  allowImpulse,
  canImpulse,
  recordImpulse,
  dueSoonLoop,
  undatedLoop,
  recordGameResult,
  addTrick,
  findTrick,
  touchTrick,
  setWorkshopRefs,
  workshopRefs,
  setEquippedProps,
  equippedProps,
  stage,
  stageInfo,
  userName,
  setUserName,
  setIdentity,
  identity,
  duckName,
  skin,
  setMusicSense,
  musicSense,
  hatch,
  userStateFresh,
  sessionsCount,
  understanding,
  hasMemories,
  itemsMissingEmbedding,
  setEmbedding,
  searchByEmbedding,
  touchItems,
  save,
};
