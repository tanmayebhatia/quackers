# Quackers 🥚

An egg falls onto your screen. If you're kind to it, it hatches.

What comes out is a little pixel duck that lives *on* your screen — not in a
window. It waddles along the top of your dock, naps, trips over nothing,
plays games with you, and — because ducklings imprint on the first thing they
see — it imprints on **you**. It learns your name, your people, your projects,
your running jokes, and it never forgets who you are to each other.

Everything underneath stays clickable; Quackers only grabs your mouse when
your cursor is actually on it.

**[helloquackers.com](https://helloquackers.com)** · macOS · bring your own OpenAI key

## Requirements

- **macOS.** It leans on macOS-only pieces — the menu-bar duck, permission-free
  `lsappinfo` sensing, System Events for tricks. Apple Silicon or Intel.
- **Node 18+** and npm, to run from source.
- An **OpenAI API key** for voice and memory (yours, stored only on your Mac).
  Everything *visual* — the duck, hatching, petting, games, mischief — works
  without one; the key is what gives it a voice and a memory.

## Run it

Run from source (macOS, Node 18+):

```bash
git clone https://github.com/tanmayebhatia/quackers.git
cd quackers
npm install
npm start
```

First run only: a small window asks you to **pick your Quacker** — eleven of
them (classic, ninja, princess, wizard, pirate, astronaut, robot, cowboy,
vampire, detective, chef) — and name it. Press Enter, and an egg drops onto
your screen. Pet it (click it) and see what happens. The outfit isn't just
pixels: a ninja duck speaks softly of stealth and honor; a detective duck
treats every missing crumb as a case.

You choose once. Every run after that, your duck is just… there.

Quit from the little duck in your menu bar.

## Give it a voice

Quackers talks through your own OpenAI API key, stored only on your Mac.
The duck will bring it up itself after hatching — or use the little duck in
your menu bar → **"Give Quackers a voice…"**, or drop a `.env` at the repo root:

```
OPENAI_API_KEY=sk-...
```

Then press **⌃⇧T** (or double-click the duck) to talk. It listens (green dot),
speaks with a flapping beak, and emotes with its whole body.

It will only look at your screen when you explicitly ask it to — and when it
looks, you *see* it look: the duck visibly peers around, eyes wide. Never
silently, never on its own.

## Interactions

- **⌃⇧T** or **double-click** — start / end a voice conversation
- **⌃⇧Q** — summon or dismiss it (poofs out, drops back in)
- **⌃⇧C** — **clip that!** saves the last ~15 seconds of duck to your Desktop
- **Click** — pet it (it likes this; eggs like it even more)
- **Right-click** — toss it a crumb (it runs over and eats it)
- **Drag / throw** — pick it up (it does not like this); physics happen

## Games (it keeps score, forever)

Ask it to play, in a conversation:

- **Chase** — it flees your cursor for 35 seconds; leaps over you when cornered
- **Guard the secret** — it picks a secret word and you have three minutes to
  trick it out. It desperately wants to talk about the word. That's the game.
- **Trivia, 20 questions, story-building** — all voice-native
- All-time scores live in its memory. It is a gracious loser and an
  insufferable winner.
- **Mischief** — tell it to go wild and it goes feral over your whole screen
  for a minute: footprints, crayon doodles, crimes. Clip it (⌃⇧C).

## Tricks (teach it to use your computer)

Show it a workflow once — narrating as you click — and it learns the *shape* of
it, not your pixels ("open Trash, empty it"). Ask for it later and the duck
flies its little body to each spot on screen and does it, narrating with
showmanship and pausing to ask before anything risky. Grab the mouse mid-trick
and it stops instantly — your hands always win.

Teaching is consented watching; performing needs macOS Accessibility permission
(the little duck in your menu bar has a **"Give it hands…"** button). It never
performs a trick you didn't just ask for.

## The workshop (it builds things)

Ask it to play something it doesn't have — tic tac toe, dots and boxes,
anything tap-sized — and it offers to **build it**: "I can't right now… but I
could build it for us. Want me to?" Say yes and it heads to a little workbench
and hammers for a minute; then a crayon board appears next to it and you play.
It keeps everything it builds, forever — next time it's "still got our board!"
Scores live in its memory like every other game.

It also makes **props** for itself on request — a wizard hat, a tiny
skateboard — and wears them until you say otherwise.

It never builds anything you didn't say yes to. Generated code runs in a
locked sandbox that can only draw crayon shapes on the board — no network, no
files, no screen.

## How it remembers you (the actual point)

Quackers has a two-speed mind:

- **Live**, it talks with a realtime voice model that's handed a compact
  "capsule": a prose understanding of who you are, where things stand between
  you, threads to pick up, your running bits, and the all-time scores.
- **While it sleeps**, a slower model *dreams*: it closes stale threads,
  merges duplicate memories, promotes recurring themes, rewrites its
  understanding of you, grows the duck's own personality quirks out of your
  shared history, and writes a diary entry about your day together.

Memory manners are hard rules: at most one unprompted callback per
conversation, observations instead of judgments, and nothing sensitive quoted
back verbatim. Being remembered is magic; being monitored is creepy.

**Everything is visible and editable**: menu bar → *"What Quackers
remembers…"* shows every fact (fix or forget any of them), its understanding
of you, its diary, and the scoreboard. It's all one local JSON file. Nothing
leaves your machine except inside prompts to the APIs.

## Ambient sense (no permissions, no peeking)

Without ever reading your screen, the duck senses the shape of your day:
which app is frontmost, how long you've been heads-down, battery, idle. It
naps when you leave, greets you when you're back (sometimes with treasure),
tells you to blink after two hours of Figma — and goes **completely silent
when Do Not Disturb is on**. Proactive moments are hard-capped at four a day,
90 minutes apart.

## Coding buddy

Quackers listens on `127.0.0.1:42990` so your dev tools can poke it — hook it
to Claude Code and the duck celebrates when your runs finish (and droops when
tests go red). See [docs/coding-buddy.md](docs/coding-buddy.md).

## How it's built

A hand-rolled pixel engine (no game framework), a realtime voice "mouth," and a
slower background "mind" for memory — all in ~5k lines of plain JS on Electron,
no build step. If you want the internals:
[engine design](docs/engine-design.md) ·
[the workshop](docs/workshop-design.md) ·
[coding buddy](docs/coding-buddy.md) ·
[conversation lab](docs/duck-lab.md).

## Roadmap

- [x] A creature that exists on your screen
- [x] Voice conversation + memory spine (bring your own API key)
- [x] Hatching arc — starts as an egg, imprints on you
- [x] Dream loop — sleep-time memory consolidation + understanding + diary
- [x] Games with permanent scores, mischief mode, clip-that
- [x] Tricks — teach it a workflow by demonstration, it performs it live
- [x] The workshop — it builds little games and props on request
- [x] Ambient senses (tier-0, permission-free) + capped proactivity
- [ ] Growth stages deepening over weeks (fledgling → companion voices)
- [ ] Friends' ducks visiting your screen

## License

MIT
