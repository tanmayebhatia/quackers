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
    close();
    const pos = window.duckAPI && window.duckAPI.pos ? window.duckAPI.pos() : { x: innerWidth / 2, ground: innerHeight - 90 };
    const left = Math.round(Math.max(8, Math.min(innerWidth - BOARD_W - 8, pos.x + 50)));
    const top = Math.round(Math.max(8, pos.ground - BOARD_H - 6));
    const frame = makeIframe(code, state);
    frame.style.left = left + 'px';
    frame.style.top = top + 'px';
    current = { id, name, frame, left, top };
  }

  function close() {
    if (!current) return;
    current.frame.remove();
    current = null;
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
        `stage game "${current.name}": ${winner === 'duck' ? 'YOU won' : 'HE won'}. All-time: you ${tally ? tally.duck : '?'} — him ${tally ? tally.user : '?'}. React out loud (the score is already recorded — do not record it again).`
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
