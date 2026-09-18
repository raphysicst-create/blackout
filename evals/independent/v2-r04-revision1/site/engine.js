/* Explicit two-terminal DC model. No DOM dependencies. */
(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (root) root.BlackoutEngine = engine;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const EPSILON = 1e-9;
  const WIRE_CAPACITY = 0.75;
  const WIRE_RESISTANCE = 0.002;
  const SOURCE_RESISTANCE = 0.01;
  const HEAT_LIMIT_SECONDS = 6;
  const COOLING_SECONDS = 3;
  const STABLE_BRIGHTNESS = 0.8;
  const RESISTANCE = Object.freeze({ lamp: 1 / 0.3, motor: 1 / 0.45 });
  const PORTS = Object.freeze({
    source: Object.freeze(['plus', 'minus']),
    feeder: Object.freeze(['plus', 'minus']),
    lamp: Object.freeze(['left', 'right']),
    motor: Object.freeze(['left', 'right']),
    junction: Object.freeze(['joint']),
  });
  function ports(node) { return PORTS[node && node.type] || []; }
  function validPort(node, port) { return ports(node).includes(port); }
  function terminal(id, port) { return JSON.stringify([id, port]); }
  function capacity(edge) {
    return Number.isFinite(edge.capacity) && edge.capacity >= 0 ? edge.capacity : WIRE_CAPACITY;
  }
  function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

  function graphOf(nodes, edges) {
    const byId = new Map(), terminals = new Map(), links = new Map();
    const edgeIds = new Set(), pairs = new Set(), wires = [];
    let valid = true;
    for (const node of nodes) {
      if (byId.has(node.id) || !ports(node).length) valid = false;
      byId.set(node.id, node);
      for (const port of ports(node)) {
        const key = terminal(node.id, port);
        terminals.set(key, { nodeId: node.id, port });
        links.set(key, []);
      }
    }
    for (const edge of edges) {
      const a = terminal(edge.a, edge.aPort), b = terminal(edge.b, edge.bPort);
      const pair = pairKey(a, b);
      if (edgeIds.has(edge.id) || pairs.has(pair) || a === b ||
          !validPort(byId.get(edge.a), edge.aPort) || !validPort(byId.get(edge.b), edge.bPort)) {
        valid = false;
        continue;
      }
      edgeIds.add(edge.id);
      pairs.add(pair);
      const wire = { id: edge.id, a, b, resistance: WIRE_RESISTANCE, edge, kind: 'wire' };
      wires.push(wire);
      links.get(a).push(b);
      links.get(b).push(a);
    }
    return { byId, terminals, links, wires, valid };
  }
  function component(links, start) {
    const seen = new Set([start]), pending = [start];
    while (pending.length) {
      for (const next of links.get(pending.pop()) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        pending.push(next);
      }
    }
    return seen;
  }
  function canConnect(nodes, edges, from, to, fromPort, toPort) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    if (!byId.has(from) || !byId.has(to)) return { ok: false, reason: '연결할 시설을 찾을 수 없어요.' };
    if (!validPort(byId.get(from), fromPort) || !validPort(byId.get(to), toPort)) {
      return { ok: false, reason: '장치의 연결 단자에서 다른 단자로 연결하세요.' };
    }
    if (from === to && fromPort === toPort) return { ok: false, reason: '같은 단자에는 연결할 수 없어요.' };
    if (edges.some(edge =>
      (edge.a === from && edge.aPort === fromPort && edge.b === to && edge.bPort === toPort) ||
      (edge.b === from && edge.bPort === fromPort && edge.a === to && edge.aPort === toPort))) {
      return { ok: false, reason: '이미 연결된 두 단자예요.' };
    }
    // Loops are required. A same-device connection can be a bypass or short.
    return { ok: true, reason: '' };
  }
  function solve(matrix, rhs) {
    const size = rhs.length;
    for (let col = 0; col < size; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < size; row += 1) {
        if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
      }
      if (Math.abs(matrix[pivot][col]) < 1e-12) return null;
      [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
      [rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]];
      for (let row = col + 1; row < size; row += 1) {
        const factor = matrix[row][col] / matrix[col][col];
        if (!factor) continue;
        matrix[row][col] = 0;
        for (let k = col + 1; k < size; k += 1) matrix[row][k] -= factor * matrix[col][k];
        rhs[row] -= factor * rhs[col];
      }
    }
    const values = Array(size).fill(0);
    for (let row = size - 1; row >= 0; row -= 1) {
      let value = rhs[row];
      for (let col = row + 1; col < size; col += 1) value -= matrix[row][col] * values[col];
      values[row] = value / matrix[row][row];
      if (!Number.isFinite(values[row])) return null;
    }
    return values;
  }

  function analyze(nodes, edges) {
    const graph = graphOf(nodes, edges.filter(edge => !edge.open));
    const result = {
      nodes: Object.create(null), edges: Object.create(null), totalCurrent: 0,
      allStable: false, hasParallel: false, hasSeries: false, branches: [], shortCircuit: false,
    };
    for (const node of nodes) result.nodes[node.id] = {
      powered: node.type === 'source', brightness: node.type === 'source' ? 1 : 0,
      current: 0, voltage: node.type === 'source' ? 1 : 0,
      terminals: Object.fromEntries(ports(node).map(port => [port, 0])),
    };
    for (const edge of edges) result.edges[edge.id] = {
      current: 0, from: edge.a, to: edge.b, fromPort: edge.aPort, toPort: edge.bPort,
      overloaded: false,
    };
    const sources = nodes.filter(node => node.type === 'source');
    if (sources.length !== 1) return result;
    const source = sources[0], positive = terminal(source.id, 'plus'), negative = terminal(source.id, 'minus');
    // Wire-only nets never join a device's two terminals.
    const netOf = new Map(), nets = [];
    for (const key of graph.terminals.keys()) {
      if (netOf.has(key)) continue;
      const members = component(graph.links, key), id = nets.length;
      nets.push(members);
      for (const member of members) netOf.set(member, id);
    }
    result.shortCircuit = netOf.get(positive) === netOf.get(negative);
    const resistors = graph.wires.slice(), loads = [];
    for (const node of nodes) {
      if (!RESISTANCE[node.type]) continue;
      const a = terminal(node.id, 'left'), b = terminal(node.id, 'right');
      const bypassed = netOf.get(a) === netOf.get(b);
      result.nodes[node.id].bypassed = bypassed;
      // Bypassed devices stay off. Under a direct short, load supply is tripped;
      // current still heats the actual shorting wires and can break them.
      if (bypassed || result.shortCircuit) continue;
      const resistance = Number.isFinite(node.nominalCurrent) && node.nominalCurrent > 0 ? 1 / node.nominalCurrent : RESISTANCE[node.type];
      const load = { id: node.id, a, b, resistance, kind: 'load' };
      loads.push(load);
      resistors.push(load);
    }
    const links = new Map([...graph.links].map(([key, value]) => [key, value.slice()]));
    for (const load of loads) { links.get(load.a).push(load.b); links.get(load.b).push(load.a); }
    // Floating components have no source and carry zero current. Exclude them
    // from the source-referenced nodal system to avoid singular matrices.
    const active = new Set([...component(links, positive), ...component(links, negative)]);
    const unknowns = [...active].filter(key => key !== negative);
    const index = new Map(unknowns.map((key, i) => [key, i]));
    const matrix = unknowns.map(() => Array(unknowns.length).fill(0)), rhs = Array(unknowns.length).fill(0);
    for (const resistor of resistors) {
      if (!active.has(resistor.a) || !active.has(resistor.b)) continue;
      const a = index.get(resistor.a), b = index.get(resistor.b), g = 1 / resistor.resistance;
      if (a !== undefined) matrix[a][a] += g;
      if (b !== undefined) matrix[b][b] += g;
      if (a !== undefined && b !== undefined) { matrix[a][b] -= g; matrix[b][a] -= g; }
    }
    // The ideal normalized 1 V cell is behind a finite internal resistance.
    const sourceIndex = index.get(positive);
    matrix[sourceIndex][sourceIndex] += 1 / SOURCE_RESISTANCE;
    rhs[sourceIndex] += 1 / SOURCE_RESISTANCE;
    const solution = solve(matrix, rhs);
    if (!solution) return result;
    const potentials = new Map([[negative, 0]]);
    for (const [key, i] of index) potentials.set(key, Math.max(0, Math.min(1, solution[i])));
    for (const [key, info] of graph.terminals) result.nodes[info.nodeId].terminals[info.port] = potentials.get(key) || 0;
    const flow = new Map([...graph.terminals.keys()].map(key => [key, { incoming: [], outgoing: [] }]));
    const clean = value => Math.abs(value) < EPSILON ? 0 : value;
    const netLoads = nets.map(() => ({ incoming: 0, outgoing: 0 }));
    for (const resistor of resistors) {
      const delta = (potentials.get(resistor.a) || 0) - (potentials.get(resistor.b) || 0);
      const signed = clean(delta / resistor.resistance), current = Math.abs(signed);
      const fromKey = signed >= 0 ? resistor.a : resistor.b, toKey = signed >= 0 ? resistor.b : resistor.a;
      const from = graph.terminals.get(fromKey), to = graph.terminals.get(toKey);
      if (resistor.kind === 'wire') Object.assign(result.edges[resistor.id], {
        current, from: from.nodeId, to: to.nodeId, fromPort: from.port, toPort: to.port,
        overloaded: current - capacity(resistor.edge) > EPSILON,
      });
      else {
        Object.assign(result.nodes[resistor.id], {
          current, voltage: Math.abs(delta), brightness: current ? Math.min(1, delta * delta) : 0,
          powered: current > EPSILON,
        });
        if (current > EPSILON) {
          netLoads[netOf.get(fromKey)].outgoing += 1;
          netLoads[netOf.get(toKey)].incoming += 1;
        }
      }
      if (current > EPSILON) {
        const item = { edgeId: resistor.kind === 'wire' ? resistor.id : null,
          deviceId: resistor.kind === 'load' ? resistor.id : null, current };
        flow.get(fromKey).outgoing.push(item);
        flow.get(toKey).incoming.push(item);
      }
    }
    result.totalCurrent = clean(Math.max(0, (1 - potentials.get(positive)) / SOURCE_RESISTANCE));
    Object.assign(result.nodes[source.id], {
      current: result.totalCurrent, voltage: potentials.get(positive), brightness: 1, powered: true,
    });
    if (result.totalCurrent > EPSILON) {
      const supply = { edgeId: null, deviceId: source.id, current: result.totalCurrent };
      flow.get(positive).incoming.push(supply);
      flow.get(negative).outgoing.push(supply);
    }
    for (const [key, currents] of flow) {
      const info = graph.terminals.get(key), node = graph.byId.get(info.nodeId);
      const incoming = currents.incoming.reduce((sum, item) => sum + item.current, 0);
      if (node.type === 'junction') Object.assign(result.nodes[node.id], {
        current: incoming, voltage: potentials.get(key) || 0,
        powered: incoming > EPSILON, brightness: incoming > EPSILON ? 1 : 0,
      });
      if (currents.outgoing.length >= 2) result.branches.push({
        nodeId: info.nodeId, port: info.port, incoming, outgoing: currents.outgoing,
      });
    }
    result.hasParallel = netLoads.some(net => net.incoming >= 2 || net.outgoing >= 2);
    result.hasSeries = netLoads.some((net, id) => net.incoming > 0 && net.outgoing > 0 &&
      id !== netOf.get(positive) && id !== netOf.get(negative));
    const allLoads = nodes.filter(node => RESISTANCE[node.type]);
    result.allStable = graph.valid && !result.shortCircuit && allLoads.length > 0 && allLoads.every(node => {
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
      edge.heat = state && state.overloaded
        ? Math.min(1, heat + dt / HEAT_LIMIT_SECONDS)
        : Math.max(0, heat - dt / COOLING_SECONDS);
      if (edge.heat >= 1 - EPSILON) broken.push(edge.id);
    }
    return broken;
  }
  return Object.freeze({
    analyze, canConnect, tickHeat, ports, validPort,
    WIRE_CAPACITY, WIRE_RESISTANCE, SOURCE_RESISTANCE,
    HEAT_LIMIT_SECONDS, COOLING_SECONDS, STABLE_BRIGHTNESS,
  });
});
