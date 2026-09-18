/* BLACKOUT — deterministic orthogonal street routing and wire geometry. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.BlackoutRouter = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const EPSILON = 1e-7;
  const copy = point => ({ x: point.x, y: point.y });
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const same = (a, b) => Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
  const pointKey = point => `${point.x.toFixed(8)},${point.y.toFixed(8)}`;
  const compare = (a, b) => a.x - b.x || a.y - b.y;

  function normalize(points) {
    const clean = [];
    for (const point of points || []) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      if (clean.length && same(clean[clean.length - 1], point)) continue;
      clean.push(copy(point));
      while (clean.length >= 3) {
        const [a, b, c] = clean.slice(-3);
        const collinear = Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) <= EPSILON;
        // Keep reversals: a short end spur can legitimately double back.
        const forward = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0;
        if (!collinear || !forward) break;
        clean.splice(clean.length - 2, 1);
      }
    }
    return clean;
  }

  function projection(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const square = dx * dx + dy * dy;
    const t = square ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / square)) : 0;
    return { x: a.x + t * dx, y: a.y + t * dy };
  }

  function contains(point, a, b) {
    return distance(point, projection(point, a, b)) <= EPSILON;
  }

  function geometry(points) {
    const clean = normalize(points);
    let length = 0;
    const samples = clean.map((point, index) => {
      if (index) length += distance(clean[index - 1], point);
      return { ...point, length };
    });
    return {
      d: clean.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' '),
      samples,
      length,
      at(fraction) {
        if (!samples.length) return { x: 0, y: 0 };
        if (!length) return copy(samples[0]);
        const ratio = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
        const goal = ratio * length;
        let i = 1;
        while (i < samples.length - 1 && samples[i].length < goal) i++;
        const before = samples[i - 1], after = samples[i];
        const t = (goal - before.length) / (after.length - before.length || 1);
        return { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t };
      },
    };
  }

  function split(points, target) {
    const clean = normalize(points);
    if (!clean.length) return { point: copy(target), before: [], after: [] };
    if (clean.length === 1) return { point: copy(clean[0]), before: [copy(clean[0])], after: [copy(clean[0])] };
    let best = null;
    for (let i = 1; i < clean.length; i++) {
      const point = projection(target, clean[i - 1], clean[i]);
      const separation = distance(target, point);
      if (!best || separation < best.distance - EPSILON) best = { point, index: i, distance: separation };
    }
    return {
      point: copy(best.point),
      before: normalize([...clean.slice(0, best.index), best.point]),
      after: normalize([best.point, ...clean.slice(best.index)]),
    };
  }

  function roadSegments(roads) {
    const unique = new Map();
    for (const road of roads || []) {
      const points = normalize(road.points);
      for (let i = 1; i < points.length; i++) {
        let a = points[i - 1], b = points[i];
        if (Math.abs(a.x - b.x) > EPSILON && Math.abs(a.y - b.y) > EPSILON) {
          throw new Error('BLACKOUT roads must use horizontal or vertical segments.');
        }
        if (compare(a, b) > 0) [a, b] = [b, a];
        const segment = { a: copy(a), b: copy(b), horizontal: Math.abs(a.y - b.y) <= EPSILON };
        unique.set(`${pointKey(a)}|${pointKey(b)}`, segment);
      }
    }
    return [...unique.values()].sort((a, b) => compare(a.a, b.a) || compare(a.b, b.b));
  }

  function graphFromSegments(segments) {
    const cuts = segments.map(segment => [segment.a, segment.b]);
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i], b = segments[j];
        if (a.horizontal !== b.horizontal) {
          const horizontal = a.horizontal ? a : b;
          const vertical = a.horizontal ? b : a;
          const crossing = { x: vertical.a.x, y: horizontal.a.y };
          if (contains(crossing, a.a, a.b) && contains(crossing, b.a, b.b)) {
            cuts[i].push(crossing); cuts[j].push(crossing);
          }
        } else {
          // The shared endpoints also split collinear partial overlaps.
          for (const point of [a.a, a.b, b.a, b.b]) {
            if (contains(point, a.a, a.b) && contains(point, b.a, b.b)) {
              cuts[i].push(point); cuts[j].push(point);
            }
          }
        }
      }
    }
    const vertices = new Map();
    const edgeMap = new Map();
    for (let i = 0; i < segments.length; i++) {
      const sorted = [...new Map(cuts[i].map(point => [pointKey(point), point])).values()].sort(compare);
      for (const point of sorted) vertices.set(pointKey(point), copy(point));
      for (let j = 1; j < sorted.length; j++) {
        const a = sorted[j - 1], b = sorted[j];
        if (!same(a, b)) edgeMap.set(`${pointKey(a)}|${pointKey(b)}`, { a, b });
      }
    }
    return { vertices, edges: [...edgeMap.values()] };
  }

  function closestRoad(point, segments) {
    let best = null;
    for (const segment of segments) {
      const projected = projection(point, segment.a, segment.b);
      const separation = distance(point, projected);
      if (!best || separation < best.distance - EPSILON) {
        best = { point: projected, distance: separation, horizontal: segment.horizontal };
      }
    }
    return best;
  }

  function connector(point, road) {
    // Approach the road perpendicularly, with at most one off-road elbow.
    const elbow = road.horizontal ? { x: road.point.x, y: point.y } : { x: point.x, y: road.point.y };
    return normalize([point, elbow, road.point]);
  }

  function shortest(base, start, end) {
    const vertices = new Map(base.vertices);
    vertices.set(pointKey(start), start);
    vertices.set(pointKey(end), end);
    const links = new Map([...vertices.keys()].map(key => [key, new Map()]));
    for (const edge of base.edges) {
      const cuts = [edge.a, edge.b];
      if (contains(start, edge.a, edge.b)) cuts.push(start);
      if (contains(end, edge.a, edge.b)) cuts.push(end);
      const sorted = [...new Map(cuts.map(point => [pointKey(point), point])).values()].sort(compare);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1], b = sorted[i];
        const weight = distance(a, b);
        if (weight <= EPSILON) continue;
        links.get(pointKey(a)).set(pointKey(b), weight);
        links.get(pointKey(b)).set(pointKey(a), weight);
      }
    }
    const startKey = pointKey(start), endKey = pointKey(end);
    const cost = new Map([[startKey, 0]]);
    const previous = new Map();
    const pending = new Set(vertices.keys());
    while (pending.size) {
      let current = null, best = Infinity;
      for (const key of pending) {
        const value = cost.get(key) ?? Infinity;
        if (value < best - EPSILON || (Math.abs(value - best) <= EPSILON && (current === null || key < current))) {
          current = key; best = value;
        }
      }
      if (current === null || !Number.isFinite(best)) break;
      pending.delete(current);
      if (current === endKey) break;
      for (const [neighbor, weight] of [...links.get(current)].sort(([a], [b]) => a.localeCompare(b))) {
        if (!pending.has(neighbor)) continue;
        const candidate = best + weight;
        if (candidate < (cost.get(neighbor) ?? Infinity) - EPSILON) {
          cost.set(neighbor, candidate); previous.set(neighbor, current);
        }
      }
    }
    if (!cost.has(endKey)) return null;
    const path = [];
    let cursor = endKey;
    while (cursor !== undefined) {
      path.push(copy(vertices.get(cursor)));
      if (cursor === startKey) break;
      cursor = previous.get(cursor);
    }
    return path.reverse();
  }

  function create(roads) {
    const segments = roadSegments(roads);
    const base = graphFromSegments(segments);
    return Object.freeze({
      route(a, b) {
        if (same(a, b)) return [copy(a)];
        const start = closestRoad(a, segments), end = closestRoad(b, segments);
        // Empty/disconnected street sets still give a usable orthogonal preview.
        if (!start || !end) return normalize([a, { x: b.x, y: a.y }, b]);
        // Solve ties from the same canonical direction so reversing a wire
        // reverses its exact path, even when several street routes are equal.
        const reverse = compare(start.point, end.point) > 0;
        let middle = reverse ? shortest(base, end.point, start.point) : shortest(base, start.point, end.point);
        if (!middle) return normalize([a, { x: b.x, y: a.y }, b]);
        if (reverse) middle = middle.reverse();
        return normalize([...connector(a, start), ...middle, ...connector(b, end).reverse()]);
      },
    });
  }

  function offset(points, amount) {
    const clean = normalize(points);
    const shape = geometry(clean);
    if (!Number.isFinite(amount) || Math.abs(amount) <= EPSILON || shape.length <= 20 + EPSILON) return clean;
    // Preserve at least ten units along the original route at each endpoint.
    // Following the path (rather than its first segment) handles the motor's
    // two-unit spur without diagonal joins, division by zero or lost endpoints.
    const startCut = split(clean, shape.at(10 / shape.length));
    const endCut = split(startCut.after, shape.at((shape.length - 10) / shape.length));
    const middle = endCut.before;
    if (middle.length < 2) return clean;
    const directions = [];
    for (let i = 1; i < middle.length; i++) {
      const dx = middle[i].x - middle[i - 1].x, dy = middle[i].y - middle[i - 1].y;
      if (Math.abs(dx) > EPSILON && Math.abs(dy) > EPSILON) throw new Error('BLACKOUT lane offsets require orthogonal paths.');
      const length = Math.hypot(dx, dy);
      directions.push({ x: dx / length, y: dy / length });
    }
    const normal = direction => ({ x: -direction.y * amount, y: direction.x * amount });
    const shifted = middle.map((point, index) => {
      if (index === 0 || index === middle.length - 1) {
        const shift = normal(directions[index === 0 ? 0 : directions.length - 1]);
        return { x: point.x + shift.x, y: point.y + shift.y };
      }
      const incoming = directions[index - 1], outgoing = directions[index];
      const a = normal(incoming), b = normal(outgoing);
      if (Math.abs(incoming.x) > .5 && Math.abs(outgoing.y) > .5) return { x: point.x + b.x, y: point.y + a.y };
      if (Math.abs(incoming.y) > .5 && Math.abs(outgoing.x) > .5) return { x: point.x + a.x, y: point.y + b.y };
      return { x: point.x + a.x, y: point.y + a.y };
    });
    return normalize([...startCut.before, ...shifted, ...endCut.after]);
  }

  return Object.freeze({ create, geometry, split, offset });
});
