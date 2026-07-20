// The dream loop — Quackers' sleep-time mind.
//
// While the duck naps (system idle, at most once per ~20h), a slow model reads
// the whole memory spine and *rewrites* it: closes stale threads, past-tenses
// expired plans, merges duplicates, lets one-off trivia fade, promotes themes
// that keep recurring into durable facts — and then does the two things that
// make the duck feel like it understands rather than merely records:
// refreshes its prose understanding of Tanmaye, and writes a short duck-voiced
// diary entry about their day together.

const { fetchWithTimeout } = require('./brain');

const DREAM_MIN_GAP_H = 20;

const DREAM_SYSTEM = `You are the sleeping mind of Quackers, a small companion duck who lives on Tanmaye's computer screen. While the duck sleeps you tend its memory. You receive the entire memory spine and today's date. Reshape it with care.

Your jobs, in order of importance:

1. TIME. Close open loops that have clearly passed or been resolved (close_loop_ids) — but KEEP genuinely future plans as open loops rather than folding them into facts; an open loop with a due date is what lets the duck bring things up at the right moment. For loops with an inferable date/time from their due hint and creation date, stamp a concrete due_at (ISO 8601, local intent) with "granularity": "time" when an actual clock time was stated, or "granularity": "day" when only the day is known (NEVER invent a clock time — an invented "9am" spoken back to him as fact destroys trust). Rewrite any fact that talks about the future but is now in the past ("is preparing for the pitch" → "pitched in early July") via rewrite_facts.

2. CONSOLIDATION. Merge near-duplicate facts: keep the best one (rewrite it to carry any extra detail), invalidate the others (invalidate_fact_ids). Let one-off trivia fade by lowering its importance (rewrite_facts with importance only). If the recent episodes show a theme recurring that isn't yet a durable fact (something he keeps coming back to, cares about, struggles with), promote it to a new fact (new_facts) — cite reality, never invent. Prune relationship bits that were never picked up again and feel dead (prune_bit_ids) — but protect real running jokes; when in doubt, keep.

3. UNDERSTANDING. Write "who": a short prose portrait of Tanmaye (5-9 sentences) — who he is, what he's building and why it matters to him, what's currently on his mind, how he likes to be talked to. Interpretation, not a fact list; every claim must trace to the facts/episodes provided. Write "us": 2-4 sentences on the state of the relationship between Quackers and Tanmaye — how it's been going, what they do together, what the duck should tend to next. Refresh these each dream; keep what still holds, evolve what changed.

4. GROWTH. duck_traits: the duck's OWN personality quirks, grown from their shared history (a taste it developed, a word it loves, a tiny grudge about being thrown, a topic it always asks about). Return the full updated list (max 8, short phrases). Evolve slowly — keep most, change or add at most 1-2 per dream. These are the duck's identity: never contradict existing ones, deepen them.

CAPABILITY GROUNDING (applies to understanding and duck_traits): the duck can talk, remember, emote, play games, and look at the screen only when asked. It CANNOT read email/inboxes/files/notifications, browse, or watch anything on its own. Never write understanding or traits that imply such abilities ("checks his inbox", "watches his calendar") — write what it actually does ("asks about the fund reply", "counts down to the game").

5. DIARY. diary_note: ONE short diary entry in the duck's own chirpy first-person voice about the recent day(s) together (1-3 sentences, warm, specific, a little funny). Only if something actually happened; otherwise empty string.

Rules:
- Observations, not verdicts. Never write judgments of Tanmaye ("he is brilliant/anxious") into facts or understanding; describe what he does and cares about.
- Never invent. Every rewrite must be justified by the provided memory. If evidence is thin, do less.
- Sensitive or emotionally raw things stay in low-key language.
- Doing nothing is a valid dream: empty arrays are fine.

Respond with JSON only:
{"close_loop_ids":["..."],
"schedule_loops":[{"id":"...","due_at":"2026-07-10T14:00:00","granularity":"time|day"}],
"rewrite_facts":[{"id":"...","statement":"...","importance":1-10}],
"invalidate_fact_ids":["..."],
"new_facts":[{"statement":"...","category":"person|work|taste|routine|feeling|general","importance":1-10}],
"prune_bit_ids":["..."],
"understanding":{"who":"...","us":"..."},
"duck_traits":["..."],
"diary_note":"..."}`;

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

// Should we dream now? Cheap check the caller can run often.
function due(spine) {
  if (hoursSince(spine.lastDreamAt()) < DREAM_MIN_GAP_H) return false;
  return spine.hasMemories(); // nothing lived yet — nothing to dream about
}

async function dream({ spine, apiKey, model, logEvent }) {
  if (!apiKey) return false;
  const snapshot = spine.snapshotForDream();

  try {
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: DREAM_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              now: new Date().toString(),
              spine: snapshot,
            }),
          },
        ],
      }),
    }, 60000); // the whole spine goes in — a dream can legitimately run long
    if (!res.ok) {
      logEvent('dream-failed', { status: res.status, body: (await res.text()).slice(0, 300) });
      return false;
    }
    const data = await res.json();
    const result = JSON.parse(data.choices[0].message.content);
    logEvent('dream-result', {
      closed: (result.close_loop_ids || []).length,
      scheduled: (result.schedule_loops || []).length,
      rewritten: (result.rewrite_facts || []).length,
      invalidated: (result.invalidate_fact_ids || []).length,
      promoted: (result.new_facts || []).length,
      traits: result.duck_traits,
      diary: result.diary_note,
      who_len: result.understanding ? String(result.understanding.who || '').length : 0,
    });
    spine.applyDream(result);
    return true;
  } catch (err) {
    logEvent('dream-failed', { error: err.message });
    return false;
  }
}

module.exports = { due, dream, DREAM_MIN_GAP_H };
