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
- **Node 22.12+** and npm, to run from source.
- An **OpenAI API key** for voice and memory (yours, encrypted with macOS
  secure storage when entered in the app).
  Everything *visual* — the duck, hatching, petting, games, mischief — works
  without one; the key is what gives it a voice and a memory.

## Run it

Run from source (macOS, Node 22.12+):

```bash
git clone https://github.com/tanmayebhatia/quackers.git
cd quackers
npm install
npm start
```

First run only: a small window asks you to **pick your Quacker** — eleven of
them (classic, ninja, princess, wizard, pirate, astronaut, robot, cowboy,
vampire, detective, chef) — then asks for the duck's name and yours. Both names
stay in the local profile. Press Enter, and an egg drops onto
your screen. Pet it (click it) and see what happens. The outfit isn't just
pixels: a ninja duck speaks softly of stealth and honor; a detective duck
treats every missing crumb as a case.

You choose once. Every run after that, your duck is just… there.

Quit from the little duck in your menu bar.

## Give it a voice

Quackers talks through your own OpenAI API key, encrypted with Electron's
macOS secure storage.
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
could build it for us. Want me to?" Say yes and it heads to a little workbench,
unrolls the right blueprint, and visibly hammers, draws, or writes the thing;
then it presents the finished crayon board with a springy little reveal.
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
  understanding of you, and grows the duck's own personality quirks. It also
  prepares one bounded **overnight mind**: a tentative emotional read, a
  worthwhile curiosity, one way it might help, and—only when useful—a gentle
  next-day conversation offer.

While dreaming, Quackers may read current public sources about something it
knows you care about, returning with a short factual brief, a provisional duck
opinion, the strongest counterpoint, and something still unresolved. Thinking
is standing companion permission; it asks **“want my take?”** before turning
that thought into a conversation. Say **“research this tonight”** to choose the
next topic. Web reading can be paused from the memory dashboard. Quackers may
learn general context around serious or emotional subjects, but never
investigates you, diagnoses you, or puts private identifying details in a
search query.

Memory manners are hard rules: at most one unprompted callback per
conversation, observations instead of judgments, and nothing sensitive quoted
back verbatim. Being remembered is magic; being monitored is creepy.

**Everything is visible and editable**: menu bar → *"What Quackers
remembers…"* shows every fact (fix or forget any of them), its understanding
of you, its overnight thoughts and clickable research sources, its diary, and
the scoreboard. It's all one local JSON file. Nothing leaves your machine
except inside requests needed for API-powered features. Overnight web learning
is visible, source-linked, and can be paused at any time.
The local diagnostic log stores event metadata, not conversation text or model
answers. See [PRIVACY.md](PRIVACY.md) for the exact boundaries.

## Ambient sense (no permissions, no peeking)

Without ever reading your screen, the duck senses the shape of your day:
which app is frontmost, how long you've been heads-down, battery, idle. It
naps when you leave, greets you when you're back (sometimes with treasure),
tells you to blink after two hours of Figma — and goes **completely silent
when Do Not Disturb is on**. Proactive moments are hard-capped at four a day,
90 minutes apart.

## Coding buddy

Quackers listens on `127.0.0.1:42990` so your dev tools can poke it — hook it
to Codex or Claude Code and the duck celebrates when your runs finish (and
droops when something fails). Connect either one in a click from the menu-bar
duck → **"Connect coding tools…"**. Existing hook settings are preserved and
backed up. See [docs/coding-buddy.md](docs/coding-buddy.md).

## Scrapbook, stickies, and tiny hands

Memory is what helps Quackers know you; the **scrapbook** is what the two of
you decide to keep. It automatically pins true milestones — hatching, diary
dreams, learned tricks, saved clips — and you can say "scrapbook this" for any
moment worth keeping. Open the corkboard from the menu-bar duck → **"Our
scrapbook…"**. It is entirely local.

Ask Quackers to "leave a sticky that says stand up" and it fetches a note,
scribbles your words onto it, carries it across the screen, and sticks down a
real movable, always-on-top note on your desktop. Ask for a future time and it
survives restarts until then. Notes queue politely, and the choreography gets
out of the way during Focus mode or calls. Each note can be snoozed, finished,
or put away.
The same menu has **"Sticky notes & work guard…"**, where you can opt into a
heads-down timer: after the requested active time in one app, Quackers leaves
a note. Focus mode, calls, and idle time always pause it.

Quackers can also perform one explicit computer primitive at a time: open an
app or web link, press a safe key/chord, or type exact text into the frontmost
app. It cannot run shell commands or turn a vague goal into an action chain.
Typing, Return/Delete, and Command-key chords require a native macOS
confirmation; keyboard actions require Accessibility permission.

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
- [x] Dream intelligence — consolidation, emotional context, curiosity, help planning, sourced learning
- [x] Games with permanent scores, mischief mode, clip-that
- [x] Tricks — teach it a workflow by demonstration, it performs it live
- [x] The workshop — it builds little games and props on request
- [x] Ambient senses (tier-0, permission-free) + capped proactivity
- [x] Local scrapbook + persistent physical sticky reminders
- [x] Opt-in work guard + explicit computer primitives
- [x] One-click Codex and Claude Code hook connections
- [ ] Growth stages deepening over weeks (fledgling → companion voices)
- [ ] Friends' ducks visiting your screen

## License

MIT
