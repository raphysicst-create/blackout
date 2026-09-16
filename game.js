/* BLACKOUT — the map is the interface. Runs directly from index.html. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = window.BlackoutEngine;
  const R = window.BlackoutRouter;
  const roadRouter = R.create(window.BlackoutCity.roads);
  const board = $('board');
  const game = $('game');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const loadPlan = [
    { at: 0, id: 'lamp-1', type: 'lamp', x: 545, y: 285, label: '01 / 주택' },
    { at: 30, id: 'lamp-2', type: 'lamp', x: 800, y: 465, label: '02 / 골목' },
    { at: 90, id: 'lamp-3', type: 'lamp', x: 850, y: 180, label: '03 / 공원' },
    { at: 225, id: 'motor-1', type: 'motor', x: 1020, y: 345, label: '04 / 급수 펌프' },
  ];
  let state;
  let drag = null;
  let selected = null;
  let measured = null;
  let keyboardStart = null;
  let wireCounter = 0;
  let junctionCounter = 0;
  let lastFrame = performance.now();
  let toastUntil = 0;
  let hintUntil = Infinity;
  let focusReturn = null;
  let views = new Map();
  let wireViews = new Map();
  let audioContext = null;
  let sound = false;
  let topologyDirty = false;

  function lockPlayfield(locked) {
    for (const element of [board, document.querySelector('.bottom-bar')]) {
      element.toggleAttribute('inert', locked);
      if (locked) element.setAttribute('aria-hidden', 'true');
      else element.removeAttribute('aria-hidden');
    }
  }

  function timeText(seconds) {
    const whole = Math.floor(seconds);
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  }
  function toast(text, duration = 4200) {
    $('toast').textContent = text;
    $('toast').classList.add('visible');
    toastUntil = performance.now() + duration;
  }
  function hint(title, detail = '', duration = 9) {
    $('hint-title').textContent = title;
    $('hint-detail').textContent = detail;
    $('hint').classList.remove('quiet');
    hintUntil = duration === Infinity ? Infinity : state.time + duration;
  }
  function tone(kind) {
    if (!sound) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const o = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const pitches = { connect: [760, 1120, .09], pop: [430, 620, .15], snap: [135, 35, .25], win: [523, 784, .8], measure: [600, 600, .05] };
      const [start, end, length] = pitches[kind] || pitches.connect;
      o.type = kind === 'snap' ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(start, now);
      o.frequency.exponentialRampToValueAtTime(end, now + length);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.055, now + .01);
      gain.gain.exponentialRampToValueAtTime(.0001, now + length);
      o.connect(gain).connect(audioContext.destination);
      o.start(now); o.stop(now + length + .03);
    } catch { /* Audio is optional; blocked audio never interrupts a run. */ }
  }
  function reset() {
    cancelDrag();
    state = {
      mode: 'intro', time: 0, stableFor: 0, victoryFor: 0, tool: 'connect', paused: false,
      nodes: [{ id: 'source', type: 'source', x: 245, y: 415, label: '전원' }, { ...loadPlan[0] }],
      edges: [], analysis: null, firstConnection: false, ampUnlocked: false, branchUnlocked: false,
      noticedDim: false, noticedOverload: false, lateHint: false, breaks: 0, didBranch: false,
    };
    wireCounter = 0; junctionCounter = 0; selected = null; measured = null; keyboardStart = null;
    views.clear(); wireViews.clear();
    game.className = 'game intro-mode';
    $('intro').hidden = false; $('intro').classList.remove('leaving');
    $('intro').inert = false;
    for (const id of ['result', 'pause-panel', 'help-panel', 'schematic-panel', 'wire-actions']) $(id).hidden = true;
    $('amp-tool').disabled = true;
    $('amp-tool').setAttribute('aria-label', '전류계 · 잠김');
    $('amp-tool').title = '전류계는 잠시 후 열립니다';
    $('phase-label').textContent = '전력 복구';
    $('clock').textContent = '00:00';
    $('ambient-light').setAttribute('opacity', '.018');
    $('city').innerHTML = window.BlackoutCity.markup();
    $('measure-layer').innerHTML = '';
    $('toast').classList.remove('visible');
    setTool('connect');
    recalculate(); rebuild();
    hint('전원에서 전구까지, 빛을 이어 주세요.', '노드를 누른 채 전구까지 끌어 놓으세요.', Infinity);
    lockPlayfield(true);
  }
  function start() {
    if (state.mode !== 'intro') return;
    state.mode = 'playing';
    game.classList.remove('intro-mode');
    $('intro').classList.add('leaving');
    $('intro').inert = true;
    lockPlayfield(false);
    lastFrame = performance.now();
    tone('pop');
  }
  function recalculate() {
    state.analysis = E.analyze(state.nodes, state.edges);
    topologyDirty = true;
  }
  function makeWire(a, b, heat = 0, route = null) {
    const from = state.nodes.find(n => n.id === a);
    const to = state.nodes.find(n => n.id === b);
    return { id: `wire-${++wireCounter}`, a, b, route: route || wireRoute(from, to), heat, capacity: E.WIRE_CAPACITY, born: state.time };
  }
  function addConnection(from, to) {
    const check = E.canConnect(state.nodes, state.edges, from, to);
    if (!check.ok) { toast(check.reason); return false; }
    state.edges.push(makeWire(from, to));
    connected();
    return true;
  }
  function connected() {
    recalculate(); rebuild();
    tone('connect');
    state.stableFor = 0;
    if (!state.firstConnection && state.analysis.nodes['lamp-1'].powered) {
      state.firstConnection = true;
      hint('하나의 연결, 하나의 빛.', '새로운 시설이 나타나면 빛을 이어 주세요.', 7);
    }
    if (!state.noticedDim && state.nodes.some(n => n.type === 'lamp' && state.analysis.nodes[n.id].powered && state.analysis.nodes[n.id].brightness < .8)) {
      state.noticedDim = true;
      hint('빛이 조금 약해졌네요.', '다른 곳에서 전선을 가져오면 어떤 변화가 생길까요?', 10);
    }
  }
  function addBranch(edgeId, origin, targetId) {
    const edge = state.edges.find(e => e.id === edgeId);
    if (!edge) return;
    if (!state.branchUnlocked) { toast('조금 뒤에 전선 중간에서도 새 갈래를 만들 수 있어요.'); return; }
    const a = state.nodes.find(n => n.id === edge.a);
    const b = state.nodes.find(n => n.id === edge.b);
    const pieces = R.split(edge.route, origin);
    origin = pieces.point;
    if (distance(origin, a) < 46) { addConnection(a.id, targetId); return; }
    if (distance(origin, b) < 46) { addConnection(b.id, targetId); return; }
    const j = { id: `junction-${junctionCounter + 1}`, type: 'junction', x: origin.x, y: origin.y, label: '' };
    const remaining = state.edges.filter(e => e.id !== edgeId);
    // Validate before mutation. Failed drops never leave orphan junctions.
    const candidate = [...remaining, { id: '_a', a: edge.a, b: j.id }, { id: '_b', a: j.id, b: edge.b }];
    const check = E.canConnect([...state.nodes, j], candidate, j.id, targetId);
    if (!check.ok) { toast(check.reason); return; }
    junctionCounter++;
    state.nodes.push(j);
    state.edges = [...remaining, makeWire(edge.a, j.id, edge.heat, pieces.before), makeWire(j.id, edge.b, edge.heat, pieces.after)];
    state.edges.push(makeWire(j.id, targetId));
    state.didBranch = true;
    selected = null; $('wire-actions').hidden = true;
    connected();
  }
  function removeWire(id, broken = false) {
    if (!state.edges.some(e => e.id === id)) return;
    state.edges = state.edges.filter(e => e.id !== id);
    const used = new Set(state.edges.flatMap(e => [e.a, e.b]));
    state.nodes = state.nodes.filter(n => n.type !== 'junction' || used.has(n.id));
    if (selected === id) selectWire(null);
    if (measured?.id === id) { measured = null; $('measure-layer').innerHTML = ''; }
    state.stableFor = 0;
    recalculate(); rebuild();
    if (!broken) tone('snap');
  }
  function setTool(tool) {
    if (!state || (tool === 'amp' && !state.ampUnlocked)) return;
    cancelDrag();
    state.tool = tool;
    for (const name of ['connect', 'amp']) {
      $(`${name}-tool`).classList.toggle('active', tool === name);
      $(`${name}-tool`).setAttribute('aria-pressed', String(tool === name));
    }
    $('tool-caption').textContent = tool === 'amp' ? '전선을 눌러 전류 관찰' : '전선을 그려 연결';
    selectWire(null);
    if (tool !== 'amp') { measured = null; $('measure-layer').innerHTML = ''; }
  }
  function selectWire(id, point) {
    selected = id;
    for (const [key, v] of wireViews) v.group.classList.toggle('selected', key === id);
    $('wire-actions').hidden = !id;
    if (!id) return;
    const p = toScreen(point || wireViews.get(id).geometry.at(.5));
    $('wire-actions').style.left = `${Math.max(130, Math.min(innerWidth - 130, p.x))}px`;
    $('wire-actions').style.top = `${Math.max(130, p.y - 20)}px`;
  }
  function measure(id, p) {
    measured = { id, x: Math.max(75, Math.min(1125, p.x)), y: Math.max(110, p.y - 45) };
    const current = state.analysis.edges[id]?.current || 0;
    $('measure-layer').innerHTML = `<g transform="translate(${measured.x},${measured.y})"><rect class="measure-box" x="-55" y="-28" width="110" height="55" rx="9"/><text class="measure-value" text-anchor="middle" y="-5">${current.toFixed(2)} A</text><text class="measure-label" text-anchor="middle" y="14">${current > .75 ? '많은 전류가 흘러요' : '이 전선에 흐르는 전류'}</text></g>`;
    tone('measure');
  }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function pointFromEvent(event) {
    const matrix = board.getScreenCTM();
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }
  function toScreen(p) { return new DOMPoint(p.x, p.y).matrixTransform(board.getScreenCTM()); }
  function worldScale() { return Math.max(.1, Math.abs(board.getScreenCTM().a)); }
  function closestNode(p, exclude) {
    const radius = Math.max(34, 31 / worldScale());
    let found = null, nearest = radius;
    for (const n of state.nodes) {
      if (n.id === exclude) continue;
      const d = distance(p, n);
      if (d < nearest) { found = n; nearest = d; }
    }
    return found;
  }
  function closestWire(p) {
    let found = null, nearest = Math.max(15, 13 / worldScale());
    for (const [id, v] of wireViews) {
      for (let i = 1; i < v.geometry.samples.length; i++) {
        const a = v.geometry.samples[i - 1], b = v.geometry.samples[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const projected = { x: a.x + t * dx, y: a.y + t * dy };
        const d = distance(p, projected);
        if (d < nearest) { nearest = d; found = { id, point: projected }; }
      }
    }
    return found;
  }
  function wireRoute(a, b) {
    const centerline = roadRouter.route(a, b);
    let best = centerline, bestScore = Infinity;
    // Parallel road lanes are visual only: crossing wires never form a junction.
    // Persist the chosen path so later connections cannot move existing wires.
    for (const lane of [0, 4, -4, 8, -8]) {
      const candidate = R.offset(centerline, lane);
      let score = Math.abs(lane) * .05;
      for (let i = 1; i < candidate.length; i++) {
        const start = candidate[i - 1], end = candidate[i];
        const horizontal = Math.abs(start.y - end.y) < .001;
        const axis = horizontal ? 'x' : 'y';
        const cross = horizontal ? 'y' : 'x';
        for (const edge of state.edges) {
          for (let j = 1; j < edge.route.length; j++) {
            const otherStart = edge.route[j - 1], otherEnd = edge.route[j];
            if ((Math.abs(otherStart.y - otherEnd.y) < .001) !== horizontal) continue;
            const separation = Math.abs(start[cross] - otherStart[cross]);
            if (separation >= 3.5) continue;
            const overlap = Math.min(Math.max(start[axis], end[axis]), Math.max(otherStart[axis], otherEnd[axis]))
              - Math.max(Math.min(start[axis], end[axis]), Math.min(otherStart[axis], otherEnd[axis]));
            if (overlap > 0) score += overlap * (3.5 - separation);
          }
        }
      }
      if (score < bestScore) { best = candidate; bestScore = score; }
      if (score === 0) break;
    }
    return best;
  }
  function geometry(a, b) {
    return R.geometry(wireRoute(a, b));
  }
  function nodeMarkup(n) {
    const label = n.type === 'source' ? '전원' : n.type === 'junction' ? '분기점' : n.label;
    let art;
    if (n.type === 'source') {
      art = '<polygon class="node-shell" points="0,-29 25,-14.5 25,14.5 0,29 -25,14.5 -25,-14.5"/><path class="node-symbol" d="M4-16-9 3H0L-4 16 10-4H1Z"/>';
    } else if (n.type === 'lamp') {
      art = '<circle class="node-shell" r="22"/><path class="node-symbol" d="M-8-5a8 8 0 1 1 16 0c0 4-4 5-4 9h-8c0-4-4-5-4-9Z M-4 8h8 M-2 11h4 M-3-5l3 4 3-4M0-1v5"/>';
    } else if (n.type === 'motor') {
      art = '<circle class="node-shell" r="24"/><circle class="node-symbol" r="18"/><g class="rotor"><path class="node-symbol" d="M0 0C-15-4-8-16-2-11Z M0 0C4-15 16-8 11-2Z M0 0C15 4 8 16 2 11Z M0 0C-4 15-16 8-11 2Z"/></g><circle class="node-symbol" r="3"/>';
    } else {
      art = '<circle class="node-shell" r="9"/><circle class="junction-core" r="3"/>';
    }
    return `<g id="node-${n.id}" class="node ${n.type}" data-node="${n.id}" role="button" aria-label="${label}, 연결하려면 끌어 놓으세요" tabindex="0" transform="translate(${n.x} ${n.y})"><circle class="hit-area" r="34"/><g class="node-art">${art}</g>${n.label ? `<text class="node-label" text-anchor="middle" y="49">${n.label}</text>` : ''}</g>`;
  }
  function rebuild() {
    const oldBrightness = new Map([...views].map(([id, v]) => [id, v.brightness]));
    const oldIds = new Set(views.keys());
    $('nodes').innerHTML = state.nodes.map(nodeMarkup).join('');
    $('halos').innerHTML = state.nodes.filter(n => n.type !== 'junction').map(n => `<g id="halo-${n.id}" opacity="0"><circle cx="${n.x}" cy="${n.y}" r="120" fill="url(#lamp-halo)"/>${n.type === 'lamp' ? `<circle cx="${n.x}" cy="${n.y}" r="70" fill="url(#lamp-aura)" filter="url(#aura-soften)"/>` : ''}</g>`).join('');
    $('light-pools').innerHTML = state.nodes.filter(n => n.type !== 'junction').map(n => `<circle id="pool-${n.id}" cx="${n.x}" cy="${n.y}" r="${n.type === 'source' ? 145 : 195}" fill="url(#pool)" opacity="0"/>`).join('');
    views = new Map(state.nodes.map(n => {
      const el = $(`node-${n.id}`);
      if (!oldIds.has(n.id)) el.classList.add('new');
      return [n.id, { el, halo: $(`halo-${n.id}`), pool: $(`pool-${n.id}`), brightness: oldBrightness.get(n.id) || 0, newAt: state.time }];
    }));
    const paths = new Map(state.edges.map(e => [e.id, R.geometry(e.route)]));
    $('wires').innerHTML = state.edges.map(e => {
      const p = paths.get(e.id);
      return `<g id="${e.id}" class="wire${selected === e.id ? ' selected' : ''}" data-wire="${e.id}" tabindex="0" role="button" aria-label="전선, 선택하여 끊거나 전류를 측정하세요"><path class="wire-base" d="${p.d}"/><path class="wire-aura" d="${p.d}"/><path class="wire-light" d="${p.d}" pathLength="1"/><path class="wire-hit" d="${p.d}"/></g>`;
    }).join('');
    $('particles').innerHTML = state.edges.map(e => `<g id="particles-${e.id}">${Array.from({ length: 32 }, () => '<circle class="particle" r="2" opacity="0"/>').join('')}</g>`).join('');
    wireViews = new Map(state.edges.map(e => {
      const group = $(e.id);
      return [e.id, { group, light: group.querySelector('.wire-light'), aura: group.querySelector('.wire-aura'), particles: [...$(`particles-${e.id}`).children], geometry: paths.get(e.id) }];
    }));
    if (measured && state.edges.some(e => e.id === measured.id)) measure(measured.id, { x: measured.x, y: measured.y + 45 });
    topologyDirty = false;
    resizeHits();
  }
  function resizeHits() {
    const scale = worldScale();
    const radius = Math.max(34, 31 / scale);
    const artScale = Math.max(1, .72 / scale);
    for (const v of views.values()) {
      v.el.querySelector('.hit-area').setAttribute('r', radius);
      v.el.style.setProperty('--node-scale', artScale);
      const label = v.el.querySelector('.node-label');
      if (label) { label.style.fontSize = `${Math.max(9, 8 / scale)}px`; label.setAttribute('y', 49 * artScale); }
    }
    for (const v of wireViews.values()) v.group.querySelector('.wire-hit').setAttribute('stroke-width', Math.max(26, 26 / scale));
  }
  function canInteract() { return state.mode === 'playing' && !state.paused && $('help-panel').hidden; }
  function cancelDrag() {
    if (drag?.pointerId != null && board.hasPointerCapture(drag.pointerId)) board.releasePointerCapture(drag.pointerId);
    drag = null; keyboardStart = null;
    $('preview').setAttribute('d', '');
    $('snap-ring').setAttribute('visibility', 'hidden');
    for (const v of views.values()) v.el.classList.remove('snap');
  }
  board.addEventListener('pointerdown', event => {
    if (!canInteract() || event.button !== 0 || drag) return;
    event.preventDefault();
    const p = pointFromEvent(event);
    const node = closestNode(p);
    const wire = node ? null : closestWire(p);
    if (state.tool === 'amp') {
      if (wire) measure(wire.id, wire.point);
      else { measured = null; $('measure-layer').innerHTML = ''; }
      return;
    }
    if (wire && selected === wire.id) { removeWire(wire.id); return; }
    selectWire(null);
    if (!node && !wire) return;
    drag = { pointerId: event.pointerId, kind: node ? 'node' : 'wire', from: node?.id, edgeId: wire?.id, origin: node || wire.point, down: p, point: p, target: null, moved: false, held: false, started: performance.now() };
    board.setPointerCapture(event.pointerId);
  });
  board.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId || !canInteract()) return;
    const p = pointFromEvent(event);
    drag.point = p;
    if (distance(p, drag.down) * worldScale() > 8) drag.moved = true;
    if (!drag.moved) return;
    for (const v of views.values()) v.el.classList.remove('snap');
    const target = closestNode(p, drag.from);
    drag.target = target?.id || null;
    const end = target || p;
    if (drag.kind === 'wire' && drag.held) {
      $('preview').setAttribute('d', '');
      return;
    }
    $('preview').setAttribute('d', geometry(drag.origin, end).d);
    $('preview').classList.toggle('snapped', !!target);
    $('snap-ring').setAttribute('visibility', target ? 'visible' : 'hidden');
    if (target) {
      views.get(target.id).el.classList.add('snap');
      $('snap-ring').setAttribute('cx', target.x); $('snap-ring').setAttribute('cy', target.y);
    }
  });
  board.addEventListener('pointerup', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pending = { ...drag };
    cancelDrag();
    if (!canInteract()) return;
    if (pending.kind === 'wire' && pending.held && pending.moved) {
      if (distance(pending.point, pending.origin) * worldScale() > 35) removeWire(pending.edgeId);
      return;
    }
    if (pending.moved && pending.target) {
      if (pending.kind === 'node') addConnection(pending.from, pending.target);
      else addBranch(pending.edgeId, pending.origin, pending.target);
    } else if (pending.kind === 'wire' && !pending.moved) {
      selectWire(pending.edgeId, pending.origin);
    }
  });
  board.addEventListener('pointercancel', cancelDrag);
  board.addEventListener('lostpointercapture', () => { if (drag) cancelDrag(); });
  board.addEventListener('contextmenu', e => e.preventDefault());
  board.addEventListener('keydown', event => {
    if (!canInteract() || !['Enter', ' '].includes(event.key)) return;
    const nodeId = event.target.closest('[data-node]')?.dataset.node;
    const edgeId = event.target.closest('[data-wire]')?.dataset.wire;
    if (!nodeId && !edgeId) return;
    event.preventDefault(); event.stopPropagation();
    if (edgeId) {
      const p = wireViews.get(edgeId).geometry.at(.5);
      if (state.tool === 'amp') measure(edgeId, p); else selectWire(edgeId, p);
    } else if (state.tool === 'connect') {
      if (keyboardStart) {
        const from = keyboardStart; cancelDrag(); addConnection(from, nodeId);
      } else {
        keyboardStart = nodeId;
        views.get(nodeId).el.classList.add('snap');
        toast('Tab으로 다른 노드를 선택하고 Enter로 연결하세요.');
      }
    }
  });
  function pause(value) {
    if (state.mode !== 'playing') return;
    cancelDrag();
    state.paused = value;
    game.classList.toggle('paused', value);
    lockPlayfield(value);
    $('pause-panel').hidden = !value;
    $('pause-button').setAttribute('aria-label', value ? '계속하기' : '일시 정지');
    if (value) { focusReturn = document.activeElement; $('resume-button').focus(); }
    else { focusReturn?.focus(); lastFrame = performance.now(); }
  }
  function showHelp(show) {
    if (state.mode !== 'playing') return;
    cancelDrag();
    $('help-panel').hidden = !show;
    lockPlayfield(show);
    if (show) {
      focusReturn = document.activeElement;
      state.paused = true; game.classList.add('paused'); $('close-help').focus();
    } else {
      state.paused = false; game.classList.remove('paused'); lastFrame = performance.now(); focusReturn?.focus();
    }
  }
  function update(dt) {
    if (state.paused || state.mode === 'intro') return;
    if (state.mode === 'won') {
      state.victoryFor += dt;
      $('ambient-light').setAttribute('opacity', Math.min(1, .018 + state.victoryFor / 2));
      if (state.victoryFor >= 1.5) game.classList.add('restored');
      // Let the player see the whole city before adding the quiet end card.
      if (state.victoryFor >= 7 && $('schematic-panel').hidden) $('result').hidden = false;
      return;
    }
    state.time += dt;
    $('clock').textContent = timeText(state.time);
    for (const plan of loadPlan) {
      if (state.time >= plan.at && !state.nodes.some(n => n.id === plan.id)) {
        state.nodes.push({ ...plan }); recalculate(); rebuild(); tone('pop');
        hint(plan.type === 'motor' ? '마지막 불빛이 당신을 기다립니다.' : '도시 한편에, 불빛이 더 필요해요.', plan.type === 'motor' ? '급수 펌프까지 연결하고 전선의 흐름을 살펴보세요.' : '전선을 어디에서 가져올지 살펴보세요.', 11);
      }
    }
    if (state.time >= 65 && !state.ampUnlocked) {
      state.ampUnlocked = true; $('amp-tool').disabled = false;
      $('amp-tool').setAttribute('aria-label', '전류 측정'); $('amp-tool').title = '전류 측정 (A)';
      toast('A 도구가 열렸어요. 전선을 눌러 흐르는 전류를 살펴보세요.', 6500);
    }
    if (state.time >= 90 && !state.branchUnlocked) {
      state.branchUnlocked = true;
      toast('전선 중간에서 새 시설로 끌면, 작은 분기점이 생깁니다.', 7000);
    }
    if (state.time >= 150 && !state.didBranch && !state.branchReminder) {
      state.branchReminder = true;
      hint('빛은 여러 갈래로 이어질 수 있어요.', '전선 중간을 잡고 새 시설까지 끌어 보세요.', 9);
    }
    const overheated = state.edges.some(e => state.analysis.edges[e.id]?.overloaded);
    if (overheated && !state.noticedOverload) {
      state.noticedOverload = true;
      hint('전선이 너무 많은 전류를 견디고 있어요.', '한 전선에 모인 흐름을 다른 길로 나눠 보세요.', 9);
    }
    const broken = E.tickHeat(state.edges, state.analysis, dt);
    if (broken.length) {
      broken.forEach(id => removeWire(id, true));
      state.breaks++;
      tone('snap');
      $('blackout').classList.remove('flash');
      void $('blackout').offsetWidth;
      $('blackout').classList.add('flash');
      hint('괜찮아요. 다시 이어 주세요.', '전원에서 새로운 길을 내면 한 전선의 부담이 줄어들어요.', 12);
    }
    // Cooling participates in stability, so recompute after heat changes too.
    state.analysis = E.analyze(state.nodes, state.edges);
    const allPresent = loadPlan.every(p => state.nodes.some(n => n.id === p.id));
    if (allPresent && state.analysis.allStable) {
      state.stableFor += dt;
      if (state.stableFor > .5 && state.stableFor < .5 + dt) hint('빛이 제자리를 찾고 있어요.', '잠시, 안정된 흐름을 지켜보세요.', 12);
      if (state.stableFor >= 8) win();
    } else state.stableFor = 0;
    if (state.time >= 300 && !state.lateHint) {
      state.lateHint = true;
      toast('서두르지 않아도 괜찮아요. 모든 시설에 빛이 돌아올 때까지 이어가세요.', 7000);
    }
    if (state.time > hintUntil) $('hint').classList.add('quiet');
  }
  function win() {
    if (state.mode !== 'playing') return;
    state.mode = 'won'; state.victoryFor = 0;
    lockPlayfield(true);
    cancelDrag(); selectWire(null); measured = null; $('measure-layer').innerHTML = '';
    $('hint').classList.add('quiet'); $('toast').classList.remove('visible');
    $('result-time').textContent = timeText(state.time);
    $('phase-label').textContent = '복구 완료';
    tone('win');
  }
  function draw(dt) {
    if (topologyDirty) rebuild();
    const k = reducedMotion ? 1 : Math.min(1, dt * 5);
    for (const n of state.nodes) {
      const v = views.get(n.id), status = state.analysis.nodes[n.id];
      // The wire's light reaches the load before its surroundings illuminate.
      const target = n.type === 'source' ? 1 : (status.powered ? status.brightness : 0);
      const age = state.time - v.newAt;
      const on = target > 0 && (n.type === 'source' || age > .22);
      v.brightness += ((on ? target : 0) - v.brightness) * k;
      v.el.classList.toggle('lit', on && v.brightness > .015);
      const symbol = v.el.querySelector('.node-art');
      symbol.style.opacity = target > 0 ? String(.45 + .55 * v.brightness) : '1';
      if (v.halo) v.halo.setAttribute('opacity', v.brightness.toFixed(3));
      if (v.pool) v.pool.setAttribute('opacity', (v.brightness * .9).toFixed(3));
      if (n.type !== 'junction') v.el.setAttribute('aria-label', `${n.label}, ${target >= .8 ? '정상 작동' : target > 0 ? '빛이 약함' : '꺼짐'}`);
    }
    for (const e of state.edges) {
      const v = wireViews.get(e.id), electrical = state.analysis.edges[e.id];
      const current = electrical.current;
      v.group.classList.toggle('overloaded', electrical.overloaded);
      const lit = current > .0001;
      const age = Math.max(0, state.time - e.born);
      const reveal = reducedMotion ? 1 : Math.min(1, age / .32);
      v.light.style.opacity = lit ? String(.35 + Math.min(.65, current)) : '0';
      v.aura.style.opacity = lit ? String(.06 + Math.min(.34, current * .4)) : '0';
      v.light.style.strokeDasharray = `${reveal} 1`;
      v.light.style.strokeDashoffset = electrical.from === e.a ? '0' : String(reveal - 1);
      const count = lit ? Math.min(32, Math.max(2, Math.round(v.geometry.length * current * .09))) : 0;
      for (let i = 0; i < v.particles.length; i++) {
        const dot = v.particles[i];
        if (i >= count) { dot.setAttribute('opacity', '0'); continue; }
        let progress = reducedMotion ? i / count : (i / count + (state.time + state.victoryFor) * 82 / Math.max(1, v.geometry.length)) % 1;
        if (electrical.from !== e.a) progress = 1 - progress;
        const p = v.geometry.at(progress);
        dot.setAttribute('cx', p.x.toFixed(2)); dot.setAttribute('cy', p.y.toFixed(2));
        dot.setAttribute('opacity', reveal >= 1 ? '.92' : '0');
      }
    }
    if (measured) {
      const value = $('measure-layer').querySelector('.measure-value');
      if (value) value.textContent = `${(state.analysis.edges[measured.id]?.current || 0).toFixed(2)} A`;
    }
  }
  function frame(now) {
    const dt = Math.min(.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    update(dt);
    if (drag && drag.kind === 'wire' && !drag.moved && !drag.held && now - drag.started > 500) {
      drag.held = true; selectWire(drag.edgeId, drag.origin);
      if (navigator.vibrate) navigator.vibrate(12);
    }
    draw(state.paused ? 0 : dt);
    if (now > toastUntil) $('toast').classList.remove('visible');
    requestAnimationFrame(frame);
  }
  $('intro').addEventListener('click', start);
  $('start-button').addEventListener('click', start);
  $('connect-tool').addEventListener('click', () => setTool('connect'));
  $('amp-tool').addEventListener('click', () => setTool('amp'));
  $('delete-wire').addEventListener('click', () => { if (selected) removeWire(selected); });
  $('pause-button').addEventListener('click', () => pause(!state.paused));
  $('resume-button').addEventListener('click', () => pause(false));
  $('help-button').addEventListener('click', () => showHelp(true));
  $('close-help').addEventListener('click', () => showHelp(false));
  const replay = () => { reset(); $('intro').inert = false; start(); };
  $('restart-button').addEventListener('click', replay);
  $('replay-button').addEventListener('click', replay);
  $('sound-button').addEventListener('click', () => {
    sound = !sound;
    $('sound-button').setAttribute('aria-pressed', String(sound));
    $('sound-button').setAttribute('aria-label', sound ? '소리 끄기' : '소리 켜기');
    $('sound-button').title = sound ? '소리 끄기' : '소리 켜기';
    $('sound-button').innerHTML = `<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4Z ${sound ? 'M15 8q5 4 0 8M18 5q8 7 0 14' : 'M16 9l5 6m0-6-5 6'}"/></svg>`;
    if (sound) tone('pop');
  });
  $('schematic-button').addEventListener('click', () => {
    $('schematic-svg').innerHTML = window.BlackoutSchematic.render(state.nodes, state.edges, state.analysis);
    $('discovery').textContent = state.analysis.hasParallel
      ? '당신이 만든 병렬 연결에서는 전류가 여러 갈래로 나뉩니다. 갈라진 전류를 모두 더하면, 갈라지기 전의 전류와 같습니다.'
      : '전류는 전원에서 시설을 지나 다시 전원으로 돌아옵니다. 당신이 만든 연결을 따라가 보세요.';
    $('schematic-panel').hidden = false; $('result').hidden = true; $('close-schematic').focus();
  });
  $('close-schematic').addEventListener('click', () => { $('schematic-panel').hidden = true; $('result').hidden = false; $('schematic-button').focus(); });
  document.addEventListener('keydown', event => {
    const modal = ['help-panel', 'pause-panel', 'schematic-panel'].map($).find(el => !el.hidden);
    if (modal && event.key === 'Tab') {
      const buttons = [...modal.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key === 'Escape') {
      if (!$('help-panel').hidden) showHelp(false);
      else if (!$('schematic-panel').hidden) $('close-schematic').click();
      else if (drag || keyboardStart || selected || measured) { cancelDrag(); selectWire(null); measured = null; $('measure-layer').innerHTML = ''; }
      else if (state.mode === 'playing') pause(!state.paused);
      return;
    }
    // Native button activation owns Space and Enter while a button is focused.
    if (event.target.closest('button') && [' ', 'Enter'].includes(event.key)) return;
    if (event.code === 'Space' && state.mode === 'playing' && $('help-panel').hidden) { event.preventDefault(); pause(!state.paused); }
    if (!canInteract()) return;
    if (event.key.toLowerCase() === 'a') setTool('amp');
    if (event.key.toLowerCase() === 'c') setTool('connect');
    if (['Delete', 'Backspace'].includes(event.key) && selected) { event.preventDefault(); removeWire(selected); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.mode === 'playing' && !state.paused) pause(true); });
  window.addEventListener('blur', () => cancelDrag());
  window.addEventListener('resize', () => { cancelDrag(); selectWire(null); resizeHits(); });
  reset();
  requestAnimationFrame(frame);
  // Deterministic integration testing only; ordinary play has no speed controls.
  if (new URLSearchParams(location.search).has('test')) {
    window.BlackoutTesting = Object.freeze({
      snapshot: () => JSON.parse(JSON.stringify(state)),
      advance(seconds) { for (let t = 0; t < seconds; t += .05) { update(Math.min(.05, seconds - t)); draw(.05); } },
      start, reset, connect: addConnection, branch: addBranch, remove: removeWire,
      geometry: id => wireViews.get(id)?.geometry,
    });
  }
})();
