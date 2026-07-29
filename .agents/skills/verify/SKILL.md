---
name: verify
description: How to launch and drive Quackers for end-to-end verification without touching the real duck's memory
---

# Verifying Quackers changes

## Launch against a scratch profile

```bash
SCRATCH=$(mktemp -d)
# seed a HATCHED duck (fresh profiles are eggs — onboarding blocks everything):
cat > "$SCRATCH/spine.json" <<EOF
{"facts":[],"meta":{"firstRunAt":"2026-01-01T00:00:00.000Z","stage":"duckling","onboarded":true,"skin":"classic","duckName":"Verifier","hatchedAt":"2026-01-01T00:00:00.000Z"}}
EOF
QUACKERS_DATA_DIR="$SCRATCH" npm start   # run in background
```

## Gotchas

- **Port 42990 collision:** the installed ~/Applications/Quackers.app usually
  holds the coding-buddy port. Quit it first (`osascript -e 'quit app "Quackers"'`)
  or the dev instance logs `buddy-server-error EADDRINUSE` and your curls hit
  the OLD build. Relaunch with `open -a Quackers` when done.
- **Time-gated behavior** (night owl, latenight impulse): fake the clock with
  `TZ=Australia/Sydney npm start` (or any TZ whose local hour is in range —
  main and renderer both follow TZ).
- No screenshots from the agent shell (screen-recording TCC denied); verify
  via the app's own files instead.

## Observable surfaces (no pixels needed)

- `$SCRATCH/interactions.jsonl` — every startup, buddy-event, tool-call, impulse error.
- `$SCRATCH/spine.json` — `happenings[]` (buddy/music/pet/etc.), `meta.impulses[]`.
  An entry in `meta.impulses` proves the FULL roundtrip: main sent the impulse,
  the renderer showed the bubble, and the `impulse-shown` ack charged the budget.
- `curl http://127.0.0.1:42990/health` and `POST /event` — the coding-buddy surface.
- Impulse loop ticks every 30s and needs system idle < 60s (a human at the keys).

## Cleanup

Kill the dev electron (`pkill -f "node_modules/.bin/electron"`), relaunch the
installed app, confirm `/health` answers again.
