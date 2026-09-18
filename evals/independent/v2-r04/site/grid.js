/* Fixed distribution circuits. Geometry never changes electrical capacity. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BlackoutGrid = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const LIMIT = .75;
  const isLoad = n => n && ['lamp', 'motor'].includes(n.type);
  function feeders() {
    return [
      { id: 'feeder-A', type: 'feeder', x: 410, y: 204, label: 'A / 주택 회선', tripped: false },
      { id: 'feeder-B', type: 'feeder', x: 410, y: 465, label: 'B / 공원 회선', tripped: false },
    ];
  }
  function infrastructure(makeWire) {
    return feeders().flatMap(n => ['plus', 'minus'].map(port => ({
      ...makeWire('source', n.id, port, port),
      id: `${n.id}-${port}`, fixed: true, feeder: n.id, capacity: LIMIT, open: false,
    })));
  }
  function group(nodes, edges, start) {
    const ids = new Set([start]), queue = [start];
    while (queue.length) {
      const id = queue.pop();
      // The feeder is a boundary, not a bridge into every other load.
      if (id !== start && nodes.find(n => n.id === id)?.type === 'feeder') continue;
      for (const e of edges) {
        if (e.fixed || (e.a !== id && e.b !== id)) continue;
        const other = e.a === id ? e.b : e.a;
        if (!ids.has(other)) { ids.add(other); queue.push(other); }
      }
    }
    return ids;
  }
  function canConnect(nodes, edges, a, b, aPort, bPort) {
    const from = nodes.find(n => n.id === a), to = nodes.find(n => n.id === b);
    if (!from || !to) return { ok: false, reason: '연결할 시설을 찾을 수 없어요.' };
    if (from.type === 'source' || to.type === 'source') return { ok: false, reason: '전원은 두 회선을 공급해요. A 또는 B 배전함의 단자에서 연결하세요.' };
    if (from.type === 'feeder' && to.type === 'feeder') return { ok: false, reason: '배전함끼리는 연결할 수 없어요. 시설의 전력을 A 또는 B로 나눠 주세요.' };
    for (const [n, port] of [[from, aPort], [to, bPort]]) {
      if (isLoad(n) && edges.some(e => (e.a === n.id && e.aPort === port) || (e.b === n.id && e.bPort === port))) {
        return { ok: false, reason: '이 단자에는 이미 전선이 있어요. 기존 전선을 선택해 끊은 뒤 옮겨 주세요.' };
      }
    }
    const candidate = [...edges, { a, b, aPort, bPort }];
    const ids = group(nodes, candidate, isLoad(from) ? a : b);
    if (nodes.filter(n => n.type === 'feeder' && ids.has(n.id)).length > 1) {
      return { ok: false, reason: '한 시설의 공급과 귀환은 같은 회선으로 이어 주세요. 옮길 때는 기존 두 전선을 먼저 끊으세요.' };
    }
    return { ok: true, reason: '' };
  }
  function assignment(nodes, edges, id) {
    const ids = group(nodes, edges, id);
    return nodes.find(n => n.type === 'feeder' && ids.has(n.id))?.id || null;
  }
  function status(nodes, edges, analysis) {
    return nodes.filter(n => n.type === 'feeder').map(n => {
      const conductors = edges.filter(e => e.feeder === n.id);
      return {
        id: n.id, label: n.label, tripped: n.tripped, tripCurrent: n.tripCurrent || 0, tripLoads: n.tripLoads || [],
        capacity: LIMIT,
        current: Math.max(0, ...conductors.map(e => analysis.edges[e.id]?.current || 0)),
        heat: Math.max(0, ...conductors.map(e => e.heat || 0)),
        loads: nodes.filter(isLoad).filter(load => assignment(nodes, edges, load.id) === n.id).map(n => n.id),
      };
    });
  }
  function trip(nodes, edges, ids, analysis) {
    const changed = [];
    for (const id of new Set(edges.filter(e => e.fixed && ids.includes(e.id)).map(e => e.feeder))) {
      const node = nodes.find(n => n.id === id);
      if (node.tripped) continue;
      node.tripCurrent = Math.max(...edges.filter(e => e.feeder === id).map(e => analysis.edges[e.id]?.current || 0));
      node.tripLoads = nodes.filter(isLoad).filter(n => assignment(nodes, edges, n.id) === id).map(n => n.id);
      node.tripped = true;
      for (const edge of edges.filter(e => e.feeder === id)) { edge.open = true; edge.heat = Math.max(edge.heat, 1); }
      changed.push(id);
    }
    return changed;
  }
  function resetFeeder(engine, nodes, edges, id) {
    const node = nodes.find(n => n.id === id && n.type === 'feeder');
    if (!node?.tripped) return { ok: false, reason: '이미 전력이 공급되고 있어요.' };
    if (edges.some(e => e.feeder === id && e.heat > 1e-9)) return { ok: false, reason: '회선이 식고 있어요. 잠시 뒤 다시 복구하세요.' };
    const candidate = edges.map(e => e.feeder === id ? { ...e, open: false } : e);
    const trial = engine.analyze(nodes, candidate);
    if (trial.shortCircuit || candidate.some(e => e.feeder === id && trial.edges[e.id]?.overloaded)) {
      return { ok: false, reason: '다시 켜면 같은 회선이 과부하돼요. 시설 일부를 다른 회선으로 옮기거나 연결을 끊으세요.' };
    }
    for (const edge of edges.filter(e => e.feeder === id)) edge.open = false;
    node.tripped = false;
    return { ok: true, reason: '' };
  }
  return { LIMIT, feeders, infrastructure, canConnect, group, assignment, status, trip, resetFeeder };
});
