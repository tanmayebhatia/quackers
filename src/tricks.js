// Tricks — workflows the user TEACHES the duck by demonstrating on screen.
//
// Teaching: with explicit consent ("I'm going to teach you a trick"), the duck
// watches — periodic screenshots + the user's spoken narration — and the slow
// brain distills them into a SEMANTIC plan: goal, natural-language steps, risk
// flags. Never pixel coordinates; the frames are discarded after distillation.
//
// Performing: each run re-grounds the plan against a fresh screenshot: a
// vision model looks at the screen, decides the next action, a tiny osascript
// actuator executes it (Accessibility permission = "the duck's hands"), and
// the duck's body flies to every click and pecks it. Risky steps pause for a
// a native confirmation. The user grabbing the mouse aborts instantly.

const { screen, desktopCapturer, systemPreferences, dialog } = require('electron');
const { execFile } = require('child_process');
const { validateAction, actionLooksRisky } = require('./trick-safety');

const ACT_MODEL = 'gpt-5.5';
const MAX_STEPS = 12;
const FRAME_W = 1344;

let deps = null; // { spine, loadApiKey, logEvent, sendToDuck }
function init(d) {
  deps = d;
}

function personName() {
  return (deps && deps.spine && deps.spine.userName()) || 'your person';
}

function hasHands() {
  return process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : false;
}

// ---------------------------------------------------------------------------
// Capture (silent — the duck's visible "watching/performing" state is the
// indicator; content protection keeps the duck out of its own frames)
// ---------------------------------------------------------------------------

async function grabFrame() {
  deps.protect(true); // keep the duck out of its own lesson/performance frames
  try {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: display.size.width, height: display.size.height },
    });
    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    const img = source && source.thumbnail;
    if (!img || img.isEmpty()) return null;
    const scaled = img.getSize().width > FRAME_W ? img.resize({ width: FRAME_W }) : img;
    return { jpegBase64: scaled.toJPEG(72).toString('base64'), size: scaled.getSize(), display };
  } finally {
    deps.protect(false);
  }
}

// ---------------------------------------------------------------------------
// Teaching
// ---------------------------------------------------------------------------

const teach = { active: false, name: '', frames: [], timer: null };

function startTeaching(name) {
  if (teach.active) return 'already watching a lesson — finish that one first';
  teach.active = true;
  teach.name = String(name || 'new trick').slice(0, 60);
  teach.frames = [];
  deps.sendToDuck('quackers:trick', { phase: 'watching' });
  teach.timer = setInterval(async () => {
    if (teach.frames.length >= 24) return; // ~1 minute of lesson is plenty
    const f = await grabFrame().catch(() => null);
    if (f) teach.frames.push(f.jpegBase64);
  }, 2500);
  deps.logEvent('trick-teach-start', { name: teach.name });
  return `watching closely now. ${personName()} should DO the workflow while narrating what is happening and why. When ${personName()} says the lesson is done, call finish_trick.`;
}

async function finishTeaching(narration) {
  if (!teach.active) return { error: 'no lesson in progress' };
  clearInterval(teach.timer);
  const frames = teach.frames;
  const name = teach.name;
  teach.active = false;
  teach.frames = [];
  deps.sendToDuck('quackers:trick', { phase: 'done' });

  if (frames.length < 2) return { error: `the lesson was too quick — I barely saw anything. Ask ${personName()} to teach it again, a bit slower.` };

  const apiKey = deps.loadApiKey();
  const system = `You are distilling a screen-recorded lesson into a reusable "trick" — a workflow a small desktop agent will perform later on the SAME computer. You get sequential screenshots of the demonstration plus the teacher's spoken narration.

Write a SEMANTIC plan, not pixel positions: describe targets by what they look like and where they conceptually live ("the Trash icon at the right end of the Dock", "the Empty button in the confirmation dialog"). Steps must be reproducible when windows have moved.

Mark "risky": true on any step that deletes, sends, submits, purchases, closes unsaved work, or is otherwise hard to undo. Emptying the trash, deleting files, sending messages, and confirming destructive dialogs are ALWAYS risky.

Where a menu-bar route exists for a step (e.g. Finder menu > Empty Trash), mention it in that step's "what" as an alternative — menu bars are always visible, Dock icons and windows may not be.

Respond with JSON only:
{"name":"(ignored — the trick already has its name)",
"goal":"one sentence: what this trick accomplishes",
"steps":[{"what":"one concrete action, semantically described","risky":false}],
"notes":"anything important the performer should know (preconditions, what success looks like)"}`;

  const content = [
    { type: 'text', text: `Narration during the lesson:\n${narration || '(none — screenshots only)'}` },
    ...frames.filter((_, i) => i % Math.ceil(frames.length / 12) === 0 || i === frames.length - 1).map((b64) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    })),
  ];

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ACT_MODEL,
        response_format: { type: 'json_object' },
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
      }),
    });
    if (!res.ok) {
      deps.logEvent('trick-distill-failed', { status: res.status, body: (await res.text()).slice(0, 200) });
      return { error: `my brain fumbled the lesson — ask ${personName()} to teach it once more.` };
    }
    const spec = JSON.parse((await res.json()).choices[0].message.content);
    spec.name = name; // the name he gave it at teach time — models don't get to rename tricks
    const trick = deps.spine.addTrick(spec);
    deps.logEvent('trick-learned', { name: trick && trick.name, steps: trick && trick.steps.length });
    if (!trick) return { error: 'I could not make sense of that lesson — ask him to show me again.' };
    return {
      trick,
      summary: `Learned "${trick.name}" (${trick.steps.length} steps): ${trick.steps.map((s) => s.what).join(' → ')}${trick.steps.some((s) => s.risky) ? ` — some steps are risky and will need ${personName()}'s confirmation when performed.` : ''}`,
    };
  } catch (err) {
    deps.logEvent('trick-distill-failed', { error: err.message });
    return { error: `my brain fumbled the lesson — ask ${personName()} to teach it once more.` };
  }
}

// ---------------------------------------------------------------------------
// The actuator — the duck's hands (osascript → System Events)
// ---------------------------------------------------------------------------

const KEYCODES = { return: 36, enter: 36, escape: 53, esc: 53, tab: 48, space: 49, delete: 51, backspace: 51, up: 126, down: 125, left: 123, right: 124 };

function osa(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 8000 }, (err, _out, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).slice(0, 160)));
      else resolve();
    });
  });
}

async function actuate(action, pt) {
  switch (action.action) {
    case 'click':
      return osa(`tell application "System Events" to click at {${pt.x}, ${pt.y}}`);
    case 'double_click':
      await osa(`tell application "System Events" to click at {${pt.x}, ${pt.y}}`);
      return osa(`tell application "System Events" to click at {${pt.x}, ${pt.y}}`);
    case 'type': {
      const text = String(action.text || '').replace(/[\\"]/g, '\\$&').slice(0, 300);
      return osa(`tell application "System Events" to keystroke "${text}"`);
    }
    case 'key': {
      const spec = String(action.key || '').toLowerCase();
      const parts = spec.split('+').map((s) => s.trim());
      const key = parts.pop();
      const mods = parts
        .map((m) => ({ cmd: 'command down', command: 'command down', shift: 'shift down', alt: 'option down', option: 'option down', ctrl: 'control down', control: 'control down' }[m]))
        .filter(Boolean);
      const using = mods.length ? ` using {${mods.join(', ')}}` : '';
      if (KEYCODES[key] != null) return osa(`tell application "System Events" to key code ${KEYCODES[key]}${using}`);
      const ch = key.replace(/[\\"]/g, '\\$&').slice(0, 1);
      return osa(`tell application "System Events" to keystroke "${ch}"${using}`);
    }
    case 'scroll':
      return osa(`tell application "System Events" to key code ${action.direction === 'up' ? 116 : 121}`);
    case 'menu_item': {
      // semantic and pixel-free: click a named menu item in a named app —
      // the reliable route when Dock icons or windows aren't visible
      const esc = (s) => String(s || '').replace(/[\\"]/g, '\\$&').slice(0, 80);
      const appName = esc(action.app);
      await osa(`tell application "${appName}" to activate`);
      await new Promise((r) => setTimeout(r, 400));
      return osa(
        `tell application "System Events" to tell process "${appName}" to click menu item "${esc(action.item)}" of menu "${esc(action.menu)}" of menu bar 1`
      );
    }
    default:
      return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Performing
// ---------------------------------------------------------------------------

const run = { active: false, abort: false, confirm: null };

function resolveConfirm(approved) {
  if (run.confirm) {
    run.confirm(Boolean(approved));
    run.confirm = null;
    return true;
  }
  return false;
}

function cancel() {
  if (!run.active) return false;
  run.abort = true;
  if (run.confirm) resolveConfirm(false);
  return true;
}

// notify the live conversation via the renderer bridge
function tell(text) {
  deps.sendToDuck('quackers:trick-event', { text });
}

async function confirmRiskyAction(action, trick) {
  const result = await dialog.showMessageBox({
    type: 'warning',
    title: 'Allow this Quackers action?',
    message: `Allow Quackers to ${String(action.describe || action.item || action.action).slice(0, 140)}?`,
    detail: `Trick: ${trick.name}\n\nThis action may send, delete, submit, purchase, close, or otherwise make a hard-to-undo change.`,
    buttons: ['Cancel', 'Allow once'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}

async function perform(name, guidance) {
  if (run.active) return 'already mid-trick — one at a time';
  const trick = deps.spine.findTrick(name);
  if (!trick) return `you don't know a trick called "${name}". Your tricks are in your memory — offer to learn this one if ${personName()} teaches it.`;
  if (!hasHands()) {
    return `your hands aren't hooked up: performing tricks needs macOS Accessibility permission. Tell ${personName()}, in one light sentence, that the little duck in the menu bar has a 'Give it hands' button that opens the right settings page (quick app restart after), and you'll happily do the trick then.`;
  }

  run.active = true;
  run.abort = false;
  deps.spine.touchTrick(trick.id);
  deps.logEvent('trick-perform-start', { name: trick.name, guidance: guidance || undefined });

  performLoop(trick, String(guidance || '').slice(0, 300)).catch((err) => {
    deps.logEvent('trick-perform-crashed', { error: err.message });
    tell(`TRICK EVENT: the trick crashed unexpectedly (${err.message.slice(0, 80)}). Own it gracefully.`);
    deps.sendToDuck('quackers:trick', { phase: 'abort' });
    run.active = false;
  });

  return `Performing "${trick.name}" now — your body is doing it on screen. TRICK EVENT messages will arrive as you go; narrate ONLY what they say, briefly and with showmanship. A native macOS confirmation will appear before any risky action; never claim approval before that dialog is accepted.`;
}

async function performLoop(trick, guidance = '') {
  const apiKey = deps.loadApiKey();
  const history = [];
  let lastCursor = null;

  for (let step = 0; step < MAX_STEPS && !run.abort; step++) {
    // The person's hands always win: if the mouse moved since our last action, stop.
    const cur = screen.getCursorScreenPoint();
    if (lastCursor && Math.hypot(cur.x - lastCursor.x, cur.y - lastCursor.y) > 80) {
      tell(`TRICK EVENT: ${personName()} grabbed the mouse — you stopped instantly, mid-trick. Human hands always win; say so cheerfully.`);
      break;
    }

    const frame = await grabFrame();
    if (!frame) {
      tell('TRICK EVENT: your eyes failed mid-trick (screen capture returned nothing). Stop and say so.');
      break;
    }

    const system = `You are performing a learned trick on the user's macOS screen, one action at a time. You get the trick plan, the actions taken so far, and a CURRENT screenshot (${frame.size.width}x${frame.size.height} pixels, representing the full screen).

Decide the SINGLE next action. Ground it in what you actually SEE now — the plan describes targets semantically; find them in the screenshot. Coordinates are in screenshot pixels.

Rules:
- FIRST, check the screenshot for the EFFECT of your previous action. If it visibly didn't work, take a DIFFERENT route — never repeat the same click hoping for a different result.
- ${deps.dockHidden && deps.dockHidden() ? "This user's Dock is AUTO-HIDDEN: Dock icons will NOT appear in screenshots and cannot be clicked. Use menu_item or keyboard routes instead of anything Dock-based." : 'If a Dock target is not visible in the screenshot, do not click where it "should" be — use menu_item or a keyboard route instead.'}
- menu_item is your most reliable action: it clicks a named item in a named app's menu bar semantically, no pixels needed (e.g. app "Finder", menu "Finder", item "Empty Trash"). Prefer it whenever the plan's target is a menu command or the visual target is missing.
- KNOW WHEN TO STOP. The moment the goal is achieved, return "done" — immediately. Verify by LOOKING at the current screenshot, never by acting: no re-opening windows to check, no extra clicks "to be sure", no redoing finished steps. Every action after the goal is achieved is a mistake the user watches happen.
- If the screen doesn't match the plan and you can't find any route, return "abort" with a reason — never guess-click.
- Set "risky": true when the action deletes, sends, submits, purchases, or confirms something destructive (emptying trash and deleting files ARE destructive; also anything the plan marked risky).

Respond with JSON only:
{"action":"click|double_click|type|key|scroll|menu_item|done|abort",
"x":0,"y":0,
"text":"(for type)","key":"(for key, e.g. 'return' or 'cmd+w')","direction":"up|down (for scroll)",
"app":"(for menu_item)","menu":"(for menu_item)","item":"(for menu_item)",
"describe":"5-10 words: what you're doing, for the duck to narrate",
"risky":false,
"reason":"(for abort)"}`;

    const user = [
      {
        type: 'text',
        text: JSON.stringify({
          trick: { name: trick.name, goal: trick.goal, steps: trick.steps, notes: trick.notes },
          live_coaching: guidance || undefined,
          actions_so_far: history,
        }),
      },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame.jpegBase64}` } },
    ];

    let act;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ACT_MODEL,
          response_format: { type: 'json_object' },
          reasoning_effort: 'low', // grounding a click needs eyes, not chain-of-thought — this is the step-latency lever
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`model ${res.status}`);
      act = JSON.parse((await res.json()).choices[0].message.content);
    } catch (err) {
      tell(`TRICK EVENT: your deeper mind glitched mid-trick (${err.message.slice(0, 60)}) — stop gracefully.`);
      break;
    }

    deps.logEvent('trick-step', { step, action: act.action, describe: act.describe, risky: act.risky });

    const valid = validateAction(act, frame);
    if (!valid.ok) {
      tell(`TRICK EVENT: the proposed action failed a safety check (${valid.error}) — you stopped before touching anything.`);
      break;
    }

    // stuck detection: the same physical action twice in a row means the model
    // is flailing — stop honestly instead of clicking a wall forever
    // (coordinates are bucketed: a click 10px away from a failed click is the same click)
    const sig = `${act.action}:${Math.round((act.x || 0) / 24)},${Math.round((act.y || 0) / 24)}:${act.item || ''}${act.key || ''}`;
    const prev = history[history.length - 1];
    if (prev && prev.sig === sig) {
      tell(`TRICK EVENT: you tried "${act.describe}" twice and the screen didn't change — the trick isn't landing today. Stop honestly and suggest ${personName()} re-teach it or set the stage first.`);
      break;
    }

    if (act.action === 'done') {
      deps.sendToDuck('quackers:trick', { phase: 'done' });
      deps.spine.addHappening('trick', `performed "${trick.name}" successfully`);
      tell(`TRICK EVENT: trick complete! "${trick.name}" done in ${history.length} actions. Take your bow.`);
      run.active = false;
      return;
    }
    if (act.action === 'abort') {
      tell(`TRICK EVENT: you stopped — the screen didn't match what you learned (${String(act.reason || '').slice(0, 100)}). Say so plainly and suggest ${personName()} re-teach or set the stage.`);
      break;
    }

    if (actionLooksRisky(act, trick, history)) {
      deps.sendToDuck('quackers:trick', { phase: 'confirm' });
      tell(`TRICK EVENT: PAUSED — macOS is asking ${personName()} to allow the risky step "${act.describe}". Wait for the native dialog; never self-approve.`);
      const approved = await confirmRiskyAction(act, trick);
      if (!approved || run.abort) {
        tell(`TRICK EVENT: ${personName()} did not allow the risky step — you skipped it and stopped the trick. Total respect, zero sulking.`);
        break;
      }
    }

    // screenshot px → display points, for the actuator; menu_item pecks the menu bar
    const d = frame.display;
    const pt =
      act.action === 'menu_item'
        ? { x: d.bounds.x + 180, y: d.bounds.y + 12 }
        : {
            x: Math.round(d.bounds.x + ((act.x || 0) / frame.size.width) * d.bounds.width),
            y: Math.round(d.bounds.y + ((act.y || 0) / frame.size.height) * d.bounds.height),
          };

    // the duck's body flies to the spot and pecks — the signature visual
    const cursorBeforeFlight = screen.getCursorScreenPoint();
    deps.sendToDuck('quackers:trick', { phase: 'action', x: pt.x, y: pt.y, type: act.action, label: act.describe });
    await new Promise((r) => setTimeout(r, 900)); // let the flight land
    const cursorAfterFlight = screen.getCursorScreenPoint();
    if (Math.hypot(cursorAfterFlight.x - cursorBeforeFlight.x, cursorAfterFlight.y - cursorBeforeFlight.y) > 40) {
      tell(`TRICK EVENT: ${personName()} moved the mouse while you were flying in — you stopped before clicking. Human hands always win.`);
      break;
    }

    try {
      await actuate(act, pt);
    } catch (err) {
      tell(`TRICK EVENT: your hands slipped (${err.message.slice(0, 80)}) — stop and say so honestly.`);
      break;
    }
    history.push({ step, action: act.action, describe: act.describe, sig });
    lastCursor = screen.getCursorScreenPoint();
    await new Promise((r) => setTimeout(r, 700)); // let the UI react before looking again
  }

  deps.sendToDuck('quackers:trick', { phase: 'abort' });
  run.active = false;
}

module.exports = { init, hasHands, startTeaching, finishTeaching, perform, resolveConfirm, cancel };
