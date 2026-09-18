(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BlackoutTelemetry = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  function create(meta = {}, clock = () => performance.now()) {
    const started = clock();
    const events = [];
    let sequence = 0;
    return {
      record(event, activeSeconds, payload = {}) {
        events.push({ eventSeq: ++sequence, wallMs: Math.round(clock() - started),
          activeMs: Math.round(activeSeconds * 1000), event, payload: JSON.parse(JSON.stringify(payload)) });
      },
      export() { return JSON.parse(JSON.stringify({ schemaVersion: 1, ...meta, events })); },
    };
  }
  return { create };
});
