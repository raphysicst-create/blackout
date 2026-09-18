/* BLACKOUT — the exact terminal circuit the player has actually connected. */
(function (global) {
  'use strict';

  const COLOR = { background: '#090B0C', off: '#4b5356', text: '#899497', active: '#e9b44c', danger: '#bd8175' };
  const PORTS = { source: ['minus', 'plus'], feeder: ['minus', 'plus'], lamp: ['left', 'right'], motor: ['left', 'right'], junction: ['joint'] };
  const TERMINAL_OFFSET = 46;

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function valueFor(collection, id) {
    if (!collection) return {};
    return typeof collection.get === 'function' ? collection.get(id) || {} : collection[id] || {};
  }
  function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
  function same(a, b) { return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001; }
  function side(port) { return port === 'minus' || port === 'left' ? -1 : port === 'joint' ? 0 : 1; }
  function finitePoint(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.y); }
  function pathData(points) { return points.map((point, i) => (i ? 'L ' : 'M ') + point.x + ' ' + point.y).join(' '); }
  function midpoint(points) {
    const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] && lengths[i] > 0) {
        const ratio = remaining / lengths[i];
        return { x: points[i].x + (points[i + 1].x - points[i].x) * ratio, y: points[i].y + (points[i + 1].y - points[i].y) * ratio };
      }
      remaining -= lengths[i];
    }
    return points[0];
  }

  function overlaps(a, b, gap = 0) {
    return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
  }

  // Shared street lanes can sit only a few pixels apart. Pick a free section of
  // each wire for its reading, rather than stacking every reading at mid-route.
  function placeReadings(paths, positions, nodes) {
    const width = 78, height = 28;
    const deviceBoxes = nodes.map(node => {
      const point = positions.get(node.id);
      const joint = node.type === 'junction';
      return { left: point.x - (joint ? 12 : 57), right: point.x + (joint ? 12 : 57), top: point.y - (joint ? 12 : 37), bottom: point.y + (joint ? 12 : 55) };
    });
    const wireBoxes = paths.flatMap(path => path.points.slice(1).map((point, index) => {
      const a = path.points[index];
      return { left: Math.min(a.x, point.x) - 2, right: Math.max(a.x, point.x) + 2, top: Math.min(a.y, point.y) - 2, bottom: Math.max(a.y, point.y) + 2 };
    }));
    const readings = [];
    paths.forEach(path => {
      const middle = midpoint(path.points);
      let best;
      // Additional rows are considered only if the nearby space is occupied.
      for (let level = 0; level < 12 && !best; level++) {
        path.points.slice(1).forEach((b, index) => {
          const a = path.points[index];
          const horizontal = a.y === b.y;
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          for (const fraction of [.5, .25, .75, .12, .88]) {
            for (const sign of [-1, 1]) {
              const offset = (horizontal ? 22 : 50) + level * 28;
              const x = a.x + (b.x - a.x) * fraction + (horizontal ? 0 : offset * sign);
              const y = a.y + (b.y - a.y) * fraction + (horizontal ? offset * sign : 0);
              const box = { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
              if (deviceBoxes.some(device => overlaps(box, device, 5)) || readings.some(reading => overlaps(box, reading.box, 7))) continue;
              const wireCrossings = wireBoxes.filter(wire => overlaps(box, wire, 2)).length;
              const score = wireCrossings * 100 + Math.hypot(x - middle.x, y - middle.y) * .03 - Math.min(length, 250) * .01;
              if (!best || score < best.score) best = { edgeId: path.edge.id, x, y, width, height, box, score };
            }
          }
        });
      }
      if (!best) {
        const x = Math.max(...deviceBoxes.map(box => box.right), ...readings.map(reading => reading.box.right)) + width;
        const y = middle.y;
        best = { edgeId: path.edge.id, x, y, width, height, box: { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 } };
      }
      readings.push(best);
    });
    return new Map(readings.map(reading => [reading.edgeId, reading]));
  }

  function render(inputNodes, inputEdges, analysis) {
    const nodes = Array.isArray(inputNodes) ? inputNodes : [];
    const edges = Array.isArray(inputEdges) ? inputEdges : [];
    const state = analysis || {};
    if (!nodes.length) return '<title>BLACKOUT 회로도</title><text x="600" y="360" text-anchor="middle" fill="' + COLOR.text + '" font-family="sans-serif" font-size="18">아직 연결한 시설이 없습니다.</text>';

    const byId = new Map(nodes.map(node => [node.id, node]));
    const positions = new Map();
    const occupied = new Set();
    const hasDistinctPositions = nodes.every(node => {
      if (!finitePoint(node)) return false;
      const key = node.x + ',' + node.y;
      if (occupied.has(key)) return false;
      occupied.add(key);
      return true;
    });
    nodes.forEach((node, index) => positions.set(node.id, hasDistinctPositions
      ? { x: node.x, y: node.y }
      : { x: 160 + index % 3 * 300, y: 150 + Math.floor(index / 3) * 200 }));

    function terminal(id, port) {
      const point = positions.get(id);
      return { x: point.x + side(port) * TERMINAL_OFFSET, y: point.y };
    }
    function nodeColor(node) {
      const info = valueFor(state.nodes, node.id);
      if (node.type === 'source') return state.shortCircuit ? COLOR.danger : COLOR.active;
      return info.powered || Math.abs(number(info.current)) > 0.0001 ? COLOR.active : COLOR.off;
    }

    const minNodeY = Math.min(...Array.from(positions.values()).map(point => point.y));
    const paths = [];
    edges.forEach((edge, index) => {
      const a = byId.get(edge.a), b = byId.get(edge.b);
      // Missing or invalid terminals are not silently replaced with invented ones.
      if (!a || !b || !(PORTS[a.type] || []).includes(edge.aPort) || !(PORTS[b.type] || []).includes(edge.bPort)) return;
      const start = terminal(edge.a, edge.aPort), end = terminal(edge.b, edge.bPort);
      let points;
      if (hasDistinctPositions && Array.isArray(edge.route) && edge.route.length >= 2 && edge.route.every(finitePoint)) {
        if (same(edge.route[0], start) && same(edge.route[edge.route.length - 1], end)) points = edge.route;
        else if (same(edge.route[0], end) && same(edge.route[edge.route.length - 1], start)) points = edge.route.slice().reverse();
      }
      if (!points) {
        const stubA = { x: start.x + side(edge.aPort) * 22, y: start.y };
        const stubB = { x: end.x + side(edge.bPort) * 22, y: end.y };
        const facing = side(edge.aPort) === -side(edge.bPort) && Math.sign(end.x - start.x) === side(edge.aPort);
        if (facing) {
          const column = (stubA.x + stubB.x) / 2;
          points = [start, stubA, { x: column, y: start.y }, { x: column, y: end.y }, stubB, end];
        } else {
          const row = minNodeY - 65 - index * 14;
          points = [start, stubA, { x: stubA.x, y: row }, { x: stubB.x, y: row }, stubB, end];
        }
      }
      paths.push({ edge, points: points.filter((point, i) => !i || !same(point, points[i - 1])) });
    });

    const readings = placeReadings(paths, positions, nodes);
    const bounds = Array.from(positions.values()).flatMap(point => [
      { x: point.x - 65, y: point.y - 50 }, { x: point.x + 65, y: point.y + 60 }
    ]).concat(paths.flatMap(path => path.points), Array.from(readings.values()).flatMap(reading => [
      { x: reading.box.left, y: reading.box.top }, { x: reading.box.right, y: reading.box.bottom }
    ]));
    const minX = Math.min(...bounds.map(point => point.x)) - 35;
    const minY = Math.min(...bounds.map(point => point.y)) - 35;
    const width = Math.max(...bounds.map(point => point.x)) - minX + 35;
    const height = Math.max(...bounds.map(point => point.y)) - minY + 35;
    const scale = Math.min(1.5, 1090 / width, 565 / height);
    const offsetX = (1200 - width * scale) / 2 - minX * scale;
    const offsetY = 45 + (565 - height * scale) / 2 - minY * scale;
    const parts = [
      '<title>내가 연결한 회로</title>',
      '<desc>실제로 연결한 단자와 전선만 표시합니다. 건전지 오른쪽 플러스에서 시설을 지나 왼쪽 마이너스까지 이어져야 전류가 흐릅니다. 전선 교차점은 연결점 표시가 있을 때만 이어집니다.</desc>',
      '<g font-family="ui-monospace, SFMono-Regular, Consolas, monospace" stroke-linecap="round" stroke-linejoin="round">',
      '<g transform="translate(' + offsetX.toFixed(2) + ' ' + offsetY.toFixed(2) + ') scale(' + scale.toFixed(4) + ')">'
    ];
    const currentLabels = [];
    paths.forEach(({ edge, points }) => {
      const info = valueFor(state.edges, edge.id);
      const active = Math.abs(number(info.current)) > 0.0001;
      const color = info.overloaded ? COLOR.danger : active ? COLOR.active : COLOR.off;
      parts.push('<path data-edge-id="' + escape(edge.id) + '" data-a-node="' + escape(edge.a) + '" data-a-port="' + escape(edge.aPort) + '" data-b-node="' + escape(edge.b) + '" data-b-port="' + escape(edge.bPort) + '" d="' + pathData(points) + '" fill="none" stroke="' + color + '" stroke-width="2.3"/>');
      const reading = readings.get(edge.id);
      currentLabels.push('<g data-current-for="' + escape(edge.id) + '" transform="translate(' + reading.x + ' ' + reading.y + ')" pointer-events="none"><rect x="-39" y="-14" width="78" height="28" rx="10" fill="#101618" stroke="#293237" stroke-width=".7"/><text y="5.5" text-anchor="middle" fill="' + (active ? color : COLOR.text) + '" font-size="16">' + Math.abs(number(info.current)).toFixed(2) + ' A</text></g>');
    });
    parts.push(...currentLabels);

    let lampCount = 0, motorCount = 0;
    nodes.forEach(node => {
      const point = positions.get(node.id);
      const color = nodeColor(node);
      const info = valueFor(state.nodes, node.id);
      const opacity = node.type === 'lamp' && info.powered ? Math.max(0.4, Math.min(1, 0.4 + number(info.brightness) * 0.6)) : 1;
      const label = node.type === 'source' ? '건전지' : node.type === 'feeder' ? node.id.slice(-1) + ' · 0.75 A' : node.type === 'lamp' ? 'L' + (++lampCount) : node.type === 'motor' ? 'M' + (++motorCount > 1 ? motorCount : '') : '';
      parts.push('<g data-node-id="' + escape(node.id) + '" data-node-type="' + escape(node.type) + '" transform="translate(' + point.x + ' ' + point.y + ')" stroke="' + color + '" stroke-width="2.3">');
      parts.push('<title>' + escape(node.label || label || '연결점') + '</title>');
      if (node.type === 'source') {
        parts.push('<path d="M -46 0 H -25 M 29 0 H 46" fill="none"/><path d="M -25 -14 H 25 V -7 H 29 V 7 H 25 V 14 H -25 Z" fill="' + COLOR.background + '"/><path d="M -16 0 H -8 M 8 0 H 18 M 13 -5 V 5" fill="none"/>');
        parts.push('<text data-polarity="minus" x="-46" y="-16" text-anchor="middle" stroke="none" fill="' + color + '" font-size="20">−</text><text data-polarity="plus" x="46" y="-16" text-anchor="middle" stroke="none" fill="' + color + '" font-size="20">+</text>');
      } else if (node.type === 'feeder') {
        parts.push('<path d="M -46 0 H -20 M 20 0 H 46 M -20 -10 V 10 M 20 -10 V 10" fill="none"/>');
        parts.push('<text data-polarity="minus" x="-46" y="-16" text-anchor="middle" stroke="none" fill="' + color + '" font-size="20">−</text><text data-polarity="plus" x="46" y="-16" text-anchor="middle" stroke="none" fill="' + color + '" font-size="20">+</text>');
      } else if (node.type === 'junction') {
        parts.push('<circle r="5" fill="' + color + '" stroke="none"/>');
      } else {
        parts.push('<path d="M -46 0 H -22 M 22 0 H 46" fill="none"/><circle r="22" fill="' + COLOR.background + '"/>');
        if (node.type === 'motor') parts.push('<text y="8" text-anchor="middle" stroke="none" fill="' + color + '" font-size="24">M</text>');
        else parts.push('<path d="M -15 -15 L 15 15 M 15 -15 L -15 15" fill="none" opacity="' + opacity.toFixed(2) + '"/>');
      }
      (PORTS[node.type] || []).forEach(port => parts.push('<circle data-terminal="' + escape(port) + '" cx="' + side(port) * TERMINAL_OFFSET + '" cy="0" r="' + (node.type === 'junction' ? 5 : 3.5) + '" fill="' + (node.type === 'junction' ? color : COLOR.background) + '"/>'));
      if (label) parts.push('<text y="46" text-anchor="middle" stroke="none" fill="' + COLOR.text + '" font-size="17" letter-spacing="1">' + escape(label) + '</text>');
      parts.push('</g>');
    });

    parts.push('</g><line x1="64" y1="654" x2="1136" y2="654" stroke="' + COLOR.off + '" stroke-width="1" opacity="0.5"/>');
    const note = state.shortCircuit ? '합선: 시설을 거치지 않고 건전지의 두 극이 이어졌습니다.' : '건전지 + → 시설 → 건전지 − · 돌아오는 전선까지 직접 연결한 회로';
    parts.push('<text x="600" y="690" text-anchor="middle" fill="' + (state.shortCircuit ? COLOR.danger : COLOR.text) + '" font-family="sans-serif" font-size="18">' + escape(note) + '</text>');
    parts.push('<text x="600" y="724" text-anchor="middle" fill="' + COLOR.text + '" font-family="sans-serif" font-size="15">교차하는 전선은 ● 연결점에서만 이어집니다.</text></g>');
    return parts.join('');
  }

  const api = { render };
  global.BlackoutSchematic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
