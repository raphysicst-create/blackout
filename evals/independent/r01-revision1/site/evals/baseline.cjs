'use strict';

// Diagnostic fixtures, not a simulation of human play or a fun score.
// Run from any directory: node evals/baseline.cjs > evals/baseline.json
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const E = require('../engine.js');
const root = path.resolve(__dirname, '..');
const node = (id, type = 'lamp') => ({ id, type });
const wire = (id, a, aPort, b, bPort) => ({ id, a, aPort, b, bPort, heat: 0 });
const loads = [node('l1'), node('l2'), node('l3'), node('m1', 'motor')];
const source = node('s', 'source');
const direct = loads.flatMap(n => [
  wire(`${n.id}-in`, 's', 'plus', n.id, 'left'),
  wire(`${n.id}-out`, n.id, 'right', 's', 'minus'),
]);
const sharedNodes = [source, ...loads, node('p', 'junction'), node('n', 'junction')];
const shared = [wire('trunk-in', 's', 'plus', 'p', 'joint'),
  wire('trunk-out', 'n', 'joint', 's', 'minus'),
  ...loads.flatMap(n => [wire(`${n.id}-in`, 'p', 'joint', n.id, 'left'),
    wire(`${n.id}-out`, n.id, 'right', 'n', 'joint')])];

function describe(nodes, edges) {
  const a = E.analyze(nodes, edges);
  return {
    allStable: a.allStable, shortCircuit: a.shortCircuit,
    totalCurrent: a.totalCurrent, wireCount: edges.length,
    overloadedEdges: Object.keys(a.edges).filter(id => a.edges[id].overloaded),
    loads: Object.fromEntries(nodes.filter(n => ['lamp', 'motor'].includes(n.type))
      .map(n => [n.id, { brightness: a.nodes[n.id].brightness, current: a.nodes[n.id].current }])),
  };
}

const sharedAnalysis = E.analyze(sharedNodes, shared);
let elapsed = 0, broken = [];
while (elapsed < 7 && !broken.length) {
  broken = E.tickHeat(shared, sharedAnalysis, .05);
  elapsed += .05;
}
const hashes = Object.fromEntries(['engine.js', 'game.js', 'router.js', 'styles.css']
  .map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceHashes: hashes,
  scope: 'Fixed engine topology probes only; no browser, pacing, human or candidate evaluation.',
  constants: { wireCapacity: E.WIRE_CAPACITY, heatSeconds: E.HEAT_LIMIT_SECONDS,
    coolingSeconds: E.COOLING_SECONDS, stableBrightness: E.STABLE_BRIGHTNESS },
  probes: {
    oneWireOpen: describe([source, loads[0]], [direct[0]]),
    twoLampsSeries: describe([source, loads[0], loads[1]], [
      wire('in', 's', 'plus', 'l1', 'left'), wire('middle', 'l1', 'right', 'l2', 'left'),
      wire('out', 'l2', 'right', 's', 'minus')]),
    fourIndependentLoops: describe([source, ...loads], direct),
    fourSharedLoops: describe(sharedNodes, shared),
    sharedTrunkBreak: { simulatedSeconds: Number(elapsed.toFixed(2)), brokenEdges: broken },
    rebuiltIndependentLoops: describe([source, ...loads], direct),
  },
  humanPlaytest: { status: 'not_run', participants: 0 },
  interpretation: 'Independent loops are a stable solution in this fixture. Whether players discover or overuse it requires playtests. Rebuild uses fresh wires and does not model repair input or time.',
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
