(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BlackoutDirector = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  function create() { return { stableFor: 0, lastSpawn: 0, helpGiven: false, preview: false }; }
  function step(state, { time, dt, allStable, hasNext }) {
    if (!Number.isFinite(dt) || dt <= 0) return { spawn: false, help: false, remaining: null, announce: false };
    state.stableFor = allStable ? state.stableFor + dt : 0;
    const remaining = hasNext && allStable
      ? Math.max(0, 7 - state.stableFor, 12 - (time - state.lastSpawn)) : null;
    const announce = remaining !== null && remaining <= 3 && !state.preview;
    state.preview = remaining !== null && remaining <= 3;
    const help = hasNext && !allStable && !state.helpGiven && time - state.lastSpawn >= 25;
    if (help) state.helpGiven = true;
    if (remaining !== null && remaining <= 1e-8) {
      state.lastSpawn = time; state.stableFor = 0; state.helpGiven = false; state.preview = false;
      return { spawn: true, help: false, remaining: null, announce: false };
    }
    return { spawn: false, help, remaining, announce };
  }
  return { create, step };
});
