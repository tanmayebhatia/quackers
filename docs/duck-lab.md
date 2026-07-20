# Duck Lab — conversation-test the duck's actual brain

`tools/duck-lab.js` drives the exact code the app ships — `src/brain.js`
instructions + tools, `src/spine.js` memory, `src/dream.js` consolidation,
real OpenAI calls — over text instead of voice, against a sandboxed spine in
`.lab/` (the real duck's memory is never touched). The body is simulated as
printed `[body]` actions.

```bash
node tools/duck-lab.js chat "hey quackers"      # talk (session persists between calls)
node tools/duck-lab.js end                      # end conversation → run the digester
node tools/duck-lab.js dream                    # force a dream cycle, print results
node tools/duck-lab.js capsule                  # print the full live instructions
node tools/duck-lab.js spine                    # dump lab memory
node tools/duck-lab.js screen "desc…"           # what the next look_at_screen sees
node tools/duck-lab.js seed file.json           # seed facts/bits/loops/happenings
node tools/duck-lab.js reset                    # wipe the lab
node tools/duck-lab.js scenario tools/scenarios/03-plans-and-callbacks.json
```

Scenarios in `tools/scenarios/` cover: first meeting/imprinting, work
deep-dive (think_hard), plans → dream → next-day callback, guard-the-secret,
a restraint probe (sensitive memory), and a returning day (happenings +
mischief). Each prints the transcript with tool calls, the digest, dream
output, and the final capsule — read and judge.

The lab mouth is `gpt-5-mini` (override: `LAB_MOUTH_MODEL`), a rougher
instruction-follower than the shipped realtime model — which makes it a good
stress test: rules that survive mini survive anything.

## Defect classes the lab has already caught (and their fixes)

1. **Tool narration** — duck said "remember_name called" out loud → tools-are-instincts rule.
2. **Consultant dumps** — think_hard answers delivered as 11-section reports → inner-mind hard format rules + DELIVERY CONTRACT (≤3 sentences, ever).
3. **Dropped answers** — duck emoted instead of delivering the think_hard take → "SPEAK it now, before any other tool" framing.
4. **Hallucinated specifics** — dream invented "9 AM" from "tomorrow"; duck stated it as fact → due-date granularity (day vs time) end to end.
5. **False capability claims** — "want me to peek at your inbox?" → CAN/CANNOT block; dream capability grounding for traits/understanding.
6. **Silent turns** — outrageous user gambits got emotes and no words → always-speak rule + emote throttle (body-level 1.2s rate limit too).
7. **Fabricated scores** — recorded chase wins for games never played → scoreboard honesty rule in the tool description.
8. **Advice reflex on vulnerable turns** — bad-news share got instant unsolicited tactics → friend-first rule (acknowledge, follow his lead).

A separate 8-angle adversarial code review (docs of record: this repo's git history) then caught and fixed a second wave: an imprint race that could permanently skip the hatch script, hung voice sessions on network blips (tool outputs now always sent, `embed` never rejects), impulse budget charged for never-shown nudges (now delivery-acked), a dated loop starving all other reminders, a thin dream erasing the duck's grown personality, an Apple-Events TCC prompt from the ambient sensor (now `lsappinfo`, truly permission-free), a clip save/restart race, and embeddings bloating `spine.json` (now a sidecar file). All regression-tested (19 tests).
