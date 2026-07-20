# Quackers Engine Design — Voice, Memory, Senses, Impulse

*July 2026. Research-grounded design for the companion intelligence. The goal, verbatim from the founder: "It's not to be omniscient. It's to remember me, things I like, be able to do things that I want — as a companion, not an omniscient friend."*

## The core architecture: two brains, one duck

The single most important design decision, and it matches the founder's instinct that "some of these things can actually be computed prior to calling": **split the intelligence into a fast mouth and a slow soul.**

- **The Mouth (live, fast, cheap):** OpenAI `gpt-realtime-2.1-mini` speech-to-speech session. Handles the actual conversation — ~300ms responses, native barge-in, tool calls that drive the duck's animations. It knows Tanmaye because it's *handed* a precomputed context capsule at session start; it does almost no thinking of its own.
- **The Soul (background, slow, smart):** Claude. Runs when the duck is idle or asleep — digests conversation transcripts into memories, reflects nightly, plans proactive moments, and compiles the context capsule the Mouth will use. This is the moat and where the personality actually lives.

This is a validated, shipped pattern, not an invention: Letta calls it *sleep-time compute* ("cheap fast model live, expensive slow model in background"); Zep productized the capsule as their *Context Block*; Tolan (the best-regarded voice companion of 2025-26) runs almost exactly this stack.

```
                 ┌──────────────────────────────────────────────┐
                 │ THE SOUL (Claude, background)                │
                 │  digester → memory spine → reflector         │
                 │  capsule builder → impulse planner           │
                 └───────┬──────────────────────────▲───────────┘
        context capsule  │                          │ transcripts,
        + daily brief    ▼                          │ events
                 ┌──────────────────────────────────┴───────────┐
                 │ THE MOUTH (gpt-realtime-2.1-mini, live)      │
                 │  voice in/out · animation tool calls ·       │
                 │  on-demand screen frames                     │
                 └───────▲──────────────────────────┬───────────┘
                         │                          │
                 ┌───────┴───────┐          ┌───────▼────────┐
                 │ THE SENSES    │          │ THE BODY       │
                 │ ambient tier +│          │ pixel duck,    │
                 │ screen glances│          │ bubbles, emotes│
                 └───────────────┘          └────────────────┘
```

---

## 1. The Mouth — voice layer

**Model: `gpt-realtime-2.1-mini`** (released July 6, 2026), WebRTC from the Electron renderer, ephemeral session keys minted in the main process so the user's OpenAI key never touches the renderer.

Why this over the alternatives (researched July 2026):

| Option | Verdict |
|---|---|
| `gpt-realtime-2.1-mini` | **Winner.** ~$0.03/min blended (~$0.05 real-world with caching), ~300ms, native barge-in + semantic VAD, tool calling, and — uniquely at this price — **image input mid-session**, so the duck can literally look at the screen while talking. One-line upgrade to full 2.1 if personality feels thin. |
| Full `gpt-realtime-2.1` | Upgrade path (~3× cost). Try mini first; 2.1's instruction-following is strong on both. |
| Gemini 3.1 Flash Live | Cheapest ($0.023/min, free tier) — use its free tier for dev iteration; preview status + weaker persona-stickiness makes it second choice for prod. |
| Hume EVI 4-mini | The "duck notices you sound stressed" option (emotion-aware, describable custom voices). Revisit if emotional attunement becomes the killer feature. |
| STT→Claude→TTS pipeline | 2× cost, +200-400ms latency, and we own barge-in plumbing. Only worth it if a cloned duck voice or Claude-authored live personality becomes non-negotiable. Claude still authors the personality — just offline, via the capsule. |

**Session mechanics:**
- Voice: `cedar` or `marin` (the two Realtime-tier voices). No cloning exists on any S2S API — the duck's character lives entirely in `instructions`, which 2.1 follows strictly.
- Turn detection: `semantic_vad` with `eagerness: "low"` — waits for completed thoughts, reads as politeness. Push-to-talk mode (`turn_detection: null`) as the default first shipped mode: hold ⌥ Space (or tap the duck) to talk.
- `reasoning_effort: "low"` — charm, not chain-of-thought.
- `retention_ratio: 0.8` so prompt caching survives long sessions (cached audio input is a 98.75% discount; caching is the difference between $0.46/min and $0.05/min).
- Session cap is 60 min; sessions end when the user goes quiet — the duck yawns and the transcript goes to the digester.
- **Animation bridge:** expose tool functions to the Realtime session — `emote(happy|sleepy|dance|preen|jump)`, `speak_bubble(text)`, `look_at_screen()`. The model calling `emote("dance")` mid-sentence is what makes the duck feel alive rather than dubbed.

**The Electron echo trap (known, planned for):** Electron's `echoCancellation` is broken (electron#47043, closed not-planned) — an unmitigated duck hears itself through the speakers and argues with itself. Mitigation: hard-mute the mic track (`track.enabled = false`) while the duck's audio is playing; interrupt via click/hotkey instead of acoustic barge-in in v1. Push-to-talk mode sidesteps it entirely, which is another reason it ships first.

---

## 2. The Soul — memory spine

**Storage: local SQLite** (`better-sqlite3`), local-first and private. No memory leaves the machine except inside prompts to the APIs. Embeddings for retrieval (small OpenAI embedding model), but the primary access path is the capsule, not live RAG.

**Memory types** (the schema practitioners converge on — CoALA split + companion-specific additions):

| Table | Contents | Example |
|---|---|---|
| `facts` (semantic) | `statement, category(person/work/taste/routine/health), confidence, importance(1-10), source_episode, created_at, valid_from, invalid_at, last_referenced` | "Tanmaye is building a companion-device startup" |
| `episodes` (episodic) | `date, summary, emotional_tone, salient_quotes, raw_transcript_ref` | "Tues: long talk about the pitch; he was nervous" |
| `open_loops` | `description, due_hint, status, source` | "wants to catch the World Cup game Thursday 2pm" |
| `relationship` (procedural) | interaction rules + running bits, hand-protected from auto-pruning | "our bit: I call his cat 'the landlord'"; "don't ask about work before coffee" |
| `entities` | named people/pets/projects + relationships | "Rohan — brother, in Austin" |
| `self` | what Quackers can and can't do | prevents false capability claims (Dot's #1 user complaint) |

Design rules stolen from the field:
- **Bitemporal validity, not deletion** — "job hunting" gets `invalid_at` stamped when he gets the job. Stale-facts-as-current is a top companion failure.
- **Extract, don't compress-in-place.** Raw episode summaries are kept; over-summarization is how Replika earned its memory reputation.
- **Write path = Mem0's ADD/UPDATE/DELETE/NOOP:** each candidate fact is checked against similar existing memories and reconciled by the LLM, with contradictions surfaced rather than silently resolved.
- **Retrieval scoring = recency × importance × relevance** (Stanford generative-agents formula). Inject 3 highly relevant memories, not 10 marginal ones.
- **Inside jokes are first-class** (`relationship` table) because generic importance-scorers classify jokes as low-value and drop them — and callbacks to running bits are precisely what users cite as the moat (Nomi's ~92% recall is its whole reputation).
- **User-visible memory dashboard from day one** — "What Quackers remembers about you," with edit/delete. Every serious companion product converged on this; deletion propagates to summaries too.

**The digestion loop (Claude, background):**
1. **Post-session digest** (minutes after a conversation ends): transcript → candidate facts + episode summary + open loops + emotional tone → reconcile into the spine.
2. **Nightly reflection**: "given recent memories, what higher-level insights emerge?" → stored as insight memories pointing at evidence. Plus dedupe (embedding clustering), contradiction resolution, tiered expiry (core facts never; casual context ~30 days unless referenced 3+).
3. **Weekly reorganization**, monthly rollups. Don't over-consolidate — granularity is the product.

---

## 3. The Capsule — precomputed intelligence

The founder's key insight, made concrete. Built by Claude **before** any live call, so the Mouth is fast and personal with zero live retrieval in the common case:

```
CAPSULE (≈1,500-2,500 tokens, compiled at session start; daily brief at ~9am)
├─ Persona card         (who Quackers is — voice, never-dos, current mood)
├─ User summary         (who Tanmaye is, freshly re-written weekly)
├─ Today                (open loops due soon: "World Cup game at 2 — bring it
│                        up if he's around"; calendar-shaped hints)
├─ Recent thread        (last episode summary: "yesterday he was nervous
│                        about the pitch — ask how it went")
├─ Running bits         (inside jokes, rituals, greeting style)
├─ Conversation seeds   (2-3 planned, from reflection: things he likes
│                        talking about, stories he enjoys)
└─ Ambient now          (frontmost app, now playing, focus state, time of day)
```

Injected as Realtime `instructions` at session create; refreshed mid-session via `session.update`; one-off context (a screen frame, a deep-memory lookup) via `conversation.item.create`. A `recall_memory(query)` tool on the session covers the rare deep-recall question the capsule missed (Tolan's hybrid).

Persona entries are written **as memories, not rules** — "Quackers is weirdly good at trivia but always brings it back to you" outperforms "Never act like an assistant." The "capital of Peru" test resolves in-character: *"Lima! Why — are we going?"* — knows things, is never an assistant about it.

---

## 4. The Senses — screen and ambient awareness

Three tiers, each behind its own explicit opt-in. The privacy research verdict is unambiguous: **concealment is the sin** (Cluely), **opt-in is non-negotiable** (Microsoft Recall), **local-first + nothing stored is the trust story** (Rewind).

**Tier 0 — Ambient (no macOS permissions at all).** Frontmost app name via `get-windows` with `screenRecordingPermission: false`; now-playing track via `mediaremote-adapter`; Focus/DND state; idle time; dark mode; battery. This alone fuels 80% of ambient charm ("Tame Impala again?" / duck falls asleep when you've been idle / **duck goes silent when DND is on** — the highest-ROI signal there is).

**Tier 1 — Glances (opt-in Screen Recording permission).** Window titles + one screenshot per ~45-60s, downscaled to ~1344px, described by a Claude vision call, description appended to the ambient context stream. Costs well under $1/day. Guards:
- Tier 0's frontmost-bundle-ID check runs **before** every capture — default-deny list (1Password, banking, private windows, System Settings) means the frame is never taken, not taken-and-discarded.
- Frames are sent, described, and **discarded** — no local screenshot archive, nothing to breach.
- The duck's **eyes visibly open/close** with capture state, mirroring the macOS purple indicator instead of fighting it (a one-shot capture blips the purple menu-bar dot every time; Sequoia also re-prompts monthly — the UX must make both unsurprising). One click on the duck's eyes = pause (1h / today / while this app).
- The duck's own overlay is excluded from captures (`setContentProtection(true)` toggled around each grab in v1; a native `SCContentFilter` exclusion later so the duck stays visible in the user's own Zoom shares).
- A "why did you say that?" affordance shows the last context sent.

**Tier 2 — Live look (during voice).** On "look at this" or the `look_at_screen()` tool call, grab + downscale a frame and inject it into the open Realtime session as an `input_image` item (~1-2K tokens, ~$0.005, +300-800ms on that turn). This is the demo moment: *talking to the duck about what's on your screen, live.*

---

## 5. The Impulse — proactivity engine

What the research says users love vs. hate, encoded as rules:

**Triggers (planned by the Soul, mostly precomputed into a daily schedule):**
1. **Open-loop follow-ups** — stored fact + time: "the game you wanted to catch starts in 20." The single most-loved proactive pattern.
2. **Learned-time check-ins** — end-of-day reflection at whenever he actually winds down (learned, not configured).
3. **Callbacks of delight** — unprompted reference to a running bit. Sparingly; this is seasoning.
4. **Ambient riffs** — reaction to tier-0/1 signals ("you've been in Figma for three hours, blink").

**Governance (non-negotiable — every failed companion failed here):**
- **Hard caps:** max ~4 proactive moments/day, minimum 90-minute gap. Dot's #1 monitored complaint was frequency; Friend pendant's context-poor pings made it a punchline.
- **Escalation ladder:** animation (duck gets excited) → speech bubble → voice, only if the user engages with the earlier stage. The duck never speaks aloud uninvited in v1.
- **Quiet rules:** DND/Focus = total silence; meetings (mic in use) = silence; learned quiet hours.
- **"Not now" is remembered** and shifts future timing — the system treats dismissals as training signal, ElliQ-style graduated initiative.

---

## 6. Costs, keys, models

- **Two API keys needed:** OpenAI (Realtime voice) + Anthropic (the Soul). Both stored in macOS Keychain via the main process, never in the renderer, never in the repo.
- **Voice:** ~$0.03-0.05/min real-world on mini with caching. An hour of conversation a day ≈ $2-3/day worst case, typically far less.
- **Soul:** digestion + nightly reflection is pennies/day (Claude Opus 4.8, `claude-opus-4-8`, for reflection/capsule quality; the ambient screen-glance describer can run Haiku 4.5 for cost — glances are high-frequency and low-stakes).
- **Realistic total:** $10-30/month for a heavy user — which is exactly what validates the ~$15/month subscription framing for the hardware product.

## 7. Build order

1. **Voice MVP** — push-to-talk session, static persona capsule v0 (hand-written + a simple facts file), animation tool bridge, mic-mute-while-speaking. *The "whoa" demo.*
2. **Memory spine** — SQLite schema, post-session digester, memory dashboard window.
3. **Capsule + daily brief + open loops** — precompute pipeline; proactivity v1 (bubbles only, hard caps).
4. **Senses tier 0** — ambient context into the capsule; DND silence.
5. **Semantic VAD mode + senses tier 1/2** — hands-free conversation; opt-in glances; live look.

Each step is independently shippable and demoable — which keeps the build-in-public cadence alive.

## Decision log

- **2026-07-09 (build):** Shipped in one pass, re-derived from the research rather than this doc's build order: hatching/imprinting first-run (moment-one virality), dream loop (sleep-time consolidation → understanding prose + duck diary + duck-grown traits), scored retrieval (relevance + recency + importance + exact-term boost), user_state hypothesis, memory-manners restraint rules, tier-0 ambient senses (frontmost app/DND/battery/idle — reversing this doc's "deferred" call; the research says contingent responsiveness is the #1 attachment lever), games with permanent scores, mischief mode, clip-that (⌃⇧C), coding-buddy endpoint (127.0.0.1:42990), keyless-graceful onboarding ("give Quackers a voice"). Look-at-screen now always plays a visible peering animation — the privacy line as character.

- **2026-07-09 (Tanmaye):** All-OpenAI stack — the Soul's digestion/reflection/capsule jobs run on OpenAI text models too, so one API key covers everything. Claude-as-Soul stays in this doc as a swappable upgrade if personality writing needs it.
- **2026-07-09 (Tanmaye):** Screen awareness is **command-only**. No ambient tier-1 glances; the duck looks only when explicitly told ("look at my screen / this app") and follows the cursor only when asked. Tier-0 ambient signals (frontmost app, DND) remain optional future work.
- **2026-07-11 (Tanmaye):** The Workshop — companion-led runtime codegen (gpt-5.5) on a sandboxed crayon stage; the consent gate (check_workshop before build_artifact, explicit yes) is enforced in the tool handler, not the prompt; artifacts persist in userData/workshop with lightweight spine refs; props are pixel specs worn like skin accessories. Background brain upgraded to gpt-5.5 across the board. See docs/workshop-design.md.

## Open questions (deliberately deferred)

- Hatching arc mechanics: hatch as a function of relationship depth (facts learned, sessions held) — design when memory spine exists.
- What's open-sourced vs. private: the overlay + voice plumbing stay MIT; the Soul's prompts, capsule builder, and personality corpus stay private (they're the moat).
- Whether ambient glance descriptions should also feed proactive triggers (privacy-sensitive; decide after tier-1 ships).
