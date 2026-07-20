// The Stage API — the ENTIRE world available to generated artifact code.
// One contract, three consumers: the codegen prompt (workshop.js), the iframe
// runtime shim (renderer/stage-runtime.js), and the lab's vm mock
// (tools/vm-smoke.js). Style lives in the shim so generated code physically
// cannot break the crayon illusion.

const STAGE_COLORS = ['#f79e2d', '#ff6b81', '#6db7ff', '#8bd66e', '#b78cff', '#33302e'];
const STICKERS = ['duck', 'egg', 'star', 'heart', 'x', 'o', 'crumb'];
const API_NAMES = [
  'COLORS', 'size', 'clear', 'crayonLine', 'crayonRect', 'crayonCircle',
  'crayonText', 'sticker', 'grid', 'onTap', 'say', 'state', 'save',
  'reportScore', 'done',
];

const API_DOC = `You write code for "the stage" — a small crayon drawing board (340x280 px) that belongs to a pixel duck. A global object \`stage\` is the ONLY API. There is no DOM, no window, no document, no network, no timers. Your code runs once, top to bottom; after that, everything happens inside tap handlers.

stage.COLORS                      // the crayon palette: ${STAGE_COLORS.join(', ')} — use ONLY these
stage.size()                      // -> {w, h} board pixels
stage.clear()                     // wipe the board back to blank paper
stage.crayonLine(x1,y1,x2,y2,color?)   // jittered hand-drawn stroke
stage.crayonRect(x,y,w,h,color?)       // hand-drawn rectangle outline
stage.crayonCircle(cx,cy,r,color?)     // hand-drawn circle outline
stage.crayonText(x,y,text,size?,color?) // hand-lettered text, centered on x
stage.sticker(x,y,name)                // small stamp: ${STICKERS.join('|')}
stage.grid(cols,rows,onCell)      // draws a crayon grid filling the board and
                                  // registers taps: onCell({col,row,cx,cy,w,h}).
                                  // Returns {cellCenter(col,row) -> {x,y,w,h}}
stage.onTap(fn)                   // fn({x,y}) board-pixel taps (raw)
stage.say(line)                   // the duck speaks the line out loud (<= 90
                                  // chars, throttled — use sparingly, for game
                                  // moments: wins, trash talk, reactions)
stage.state                       // plain JSON object, ALREADY LOADED from the
                                  // last session — running scores live here
stage.save()                      // persist stage.state (call after changes)
stage.reportScore(winner)         // 'duck'|'user' — records on the permanent
                                  // all-time scoreboard. Call when a game ends.
stage.done(summary?)              // close the board (only if the user asked)

HARD RULES:
- Tap-driven only: NO setTimeout/setInterval/requestAnimationFrame, no loops that wait. Redraw in response to taps.
- Use only stage.* — any reference to window, document, fetch, eval, import, require, localStorage, postMessage or similar is rejected.
- Colors ONLY from stage.COLORS. The board must look hand-drawn by a duck.
- If the duck plays a side (games), the DUCK plays 'duck' and the human plays 'user'; make the duck's moves immediately inside the same tap handler, with simple sensible strategy. reportScore exactly once per finished game, then offer a rematch via stage.say and reset on the next tap.
- Keep it under ~150 lines. Robust: ignore taps that make no sense mid-state.`;

module.exports = { STAGE_COLORS, STICKERS, API_NAMES, API_DOC };
