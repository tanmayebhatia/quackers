(function exposeChoreography(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QUACKERS_CHOREOGRAPHY = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function easeOutCubic(value) {
    const t = clamp01(value);
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInOutCubic(value) {
    const t = clamp01(value);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // One readable action per phase. These timings intentionally leave a beat
  // between writing and placing so the physical sticky feels like the end of
  // the duck's action, not an unrelated notification.
  function stickyFrame(seconds, reducedMotion = false) {
    const t = Math.max(0, Number(seconds) || 0);
    if (reducedMotion) {
      return {
        phase: t < 0.18 ? 'write' : t < 0.36 ? 'stick' : 'done',
        progress: clamp01(t / 0.36),
        writeProgress: clamp01(t / 0.18),
        done: t >= 0.36,
      };
    }
    if (t < 0.55) {
      return { phase: 'fetch', progress: easeOutCubic(t / 0.55), writeProgress: 0, done: false };
    }
    if (t < 2.25) {
      const progress = easeInOutCubic((t - 0.55) / 1.7);
      return { phase: 'write', progress, writeProgress: progress, done: false };
    }
    if (t < 3.15) {
      return { phase: 'carry', progress: easeInOutCubic((t - 2.25) / 0.9), writeProgress: 1, done: false };
    }
    if (t < 3.9) {
      return { phase: 'stick', progress: easeOutCubic((t - 3.15) / 0.75), writeProgress: 1, done: false };
    }
    return { phase: 'done', progress: 1, writeProgress: 1, done: true };
  }

  return { clamp01, easeOutCubic, easeInOutCubic, stickyFrame };
});
