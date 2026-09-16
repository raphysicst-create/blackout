'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../router.js');
const city = require('../city.js');
const p = (x, y) => ({ x, y });
const road = (...points) => ({ points });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const nearPoint = (a, b) => { near(a.x, b.x); near(a.y, b.y); };
const orthogonal = points => {
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y, 'A diagonal segment was introduced');
    assert.notDeepEqual(points[i], points[i - 1], 'A zero-length segment was introduced');
  }
};
const onSegment = (point, a, b) =>
  Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) < 1e-6 &&
  point.x >= Math.min(a.x, b.x) - 1e-6 && point.x <= Math.max(a.x, b.x) + 1e-6 &&
  point.y >= Math.min(a.y, b.y) - 1e-6 && point.y <= Math.max(a.y, b.y) + 1e-6;
const onRoad = (point, roads) => roads.some(item => item.points.some((end, i) => i && onSegment(point, item.points[i - 1], end)));

test('exports the same API to a classic browser script', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../router.js'), 'utf8'), context);
  assert.equal(typeof context.window.BlackoutRouter.create, 'function');
  assert.equal(typeof context.window.BlackoutRouter.offset, 'function');
});

test('all actual city facilities route along streets with unchanged endpoints', () => {
  const nodes = [p(245, 415), p(545, 285), p(800, 465), p(850, 180), p(1020, 345)];
  const router = R.create(city.roads);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const route = router.route(nodes[i], nodes[j]);
      assert.deepEqual(route[0], nodes[i]);
      assert.deepEqual(route.at(-1), nodes[j]);
      orthogonal(route);
      const geometry = R.geometry(route);
      assert.ok(geometry.length > 0);
      for (let sample = 0; sample <= 100; sample++) assert.ok(onRoad(geometry.at(sample / 100), city.roads), 'Path left the road network');
      assert.deepEqual(router.route(nodes[j], nodes[i]), route.slice().reverse(), 'Reverse routing chose a different road');
    }
  }
});

test('interior road crossings connect even without explicit intersection vertices', () => {
  const router = R.create([road(p(0, 50), p(100, 50)), road(p(40, 0), p(40, 100))]);
  assert.deepEqual(router.route(p(10, 50), p(40, 90)), [p(10, 50), p(40, 50), p(40, 90)]);
  near(R.geometry(router.route(p(10, 50), p(40, 90))).length, 70);
});

test('collinear partial overlaps and T endpoints form a single connected graph', () => {
  const roads = [road(p(0, 0), p(60, 0)), road(p(40, 0), p(100, 0)), road(p(75, 0), p(75, 30))];
  const route = R.create(roads).route(p(5, 0), p(75, 30));
  assert.deepEqual(route, [p(5, 0), p(75, 0), p(75, 30)]);
  near(R.geometry(route).length, 100);
});

test('Dijkstra chooses the shorter route and equal choices remain reversible', () => {
  const roads = [road(p(0, 0), p(0, 100), p(100, 100), p(100, 0)), road(p(0, 0), p(100, 0))];
  assert.deepEqual(R.create(roads).route(p(0, 0), p(100, 0)), [p(0, 0), p(100, 0)]);
  const router = R.create(roads);
  const a = p(0, 50), b = p(100, 50);
  const route = router.route(a, b);
  near(R.geometry(route).length, 200);
  assert.deepEqual(router.route(b, a), route.slice().reverse());
});

test('dynamic endpoints on the same road are split in order without modifying cache', () => {
  const roads = [road(p(0, 0), p(100, 0))];
  const original = JSON.stringify(roads);
  const router = R.create(roads);
  assert.deepEqual(router.route(p(73.25, 0), p(12.75, 0)), [p(73.25, 0), p(12.75, 0)]);
  assert.deepEqual(router.route(p(20, 0), p(80, 0)), [p(20, 0), p(80, 0)]);
  assert.equal(JSON.stringify(roads), original);
});

test('off-road previews project to streets with axis-aligned endpoint connectors', () => {
  const router = R.create([road(p(0, 0), p(100, 0), p(100, 100))]);
  const a = p(20, -15), b = p(120, 80);
  const route = router.route(a, b);
  assert.deepEqual(route, [a, p(20, 0), p(100, 0), p(100, 80), b]);
  orthogonal(route);
  assert.deepEqual(router.route(b, a), route.slice().reverse());
  const corner = router.route(p(-10, -10), p(50, 0));
  orthogonal(corner);
  assert.deepEqual(corner[0], p(-10, -10));
});

test('geometry uses M/L only, normalizes vertices and interpolates by real distance', () => {
  const geometry = R.geometry([p(0, 0), p(0, 0), p(10, 0), p(30, 0), p(30, 40)]);
  assert.equal(geometry.d, 'M0,0 L30,0 L30,40');
  assert.deepEqual(geometry.samples.map(point => point.length), [0, 30, 70]);
  near(geometry.length, 70);
  nearPoint(geometry.at(.5), p(30, 5));
  nearPoint(geometry.at(3 / 7), p(30, 0));
  nearPoint(geometry.at(-1), p(0, 0));
  nearPoint(geometry.at(2), p(30, 40));
});

test('splitting projects to the nearest segment and preserves shape and length', () => {
  const points = [p(0, 0), p(80, 0), p(80, 60), p(120, 60)];
  const split = R.split(points, p(89, 25));
  assert.deepEqual(split.point, p(80, 25));
  assert.deepEqual(split.before, [p(0, 0), p(80, 0), p(80, 25)]);
  assert.deepEqual(split.after, [p(80, 25), p(80, 60), p(120, 60)]);
  near(R.geometry(split.before).length + R.geometry(split.after).length, R.geometry(points).length);
  for (const target of [points[0], points[1], points.at(-1)]) {
    const cut = R.split(points, target);
    near(R.geometry(cut.before).length + R.geometry(cut.after).length, 180);
  }
});

test('lane offsets use miter corners, exact endpoints, and ten-unit endpoint stubs', () => {
  const points = [p(0, 0), p(100, 0), p(100, 100)];
  const shifted = R.offset(points, 4);
  assert.deepEqual(shifted, [p(0, 0), p(10, 0), p(10, 4), p(96, 4), p(96, 90), p(100, 90), p(100, 100)]);
  orthogonal(shifted);
  assert.deepEqual(R.offset(points.slice().reverse(), -4), shifted.slice().reverse());
  assert.deepEqual(R.offset(points, 0), points);
});

test('the two-unit motor spur remains exact and orthogonal for every lane candidate', () => {
  const route = R.create(city.roads).route(p(245, 415), p(1020, 345));
  assert.deepEqual(route.at(-2), p(1020, 347));
  for (const amount of [0, 4, -4, 8, -8]) {
    const shifted = R.offset(route, amount);
    assert.deepEqual(shifted[0], p(245, 415));
    assert.deepEqual(shifted.at(-1), p(1020, 345));
    orthogonal(shifted);
    assert.ok(shifted.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    near(R.geometry(R.split(shifted, p(1020, 347)).after).length, 2);
  }
});

test('short, empty and one-point paths do not introduce zero-length or invalid geometry', () => {
  const short = [p(1020, 347), p(1020, 345)];
  assert.deepEqual(R.offset(short, 8), short);
  assert.equal(R.geometry([]).length, 0);
  assert.deepEqual(R.geometry([]).at(.5), p(0, 0));
  assert.deepEqual(R.geometry([p(2, 3), p(2, 3)]).at(.5), p(2, 3));
  assert.deepEqual(R.split([p(2, 3)], p(5, 6)), { point: p(2, 3), before: [p(2, 3)], after: [p(2, 3)] });
  assert.deepEqual(R.create([]).route(p(0, 0), p(20, 30)), [p(0, 0), p(20, 0), p(20, 30)]);
});
