'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../engine.js');

const node = (id, type = 'lamp') => ({ id, type, x: 0, y: 0 });
const wire = (a, b, extra = {}) => ({ id: `${a}-${b}`, a, b, ...extra });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('supports a classic browser script without CommonJS', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../engine.js'), 'utf8'), context);
  assert.equal(typeof context.window.BlackoutEngine.analyze, 'function');
});

test('single lamp illuminates at 0.30 A', () => {
  const result = engine.analyze([node('s', 'source'), node('a')], [wire('s', 'a')]);
  near(result.totalCurrent, 0.3);
  near(result.nodes.a.brightness, 1);
  near(result.nodes.a.voltage, 1);
  assert.equal(result.allStable, true);
  assert.equal(result.hasSeries, false);
  assert.equal(result.hasParallel, false);
});

test('two series lamps have equal currents and dim to one quarter brightness', () => {
  const result = engine.analyze([node('s', 'source'), node('a'), node('b')], [wire('s', 'a'), wire('a', 'b')]);
  near(result.edges['s-a'].current, 0.15);
  near(result.edges['a-b'].current, 0.15);
  near(result.nodes.a.brightness, 0.25);
  near(result.nodes.b.brightness, 0.25);
  assert.equal(result.hasSeries, true);
  assert.equal(result.hasParallel, false);
  assert.equal(result.allStable, false);
});

test('parallel lamps keep full brightness and conserve current at a junction', () => {
  const result = engine.analyze([node('s', 'source'), node('j', 'junction'), node('a'), node('b')],
    [wire('s', 'j'), wire('j', 'a'), wire('j', 'b')]);
  near(result.edges['s-j'].current, 0.6);
  near(result.edges['j-a'].current, 0.3);
  near(result.edges['j-b'].current, 0.3);
  near(result.nodes.a.brightness, 1);
  near(result.nodes.b.brightness, 1);
  const branch = result.branches.find(item => item.nodeId === 'j');
  near(branch.incoming, branch.outgoing.reduce((sum, item) => sum + item.current, 0));
  assert.equal(result.hasParallel, true);
  assert.equal(result.allStable, true);
});

test('a motor draws 0.45 A, and 0.75 A is safe despite floating point rounding', () => {
  const nodes = [node('s', 'source'), node('j', 'junction'), node('a'), node('m', 'motor')];
  const edges = [wire('s', 'j'), wire('j', 'a'), wire('j', 'm')];
  const result = engine.analyze(nodes, edges);
  near(result.totalCurrent, 0.75);
  near(result.nodes.m.current, 0.45);
  near(result.nodes.m.brightness, 1);
  assert.equal(result.edges['s-j'].overloaded, false);
  assert.equal(result.allStable, true);
  assert.deepEqual(engine.tickHeat(edges, result, 20), []);
});

test('a load before two parallel loads has its own drop and conserves branch current', () => {
  const result = engine.analyze([node('s', 'source'), node('a'), node('j', 'junction'), node('b'), node('c')],
    [wire('s', 'a'), wire('a', 'j'), wire('j', 'b'), wire('j', 'c')]);
  near(result.nodes.a.current, 0.2);
  near(result.nodes.b.current, 0.1);
  near(result.nodes.c.current, 0.1);
  near(result.nodes.a.voltage + result.nodes.b.voltage, 1);
  assert.equal(result.hasParallel, true);
  assert.equal(result.hasSeries, true);
  assert.equal(result.allStable, false);
});

test('detached loads cannot produce success, but detached branches can re-root', () => {
  const nodes = [node('s', 'source'), node('a'), node('j', 'junction'), node('b')];
  const edges = [wire('s', 'a'), wire('b', 'j')];
  let result = engine.analyze(nodes, edges);
  assert.equal(result.nodes.b.powered, false);
  assert.equal(result.nodes.s.powered, true);
  assert.equal(result.edges['b-j'].current, 0);
  assert.equal(result.allStable, false);
  assert.equal(engine.canConnect(nodes, edges, 'j', 's').ok, true);
  edges.push(wire('j', 's'));
  result = engine.analyze(nodes, edges);
  assert.equal(result.edges['b-j'].from, 'j');
  assert.equal(result.edges['b-j'].to, 'b');
  assert.equal(result.nodes.b.powered, true);
  assert.equal(result.allStable, true);
  const rootBranch = result.branches.find(item => item.nodeId === 's');
  near(rootBranch.incoming, 0.6);
});

test('dangling junctions are open circuits and do not dim an existing lamp', () => {
  const result = engine.analyze([node('s', 'source'), node('a'), node('j', 'junction')],
    [wire('s', 'a'), wire('a', 'j')]);
  near(result.nodes.a.brightness, 1);
  near(result.edges['a-j'].current, 0);
  assert.equal(result.nodes.j.powered, false);
  assert.equal(result.hasSeries, false);
  assert.equal(result.hasParallel, false);
});

test('rejects self loops, duplicates, missing endpoints, cycles and joined sources', () => {
  const nodes = [node('s', 'source'), node('a'), node('b'), node('s2', 'source')];
  const edges = [wire('s', 'a'), wire('a', 'b')];
  for (const [a, b] of [['a', 'a'], ['a', 's'], ['s', 'b'], ['s', 'missing'], ['s2', 'b']]) {
    const result = engine.canConnect(nodes, edges, a, b);
    assert.equal(result.ok, false);
    assert.ok(result.reason.length > 0);
  }
});

test('unexpected malformed and cyclic input remains finite and cannot win', () => {
  const nodes = [node('s', 'source'), node('a'), node('b')];
  for (const edges of [
    [wire('s', 'a'), wire('a', 'b'), wire('b', 's')],
    [wire('s', 'a'), wire('s', 'b'), wire('s', 'missing')],
    [wire('s', 'a'), wire('s', 'b'), wire('a', 'a')],
  ]) {
    const result = engine.analyze(nodes, edges);
    assert.equal(result.allStable, false);
    assert.ok(Number.isFinite(result.totalCurrent));
  }
  assert.equal(engine.analyze([], []).allStable, false);
  assert.equal(engine.analyze([node('s', 'source')], []).allStable, false);
});

test('three parallel lamps overload the shared main and break after six seconds', () => {
  const nodes = [node('s', 'source'), node('j', 'junction'), node('a'), node('b'), node('c')];
  const edges = [wire('s', 'j'), wire('j', 'a'), wire('j', 'b'), wire('j', 'c')];
  const result = engine.analyze(nodes, edges);
  near(result.totalCurrent, 0.9);
  assert.equal(result.edges['s-j'].overloaded, true);
  assert.equal(result.allStable, false);
  for (let i = 0; i < 59; i += 1) assert.deepEqual(engine.tickHeat(edges, result, 0.1), []);
  assert.deepEqual(engine.tickHeat(edges, result, 0.1), ['s-j']);
  near(edges[0].heat, 1);
  assert.equal(edges[1].heat, 0);
});

test('heat cools on safe or disconnected wires and cannot cause premature success', () => {
  const nodes = [node('s', 'source'), node('a')];
  const edges = [wire('s', 'a', { capacity: 0.2 })];
  let result = engine.analyze(nodes, edges);
  assert.deepEqual(engine.tickHeat(edges, result, 3), []);
  near(edges[0].heat, 0.5);
  edges[0].capacity = 0.75;
  result = engine.analyze(nodes, edges);
  assert.equal(result.allStable, false);
  assert.deepEqual(engine.tickHeat(edges, result, 1.5), []);
  near(edges[0].heat, 0);
  assert.equal(engine.analyze(nodes, edges).allStable, true);
  edges[0].heat = 0.4;
  engine.tickHeat(edges, { edges: {} }, 3);
  near(edges[0].heat, 0);
});

test('the final three lamps and motor are solvable through two independent mains', () => {
  const nodes = [node('s', 'source'), node('j1', 'junction'), node('j2', 'junction'),
    node('a'), node('b'), node('c'), node('m', 'motor')];
  const edges = [wire('s', 'j1'), wire('s', 'j2'), wire('j1', 'a'), wire('j1', 'b'),
    wire('j2', 'c'), wire('j2', 'm')];
  const result = engine.analyze(nodes, edges);
  near(result.totalCurrent, 1.35);
  near(result.edges['s-j1'].current, 0.6);
  near(result.edges['s-j2'].current, 0.75);
  for (const id of ['a', 'b', 'c', 'm']) near(result.nodes[id].brightness, 1);
  for (const branch of result.branches) {
    near(branch.incoming, branch.outgoing.reduce((sum, item) => sum + item.current, 0));
  }
  assert.equal(result.allStable, true);
  assert.equal(result.hasParallel, true);
  assert.equal(result.hasSeries, false);
  assert.deepEqual(engine.tickHeat(edges, result, 300), []);
});

test('an energized source with only open branches cannot report load success or parallel current', () => {
  const result = engine.analyze([node('s', 'source'), node('j1', 'junction'), node('j2', 'junction')],
    [wire('s', 'j1'), wire('s', 'j2')]);
  assert.equal(result.nodes.s.powered, true);
  near(result.nodes.s.brightness, 1);
  near(result.totalCurrent, 0);
  assert.equal(result.nodes.j1.powered, false);
  assert.equal(result.nodes.j2.powered, false);
  assert.equal(result.hasParallel, false);
  assert.equal(result.hasSeries, false);
  assert.equal(result.allStable, false);
});

test('unequal series devices share current while their normalized output differs', () => {
  const result = engine.analyze([node('s', 'source'), node('a'), node('m', 'motor')],
    [wire('s', 'a'), wire('a', 'm')]);
  near(result.nodes.a.current, 0.18);
  near(result.nodes.m.current, 0.18);
  near(result.nodes.a.voltage, 0.6);
  near(result.nodes.m.voltage, 0.4);
  near(result.nodes.a.brightness, 0.36);
  near(result.nodes.m.brightness, 0.16);
  assert.equal(result.hasSeries, true);
  assert.equal(result.allStable, false);
});

test('unused junction branches do not prevent a four-load network from stabilizing', () => {
  const nodes = [node('s', 'source'), node('a'), node('b'), node('c'), node('m', 'motor'),
    node('j1', 'junction'), node('j2', 'junction'), node('j3', 'junction')];
  const edges = [wire('s', 'a'), wire('s', 'b'), wire('s', 'c'), wire('s', 'm'),
    wire('a', 'j1'), wire('a', 'j2'), wire('j2', 'j3')];
  const result = engine.analyze(nodes, edges);
  near(result.totalCurrent, 1.35);
  for (const id of ['a', 'b', 'c', 'm']) near(result.nodes[id].brightness, 1);
  for (const id of ['a-j1', 'a-j2', 'j2-j3']) near(result.edges[id].current, 0);
  assert.equal(result.hasParallel, true);
  assert.equal(result.hasSeries, false);
  assert.equal(result.allStable, true);
  assert.equal(result.branches.some(branch => branch.nodeId === 'a'), false);
  for (const branch of result.branches) {
    near(branch.incoming, branch.outgoing.reduce((sum, item) => sum + item.current, 0));
  }
});

test('removing a burnt main immediately extinguishes descendants and allows a reversed repair', () => {
  const nodes = [node('s', 'source'), node('j', 'junction'), node('a'), node('b'), node('c')];
  let edges = [wire('s', 'j'), wire('j', 'a'), wire('j', 'b'), wire('j', 'c')];
  let result = engine.analyze(nodes, edges);
  const broken = engine.tickHeat(edges, result, 6);
  edges = edges.filter(edge => !broken.includes(edge.id));
  result = engine.analyze(nodes, edges);
  near(result.totalCurrent, 0);
  for (const id of ['a', 'b', 'c']) assert.equal(result.nodes[id].powered, false);
  assert.equal(result.allStable, false);
  edges = edges.filter(edge => edge.id !== 'j-c');
  assert.equal(engine.canConnect(nodes, edges, 'j', 's').ok, true);
  edges.push(wire('j', 's'), wire('c', 's'));
  result = engine.analyze(nodes, edges);
  assert.equal(result.allStable, true);
  near(result.edges['j-s'].current, 0.6);
  near(result.edges['c-s'].current, 0.3);
  assert.equal(result.edges['j-s'].from, 's');
  assert.equal(result.edges['c-s'].from, 's');
});
