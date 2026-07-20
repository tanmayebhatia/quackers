// Unit tests for the memory spine + dream apply logic (pure Node, no Electron).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const spine = require('../src/spine');
const dreamer = require('../src/dream');

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackers-test-'));
  spine.init(dir);
});

test('first run starts as an egg and hatches exactly once', () => {
  assert.equal(spine.stage(), 'egg');
  assert.equal(spine.hatch(), true);
  assert.equal(spine.stage(), 'duckling');
  assert.equal(spine.hatch(), false); // no re-hatching
  assert.ok(spine.stageInfo().hatchedAt);
});

test('stage grows with digested conversations, never regresses to egg', () => {
  spine.hatch();
  // sessions are counted when a conversation is DIGESTED — mere connects
  // (touchConversation) must never age the duck
  for (let i = 0; i < 5; i++) spine.touchConversation();
  assert.equal(spine.sessionsCount(), 0, 'connect attempts alone must not count as sessions');
  for (let i = 0; i < 30; i++) spine.applyDigest({ episode: { summary: `day ${i}`, tone: 'fine' } });
  for (let i = 0; i < 10; i++) spine.addFact(`fact number ${i}`, 'general', 5);
  const info = spine.stageInfo();
  assert.ok(['fledgling', 'companion'].includes(info.stage), `expected growth, got ${info.stage}`);
  assert.ok(info.depth > 25);
});

test('digester user_name safety net fills a missing name but never overwrites', () => {
  spine.applyDigest({ user_name: 'Tanmaye' });
  assert.equal(spine.userName(), 'Tanmaye');
  spine.applyDigest({ user_name: 'SomeoneElse' });
  assert.equal(spine.userName(), 'Tanmaye', 'an established name is never overwritten by digestion');
});

test('applyDigest clamps, stores user_state, resolves loops', () => {
  spine.applyDigest({
    new_facts: [{ statement: 'He likes mangoes', category: 'taste', importance: 22 }],
    episode: { summary: 'Talked about mangoes', tone: 'warm' },
    new_open_loops: [{ description: 'wants to try the new mango lassi place', due_hint: 'this weekend' }],
    user_state: 'seemed relaxed, joking around',
  });
  const all = spine.getAll();
  assert.equal(all.facts.length, 1);
  assert.equal(all.facts[0].importance, 10); // clamped
  assert.equal(all.open_loops.length, 1);
  assert.ok(spine.userStateFresh());
  assert.match(spine.capsule(), /mangoes/);

  const loopId = all.open_loops[0].id;
  spine.applyDigest({ resolved_loop_ids: [loopId] });
  assert.equal(spine.getAll().open_loops[0].status, 'resolved');
});

test('applyDream rewrites, schedules, prunes, and writes understanding + diary', () => {
  spine.addFact('He is preparing for the pitch', 'work', 8);
  spine.applyDigest({ relationship_bits: ['we call the compiler "the beast"'] });
  const all = spine.getAll();
  const factId = all.facts[0].id;
  const bitId = all.relationship[0].id;
  spine.applyDigest({ new_open_loops: [{ description: 'watch the game', due_hint: 'thursday 2pm' }] });
  const loopId = spine.getAll().open_loops[0].id;

  spine.applyDream({
    rewrite_facts: [{ id: factId, statement: 'He pitched in early July', importance: 6 }],
    schedule_loops: [{ id: loopId, due_at: '2026-07-10T14:00:00' }],
    prune_bit_ids: [bitId],
    understanding: { who: 'A builder who ships fast and cares about charm.', us: 'Early days; he pets the duck a lot.' },
    duck_traits: ['obsessed with crumbs', 'holds a grudge about being thrown'],
    diary_note: 'today he petted me twice. a good day.',
  });

  const after = spine.getAll();
  assert.equal(after.facts[0].statement, 'He pitched in early July');
  assert.equal(after.facts[0].importance, 6);
  assert.ok(after.open_loops[0].dueAt);
  assert.equal(after.relationship.length, 0);
  assert.equal(after.duck_self.length, 2);
  assert.equal(after.diary.length, 1);
  assert.match(spine.capsule(), /builder who ships fast/);
  assert.match(spine.capsule(), /obsessed with crumbs/);
  assert.ok(spine.lastDreamAt());
});

test('dream is due only after enough time and with something to dream about', () => {
  assert.equal(dreamer.due(spine), false); // empty spine — nothing to dream
  spine.addFact('He exists', 'general', 5);
  assert.equal(dreamer.due(spine), true); // never dreamed, has memories
  spine.applyDream({ diary_note: '' });
  assert.equal(dreamer.due(spine), false); // just dreamed
});

test('impulse caps: 4/day across ALL kinds, 90-minute gaps', () => {
  assert.equal(spine.allowImpulse('welcome'), true);
  assert.equal(spine.allowImpulse('welcome'), false); // 90-min gap blocks
  // simulate time passing by rewriting the stored impulse timestamps
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'spine.json'), 'utf8'));
  raw.meta.impulses = [1, 2, 3, 4].map((i) => ({ kind: 'welcome', at: Date.now() - i * 2 * 3600 * 1000 }));
  fs.writeFileSync(path.join(dir, 'spine.json'), JSON.stringify(raw));
  spine.init(dir);
  assert.equal(spine.allowImpulse('welcome'), false, 'daily cap of 4 applies to welcomes too');
});

test('dueSoonLoop fires only in-window; distant/overdue dated loops never starve undated ones', () => {
  spine.applyDigest({
    new_open_loops: [
      { description: 'someday: learn the trumpet', due_hint: '' },
      { description: 'game soon', due_hint: '' },
      { description: 'trip in 3 weeks', due_hint: '' },
    ],
  });
  const loops = spine.getAll().open_loops;
  const soon = new Date(Date.now() + 30 * 60000).toISOString();
  const far = new Date(Date.now() + 21 * 86400000).toISOString();
  spine.applyDream({
    schedule_loops: [
      { id: loops[1].id, due_at: soon, granularity: 'time' },
      { id: loops[2].id, due_at: far, granularity: 'day' },
    ],
  });
  assert.equal(spine.dueSoonLoop(45).description, 'game soon');
  assert.equal(spine.dueSoonLoop(10), null, 'outside window → nothing due');
  assert.equal(spine.undatedLoop().description, 'someday: learn the trumpet', 'dated loops never shadow undated');
});

test('impulse budget is only charged on delivery (canImpulse vs recordImpulse)', () => {
  assert.equal(spine.canImpulse('welcome'), true);
  assert.equal(spine.canImpulse('welcome'), true, 'checking must not charge the budget');
  spine.recordImpulse('welcome');
  assert.equal(spine.canImpulse('welcome'), false, 'recorded impulse starts the 90-min gap');
});

test('battery-critical bypasses the 4/day cap but keeps its own gap', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'spine.json'), 'utf8'));
  raw.meta.impulses = [1, 2, 3, 4].map((i) => ({ kind: 'welcome', at: Date.now() - (i + 1) * 2 * 3600 * 1000 }));
  fs.writeFileSync(path.join(dir, 'spine.json'), JSON.stringify(raw));
  spine.init(dir);
  assert.equal(spine.canImpulse('welcome'), false, 'daily cap holds for normal kinds');
  assert.equal(spine.canImpulse('battery'), true, 'a dying laptop outranks the cap');
  spine.recordImpulse('battery');
  assert.equal(spine.canImpulse('battery'), false, 'battery has its own 12h gap');
});

test('an empty duck_traits array from a thin dream never erases grown identity', () => {
  spine.applyDream({ duck_traits: ['obsessed with crumbs', 'grudge about throws'] });
  spine.applyDream({ duck_traits: [] });
  assert.equal(spine.getAll().duck_self.length, 2, 'identity survives a thin dream');
});

test('recall term matching is whole-word: "run" must not hit "brunch"', () => {
  spine.addFact("He loves brunch at Sunny's", 'taste', 8);
  spine.addFact('He runs every morning', 'routine', 5);
  const all = spine.getAll();
  spine.setEmbedding('facts', all.facts[0].id, [0.1, 0.9, 0]);
  spine.setEmbedding('facts', all.facts[1].id, [0.1, 0.85, 0.05]);
  const hits = spine.searchByEmbedding([1, 0, 0], 2, 'did he run today');
  // neither is semantically relevant; only a whole-word term hit may pass the floor
  assert.ok(!hits.some((h) => h.text.includes('brunch')), 'substring hit must not surface brunch');
});

test('embeddings live in a sidecar file, not spine.json', () => {
  spine.addFact('sidecar test fact', 'general', 5);
  spine.setEmbedding('facts', spine.getAll().facts[0].id, [0.1, 0.2, 0.3]);
  const spineRaw = fs.readFileSync(path.join(dir, 'spine.json'), 'utf8');
  assert.ok(!spineRaw.includes('0.1,'), 'spine.json must stay vector-free');
  assert.ok(fs.existsSync(path.join(dir, 'embeddings.json')));
  // reload round-trip keeps them searchable
  spine.init(dir);
  assert.equal(spine.itemsMissingEmbedding().length, 0);
});

test('mischief happenings render in the capsule summary', () => {
  spine.addHappening('mischief', 'went feral for a minute');
  assert.match(spine.capsule(), /feral/);
});

test('music happenings summarize by artist, deduped — never a track ledger', () => {
  spine.addHappening('music', 'Weird Fishes — Radiohead');
  spine.addHappening('music', 'Nude — Radiohead');
  spine.addHappening('music', 'Midnight City — M83');
  const capsule = spine.capsule();
  assert.match(capsule, /Radiohead, M83/);
  assert.ok(!capsule.includes('Weird Fishes'), 'track names stay out of the capsule');
});

test('music sense consent is off by default and persists across reloads', () => {
  assert.equal(spine.musicSense(), false, 'the duck never listens along uninvited');
  spine.setMusicSense(true);
  spine.init(dir); // reload round-trip
  assert.equal(spine.musicSense(), true);
});

test('latenight impulse keeps its own 20h gap — one nudge per night', () => {
  assert.equal(spine.canImpulse('latenight'), true);
  spine.recordImpulse('latenight');
  // hop past the 90-min all-kinds gap but stay inside the 20h same-kind gap
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'spine.json'), 'utf8'));
  raw.meta.impulses = [{ kind: 'latenight', at: Date.now() - 3 * 3600 * 1000 }];
  fs.writeFileSync(path.join(dir, 'spine.json'), JSON.stringify(raw));
  spine.init(dir);
  assert.equal(spine.canImpulse('latenight'), false, 'no second bedtime lecture tonight');
  assert.equal(spine.canImpulse('welcome'), true, 'other kinds are not blocked by it');
});

test('retrieval scoring: exact term hits and importance beat raw cosine', () => {
  spine.addFact('His brother Rohan lives in Austin', 'person', 9);
  spine.addFact('He drinks too much coffee', 'routine', 5);
  const all = spine.getAll();
  // hand-plant orthogonal-ish embeddings
  spine.setEmbedding('facts', all.facts[0].id, [1, 0, 0.2]);
  spine.setEmbedding('facts', all.facts[1].id, [0.9, 0.1, 0.1]);
  const hits = spine.searchByEmbedding([1, 0, 0.15], 2, 'tell me about Rohan');
  assert.equal(hits[0].text, 'His brother Rohan lives in Austin', 'term hit should win');
});

test('game scores accumulate and show up in the capsule', () => {
  spine.recordGameResult('trivia', 'duck');
  spine.recordGameResult('trivia', 'user');
  spine.recordGameResult('trivia', 'duck');
  const s = spine.getAll().game_scores.trivia;
  assert.equal(s.duck, 2);
  assert.equal(s.user, 1);
  assert.match(spine.capsule(), /trivia: you 2 — him 1/);
  assert.equal(spine.recordGameResult('trivia', 'nobody'), null);
});

test('fact edit re-embeds and capsule restraint rules are always present', () => {
  spine.addFact('He works at a bank', 'work', 7);
  const id = spine.getAll().facts[0].id;
  spine.setEmbedding('facts', id, [1, 2, 3]);
  assert.equal(spine.itemsMissingEmbedding().length, 0);
  spine.updateFact(id, 'He left the bank to found a startup');
  assert.equal(spine.itemsMissingEmbedding().length, 1, 'edit must clear stale embedding');
  assert.match(spine.capsule(), /MEMORY MANNERS/);
  assert.match(spine.capsule(), /ONE unprompted callback/);
});

test('getAll strips embeddings and exposes stage meta', () => {
  spine.addFact('secret vector carrier', 'general', 5);
  spine.setEmbedding('facts', spine.getAll().facts[0].id, [0.1, 0.2]);
  const all = spine.getAll();
  assert.equal(all.facts[0].embedding, undefined);
  assert.ok('stage' in all.meta && 'depth' in all.meta);
});

test('user name imprints once', () => {
  assert.equal(spine.userName(), null);
  spine.setUserName('Tanmaye');
  assert.equal(spine.userName(), 'Tanmaye');
});

test('a spine that has lived is never re-egged by migration', () => {
  // simulate a pre-hatching-arc install: facts exist, no firstRunAt/stage meta
  const legacy = {
    facts: [{ id: 'f1', statement: 'old friend', category: 'general', importance: 6, createdAt: new Date().toISOString(), invalidAt: null, lastSeen: new Date().toISOString() }],
    episodes: [], open_loops: [], relationship: [], happenings: [], meta: { lastConversationAt: new Date().toISOString() },
  };
  fs.writeFileSync(path.join(dir, 'spine.json'), JSON.stringify(legacy));
  spine.init(dir);
  assert.equal(spine.stage(), 'duckling', 'existing relationships must survive updates');
});

test('onboarding identity: chosen once, persists, defaults sane', () => {
  assert.equal(spine.identity().onboarded, false, 'fresh egg needs onboarding');
  spine.setIdentity('ninja', 'Shadowbeak');
  const id = spine.identity();
  assert.deepEqual(id, { onboarded: true, skin: 'ninja', duckName: 'Shadowbeak' });
  spine.init(dir); // reload round-trip
  assert.equal(spine.duckName(), 'Shadowbeak');
  assert.equal(spine.skin(), 'ninja');
});

test('existing hatched installs are auto-onboarded as classic — no picker ever', () => {
  const legacy = {
    facts: [{ id: 'f1', statement: 'old friend', category: 'general', importance: 6, createdAt: new Date().toISOString(), invalidAt: null, lastSeen: new Date().toISOString() }],
    episodes: [], open_loops: [], relationship: [], happenings: [], meta: { lastConversationAt: new Date().toISOString() },
  };
  fs.writeFileSync(path.join(dir, 'spine.json'), JSON.stringify(legacy));
  spine.init(dir);
  assert.equal(spine.identity().onboarded, true);
  assert.equal(spine.skin(), 'classic');
  assert.equal(spine.duckName(), 'Quackers');
});

test('setIdentity clamps garbage to safe defaults', () => {
  spine.setIdentity('', '   ');
  assert.equal(spine.skin(), 'classic');
  assert.equal(spine.duckName(), 'Quackers');
});

test('tricks: semantic store, re-teach replaces, fuzzy find, capsule listing', () => {
  const t = spine.addTrick({
    name: 'empty trash',
    goal: 'Empties the macOS trash',
    steps: [{ what: 'right-click the Trash icon in the Dock' }, { what: 'click Empty Trash in the menu', risky: true }],
    notes: 'trash icon is at the right end of the dock',
  });
  assert.equal(t.steps.length, 2);
  assert.equal(t.steps[1].risky, true);
  assert.ok(spine.findTrick('EMPTY TRASH'));
  assert.ok(spine.findTrick('hasty, empty trash'), 'fuzzy match within a spoken phrase');
  assert.equal(spine.findTrick('make coffee'), null);
  assert.match(spine.capsule(), /empty trash/);
  assert.match(spine.capsule(), /never performed yet/);

  spine.touchTrick(t.id);
  assert.match(spine.capsule(), /performed 1×/);

  // re-teaching replaces, keeps the perform count
  const t2 = spine.addTrick({ name: 'Empty Trash', goal: 'v2', steps: [{ what: 'one better step' }] });
  assert.equal(t2.id, t.id);
  assert.equal(t2.timesPerformed, 1);
  assert.equal(spine.getAll().tricks.length, 1);

  // garbage in → no trick
  assert.equal(spine.addTrick({ name: '  ', steps: [] }), null);
  assert.equal(spine.addTrick({ name: 'stepless', steps: [] }), null);
});

test('workshop refs: clamped, persisted, listed in the capsule', () => {
  spine.setWorkshopRefs([
    { id: 'w1', name: 'tic tac toe', kind: 'game', timesUsed: 3, broken: false },
    { id: 'w2', name: 'wizard hat', kind: 'prop', timesUsed: 0, broken: true },
  ]);
  spine.init(dir); // reload round-trip
  assert.equal(spine.workshopRefs().length, 2);
  const capsule = spine.capsule();
  assert.match(capsule, /YOUR WORKSHOP/);
  assert.match(capsule, /tic tac toe.*used 3×/);
  assert.match(capsule, /wizard hat.*broken — offer to rebuild/);
  assert.match(capsule, /NEVER build without his clear yes/);
  assert.equal(spine.getAll().workshop.length, 2);
});

test('workshop refs absent → no workshop section in capsule', () => {
  assert.ok(!spine.capsule().includes('YOUR WORKSHOP'));
});

test('equipped props persist across reloads and clamp to 4', () => {
  assert.deepEqual(spine.equippedProps(), []);
  spine.setEquippedProps(['a', 'b', 'c', 'd', 'e']);
  spine.init(dir);
  assert.deepEqual(spine.equippedProps(), ['a', 'b', 'c', 'd']);
});
