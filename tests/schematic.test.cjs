'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../engine.js');
const { render } = require('../schematic.js');

const node = (id, type = 'lamp', x = 0, y = 0) => ({ id, type, x, y });
const source = () => node('source', 'source');
const wire = (id, a, aPort, b, bPort) => ({ id, a, aPort, b, bPort });
const feed = (id = 'feed', target = 'a') => wire(id, 'source', 'plus', target, 'left');
const back = (id = 'return', from = 'a') => wire(id, from, 'right', 'source', 'minus');
const ids = (svg, attribute) => [...svg.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))].map(match => match[1]).sort();
const pathFor = (svg, id) => svg.match(new RegExp(`<path data-edge-id="${id}"[^>]* d="([^"]+)"`))[1];

function circuit(nodes, edges) {
  const analysis = analyze(nodes, edges);
  const svg = render(nodes, edges, analysis);
  assert.deepEqual(ids(svg, 'data-node-id'), nodes.map(item => item.id).sort());
  assert.deepEqual(ids(svg, 'data-edge-id'), edges.map(item => item.id).sort());
  assert.doesNotMatch(svg, /NaN|Infinity|data-return-bus|data-return-from|생략한 귀환|생략했던 귀환/);
  for (const match of svg.matchAll(/<path data-edge-id="[^"]+"[^>]* d="([^"]+)"/g)) {
    const values = match[1].match(/-?[\d.]+/g).map(Number);
    for (let i = 2; i < values.length; i += 2) assert.ok(values[i] === values[i - 2] || values[i + 1] === values[i - 1], 'wires remain orthogonal');
  }
  return { svg, analysis };
}

test('feed-only circuit stays open with no fabricated return', () => {
  const { svg, analysis } = circuit([source(), node('a')], [feed()]);
  assert.equal(analysis.nodes.a.powered, false);
  assert.equal(analysis.edges.feed.current, 0);
  assert.deepEqual(ids(svg, 'data-edge-id'), ['feed']);
  assert.match(svg, /data-edge-id="feed"[^>]*data-a-port="plus"[^>]*data-b-port="left"/);
  assert.match(svg, /data-edge-id="feed"[^>]*stroke="#4b5356"/);
  assert.match(svg, /data-polarity="minus" x="-46"/);
  assert.match(svg, /data-polarity="plus" x="46"/);
  assert.deepEqual(ids(svg, 'data-terminal'), ['left', 'minus', 'plus', 'right']);
});

test('closed lamp circuit displays both actual wires at the correct battery terminals', () => {
  const { svg, analysis } = circuit([source(), node('a')], [feed(), back()]);
  assert.ok(analysis.nodes.a.powered);
  assert.ok(analysis.edges.feed.current > .29);
  assert.match(svg, /data-edge-id="return"[^>]*data-a-port="right"[^>]*data-b-port="minus"/);
  assert.match(svg, /data-edge-id="return"[^>]*stroke="#e9b44c"/);
  assert.ok(pathFor(svg, 'feed').startsWith('M 206 150'));
  assert.ok(pathFor(svg, 'return').endsWith('L 114 150'));
  assert.equal((svg.match(/>0\.30 A</g) || []).length, 2);
});

test('two series loads preserve all three wires and the explicit return', () => {
  const { svg, analysis } = circuit([source(), node('a'), node('b')], [
    feed(), wire('series', 'a', 'right', 'b', 'left'), back('return', 'b')
  ]);
  assert.ok(analysis.hasSeries);
  assert.ok(analysis.nodes.a.powered && analysis.nodes.b.powered);
  assert.match(svg, /data-edge-id="series"[^>]*data-a-port="right"[^>]*data-b-port="left"/);
  assert.equal((svg.match(/>0\.15 A</g) || []).length, 3);
});

test('parallel branches retain separate feed and return conductors', () => {
  const { svg, analysis } = circuit([source(), node('a'), node('b')], [
    feed('a-feed'), back('a-return'), feed('b-feed', 'b'), back('b-return', 'b')
  ]);
  assert.ok(analysis.hasParallel);
  assert.ok(analysis.nodes.a.powered && analysis.nodes.b.powered);
  assert.deepEqual(ids(svg, 'data-b-port'), ['left', 'left', 'minus', 'minus']);
  assert.equal((svg.match(/>0\.30 A</g) || []).length, 4);
});

test('junction cycle edges all remain visible without flattening into a tree', () => {
  const nodes = [source(), node('a'), node('j', 'junction'), node('k', 'junction')];
  const edges = [
    wire('s-j', 'source', 'plus', 'j', 'joint'),
    wire('j-a', 'j', 'joint', 'a', 'left'),
    wire('j-k', 'j', 'joint', 'k', 'joint'),
    wire('k-a', 'k', 'joint', 'a', 'left'), back()
  ];
  const { svg, analysis } = circuit(nodes, edges);
  assert.ok(analysis.nodes.a.powered);
  assert.equal(ids(svg, 'data-edge-id').length, 5);
  assert.equal(ids(svg, 'data-terminal').filter(port => port === 'joint').length, 2);
});

test('cut return and disconnected wire remain visible and inactive', () => {
  const { svg, analysis } = circuit([source(), node('a'), node('b'), node('j', 'junction')], [
    feed(), wire('loose', 'b', 'right', 'j', 'joint')
  ]);
  assert.equal(analysis.nodes.a.powered, false);
  assert.equal(analysis.nodes.b.powered, false);
  assert.match(svg, /data-edge-id="loose"[^>]*stroke="#4b5356"/);
  assert.equal((svg.match(/>0\.00 A</g) || []).length, 2);
});

test('battery-terminal short remains an actual self edge and reports the fault', () => {
  const { svg, analysis } = circuit([source(), node('a')], [wire('short', 'source', 'plus', 'source', 'minus')]);
  assert.ok(analysis.shortCircuit);
  assert.equal(analysis.nodes.a.powered, false);
  assert.match(svg, /data-edge-id="short"[^>]*data-a-port="plus"[^>]*data-b-port="minus"/);
  assert.match(svg, /합선:/);
});

test('the schematic preserves the actual street route between exact terminals', () => {
  const nodes = [node('source', 'source', 245, 415), node('a', 'lamp', 545, 285)];
  const edges = [feed()];
  edges[0].route = [{ x: 291, y: 415 }, { x: 365, y: 415 }, { x: 365, y: 347 }, { x: 499, y: 347 }, { x: 499, y: 285 }];
  const { svg } = circuit(nodes, edges);
  assert.equal(pathFor(svg, 'feed'), 'M 291 415 L 365 415 L 365 347 L 499 347 L 499 285');
});

test('node, edge identifiers and labels are escaped as XML attributes and text', () => {
  const unsafeId = 'a&"<>\'';
  const nodes = [source(), { ...node(unsafeId), label: '<script>bad & "label"</script>' }];
  const edges = [wire(unsafeId, 'source', 'plus', unsafeId, 'left')];
  const svg = render(nodes, edges, analyze(nodes, edges));
  const escaped = 'a&amp;&quot;&lt;&gt;&#39;';
  assert.ok(svg.includes(`data-node-id="${escaped}"`));
  assert.ok(svg.includes(`data-edge-id="${escaped}"`));
  assert.ok(svg.includes(`data-b-node="${escaped}"`));
  assert.ok(!svg.includes(unsafeId));
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;bad &amp; &quot;label&quot;&lt;/script&gt;'));
});

test('missing terminals never turn into invented conductors', () => {
  const svg = render([source(), node('a')], [{ id: 'old-edge', a: 'source', b: 'a' }], {});
  assert.deepEqual(ids(svg, 'data-edge-id'), []);
  assert.doesNotMatch(svg, /data-return/);
});

test('eight shared-street readings avoid each other and device symbols without moving wires', () => {
  const R = require('../router.js');
  const roads = require('../city.js').roads;
  const roadRouter = R.create(roads);
  const nodes = [
    node('source', 'source', 245, 415), node('a', 'lamp', 545, 285),
    node('b', 'lamp', 800, 465), node('c', 'lamp', 850, 180), node('d', 'motor', 1020, 345)
  ];
  const edges = [];
  nodes.slice(1).forEach((load, index) => {
    const outgoing = feed(`feed-${index}`, load.id), returning = back(`return-${index}`, load.id);
    outgoing.route = R.offset(roadRouter.route({ x: 291, y: 415 }, { x: load.x - 46, y: load.y }), [0, 4, -4, 8][index]);
    returning.route = R.offset(roadRouter.route({ x: load.x + 46, y: load.y }, { x: 199, y: 415 }), [0, -4, 4, -8][index]);
    edges.push(outgoing, returning);
  });
  const { svg } = circuit(nodes, edges);
  const labels = [...svg.matchAll(/data-current-for="([^"]+)" transform="translate\(([-\d.]+) ([-\d.]+)\)"/g)]
    .map(match => ({ id: match[1], x: Number(match[2]), y: Number(match[3]) }));
  assert.equal(labels.length, 8);
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    for (const b of labels.slice(i + 1)) {
      assert.ok(Math.abs(a.x - b.x) >= 85 || Math.abs(a.y - b.y) >= 35, `current pills ${a.id}/${b.id} overlap`);
    }
    for (const device of nodes) {
      const overlaps = a.x - 39 < device.x + 57 && a.x + 39 > device.x - 57 && a.y - 14 < device.y + 55 && a.y + 14 > device.y - 37;
      assert.equal(overlaps, false, `current pill ${a.id} obscures ${device.id}`);
    }
  }
  for (const edge of edges) {
    const expected = edge.route.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    assert.equal(pathFor(svg, edge.id), expected, `reading placement moved ${edge.id}`);
  }
});
