# The Workshop — Quackers builds things

*Design, July 11 2026. Approved direction: this is the breakthrough feature.
Quackers can build games, visualizations, writing surfaces, and props on
request — visibly, in character, and it keeps everything it makes.*

## Thesis

Runtime code synthesis shaped as a **companionship feature, not a code
interpreter**. Three rules make the difference:

1. **Companion-led.** The duck never builds unprompted. "Can we play tic tac
   toe?" → *"I can't right now… but I could build it for us. Want me to?"* →
   explicit yes → build. Same philosophy as command-only screen looks: consent
   turned into character.
2. **Generate once, keep forever.** Artifacts persist in the duck's workshop.
   Next time: *"still got our board!"* → instant. It can revise ("make the X's
   wear hats"). The workshop grows out of shared history — that's the
   companionship-intelligence thesis applied to code execution.
3. **The illusion is load-bearing.** Nothing the model generates may look like
   alien UI on the user's screen. Style lives in the runtime shim, not in
   generated code (see Stage API).

Out of scope for v1: generated **body behaviors** (skateboarding around the
screen etc.) — needs hooks into pet.js's state machine; deferred.

## Architecture

### workshop.js (main process)

New module `src/workshop.js`, sibling of `tricks.js`. Owns:

- **Build requests.** Prompts the codegen model with the Stage API doc + hard
  design rules, receives one self-contained artifact program, validates it
  (parse check + banned-token scan: no `fetch`, `XMLHttpRequest`, `import`,
  `eval`, `parent`, `top`, `document.cookie`…), smoke-tests it headlessly, then
  stores + reveals.
- **Storage.** `userData/workshop/<id>.json`, one file per artifact:
  `{id, name, kind: game|viz|writing|prop, description, code | pixelSpec,
  version, builtAt, timesUsed, lastState}`. The spine gets only lightweight
  refs (name, kind, use counts) via a new `spine.workshop` section — capsule
  can say "things we've built together" without bloating `spine.json` (same
  pattern as the embeddings sidecar).
- **Repair loop.** If the smoke test throws, one silent repair round (error →
  model → patched code). If it fails again, the duck fails charmingly ("…the
  roof fell off. I'll try again after I sleep") and the dream loop may retry
  overnight. Designed imperfection, not a stack trace.

### Model upgrade (everywhere)

Codegen uses **gpt-5.5**, and the whole background brain upgrades with it:

| constant | file | now | becomes |
|---|---|---|---|
| `DIGEST_MODEL` | src/brain.js | gpt-5 | gpt-5.5 |
| `REASON_MODEL` | src/brain.js | gpt-5 | gpt-5.5 |
| `DREAM_MODEL` | src/brain.js | gpt-5 | gpt-5.5 |
| `ACT_MODEL` | src/tricks.js | gpt-5 | gpt-5.5 |
| `BUILD_MODEL` | src/workshop.js (new) | — | gpt-5.5 |

Lab mouth stays `gpt-5-mini` (rough mouth = good stress test).

## The Stage (sandbox + illusion)

Generated code runs in a **sandboxed iframe** inside the overlay renderer:
`sandbox="allow-scripts"` (no `allow-same-origin`), CSP with no network, no
external resources. It renders as a bounded board that appears in the duck's
world next to it. The artifact's entire universe is a postMessage shim.

**Style lives in the shim.** The Stage API exposes only pre-styled duck-native
primitives — there is no `innerHTML`, no CSS access, no arbitrary DOM. Whatever
the model draws comes out in the same crayon-and-pixel hand as mischief mode.
Flexibility comes from the logic space (any game, viz, or writing surface),
never the visual space.

### Stage API (v1 surface)

- `crayonLine(x1,y1,x2,y2, color?)` / `crayonRect` / `crayonCircle` — jittered
  hand-drawn strokes, fixed crayon palette (mischief-mode colors)
- `crayonText(x,y,text,size?)` — the duck's hand-lettering font
- `sticker(x,y,name)` — small pixel stamps (duck, egg, star, heart, X, O…)
- `grid(cols,rows)` → tappable cells with `onTap(cell => …)`
- `onTap(x,y => …)` — pointer input within the board only
- `say(line)` — proxied to the duck (bubble / voice-session event), so the
  artifact talks *through* the character; throttled
- `state` — JSON persisted per artifact (`lastState`); running scores survive
  across sessions and feed `spine.game_scores` via a `reportScore(result)` call
- `done(summary?)` — closes the stage, returns a summary for digestion

The generation prompt ships this API doc plus hard rules (board size bounds,
palette, no flashing, must be playable with taps + duck speech only).

## Companion-led flow (voice tools)

New tools in brain.js/voice.js, kept few:

- `check_workshop(name)` → `{exists, id?, kind?, timesUsed?}` — the mouth uses
  this to answer honestly: offer to build, or offer to reopen.
- `build_artifact(name, kind, description)` — only after an explicit yes.
  Emits build-progress events the mouth narrates.
- `run_artifact(id)` / `close_artifact()`
- `equip_prop(id)` / `unequip_prop(slot)` / `list_workshop()`

**Invariant (tested):** `build_artifact` without a preceding `check_workshop`
miss + user consent in the same session is refused by the tool handler — the
consent gate is enforced in code, not just prompt.

## The build performance (latency → theater)

20–45s of codegen becomes on-screen character animation in pet.js, by kind:

- **game / product** → workbench appears; duck hammers; sparks + sawdust
- **viz / design** → beret + easel; duck steps back and squints at it
- **writing** → tiny typewriter; crumpled-paper particles

The duck narrates while building ("the O's keep falling over"). Smoke test
passes → ta-da reveal (confetti reuse). Fail-after-repair → charming failure
line + open loop recorded so it can bring it up after the dream retry.

## Props (data, not code)

Props are pixel specs, not programs: the model generates a small pixel grid in
the duck palette + an anchor (`head`, `back`, `feet`) + per-pose offsets where
needed. The renderer composites them over the sprite exactly like skin
accessory layers in `src/renderer/skins.js`. Equip/dequip via voice tools;
current outfit stored in spine identity so it survives restarts. Same consent
flow, `designing` animation, ta-da.

## Testing

- **Unit tests** (extend `test/`): artifact storage round-trip, banned-token
  validation, consent-gate invariant, equip/dequip identity persistence,
  spine.workshop refs stay embedding-free and small.
- **Duck-lab scenarios** (`tools/scenarios/`): ask → offer → consent → build →
  play; ask for existing artifact → instant reopen; refusal path (user says
  no); revision request.
- **workshop-lab** (`tools/workshop-lab.js`): batch-generates a fixed artifact
  set ("tic tac toe", "pong", "dots and boxes", "a mood chart of my week",
  "a wizard hat", "a tiny skateboard prop") and smoke-tests headlessly →
  one-shot success rate. Run before filming anything.

## Launch tie-in

Video 1's tic tac toe beat is built *through* the workshop — the clip becomes
"I asked my duck for tic tac toe and it BUILT it," and the build theater (0:11
"watch this" slot or its own follow-up clip) is itself a shareable moment.
Pre-validate the exact demo artifacts with workshop-lab before recording.

## Sacred rules (inherited + new)

1. Never build unprompted — consent gate enforced in the tool handler.
2. Nothing on screen may break the crayon/pixel illusion — style in the shim.
3. Generated code gets no network, no DOM, no IPC — the Stage API is the world.
4. Never lose a built artifact in an update — the workshop is memory too
   (continuity is sacred).
