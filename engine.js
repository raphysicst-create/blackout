/* BLACKOUT's deliberately small circuit model. No DOM or rendering dependencies. */
(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (root) root.BlackoutEngine = engine;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const EPSILON = 1e-9;
  const WIRE_CAPACITY = 0.75;
  const HEAT_LIMIT_SECONDS = 6;
  const COOLING_SECONDS = 3;
  const STABLE_BRIGHTNESS = 0.8;
  const RESISTANCE = Object.freeze({ lamp: 1 / 0.3, motor: 1 / 0.45 });

  function capacity(edge) {
    return Number.isFinite(edge.capacity) && edge.capacity >= 0
      ? edge.capacity : WIRE_CAPACITY;
  }

  function makeGraph(nodes, edges) {
    const byId = new Map();
    const links = new Map();
    const edgeIds = new Set();
    let valid = true;
    for (const node of nodes) {
      if (byId.has(node.id)) valid = false;
      byId.set(node.id, node);
      links.set(node.id, []);
    }
    for (const edge of edges) {
      if (edgeIds.has(edge.id)) valid = false;
      edgeIds.add(edge.id);
      if (!byId.has(edge.a) || !byId.has(edge.b) || edge.a === edge.b) {
        valid = false;
        continue;
      }
      links.get(edge.a).push({ nodeId: edge.b, edge });
      links.get(edge.b).push({ nodeId: edge.a, edge });
    }
    return { byId, links, valid };
  }

  function component(links, start) {
    const visited = new Set([start]);
    const pending = [start];
    while (pending.length) {
      const id = pending.pop();
      for (const link of links.get(id) || []) {
        if (visited.has(link.nodeId)) continue;
        visited.add(link.nodeId);
        pending.push(link.nodeId);
      }
    }
    return visited;
  }

  function canConnect(nodes, edges, from, to) {
    const graph = makeGraph(nodes, edges);
    if (!graph.byId.has(from) || !graph.byId.has(to)) {
      return { ok: false, reason: '연결할 시설을 찾을 수 없어요.' };
    }
    if (from === to) return { ok: false, reason: '다른 시설에 연결하세요.' };
    if (edges.some(edge => (edge.a === from && edge.b === to) ||
        (edge.a === to && edge.b === from))) {
      return { ok: false, reason: '이미 연결된 전선이에요.' };
    }
    const fromComponent = component(graph.links, from);
    if (fromComponent.has(to)) {
      return { ok: false, reason: '고리 대신 새로운 갈래로 연결하세요.' };
    }
    const toComponent = component(graph.links, to);
    const hasSource = ids => [...ids].some(id => graph.byId.get(id).type === 'source');
    if (hasSource(fromComponent) && hasSource(toComponent)) {
      return { ok: false, reason: '전원끼리는 연결할 수 없어요.' };
    }
    return { ok: true, reason: '' };
  }

  function analyze(nodes, edges) {
    const graph = makeGraph(nodes, edges);
    const result = {
      nodes: Object.create(null),
      edges: Object.create(null),
      totalCurrent: 0,
      allStable: false,
      hasParallel: false,
      hasSeries: false,
      branches: [],
    };
    for (const node of nodes) {
      result.nodes[node.id] = {
        powered: node.type === 'source', brightness: 0, current: 0,
        voltage: node.type === 'source' ? 1 : 0,
      };
    }
    for (const edge of edges) {
      result.edges[edge.id] = { current: 0, from: edge.a, to: edge.b, overloaded: false };
    }

    // Validate every component, including disconnected components. Traversing an
    // unexpected cycle remains safe, but a malformed circuit cannot win a run.
    const visited = new Set();
    const children = new Map();
    const traversal = [];
    function visit(start) {
      const pending = [{ id: start, parentEdge: null }];
      visited.add(start);
      while (pending.length) {
        const item = pending.pop();
        traversal.push(item.id);
        const next = [];
        children.set(item.id, next);
        for (const link of graph.links.get(item.id)) {
          if (link.edge === item.parentEdge) continue;
          if (visited.has(link.nodeId)) {
            graph.valid = false;
            continue;
          }
          visited.add(link.nodeId);
          next.push(link);
          pending.push({ id: link.nodeId, parentEdge: link.edge });
        }
      }
    }
    const sources = nodes.filter(node => node.type === 'source');
    const source = sources[0];
    if (source) visit(source.id);
    const poweredTraversal = traversal.slice();
    for (const node of nodes) if (!visited.has(node.id)) visit(node.id);
    if (sources.length !== 1) graph.valid = false;
    if (!source) return result;

    // This is a supply tree with an implicit return conductor at load leaves,
    // not a general one-wire circuit simulator. A load is in series with its
    // downstream branches; junction branches combine in parallel. Empty junction
    // branches are open circuits and do not remove an existing load's return.
    const equivalent = new Map();
    for (let i = poweredTraversal.length - 1; i >= 0; i -= 1) {
      const id = poweredTraversal[i];
      const node = graph.byId.get(id);
      const own = RESISTANCE[node.type] || 0;
      const conductance = children.get(id).reduce((sum, link) => {
        const resistance = equivalent.get(link.nodeId);
        return sum + (Number.isFinite(resistance) && resistance > 0 ? 1 / resistance : 0);
      }, 0);
      const downstream = conductance > 0 ? 1 / conductance : 0;
      equivalent.set(id, own + downstream || Infinity);
    }

    const supplyVoltage = new Map([[source.id, 1]]);
    for (const id of poweredTraversal) {
      const node = graph.byId.get(id);
      const state = result.nodes[id];
      const voltage = supplyVoltage.get(id) || 0;
      const resistance = equivalent.get(id);
      const current = Number.isFinite(resistance) ? voltage / resistance : 0;
      const own = RESISTANCE[node.type] || 0;
      const drop = current * own;
      const remainder = Math.max(0, voltage - drop);
      state.current = current;
      state.powered = node.type === 'source' || current > EPSILON;
      state.voltage = own ? drop : voltage;
      state.brightness = own ? Math.min(1, drop * drop) : (state.powered ? 1 : 0);
      let conductiveBranches = 0;
      const outgoing = [];
      for (const link of children.get(id)) {
        const childResistance = equivalent.get(link.nodeId);
        const branchCurrent = Number.isFinite(childResistance) ? remainder / childResistance : 0;
        const edgeState = result.edges[link.edge.id];
        edgeState.current = branchCurrent;
        edgeState.from = id;
        edgeState.to = link.nodeId;
        edgeState.overloaded = branchCurrent - capacity(link.edge) > EPSILON;
        supplyVoltage.set(link.nodeId, remainder);
        outgoing.push({ edgeId: link.edge.id, current: branchCurrent });
        if (branchCurrent > EPSILON) conductiveBranches += 1;
      }
      // Only expose real current splits. A terminal load can have several empty
      // stubs, but its current returns implicitly rather than through those stubs.
      if (conductiveBranches >= 2) result.branches.push({ nodeId: id, incoming: current, outgoing });
      if (conductiveBranches >= 2) result.hasParallel = true;
      if (own && current > EPSILON && conductiveBranches > 0) result.hasSeries = true;
    }
    result.totalCurrent = result.nodes[source.id].current;
    const loads = nodes.filter(node => RESISTANCE[node.type]);
    result.allStable = graph.valid && loads.length > 0 && loads.every(node => {
      const state = result.nodes[node.id];
      return state.powered && state.brightness + EPSILON >= STABLE_BRIGHTNESS;
    }) && edges.every(edge => !result.edges[edge.id].overloaded && !(edge.heat > EPSILON));
    return result;
  }

  function tickHeat(edges, analysis, dt) {
    const broken = [];
    if (!Number.isFinite(dt) || dt <= 0) return broken;
    for (const edge of edges) {
      const state = analysis.edges[edge.id];
      const heat = Number.isFinite(edge.heat) ? Math.max(0, Math.min(1, edge.heat)) : 0;
      // Heat is normalized 0..1: six overloaded seconds break a cold wire.
      // Safe wires cool to zero in at most three seconds; brief repeated spikes
      // can accumulate heat, matching the visible thermal warning.
      edge.heat = state && state.overloaded
        ? Math.min(1, heat + dt / HEAT_LIMIT_SECONDS)
        : Math.max(0, heat - dt / COOLING_SECONDS);
      if (edge.heat >= 1 - EPSILON) broken.push(edge.id);
    }
    return broken;
  }

  return Object.freeze({
    analyze, canConnect, tickHeat,
    WIRE_CAPACITY, HEAT_LIMIT_SECONDS, COOLING_SECONDS, STABLE_BRIGHTNESS,
  });
});
