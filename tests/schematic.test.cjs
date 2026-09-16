'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../engine.js');
const { render } = require('../schematic.js');

const node = (id, type = 'lamp', y = 0) => ({ id, type, x: 0, y });
const wire = (a, b) => ({ id: `${a}-${b}`, a, b });
const source = () => node('source', 'source');
const ids = (svg, attribute) => [...svg.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))]
  .map(match => match[1]).sort();

function circuit(nodes, edges) {
  const analysis = analyze(nodes, edges);
  const svg = render(nodes, edges, analysis);
  assert.deepEqual(ids(svg, 'data-node-id'), nodes.map(item => item.id).sort());
  assert.deepEqual(ids(svg, 'data-edge-id'), edges.map(item => item.id).sort());
  assert.doesNotMatch(svg, /NaN|Infinity/);
  return { svg, analysis };
}

function assertClosedAtSource(svg) {
  const position = svg.match(/data-node-id="source"[^>]*transform="translate\(([\d.]+) ([\d.]+)\)"/);
  assert.ok(position, 'the source remains in the actual graph');
  const bus = svg.match(/data-return-bus="true" d="([^"]+)"/);
  assert.ok(bus, 'the schematic includes an explicit common return');
  assert.ok(bus[1].endsWith(`V ${Number(position[2])} H ${Number(position[1]) - 40}`),
    'the return reaches the battery negative terminal');
}

test('series network preserves actual topology and closes only the last load', () => {
  const { svg, analysis } = circuit(
    [source(), node('a'), node('b')], [wire('source', 'a'), wire('a', 'b')]
  );
  assert.equal(analysis.hasSeries, true);
  assert.deepEqual(ids(svg, 'data-return-from'), ['b']);
  assertClosedAtSource(svg);
  assert.match(svg, />0\.15 A</);
});

test('parallel network closes every load through the common return', () => {
  const { svg, analysis } = circuit(
    [source(), node('j', 'junction'), node('a', 'lamp', -50), node('b', 'lamp', 50)],
    [wire('source', 'j'), wire('j', 'a'), wire('j', 'b')]
  );
  assert.equal(analysis.hasParallel, true);
  assert.deepEqual(ids(svg, 'data-return-from'), ['a', 'b']);
  assertClosedAtSource(svg);
  assert.match(svg, />0\.60 A</);
  assert.equal((svg.match(/>0\.30 A</g) || []).length, 2);
});

test('empty downstream junction branches keep the load return, routed below them', () => {
  const { svg, analysis } = circuit(
    [source(), node('a'), node('j', 'junction', -50), node('k', 'junction', 50)],
    [wire('source', 'a'), wire('a', 'j'), wire('a', 'k')]
  );
  assert.equal(analysis.nodes.a.brightness, 1);
  assert.equal(analysis.edges['a-j'].current, 0);
  assert.equal(analysis.edges['a-k'].current, 0);
  assert.deepEqual(ids(svg, 'data-return-from'), ['a']);
  assert.match(svg, /data-return-from="a" d="M [\d.]+ [\d.]+ H [\d.]+ V [\d.]+ H [\d.]+"/);
  assertClosedAtSource(svg);
});

test('an open child does not bypass a real downstream load', () => {
  const { svg } = circuit(
    [source(), node('a'), node('j', 'junction', -50), node('b', 'lamp', 50)],
    [wire('source', 'a'), wire('a', 'j'), wire('a', 'b')]
  );
  assert.deepEqual(ids(svg, 'data-return-from'), ['b']);
  assertClosedAtSource(svg);
});

test('disconnected branches remain visible without a fictitious powered return', () => {
  const { svg } = circuit(
    [source(), node('a'), node('j', 'junction'), node('b')],
    [wire('source', 'a'), wire('j', 'b')]
  );
  assert.deepEqual(ids(svg, 'data-return-from'), ['a']);
  assert.match(svg, /전원과 분리됨/);
  assert.match(svg, /data-edge-id="j-b"[^>]*stroke="#4b5356"/);
});

test('source and empty junctions alone do not create a short circuit', () => {
  const { svg } = circuit([source(), node('j', 'junction')], [wire('source', 'j')]);
  assert.deepEqual(ids(svg, 'data-return-from'), []);
  assert.doesNotMatch(svg, /data-return-bus/);
});

test('node and edge identifiers are escaped as XML attributes', () => {
  const unsafeId = 'a&"<>\'';
  const nodes = [source(), node(unsafeId)];
  const edges = [{ id: unsafeId, a: 'source', b: unsafeId }];
  const svg = render(nodes, edges, analyze(nodes, edges));
  const escaped = 'a&amp;&quot;&lt;&gt;&#39;';
  assert.ok(svg.includes(`data-node-id="${escaped}"`));
  assert.ok(svg.includes(`data-edge-id="${escaped}"`));
  assert.ok(svg.includes(`data-return-from="${escaped}"`));
  assert.ok(!svg.includes(unsafeId));
});
