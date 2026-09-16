'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../engine.js');
const node = (id, type = 'lamp') => ({ id, type, x: 0, y: 0 });
const wire = (id, a, aPort, b, bPort, extra = {}) => ({ id, a, aPort, b, bPort, ...extra });
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const simple = () => ({ nodes: [node('s', 'source'), node('a')], edges: [
  wire('feed', 's', 'plus', 'a', 'left'), wire('return', 'a', 'right', 's', 'minus'),
] });
const parallel = (count = 2, motor = false) => {
  const ids = Array.from({ length: count }, (_, i) => `a${i}`);
  const nodes = [node('s', 'source'), node('p', 'junction'), node('n', 'junction'),
    ...ids.map((id, i) => node(id, motor && i === count - 1 ? 'motor' : 'lamp'))];
  const edges = [wire('feed', 's', 'plus', 'p', 'joint'), wire('return', 'n', 'joint', 's', 'minus')];
  for (const id of ids) edges.push(wire(`${id}-in`, 'p', 'joint', id, 'left'), wire(`${id}-out`, id, 'right', 'n', 'joint'));
  return { nodes, edges };
};

test('supports a classic browser script without CommonJS', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../engine.js'), 'utf8'), context);
  assert.equal(typeof context.window.BlackoutEngine.analyze, 'function');
});
test('only explicit valid terminals can be connected', () => {
  const { nodes, edges } = simple();
  assert.deepEqual(engine.ports(nodes[0]), ['plus', 'minus']);
  assert.deepEqual(engine.ports(nodes[1]), ['left', 'right']);
  assert.deepEqual(engine.ports(node('j', 'junction')), ['joint']);
  for (const args of [['s', 'a'], ['s', 'a', 'left', 'right'], ['s', 'missing', 'plus', 'left'],
    ['s', 's', 'plus', 'plus'], ['a', 's', 'left', 'plus']]) {
    const answer = engine.canConnect(nodes, edges, ...args);
    assert.equal(answer.ok, false);
    assert.ok(answer.reason.length > 0);
  }
  assert.equal(engine.canConnect(nodes, [edges[0]], 'a', 's', 'right', 'minus').ok, true);
  assert.equal(engine.canConnect(nodes, edges, 's', 's', 'plus', 'minus').ok, true);
  assert.equal(engine.canConnect(nodes, edges, 'a', 'a', 'left', 'right').ok, true);
});
test('a single complete lamp circuit carries current on feed and return', () => {
  const { nodes, edges } = simple(), result = engine.analyze(nodes, edges);
  const expected = 1 / (1 / .3 + 2 * engine.WIRE_RESISTANCE + engine.SOURCE_RESISTANCE);
  near(result.totalCurrent, expected);
  near(result.nodes.a.current, expected);
  near(result.edges.feed.current, expected);
  near(result.edges.return.current, expected);
  near(result.nodes.a.brightness, (expected / .3) ** 2);
  assert.equal(result.nodes.a.powered, true);
  assert.equal(result.edges.feed.from, 's');
  assert.equal(result.edges.feed.fromPort, 'plus');
  assert.equal(result.edges.return.to, 's');
  assert.equal(result.edges.return.toPort, 'minus');
  assert.equal(result.allStable, true);
  assert.equal(result.hasParallel, false);
  assert.equal(result.hasSeries, false);
});
test('feed only, return only, and cutting either side leave a lamp off', () => {
  const { nodes, edges } = simple();
  for (const openEdges of [[], [edges[0]], [edges[1]]]) {
    const result = engine.analyze(nodes, openEdges);
    near(result.totalCurrent, 0);
    near(result.nodes.a.current, 0);
    near(result.nodes.a.brightness, 0);
    assert.equal(result.nodes.a.powered, false);
    assert.equal(result.allStable, false);
    for (const state of Object.values(result.edges)) near(state.current, 0);
  }
});
test('a circuit returning to the positive terminal has no driving voltage', () => {
  const { nodes, edges } = simple();
  edges[1].bPort = 'plus';
  const result = engine.analyze(nodes, edges);
  near(result.totalCurrent, 0);
  assert.equal(result.nodes.a.powered, false);
  assert.equal(result.shortCircuit, false);
  assert.equal(result.allStable, false);
});
test('two series lamps share current and are about one quarter bright', () => {
  const nodes = [node('s', 'source'), node('a'), node('b')];
  const edges = [wire('feed', 's', 'plus', 'a', 'left'), wire('middle', 'a', 'right', 'b', 'left'),
    wire('return', 'b', 'right', 's', 'minus')];
  const result = engine.analyze(nodes, edges);
  const expected = 1 / (2 / .3 + 3 * engine.WIRE_RESISTANCE + engine.SOURCE_RESISTANCE);
  for (const value of Object.values(result.edges)) near(value.current, expected);
  near(result.nodes.a.current, result.nodes.b.current);
  near(result.nodes.a.brightness, .25, .002);
  near(result.nodes.b.brightness, .25, .002);
  assert.equal(result.hasSeries, true);
  assert.equal(result.hasParallel, false);
  assert.equal(result.allStable, false);
});
test('parallel closed loops conserve current at feed and return junctions', () => {
  const { nodes, edges } = parallel(), result = engine.analyze(nodes, edges);
  near(result.edges.feed.current, result.edges.return.current);
  near(result.edges.feed.current, result.edges['a0-in'].current + result.edges['a1-in'].current);
  near(result.edges['a0-in'].current, result.edges['a0-out'].current);
  near(result.nodes.a0.current, result.nodes.a1.current);
  assert.ok(result.nodes.a0.brightness > .98);
  for (const branch of result.branches) near(branch.incoming, branch.outgoing.reduce((sum, item) => sum + item.current, 0));
  assert.equal(result.hasParallel, true);
  assert.equal(result.hasSeries, false);
  assert.equal(result.allStable, true);
});
test('one closed parallel branch works while its one-sided neighbor stays off', () => {
  const { nodes, edges } = parallel();
  const result = engine.analyze(nodes, edges.filter(edge => edge.id !== 'a1-out'));
  assert.equal(result.nodes.a0.powered, true);
  assert.equal(result.nodes.a1.powered, false);
  near(result.edges['a1-in'].current, 0);
  near(result.totalCurrent, result.nodes.a0.current);
  assert.equal(result.hasParallel, false);
  assert.equal(result.allStable, false);
});
test('a lamp and motor in parallel stay below the 0.75 A shared-wire limit', () => {
  const { nodes, edges } = parallel(2, true), result = engine.analyze(nodes, edges);
  near(result.nodes.a1.current / result.nodes.a0.current, 1.5, .001);
  assert.ok(result.totalCurrent < .75 && result.totalCurrent > .73);
  assert.equal(result.edges.feed.overloaded, false);
  assert.equal(result.edges.return.overloaded, false);
  assert.equal(result.allStable, true);
  assert.deepEqual(engine.tickHeat(edges, result, 20), []);
});
test('mixed series and parallel loops solve individual device voltage drops', () => {
  const { nodes, edges } = parallel();
  nodes.push(node('first'));
  edges[0] = wire('feed', 'first', 'right', 'p', 'joint');
  edges.push(wire('first-in', 's', 'plus', 'first', 'left'));
  const result = engine.analyze(nodes, edges);
  near(result.nodes.first.current, result.nodes.a0.current + result.nodes.a1.current);
  near(result.nodes.first.current, .2, .002);
  near(result.nodes.a0.current, .1, .002);
  assert.equal(result.hasSeries, true);
  assert.equal(result.hasParallel, true);
  assert.equal(result.allStable, false);
});
test('lamp and motor polarity can be reversed without changing their output', () => {
  const normal = parallel(2, true), reversed = structuredClone(normal);
  for (const edge of reversed.edges) {
    if (edge.aPort === 'right') edge.aPort = 'left';
    if (edge.bPort === 'left') edge.bPort = 'right';
    [edge.a, edge.b] = [edge.b, edge.a];
    [edge.aPort, edge.bPort] = [edge.bPort, edge.aPort];
  }
  const a = engine.analyze(normal.nodes, normal.edges), b = engine.analyze(reversed.nodes, reversed.edges);
  near(a.totalCurrent, b.totalCurrent);
  near(a.nodes.a0.brightness, b.nodes.a0.brightness);
  near(a.nodes.a1.brightness, b.nodes.a1.brightness);
  assert.equal(b.edges.feed.from, 's');
  assert.equal(b.edges.return.toPort, 'minus');
  assert.equal(b.allStable, true);
});
test('dangling wires and detached closed rings cannot invent current', () => {
  const { nodes, edges } = simple();
  const baseline = engine.analyze(nodes, edges);
  nodes.push(node('stub', 'junction'), node('j1', 'junction'), node('j2', 'junction'), node('floating'));
  edges.push(wire('stub', 'a', 'left', 'stub', 'joint'), wire('ring1', 'j1', 'joint', 'floating', 'left'),
    wire('ring2', 'floating', 'right', 'j2', 'joint'), wire('ring3', 'j2', 'joint', 'j1', 'joint'));
  const result = engine.analyze(nodes, edges);
  near(result.nodes.a.current, baseline.nodes.a.current);
  for (const id of ['stub', 'ring1', 'ring2', 'ring3']) near(result.edges[id].current, 0);
  assert.equal(result.nodes.floating.powered, false);
  assert.equal(result.nodes.stub.powered, false);
  assert.equal(result.allStable, false);
});
test('redundant wire loops are allowed and solve finite conserved current', () => {
  const { nodes, edges } = simple();
  nodes.push(node('j', 'junction'));
  edges.push(wire('loop1', 's', 'plus', 'j', 'joint'));
  assert.equal(engine.canConnect(nodes, edges, 'j', 'a', 'joint', 'left').ok, true);
  edges.push(wire('loop2', 'j', 'joint', 'a', 'left'));
  const result = engine.analyze(nodes, edges);
  near(result.edges.feed.current + result.edges.loop1.current, result.totalCurrent);
  near(result.edges.loop1.current, result.edges.loop2.current);
  assert.equal(result.shortCircuit, false);
  assert.equal(result.hasParallel, false); // Parallel wires are not parallel loads.
  assert.equal(result.allStable, true);
});
test('a wire across one series lamp bypasses it while the other lamp lights', () => {
  const nodes = [node('s', 'source'), node('a'), node('b')];
  const edges = [wire('feed', 's', 'plus', 'a', 'left'), wire('middle', 'a', 'right', 'b', 'left'),
    wire('return', 'b', 'right', 's', 'minus'), wire('bypass', 'a', 'left', 'a', 'right')];
  const result = engine.analyze(nodes, edges);
  assert.equal(result.nodes.a.bypassed, true);
  assert.equal(result.nodes.a.powered, false);
  near(result.nodes.a.current, 0);
  assert.ok(result.nodes.b.brightness > .98);
  near(result.edges.bypass.current, result.totalCurrent);
  assert.equal(result.edges.bypass.fromPort, 'left');
  assert.equal(result.shortCircuit, false);
  assert.equal(result.allStable, false);
});
test('a direct battery short is finite, lights no loads, and overheats actual wires', () => {
  const { nodes, edges } = simple();
  edges.push(wire('short', 's', 'minus', 's', 'plus'));
  const result = engine.analyze(nodes, edges);
  near(result.totalCurrent, 1 / (engine.WIRE_RESISTANCE + engine.SOURCE_RESISTANCE));
  assert.equal(result.shortCircuit, true);
  assert.equal(result.nodes.a.powered, false);
  near(result.edges.feed.current, 0);
  near(result.edges.return.current, 0);
  assert.equal(result.edges.short.fromPort, 'plus');
  assert.equal(result.edges.short.toPort, 'minus');
  assert.equal(result.edges.short.overloaded, true);
  assert.equal(result.allStable, false);
  assert.deepEqual(engine.tickHeat(edges, result, 6), ['short']);
});
test('joining positive and negative through the same lamp terminal is also a short', () => {
  const { nodes, edges } = simple();
  edges[1].aPort = 'left';
  const result = engine.analyze(nodes, edges);
  assert.equal(result.shortCircuit, true);
  assert.equal(result.nodes.a.powered, false);
  assert.equal(result.edges.feed.overloaded, true);
  assert.equal(result.edges.return.overloaded, true);
  assert.equal(result.allStable, false);
});
test('three parallel lamps overload both shared conductors and break at six seconds', () => {
  const { nodes, edges } = parallel(3), result = engine.analyze(nodes, edges);
  assert.ok(result.totalCurrent > .88 && result.totalCurrent < .9);
  assert.equal(result.edges.feed.overloaded, true);
  assert.equal(result.edges.return.overloaded, true);
  assert.equal(result.allStable, false);
  for (let i = 0; i < 59; i += 1) assert.deepEqual(engine.tickHeat(edges, result, .1), []);
  assert.deepEqual(engine.tickHeat(edges, result, .1), ['feed', 'return']);
  near(edges[0].heat, 1);
  near(edges[1].heat, 1);
  near(edges[2].heat, 0);
});
test('a cut return opens the whole shared circuit and repair restores it', () => {
  const { nodes, edges } = parallel(), remaining = edges.filter(edge => edge.id !== 'return');
  let result = engine.analyze(nodes, remaining);
  near(result.totalCurrent, 0);
  assert.equal(result.nodes.a0.powered, false);
  assert.equal(result.nodes.a1.powered, false);
  remaining.push(wire('repair', 's', 'minus', 'n', 'joint'));
  result = engine.analyze(nodes, remaining);
  assert.equal(result.allStable, true);
  assert.equal(result.edges.repair.from, 'n');
  assert.equal(result.edges.repair.toPort, 'minus');
});
test('safe or open wires cool and residual heat prevents premature success', () => {
  const { nodes, edges } = simple();
  edges[1].capacity = .2;
  let result = engine.analyze(nodes, edges);
  assert.deepEqual(engine.tickHeat(edges, result, 3), []);
  near(edges[1].heat, .5);
  edges[1].capacity = .75;
  result = engine.analyze(nodes, edges);
  assert.equal(result.allStable, false);
  assert.deepEqual(engine.tickHeat(edges, result, 1.5), []);
  near(edges[1].heat, 0);
  assert.equal(engine.analyze(nodes, edges).allStable, true);
  edges[0].heat = .4;
  engine.tickHeat(edges, { edges: {} }, 3);
  near(edges[0].heat, 0);
});
test('three lamps and motor stabilize with two feeds and two explicit returns', () => {
  const nodes = [node('s', 'source'), ...['p1', 'n1', 'p2', 'n2'].map(id => node(id, 'junction')),
    node('a'), node('b'), node('c'), node('m', 'motor')];
  const edges = [];
  for (const [group, ids] of [[1, ['a', 'b']], [2, ['c', 'm']]]) {
    edges.push(wire(`feed${group}`, 's', 'plus', `p${group}`, 'joint'),
      wire(`return${group}`, `n${group}`, 'joint', 's', 'minus'));
    for (const id of ids) edges.push(wire(`${id}-in`, `p${group}`, 'joint', id, 'left'),
      wire(`${id}-out`, id, 'right', `n${group}`, 'joint'));
  }
  const result = engine.analyze(nodes, edges);
  near(result.edges.feed1.current, result.edges.return1.current);
  near(result.edges.feed2.current, result.edges.return2.current);
  assert.ok(result.edges.feed1.current > .58 && result.edges.feed1.current < .6);
  assert.ok(result.edges.feed2.current > .73 && result.edges.feed2.current < .75);
  for (const id of ['a', 'b', 'c', 'm']) assert.ok(result.nodes[id].brightness > .96);
  assert.equal(result.allStable, true);
  assert.equal(result.hasParallel, true);
  assert.equal(result.hasSeries, false);
  assert.deepEqual(engine.tickHeat(edges, result, 300), []);
});
test('missing or invalid ports never receive an implicit return', () => {
  const { nodes, edges } = simple();
  for (const badEdges of [[{ id: 'legacy', a: 's', b: 'a' }],
    [edges[0], { ...edges[1], aPort: undefined }], [edges[0], { ...edges[1], bPort: 'ground' }]]) {
    const result = engine.analyze(nodes, badEdges);
    assert.equal(result.nodes.a.powered, false);
    assert.equal(result.allStable, false);
    near(result.totalCurrent, 0);
  }
});
test('malformed topology remains finite and cannot win', () => {
  const { nodes, edges } = simple();
  for (const extra of [wire('missing', 's', 'plus', 'missing', 'left'), wire('self', 'a', 'left', 'a', 'left'),
    wire('duplicate', 'a', 'left', 's', 'plus'), wire('feed', 'a', 'right', 's', 'minus')]) {
    const result = engine.analyze(nodes, [...edges, extra]);
    assert.equal(result.allStable, false);
    assert.ok(Number.isFinite(result.totalCurrent));
  }
  assert.equal(engine.analyze([], []).allStable, false);
  assert.equal(engine.analyze([node('s', 'source')], []).allStable, false);
  assert.equal(engine.analyze([node('s', 'source'), node('s2', 'source')], []).allStable, false);
});
