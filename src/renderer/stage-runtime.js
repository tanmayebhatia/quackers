// The stage runtime — injected as an inline <script> into the sandboxed
// artifact iframe (see stage.js). This shim IS the artifact's entire world:
// pre-styled crayon primitives on a paper board, postMessage as the only
// bridge out. Style lives HERE so generated code cannot break the illusion.
//
// Kept as a source STRING because the iframe (sandbox="allow-scripts", CSP
// default-src 'none') cannot load external files — everything must inline.
// The mirror of this surface lives in src/stage-api.js; test/stage-runtime
// proves they agree.

window.STAGE_RUNTIME_SOURCE = `
(() => {
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const COLORS = ['#f79e2d', '#ff6b81', '#6db7ff', '#8bd66e', '#b78cff', '#33302e'];
  const post = (m) => parent.postMessage(m, '*');
  const tapFns = [];
  let lastSayAt = 0;

  const jit = () => (Math.random() - 0.5) * 2.4;
  function stroke(color, fn) {
    ctx.save();
    ctx.strokeStyle = color || COLORS[5];
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    fn();
    ctx.stroke();
    ctx.restore();
  }

  function paper() {
    ctx.save();
    ctx.fillStyle = '#fffdf4';
    ctx.globalAlpha = 0.96;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    stroke('#e8d5ac', () => {
      ctx.moveTo(5 + jit(), 5 + jit());
      ctx.lineTo(W - 5 + jit(), 5 + jit());
      ctx.lineTo(W - 5 + jit(), H - 5 + jit());
      ctx.lineTo(5 + jit(), H - 5 + jit());
      ctx.closePath();
    });
  }

  function crayonLine(x1, y1, x2, y2, color) {
    stroke(color, () => {
      ctx.moveTo(x1 + jit(), y1 + jit());
      ctx.quadraticCurveTo((x1 + x2) / 2 + jit() * 2, (y1 + y2) / 2 + jit() * 2, x2 + jit(), y2 + jit());
    });
  }

  const stage = {
    COLORS,
    size: () => ({ w: W, h: H }),
    clear() { ctx.clearRect(0, 0, W, H); paper(); },
    crayonLine,
    crayonRect(x, y, w, h, color) {
      crayonLine(x, y, x + w, y, color);
      crayonLine(x + w, y, x + w, y + h, color);
      crayonLine(x + w, y + h, x, y + h, color);
      crayonLine(x, y + h, x, y, color);
    },
    crayonCircle(cx, cy, r, color) {
      stroke(color, () => {
        for (let a = 0; a <= 16; a++) {
          const t = (a / 16) * Math.PI * 2;
          const px = cx + Math.cos(t) * (r + jit()), py = cy + Math.sin(t) * (r + jit());
          if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
      });
    },
    crayonText(x, y, text, size, color) {
      ctx.save();
      ctx.fillStyle = color || COLORS[5];
      ctx.globalAlpha = 0.9;
      ctx.font = 'bold ' + (size || 18) + 'px "Comic Sans MS", "Chalkboard SE", cursive';
      ctx.textAlign = 'center';
      ctx.fillText(String(text).slice(0, 60), x + jit(), y + jit());
      ctx.restore();
    },
    sticker(x, y, name) {
      const c = { duck: COLORS[0], egg: '#fff4da', star: COLORS[0], heart: COLORS[1], x: COLORS[1], o: COLORS[2], crumb: '#d97f14' }[name];
      if (!c) return;
      if (name === 'x') { crayonLine(x - 9, y - 9, x + 9, y + 9, c); crayonLine(x + 9, y - 9, x - 9, y + 9, c); }
      else if (name === 'o') stage.crayonCircle(x, y, 10, c);
      else if (name === 'star') stroke(c, () => { for (let i = 0; i <= 10; i++) { const t = (i / 10) * Math.PI * 2 - Math.PI / 2; const r = i % 2 ? 5 : 11; const px = x + Math.cos(t) * r, py = y + Math.sin(t) * r; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } });
      else if (name === 'heart') stroke(c, () => { ctx.moveTo(x, y + 8); ctx.quadraticCurveTo(x - 12, y - 4, x - 5, y - 8); ctx.quadraticCurveTo(x, y - 4, x, y); ctx.quadraticCurveTo(x, y - 4, x + 5, y - 8); ctx.quadraticCurveTo(x + 12, y - 4, x, y + 8); });
      else if (name === 'egg') stage.crayonCircle(x, y, 9, '#e8d5ac');
      else if (name === 'crumb') { ctx.save(); ctx.fillStyle = c; ctx.fillRect(x - 2, y - 2, 5, 5); ctx.restore(); }
      else if (name === 'duck') { stage.crayonCircle(x, y, 8, c); stage.crayonCircle(x + 6, y - 6, 5, c); crayonLine(x + 10, y - 6, x + 15, y - 5, '#d97f14'); }
    },
    grid(cols, rows, onCell) {
      const m = 16, gw = W - 2 * m, gh = H - 2 * m;
      const cw = gw / cols, ch = gh / rows;
      for (let i = 0; i <= cols; i++) crayonLine(m + i * cw, m, m + i * cw, m + gh);
      for (let j = 0; j <= rows; j++) crayonLine(m, m + j * ch, m + gw, m + j * ch);
      tapFns.push(({ x, y }) => {
        const col = Math.floor((x - m) / cw), row = Math.floor((y - m) / ch);
        if (col >= 0 && col < cols && row >= 0 && row < rows) {
          onCell({ col, row, cx: m + col * cw + cw / 2, cy: m + row * ch + ch / 2, w: cw, h: ch });
        }
      });
      return { cellCenter: (col, row) => ({ x: m + col * cw + cw / 2, y: m + row * ch + ch / 2, w: cw, h: ch }) };
    },
    onTap(fn) { tapFns.push(fn); },
    say(line) {
      const now = Date.now();
      if (now - lastSayAt < 2000) return;
      lastSayAt = now;
      post({ q: 'say', line: String(line).slice(0, 90) });
    },
    state: window.__STAGE_STATE__ || {},
    save() { post({ q: 'state', state: stage.state }); },
    reportScore(winner) { if (winner === 'duck' || winner === 'user') post({ q: 'score', winner }); },
    done(summary) { post({ q: 'done', summary: String(summary || '').slice(0, 120) }); },
  };

  paper();
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.q === 'tap') for (const fn of tapFns.slice()) fn({ x: d.x, y: d.y });
  });
  window.onerror = (msg) => { post({ q: 'error', message: String(msg).slice(0, 200) }); };
  window.__stage = stage;
  post({ q: 'ready' });
})();
`;
