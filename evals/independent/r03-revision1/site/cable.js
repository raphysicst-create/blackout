(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BlackoutCable = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const budgets = Object.freeze([1350, 3250, 4600, 5900]);
  function length(route) {
    if (!Array.isArray(route) || route.length < 2 || route.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return Infinity;
    let total = 0;
    for (let i = 1; i < route.length; i++) total += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
    return total;
  }
  function status(edges, count) {
    const budget = budgets[Math.max(0, Math.min(3, count - 1))];
    const used = edges.reduce((sum, edge) => sum + length(edge.route), 0);
    return { budget, used, remaining: budget - used };
  }
  function canAdd(edges, count, route) {
    return length(route) <= status(edges, count).remaining + 1e-6;
  }
  return { budgets, length, status, canAdd };
});
