// Headless stand-in for the renderer's stage smoke bench: run generated code
// in a vm with a mock stage whose surface mirrors src/stage-api.js. Catches
// syntax/runtime/tap-handler crashes; canvas-specific issues still need the
// real bench in the app.
const vm = require('node:vm');
const { API_NAMES, STAGE_COLORS } = require('../src/stage-api');

function vmSmokeTest(code) {
  const tapFns = [];
  const stage = {
    COLORS: STAGE_COLORS,
    size: () => ({ w: 340, h: 280 }),
    clear() {},
    crayonLine() {},
    crayonRect() {},
    crayonCircle() {},
    crayonText() {},
    sticker() {},
    grid(cols, rows, onCell) {
      tapFns.push(({ x, y }) => {
        const m = 16, cw = (340 - 32) / cols, ch = (280 - 32) / rows;
        const col = Math.floor((x - m) / cw), row = Math.floor((y - m) / ch);
        if (col >= 0 && col < cols && row >= 0 && row < rows) {
          onCell({ col, row, cx: m + col * cw + cw / 2, cy: m + row * ch + ch / 2, w: cw, h: ch });
        }
      });
      return { cellCenter: (col, row) => ({ x: 16 + col, y: 16 + row, w: 0, h: 0 }) };
    },
    onTap(fn) { tapFns.push(fn); },
    say() {},
    state: {},
    save() {},
    reportScore() {},
    done() {},
  };
  for (const name of API_NAMES) {
    if (!(name in stage)) throw new Error(`vm mock drifted from stage-api: missing ${name}`);
  }
  try {
    vm.runInNewContext(code, { stage }, { timeout: 1000 });
    // poke a few cells — tic tac toe's first moves shouldn't crash
    for (const [x, y] of [[170, 140], [60, 60], [280, 230]]) {
      for (const fn of tapFns.slice()) fn({ x, y });
    }
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 200) };
  }
}

module.exports = { vmSmokeTest };
