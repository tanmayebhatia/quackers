// Clip that! — a rolling recording of the duck, always ready to save.
//
// The stage canvas is transparent, so we composite it onto a soft backdrop in
// an offscreen canvas and record THAT. Two MediaRecorders run staggered by
// half a window and restart every CLIP_WINDOW seconds — whichever has been
// running longer always holds a valid, self-contained webm of the recent past
// (a single recorder's trailing chunks wouldn't decode without its header).
//
// Cost control: the composite is drawn on a 30fps interval (not rAF — no need
// to chase 120Hz ProMotion) at a capped width, and the encoder bitrate is
// modest. Still the most expensive idle feature in the app; revisit if
// battery reports say so.

(() => {
  const CLIP_WINDOW = 15000; // ms each recorder runs before restarting
  const MAX_W = 1280;
  const stage = document.getElementById('stage');

  const clipCanvas = document.createElement('canvas');
  const cctx = clipCanvas.getContext('2d');

  function sizeClipCanvas() {
    const scale = Math.min(1, MAX_W / window.innerWidth);
    clipCanvas.width = Math.round(window.innerWidth * scale);
    clipCanvas.height = Math.round(window.innerHeight * scale);
  }
  sizeClipCanvas();
  window.addEventListener('resize', sizeClipCanvas);

  function drawComposite() {
    const w = clipCanvas.width;
    const h = clipCanvas.height;
    const g = cctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#fdf8ee');
    g.addColorStop(1, '#f6ead2');
    cctx.fillStyle = g;
    cctx.fillRect(0, 0, w, h);
    cctx.drawImage(stage, 0, 0, w, h);
    cctx.save();
    cctx.globalAlpha = 0.5;
    cctx.font = '12px -apple-system, sans-serif';
    cctx.fillStyle = '#b09a6d';
    cctx.fillText('🥚 quackers', w - 92, h - 12);
    cctx.restore();
  }
  setInterval(drawComposite, 33);

  const stream = clipCanvas.captureStream(30);
  const MIME = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const slots = [
    { rec: null, chunks: [], startedAt: 0, busy: false },
    { rec: null, chunks: [], startedAt: 0, busy: false },
  ];

  function startSlot(slot) {
    try {
      const rec = new MediaRecorder(stream, { mimeType: MIME, videoBitsPerSecond: 2_000_000 });
      // each recorder writes into ITS OWN array — a restart must never let a
      // stopping recorder's trailing chunk land in the next recording
      const chunks = [];
      slot.chunks = chunks;
      slot.startedAt = performance.now();
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      rec.start(1000);
      slot.rec = rec;
    } catch (err) {
      window.quackers.logEvent('clip-recorder-error', { error: String(err) });
    }
  }

  startSlot(slots[0]);
  setTimeout(() => startSlot(slots[1]), CLIP_WINDOW / 2);

  // every half-window, restart whichever recorder is older — unless a save
  // is using it right now (the save restarts it itself when done)
  setInterval(() => {
    const older = slots[0].startedAt <= slots[1].startedAt ? slots[0] : slots[1];
    if (older.busy) return;
    if (older.rec && older.rec.state === 'recording') {
      try { older.rec.stop(); } catch { /* noop */ }
    }
    startSlot(older);
  }, CLIP_WINDOW / 2 + 100);

  let saving = false;

  async function saveClip() {
    if (saving) return;
    const best = slots
      .filter((s) => s.rec && s.rec.state === 'recording' && !s.busy)
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (!best) return;
    saving = true;
    best.busy = true;
    try {
      const rec = best.rec;
      const chunks = best.chunks; // pin: startSlot swaps the slot's array
      const done = new Promise((resolve) => {
        rec.onstop = resolve;
      });
      rec.stop();
      await done;
      const blob = new Blob(chunks, { type: 'video/webm' });
      const buf = await blob.arrayBuffer();
      best.busy = false;
      startSlot(best); // resume rolling coverage immediately
      const res = await window.quackers.clipSave(buf);
      if (res.ok) {
        window.duckAPI.sayBubble('*clipped!* → Desktop');
        window.duckAPI.emote('happy');
      } else {
        window.duckAPI.sayBubble('clip failed… camera shy');
        window.quackers.logEvent('clip-save-failed', { error: res.error });
      }
    } finally {
      best.busy = false;
      saving = false;
    }
  }

  window.quackers.onClipRequest(saveClip);
})();
