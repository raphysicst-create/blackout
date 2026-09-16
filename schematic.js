/* BLACKOUT — a circuit-symbol view of the player's actual network. */
(function (global) {
  'use strict';

  const COLOR = {
    background: '#090B0C',
    off: '#4b5356',
    text: '#899497',
    active: '#e9b44c',
    danger: '#bd8175'
  };

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function valueFor(collection, id) {
    if (!collection) return {};
    return typeof collection.get === 'function' ? collection.get(id) || {} : collection[id] || {};
  }

  function number(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function currentLabel(value) {
    return Math.abs(number(value)).toFixed(2) + ' A';
  }

  function render(inputNodes, inputEdges, analysis) {
    const nodes = Array.isArray(inputNodes) ? inputNodes : [];
    const edges = Array.isArray(inputEdges) ? inputEdges : [];
    const state = analysis || {};
    const byId = new Map(nodes.map(function (node) { return [node.id, node]; }));
    const adjacency = new Map(nodes.map(function (node) { return [node.id, []]; }));
    const validEdges = edges.filter(function (edge) {
      return byId.has(edge.a) && byId.has(edge.b) && edge.a !== edge.b;
    });
    validEdges.forEach(function (edge) {
      adjacency.get(edge.a).push({ id: edge.b, edge: edge });
      adjacency.get(edge.b).push({ id: edge.a, edge: edge });
    });

    const labels = new Map();
    let lampCount = 0;
    let motorCount = 0;
    nodes.forEach(function (node) {
      if (node.type === 'lamp') labels.set(node.id, 'L' + (++lampCount));
      if (node.type === 'motor') labels.set(node.id, 'M' + (++motorCount > 1 ? motorCount : ''));
    });

    const source = nodes.find(function (node) { return node.type === 'source'; });
    const seen = new Set();
    const positions = new Map();
    const components = [];
    let maxDepth = 1;

    function makeTree(id, depth, component) {
      seen.add(id);
      component.ids.add(id);
      maxDepth = Math.max(maxDepth, depth);
      const branch = { id: id, depth: depth, children: [] };
      const neighbors = adjacency.get(id).slice().sort(function (left, right) {
        const a = byId.get(left.id);
        const b = byId.get(right.id);
        return number(a.y) - number(b.y) || number(a.x) - number(b.x) || String(a.id).localeCompare(String(b.id));
      });
      neighbors.forEach(function (neighbor) {
        if (seen.has(neighbor.id)) return;
        const child = makeTree(neighbor.id, depth + 1, component);
        child.edge = neighbor.edge;
        branch.children.push(child);
      });
      const node = byId.get(id);
      branch.hasLoadBelow = branch.children.some(function (child) { return child.hasLoad; });
      branch.hasLoad = node.type === 'lamp' || node.type === 'motor' || branch.hasLoadBelow;
      return branch;
    }

    const roots = source ? [source].concat(nodes.filter(function (node) { return node !== source; })) : nodes;
    roots.forEach(function (root) {
      if (seen.has(root.id)) return;
      const component = { root: root, connected: root === source, ids: new Set(), terminals: [] };
      component.tree = makeTree(root.id, 0, component);
      components.push(component);
    });

    if (!nodes.length) {
      return '<title>BLACKOUT 회로도</title><text x="600" y="360" text-anchor="middle" fill="' + COLOR.text + '" font-family="sans-serif" font-size="18">아직 연결한 시설이 없습니다.</text>';
    }

    const step = Math.max(180, Math.min(320, 760 / maxDepth));
    const leafGap = 110;
    let cursor = 60;

    function place(branch, component) {
      let y;
      if (!branch.children.length) {
        y = cursor;
        cursor += leafGap;
        branch.bottom = y;
      } else {
        branch.children.forEach(function (child) { place(child, component); });
        y = (positions.get(branch.children[0].id).y + positions.get(branch.children[branch.children.length - 1].id).y) / 2;
        branch.bottom = branch.children[branch.children.length - 1].bottom;
      }
      const node = byId.get(branch.id);
      const terminal = (node.type === 'lamp' || node.type === 'motor') && !branch.hasLoadBelow;
      if (terminal) component.terminals.push(branch.id);
      positions.set(branch.id, {
        x: 130 + branch.depth * step,
        y: y,
        // Empty junction branches are open circuits. A load still returns to
        // the source; route that return below those branches so none is hidden.
        returnY: terminal && branch.children.length ? branch.bottom + 55 : y,
        returnDetour: terminal && branch.children.length > 0
      });
    }

    components.forEach(function (component, index) {
      component.top = cursor;
      place(component.tree, component);
      component.bottom = cursor - leafGap;
      component.returnY = component.bottom + 85;
      // A disconnected component is deliberately kept outside the powered loop.
      cursor = component.bottom + (component.connected ? 185 : 125);
      if (index === components.length - 1) cursor -= 35;
    });

    const maxX = Math.max.apply(null, Array.from(positions.values()).map(function (point) { return point.x; }));
    const returnX = maxX + 112;
    const naturalWidth = returnX + 60;
    const naturalHeight = Math.max(230, cursor + 25);
    const scale = Math.min(1.24, 1090 / naturalWidth, 600 / naturalHeight);
    const offsetX = (1200 - naturalWidth * scale) / 2;
    const offsetY = 35 + (600 - naturalHeight * scale) / 2;
    const parts = [
      '<title>내가 만든 전력망의 회로도</title>',
      '<desc>실제 연결한 전선과 시설을 회로 기호로 표시합니다. 지도에서 생략한 귀환 전선은 전원에 연결된 말단 시설에서 전원으로 돌아갑니다. 전원과 분리된 시설은 회색으로 표시합니다.</desc>',
      '<g font-family="ui-monospace, SFMono-Regular, Consolas, monospace" stroke-linecap="round" stroke-linejoin="round">',
      '<g transform="translate(' + offsetX.toFixed(2) + ' ' + offsetY.toFixed(2) + ') scale(' + scale.toFixed(4) + ')">'
    ];
    const drawnEdges = new Set();
    const connectedIds = components.length && components[0].connected ? components[0].ids : new Set();

    function nodeColor(id) {
      const node = byId.get(id);
      const info = valueFor(state.nodes, id);
      return connectedIds.has(id) && (node.type === 'source' || info.powered || number(info.current) > 0.0001) ? COLOR.active : COLOR.off;
    }

    function radius(node, side) {
      if (node.type === 'source') return 40;
      if (node.type === 'junction') return 0;
      return 22;
    }

    function drawTree(branch, component) {
      const parentNode = byId.get(branch.id);
      const parent = positions.get(branch.id);
      branch.children.forEach(function (child) {
        const edge = child.edge;
        drawnEdges.add(edge.id);
        const point = positions.get(child.id);
        const childNode = byId.get(child.id);
        const info = valueFor(state.edges, edge.id);
        const active = component.connected && Math.abs(number(info.current)) > 0.0001;
        const color = active ? (info.overloaded ? COLOR.danger : COLOR.active) : COLOR.off;
        const startX = parent.x + radius(parentNode, 'right');
        const endX = point.x - radius(childNode, 'left');
        const elbowX = startX + Math.min(38, (endX - startX) * 0.3);
        const path = 'M ' + startX + ' ' + parent.y + ' H ' + elbowX + ' V ' + point.y + ' H ' + endX;
        parts.push('<path data-edge-id="' + escape(edge.id) + '" d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2.3"/>');
        const labelX = parent.y === point.y ? (startX + endX) / 2 : (elbowX + endX) / 2;
        parts.push('<text x="' + labelX + '" y="' + (point.y - 18) + '" text-anchor="middle" fill="' + (active ? COLOR.active : COLOR.text) + '" font-size="24">' + currentLabel(info.current) + '</text>');
        drawTree(child, component);
      });
      if (branch.children.length > 1 && parentNode.type !== 'junction') {
        const startX = parent.x + radius(parentNode, 'right');
        const childPoint = positions.get(branch.children[0].id);
        const endX = childPoint.x - radius(byId.get(branch.children[0].id), 'left');
        const elbowX = startX + Math.min(38, (endX - startX) * 0.3);
        parts.push('<circle cx="' + elbowX + '" cy="' + parent.y + '" r="4" fill="' + nodeColor(branch.id) + '"/>');
      }
    }

    components.forEach(function (component) {
      if (!component.connected) {
        parts.push('<text x="84" y="' + (component.top - 37) + '" fill="' + COLOR.text + '" font-family="sans-serif" font-size="20">전원과 분리됨</text>');
      }
      drawTree(component.tree, component);
    });

    // The game forbids loops. Keep an unexpected extra input edge visible anyway,
    // rather than silently inventing a simpler network for the circuit view.
    validEdges.forEach(function (edge) {
      if (drawnEdges.has(edge.id)) return;
      const a = positions.get(edge.a);
      const b = positions.get(edge.b);
      parts.push('<path data-edge-id="' + escape(edge.id) + '" d="M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y + '" stroke="' + COLOR.off + '" fill="none" stroke-width="2"/>');
    });

    const main = components.find(function (component) { return component.connected; });
    if (main && main.terminals.length) {
      const origin = positions.get(source.id);
      const energized = main.terminals.some(function (id) { return nodeColor(id) === COLOR.active; });
      const returnColor = energized ? COLOR.active : COLOR.off;
      const firstY = Math.min.apply(null, main.terminals.map(function (id) { return positions.get(id).returnY; }));
      main.terminals.forEach(function (id) {
        const point = positions.get(id);
        const color = nodeColor(id);
        let route = 'M ' + (point.x + 22) + ' ' + point.y;
        if (point.returnDetour) {
          route += ' H ' + (point.x + 42) + ' V ' + point.returnY;
          parts.push('<circle cx="' + (point.x + 42) + '" cy="' + point.y + '" r="4" fill="' + color + '"/>');
        }
        route += ' H ' + returnX;
        parts.push('<path data-return-from="' + escape(id) + '" d="' + route + '" fill="none" stroke="' + color + '" stroke-width="2.3"/>');
        if (main.terminals.length > 1) parts.push('<circle cx="' + returnX + '" cy="' + point.returnY + '" r="4" fill="' + color + '"/>');
      });
      parts.push('<path data-return-bus="true" d="M ' + returnX + ' ' + firstY + ' V ' + main.returnY + ' H 60 V ' + origin.y + ' H ' + (origin.x - 40) + '" fill="none" stroke="' + returnColor + '" stroke-width="2.3"/>');
      parts.push('<text x="' + ((60 + returnX) / 2) + '" y="' + (main.returnY + 30) + '" text-anchor="middle" fill="' + COLOR.text + '" font-family="sans-serif" font-size="22">되돌아오는 전선</text>');
    }

    nodes.forEach(function (node) {
      const point = positions.get(node.id);
      const color = nodeColor(node.id);
      const info = valueFor(state.nodes, node.id);
      const opacity = color === COLOR.active && node.type === 'lamp' ? Math.max(0.4, Math.min(1, 0.4 + number(info.brightness) * 0.6)) : 1;
      parts.push('<g data-node-id="' + escape(node.id) + '" data-node-type="' + escape(node.type) + '" transform="translate(' + point.x + ' ' + point.y + ')" stroke="' + color + '" stroke-width="2.3">');
      if (node.type === 'source') {
        parts.push('<path d="M -40 0 H -10 M 10 0 H 40 M -10 -14 V 14 M 10 -27 V 27" fill="none"/>');
        parts.push('<text x="-26" y="-34" stroke="none" fill="' + COLOR.text + '" font-size="22">−</text><text x="19" y="-34" stroke="none" fill="' + COLOR.text + '" font-size="22">+</text>');
        parts.push('<text y="51" text-anchor="middle" stroke="none" fill="' + COLOR.text + '" font-family="sans-serif" font-size="22">전원</text>');
      } else if (node.type === 'junction') {
        parts.push('<circle r="5" fill="' + color + '" stroke="none"/>');
      } else if (node.type === 'motor') {
        parts.push('<circle r="22" fill="' + COLOR.background + '"/><text y="8" text-anchor="middle" stroke="none" fill="' + color + '" font-size="24">M</text>');
      } else {
        parts.push('<circle r="22" fill="' + COLOR.background + '" opacity="' + opacity.toFixed(2) + '"/><path d="M -15 -15 L 15 15 M 15 -15 L -15 15" fill="none" opacity="' + opacity.toFixed(2) + '"/>');
      }
      if (labels.has(node.id)) parts.push('<text y="46" text-anchor="middle" stroke="none" fill="' + COLOR.text + '" font-size="22" letter-spacing="1">' + escape(labels.get(node.id)) + '</text>');
      parts.push('</g>');
    });

    parts.push('</g>');
    parts.push('<line x1="64" y1="678" x2="1136" y2="678" stroke="' + COLOR.off + '" stroke-width="1" opacity="0.5"/>');
    parts.push('<text x="600" y="709" text-anchor="middle" fill="' + COLOR.text + '" font-family="sans-serif" font-size="20">지도에서 생략했던 귀환 전선을 함께 표시합니다.</text>');
    parts.push('</g>');
    return parts.join('');
  }

  const api = { render: render };
  global.BlackoutSchematic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
