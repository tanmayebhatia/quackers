# Coding buddy — the duck reacts to your dev tools

Quackers listens on `127.0.0.1:42990` (loopback only — nothing leaves your Mac)
for simple events, so anything that can `curl` can poke the duck:

```bash
curl -s -X POST http://127.0.0.1:42990/event \
  -H 'Content-Type: application/json' \
  -d '{"type":"run-done","detail":"claude finished"}'
```

Event types the duck understands: `run-done`, `run-failed`, `tests-passed`,
`tests-failed`, `pr-opened`, `note` (anything else gets a generic reaction).
Events are rate-limited to one reaction per 20 seconds, and the duck stays
silent when Do Not Disturb is on or when you look like you're on a call.
`run-done`/`run-failed`/`tests-*`/`pr-opened` also land in the duck's memory
of what happened since you last talked — it will bring them up.

## One click: Codex or Claude Code

Use the menu-bar duck → **Connect coding tools…** and press **connect** beside
Codex or Claude Code.

Quackers writes a tiny local bridge into its own app-data directory, then
merges only its commands into:

- Codex: `~/.codex/hooks.json` (`Stop` and `PermissionRequest`)
- Claude Code: `~/.claude/settings.json` (`Stop`, `StopFailure`, and
  `Notification`)

It preserves every existing setting and hook, makes a
`.quackers-backup` beside an existing config before changing it, and refuses
to overwrite malformed JSON. Disconnect removes only commands whose path
contains `quackers-hook.sh`. The bridge ignores hook input and posts a static
event to `127.0.0.1`; prompts, code, filenames, and tool output never enter
Quackers.

Codex intentionally asks you to review and trust newly discovered personal
hooks. Run `/hooks` once after connecting and approve the Quackers hook.
Claude Code's `/hooks` screen shows its installed hooks too.

## Manual Claude Code hook

If you prefer to wire it yourself, add a Stop hook so the duck celebrates
whenever a Claude Code run finishes. In `~/.claude/settings.json` (or a
project's `.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -m 2 -X POST http://127.0.0.1:42990/event -H 'Content-Type: application/json' -d '{\"type\":\"run-done\",\"detail\":\"claude code finished a run\"}' >/dev/null 2>&1 || true"
          }
        ]
      }
    ]
  }
}
```

The `-m 2 … || true` keeps the hook harmless when Quackers isn't running.

## Manual Codex hook

Codex personal hooks live in `~/.codex/hooks.json`. A minimal Stop hook is:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -m 2 -X POST http://127.0.0.1:42990/event -H 'Content-Type: application/json' -d '{\"type\":\"run-done\",\"detail\":\"codex finished a turn\"}' >/dev/null 2>&1 || true",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

After editing, open `/hooks` in Codex to review/trust it.

## PR praise

Send `pr-opened` with the PR title as `detail` and the duck celebrates it by
name ("PR's up — 'fix the flaky spine test' — nice one!"). A shell wrapper
around `gh` does it automatically (in `~/.zshrc`; needs `jq`):

```bash
gh() {
  command gh "$@" || return $?
  if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
    local title
    title=$(command gh pr view --json title -q .title 2>/dev/null)
    curl -s -m 2 -X POST http://127.0.0.1:42990/event \
      -H 'Content-Type: application/json' \
      --data "$(jq -cn --arg t "$title" '{type:"pr-opened",detail:$t}')" >/dev/null 2>&1 || true
  fi
}
```

## Anything else

- **npm test wrapper:** `npm test && curl … tests-passed || curl … tests-failed`
- **Long build:** `make && curl -d '{"type":"run-done","detail":"build finished"}' …`
- **Health check:** `curl http://127.0.0.1:42990/health` → `{"ok":true,"duck":"duckling"}`
