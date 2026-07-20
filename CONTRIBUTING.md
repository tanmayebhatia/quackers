# Contributing to Quackers

Thanks for wanting to poke at the duck. It's a small, hand-rolled codebase with
no framework and no build step — easy to jump into.

## Run it from source

```bash
npm install
npm start
```

macOS only (it leans on macOS-specific pieces — the menu-bar item, `lsappinfo`
sensing, System Events). For voice and memory you need your own OpenAI API key
in a `.env` at the repo root (`OPENAI_API_KEY=sk-...`); everything visual works
without one. See the [README](README.md) for the full picture.

## Run the tests

```bash
npm test
```

Unit tests live in `test/`. Conversation behavior is exercised separately by the
**duck lab** (`tools/duck-lab.js`, see [docs/duck-lab.md](docs/duck-lab.md)),
which drives the real `src/brain.js` over text scenarios in `tools/scenarios/`
— run it when you touch prompts, tools, memory, or digestion.

## The shape of the code

- `src/main.js` — Electron main process: windows, tray, IPC, the impulse engine,
  screen capture, the coding-buddy server.
- `src/renderer/pet.js` — the duck's body: a hand-rolled pixel-art state machine.
- `src/renderer/voice.js` — the live voice session (WebRTC to a realtime model).
- `src/brain.js` — the persona, tools, and the digest/dream prompts (shared
  verbatim by the app and the lab, so what's tested is what ships).
- `src/spine.js` — the local memory store. `src/dream.js` — sleep-time
  consolidation. `src/senses.js` — permission-free ambient sensing.
- `src/workshop.js` / `src/tricks.js` — runtime codegen and taught computer-use.

Deeper internals: [engine design](docs/engine-design.md) ·
[the workshop](docs/workshop-design.md) · [coding buddy](docs/coding-buddy.md).

## What makes a good change

- **Match the surrounding code** — its naming, its comment density, its voice.
  The comments explain *why*, not *what*; keep that.
- **Keep the duck a companion, not an assistant.** The whole point is presence,
  memory, and play — not being a task-doer. Features that make it more useful at
  *tasks* usually cut against the grain; features that make it feel more *alive*
  or more *yours* are the heart of it.
- **Respect the sacred rules**: never break memory/personality continuity, never
  exceed the proactivity caps, store observations not judgments, and never let
  the duck look at the screen unless explicitly asked.
- Run `npm test` before opening a PR; add a test if you're changing memory,
  prompts, or the impulse rules.

## Opening a PR

Small, focused PRs are easiest to review. Describe what changed and why, and if
it's a behavior change, a quick note on how you checked it (a lab scenario, a
manual run). Issues and ideas welcome too — open one before a large change so we
can talk shape first.
