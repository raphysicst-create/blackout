'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const G = require('../grid.js');
function fixture(types = ['lamp', 'lamp', 'lamp', 'motor']) {
  const nodes = [{ id: 'source', type: 'source' }, ...G.feeders(), ...types.map((type, i) => ({ id: `load-${i}`, type }))];
  let count = 0;
  const make = (a, b, aPort, bPort) => ({ id: `e${++count}`, a, b, aPort, bPort, heat: 0 });
  const edges = G.infrastructure(make);
  const add = (a, b, aPort, bPort) => edges.push(make(a, b, aPort, bPort));
  const connect = (i, feeder = 'A') => { add(`feeder-${feeder}`, `load-${i}`, 'plus', 'left'); add(`load-${i}`, `feeder-${feeder}`, 'right', 'minus'); };
  return { nodes, edges, add, connect, analyze: () => E.analyze(nodes, edges) };
}
test('two distinct allocations serve every load within both circuit capacities', () => {
  for (const pair of [[0, 3], [1, 3]]) {
    const f = fixture();
    for (let i = 0; i < 4; i++) f.connect(i, pair.includes(i) ? 'A' : 'B');
    const a = f.analyze();
    assert.equal(a.allStable, true);
    for (const s of G.status(f.nodes, f.edges, a)) assert.ok(s.current > .55 && s.current < G.LIMIT);
  }
});
test('load terminal occupancy, source bypass, feeder bridge and mixed return are refused', () => {
  const f = fixture(); f.connect(0);
  for (const args of [
    ['source','load-1','plus','left'], ['feeder-A','feeder-B','plus','minus'],
    ['feeder-A','load-0','plus','left'],
  ]) assert.equal(G.canConnect(f.nodes, f.edges, ...args).ok, false);
  f.add('feeder-A','load-1','plus','left');
  assert.equal(G.canConnect(f.nodes, f.edges,'load-1','feeder-B','right','minus').ok, false);
  assert.equal(G.canConnect(f.nodes, f.edges,'load-1','feeder-A','right','minus').ok, true);
});
test('series loads have low voltage and removing the middle wire permits repair', () => {
  const f = fixture(['lamp','lamp']);
  f.add('feeder-A','load-0','plus','left'); f.add('load-0','load-1','right','left'); f.add('load-1','feeder-A','right','minus');
  const a = f.analyze();
  assert.ok(a.nodes['load-0'].voltage < .51 && a.nodes['load-1'].voltage < .51);
  assert.equal(a.allStable, false);
  const mid = f.edges.findIndex(e => e.a === 'load-0' && e.b === 'load-1');
  f.edges.splice(mid,1);
  f.add('load-0','feeder-A','right','minus'); f.add('feeder-A','load-1','plus','left');
  assert.equal(f.analyze().allStable, true);
});
test('overload trips only its own circuit at six seconds; unsafe reset is rejected', () => {
  const f = fixture();
  f.connect(0); f.connect(1); f.connect(3); f.connect(2,'B');
  let a = f.analyze(), broken = [];
  for (let i = 0; i < 119; i++) broken = E.tickHeat(f.edges,a,.05);
  assert.equal(broken.length,0);
  broken = E.tickHeat(f.edges,a,.05);
  assert.deepEqual(G.trip(f.nodes,f.edges,broken,a), ['feeder-A']);
  a = f.analyze();
  assert.equal(a.nodes['load-0'].powered,false);
  assert.ok(a.nodes['load-2'].brightness > .8);
  assert.equal(G.resetFeeder(E,f.nodes,f.edges,'feeder-A').ok,false);
  E.tickHeat(f.edges,a,3);
  assert.equal(G.resetFeeder(E,f.nodes,f.edges,'feeder-A').ok,false);
  for (let i = f.edges.length-1; i >= 0; i--) if (!f.edges[i].fixed && [f.edges[i].a,f.edges[i].b].includes('load-1')) f.edges.splice(i,1);
  f.connect(1,'B');
  assert.equal(G.resetFeeder(E,f.nodes,f.edges,'feeder-A').ok,true);
  assert.equal(f.analyze().allStable,true);
});
test('geometry and unlimited new branch length do not change circuit current', () => {
  const f = fixture(); f.connect(0); f.connect(3); f.connect(1,'B'); f.connect(2,'B');
  const before = f.analyze().totalCurrent;
  for (const e of f.edges) e.route = [{x:0,y:0},{x:100000,y:100000}];
  assert.equal(f.analyze().totalCurrent,before);
});
