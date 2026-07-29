// The stage — a bounded crayon board in the duck's world where workshop
// artifacts run. The artifact lives in a sandboxed iframe (allow-scripts
// only, CSP no-network) with pointer-events OFF: the parent forwards taps by
// postMessage, so generated code never receives a real input event and the
// window's click-through logic stays fully in our hands.

(() => {
  let current = null; // { id, name, frame, left, top }
  let smoke = null; // { frame, token, timer, ready }
  const BOARD_W = 340;
  const BOARD_H = 280;
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ensureStageStyles() {
    if (document.getElementById('quackers-stage-styles')) return;
    const style = document.createElement('style');
    style.id = 'quackers-stage-styles';
    style.textContent = `
      .q-stage-shell {
        position: fixed;
        width: ${BOARD_W}px;
        height: ${BOARD_H}px;
        z-index: 5;
        pointer-events: none;
        box-sizing: content-box;
        border: 6px solid #8a5b35;
        border-radius: 13px;
        background: #fff8dd;
        box-shadow: 0 18px 36px rgba(48, 28, 10, .28), inset 0 0 0 2px rgba(255,255,255,.45);
        opacity: 0;
        transform: translateY(54px) scale(.72) rotate(-5deg);
        transform-origin: 12% 100%;
        transition: transform 620ms cubic-bezier(.2,1.35,.35,1), opacity 180ms ease;
      }
      .q-stage-shell.shown { opacity: 1; transform: translateY(0) scale(1) rotate(0); }
      .q-stage-shell.closing {
        opacity: 0;
        transform: translateY(28px) scale(.86) rotate(2deg);
        transition: transform 260ms cubic-bezier(.4,0,1,1), opacity 200ms ease;
      }
      .q-stage-label {
        position: absolute;
        top: -31px;
        left: 12px;
        max-width: 250px;
        padding: 5px 11px 6px;
        overflow: hidden;
        color: #4b3b29;
        background: #f6d768;
        border: 2px solid #8a5b35;
        border-radius: 8px 8px 3px 3px;
        font: 700 12px/1.1 ui-rounded, -apple-system, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
        box-shadow: 0 4px 8px rgba(48,28,10,.16);
      }
      .q-stage-nail {
        position: absolute;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #d6b157;
        box-shadow: inset -2px -2px 1px rgba(80,49,10,.22);
        z-index: 2;
      }
      .q-stage-nail.a { left: 7px; top: 7px; }
      .q-stage-nail.b { right: 7px; top: 7px; }
      .q-stage-canvas {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        opacity: 0;
        transform: scale(.97);
        transition: opacity 180ms ease 260ms, transform 260ms ease 240ms;
      }
      .q-stage-shell.shown .q-stage-canvas { opacity: 1; transform: scale(1); }
      @media (prefers-reduced-motion: reduce) {
        .q-stage-shell, .q-stage-shell.closing, .q-stage-canvas {
          transition-duration: 1ms !important;
          transition-delay: 0ms !important;
          transform: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function srcdocFor(code, state) {
    const escScript = (s) => String(s).replace(/<\/script/gi, '<\\/script');
    const stateJson = escScript(JSON.stringify(state || {}).replace(/</g, '\\u003c'));
    return [
      '<!DOCTYPE html><html><head>',
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'">',
      '<style>html,body{margin:0;background:transparent;overflow:hidden}canvas{display:block}</style>',
      '</head><body>',
      `<canvas id="board" width="${BOARD_W}" height="${BOARD_H}"></canvas>`,
      `<script>window.__STAGE_STATE__ = ${stateJson};</scr` + 'ipt>',
      `<script>${window.STAGE_RUNTIME_SOURCE}</scr` + 'ipt>',
      `<script>const stage = window.__stage; try { ${escScript(code)} } catch (err) { parent.postMessage({ q: 'error', message: String((err && err.message) || err).slice(0, 200) }, '*'); }</scr` + 'ipt>',
      '</body></html>',
    ].join('\n');
  }

  function makeIframe(code, state, { hidden } = {}) {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.style.cssText =
      `position:fixed;width:${BOARD_W}px;height:${BOARD_H}px;border:0;background:transparent;` +
      `pointer-events:none;z-index:5;${hidden ? 'visibility:hidden;left:-9999px;top:0;' : ''}`;
    f.srcdoc = srcdocFor(code, state);
    document.body.appendChild(f);
    return f;
  }

  function open({ id, name, code, state }) {
    close(true);
    ensureStageStyles();
    const pos = window.duckAPI && window.duckAPI.pos ? window.duckAPI.pos() : { x: innerWidth / 2, ground: innerHeight - 90 };
    const left = Math.round(Math.max(8, Math.min(innerWidth - BOARD_W - 8, pos.x + 50)));
    const top = Math.round(Math.max(8, pos.ground - BOARD_H - 6));
    const frame = makeIframe(code, state);
    const shell = document.createElement('div');
    shell.className = 'q-stage-shell';
    shell.style.left = left + 'px';
    shell.style.top = top + 'px';
    const label = document.createElement('div');
    label.className = 'q-stage-label';
    label.textContent = String(name || 'from the workshop');
    const nailA = document.createElement('span');
    nailA.className = 'q-stage-nail a';
    const nailB = document.createElement('span');
    nailB.className = 'q-stage-nail b';
    frame.classList.add('q-stage-canvas');
    shell.append(label, nailA, nailB, frame);
    document.body.appendChild(shell);
    current = { id, name, frame, shell, left, top };
    requestAnimationFrame(() => {
      if (current && current.shell === shell) shell.classList.add('shown');
    });
    if (window.duckAPI && window.duckAPI.presentStage) {
      window.duckAPI.presentStage(name, left + BOARD_W / 2);
    }
  }

  function close(immediate = false) {
    if (!current) return;
    const closing = current;
    current = null;
    if (immediate || reducedMotion || !closing.shell) {
      (closing.shell || closing.frame).remove();
      return;
    }
    closing.shell.classList.remove('shown');
    closing.shell.classList.add('closing');
    setTimeout(() => closing.shell.remove(), 300);
  }

  function overStage(x, y) {
    if (!current) return false;
    return x >= current.left && x <= current.left + BOARD_W && y >= current.top && y <= current.top + BOARD_H;
  }

  function routeSay(line) {
    const spoken = window.reportStageSay && window.reportStageSay(line);
    if (!spoken && window.duckAPI) window.duckAPI.sayBubble(line);
  }

  async function routeScore(winner) {
    const tally = await window.quackers.gameResult(current.name, winner);
    if (window.reportGameEvent) {
      window.reportGameEvent(
        `stage game "${current.name}": ${winner === 'duck' ? 'YOU won' : `${window.quackersPersonName || 'your person'} won`}. All-time: you ${tally ? tally.duck : '?'} — ${window.quackersPersonName || 'your person'} ${tally ? tally.user : '?'}. React out loud (the score is already recorded — do not record it again).`
      );
    }
  }

  function finishSmoke(result) {
    if (!smoke) return;
    window.quackers.workshopSmokeResult(smoke.token, result.ok, result.error || null);
    clearTimeout(smoke.timer);
    smoke.frame.remove();
    smoke = null;
  }

  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (smoke && e.source === smoke.frame.contentWindow) {
      if (d.q === 'ready') {
        smoke.ready = true;
        // poke the middle of the board — a tap handler that throws fails here
        smoke.frame.contentWindow.postMessage({ q: 'tap', x: BOARD_W / 2, y: BOARD_H / 2 }, '*');
      } else if (d.q === 'error') {
        finishSmoke({ ok: false, error: d.message || 'error on the bench' });
      }
      return;
    }
    if (!current || e.source !== current.frame.contentWindow) return;
    if (d.q === 'say') routeSay(String(d.line || ''));
    else if (d.q === 'state') window.quackers.workshopState(current.id, d.state);
    else if (d.q === 'score') routeScore(d.winner);
    else if (d.q === 'done') close();
    else if (d.q === 'error') window.quackers.logEvent('stage-error', { id: current.id, message: String(d.message || '') });
  });

  // taps: capture phase so the board wins over the pet canvas underneath it
  window.addEventListener(
    'mousedown',
    (e) => {
      if (!current || !overStage(e.clientX, e.clientY)) return;
      e.stopPropagation();
      current.frame.contentWindow.postMessage({ q: 'tap', x: e.clientX - current.left, y: e.clientY - current.top }, '*');
    },
    true
  );

  window.quackers.onStageOpen((d) => open(d));
  window.quackers.onStageClose(() => close());
  window.quackers.onWorkshopSmoke(({ token, code }) => {
    if (smoke) finishSmoke({ ok: false, error: 'superseded' });
    const frame = makeIframe(code, {}, { hidden: true });
    smoke = { frame, token, ready: false };
    smoke.timer = setTimeout(() => {
      finishSmoke(smoke.ready ? { ok: true } : { ok: false, error: 'board never became ready' });
    }, 2500);
  });

  window.stageAPI = { isOpen: () => Boolean(current), overStage };
})();
