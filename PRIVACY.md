# Quackers privacy

Quackers has no account, telemetry service, or analytics SDK. Its profile is a
set of files on the Mac where it runs.

## What is stored locally

- The person's name, the duck's name and appearance
- Long-term memories, relationship notes, diary entries, overnight emotional
  hypotheses/curiosities, research briefs and sources, scores, tricks, and
  workshop artifacts
- Embeddings used to search those memories
- A metadata-only diagnostic log (event names, status codes, counts, and
  permission states; never transcript text, model answers, names, or screen
  contents)

The OpenAI API key entered in the app is encrypted with Electron `safeStorage`,
which uses macOS secure storage. A legacy plaintext key in the app's profile is
migrated to encrypted storage and removed after migration succeeds. Developers
may still provide `OPENAI_API_KEY` through the environment or a repository
`.env` file.

## What is sent to OpenAI

Only API-powered features send data:

- Voice and text conversations send the current conversation and a compact
  memory capsule (including the locally stored person name) so the duck can
  respond consistently.
- Memory digestion and dreaming send relevant transcript or local-memory
  content so the model can return structured updates.
- During dreaming, Quackers may send one generalized topic/question to
  OpenAI's web-search tool and store the returned brief and source URLs
  locally. This is on by default and can be paused in the memory dashboard.
  “Research this tonight” chooses the next priority. Quackers may learn general
  public context around serious or emotional subjects, but autonomous queries
  must not investigate the person, infer a diagnosis, include credentials,
  identify a private person, or contain private identifying details.
- Looking at the screen sends a snapshot only after the person explicitly asks.
- Teaching or performing a trick sends the explicitly captured lesson/current
  screen frames needed to understand or carry out that trick.
- Workshop builds send the requested artifact description.

Quackers does not read mail, files, calendars, notifications, or browser
history, and does not watch the screen in the background.

## Controls

Menu bar → **What Quackers remembers…** shows local long-term memory and lets
the person edit or delete individual items, inspect/forget overnight thoughts,
open research sources, and pause or resume overnight web learning. Quitting
Quackers stops all sensing and API activity. Removing Quackers' profile
directory removes its local memory; keep a backup first if the relationship
matters.
