/* BLACKOUT — the map is the interface. Runs directly from index.html. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = window.BlackoutEngine;
  const R = window.BlackoutRouter;
  const C = window.BlackoutCable;
  const G = window.BlackoutGrid;
  const roadRouter = R.create(window.BlackoutCity.roads);
  const board = $('board');
  const game = $('game');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const testMode = new URLSearchParams(location.search).has('test');
  const legacyMode = new URLSearchParams(location.search).has('legacy');
  const Runs = window.BlackoutRuns;
  let scenarioIndex = legacyMode ? 0 : Runs.indexFor(new URLSearchParams(location.search).get('seed'));
  const runHistory = [];
  let journal;
  const record = (event, payload = {}) => journal?.record(event, state.time, payload);
  const baseLoadPlan = [
    { at: 0, id: 'lamp-1', type: 'lamp', x: 545, y: 285, label: '01 / 주택' },
    { at: 30, id: 'lamp-2', type: 'lamp', x: 800, y: 465, label: '02 / 골목' },
    { at: 90, id: 'lamp-3', type: 'lamp', x: 850, y: 180, label: '03 / 공원' },
    { at: 225, id: 'motor-1', type: 'motor', x: 1020, y: 345, label: '04 / 급수 펌프' },
  ];
  let loadPlan = Runs.plan(baseLoadPlan, scenarioIndex);
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
  let focusedCircuit = null;
  let undoEdit = null;
  let statusLayoutKeys = {};

  function clearUndo() { undoEdit = null; $('undo-wire').hidden = true; }
  function undoWire() {
    if (!canInteract() || !undoEdit) return false;
    const edge = undoEdit.edge;
    const check = G.canConnect(state.nodes, state.edges, edge.a, edge.b, edge.aPort, edge.bPort);
    if (!check.ok || !E.canConnect(state.nodes, state.edges, edge.a, edge.b, edge.aPort, edge.bPort).ok) {
      toast('그 뒤 연결이 바뀌었어요. 단자에서 다시 연결해 주세요.'); clearUndo(); return false;
    }
    const restored = { ...edge, heat: Math.max(0, edge.heat - (state.time - undoEdit.at) / E.COOLING_SECONDS) };
    state.edges.push(restored); clearUndo();
    state.stableFor = 0; state.director.stableFor = 0;
    record('wire_undo', { id: restored.id, heat: restored.heat });
    recalculate(); rebuild(); tone('connect');
    hint('방금 끊은 전선을 되돌렸어요.', '필요한 연결을 다시 골라 바꿀 수 있어요.', 6);
    return true;
  }

  function openRepairDistrict() {
    clearUndo();
    const feeder = G.assignment(state.nodes, state.edges, 'lamp-1') === 'feeder-B' ? 'feeder-A' : 'feeder-B';
    for (const plan of loadPlan.slice(1, 3)) { state.nodes.push({ ...plan }); record('facility_spawn', { id: plan.id, type: plan.type, inherited: true }); }
    const oldEdges = [makeWire(feeder, 'lamp-2', 'plus', 'left'), makeWire('lamp-2', 'lamp-3', 'right', 'left'), makeWire('lamp-3', feeder, 'right', 'minus')];
    for (const edge of oldEdges) edge.inherited = true;
    state.edges.push(...oldEdges);
    state.lessonStarted = true;
    record('repair_opened', { feeder, edges: oldEdges.map(e => e.id) });
    recalculate(); rebuild(); tone('pop');
    hint('연결은 있지만, 두 불빛이 약해요.', '두 시설 사이의 낡은 선을 선택해 끊고, 배전함에서 각 시설로 길을 바꿔 보세요.', Infinity);
  }
  function applyDemand() {
    if (state.demandChanged) return;
    const load = state.nodes.find(n => n.id === state.surgeId);
    if (!load) return;
    clearUndo();
    const before = G.status(state.nodes, state.edges, state.analysis);
    load.nominalCurrent = .45;
    state.demandChanged = true;
    state.stableFor = 0;
    recalculate(); rebuild(); tone('pop');
    record('demand_changed', { id: load.id, from: .30, to: .45, before, after: G.status(state.nodes, state.edges, state.analysis) });
    hint(`${load.label.replace(/^\d+ \/ /, '')}의 전력 수요가 늘었어요.`, '시설을 추가하지 않아도 전류가 달라져요. 두 회선의 여유를 다시 살펴보세요.', 10);
  }

  function focusCircuit(id) {
    const changed = focusedCircuit !== id;
    focusedCircuit = id;
    const related = new Set();
    if (id) {
      const pending = [id], visited = new Set([id]);
      while (pending.length) {
        const next = pending.pop();
        for (const edge of state.edges) {
          if (edge.a !== next && edge.b !== next) continue;
          related.add(edge.id);
          const other = edge.a === next ? edge.b : edge.a;
          const node = state.nodes.find(n => n.id === other);
          if (node?.type === 'junction' && !visited.has(other)) { visited.add(other); pending.push(other); }
        }
      }
      if (!legacyMode) {
        const ids = G.group(state.nodes, state.edges, id);
        const feeder = G.assignment(state.nodes, state.edges, id);
        for (const edge of state.edges) {
          if ((edge.fixed && edge.feeder === feeder) || (!edge.fixed && [edge.a, edge.b].some(key => ids.has(key) && state.nodes.find(n => n.id === key)?.type !== 'feeder'))) related.add(edge.id);
        }
      }
    }
    for (const [key, v] of wireViews) v.group.classList.toggle('unfocused', !!id && !related.has(key));
    for (const edge of state.edges) $(`particles-${edge.id}`)?.classList.toggle('unfocused', !!id && !related.has(edge.id));
    for (const [key, v] of views) v.el.classList.toggle('circuit-focus', key === id);
    if (id && changed) record('circuit_selected', { id });
  }

  function fitBoard() {
    // Keep the original city, lighting and animation; remove unused framing.
    board.setAttribute('viewBox', legacyMode ? '0 0 1200 760' : '140 75 1000 510');
    resizeHits();
    positionHint();
    positionStatus(); positionStatus('demand-status');
  }
  function positionHint() {
    if (legacyMode || !state || state.mode === 'won') return;
    const box = $('hint'), scale = worldScale();
    box.style.width = `${Math.min(innerWidth - 32, innerHeight < 430 ? 280 : 420)}px`;
    box.style.left = '50%'; box.style.top = ''; box.style.bottom = '';
    const base = box.getBoundingClientRect();
    const blocked = state.nodes.map(n => {
      const p = toScreen(n), side = Math.max(85 * scale, 44);
      return { left: p.x - side, right: p.x + side, top: p.y - Math.max(52 * scale, 22), bottom: p.y + Math.max(65 * scale, 22) };
    });
    for (const el of document.querySelectorAll('.hud,.toolbox,.utility,#cable-meter,.orientation-note,#connection-guide,#risk-status,#demand-status')) {
      if (!el.hidden && getComputedStyle(el).display !== 'none') blocked.push(el.getBoundingClientRect());
    }
    let best = null;
    for (const x of [(innerWidth - base.width) / 2, 16, innerWidth - 16 - base.width]) {
      for (let y = 64; y + base.height < innerHeight - 65; y += 4) {
        const overlap = blocked.reduce((sum, r) => sum + Math.max(0, Math.min(x + base.width, r.right + 5) - Math.max(x, r.left - 5)) * Math.max(0, Math.min(y + base.height, r.bottom + 5) - Math.max(y, r.top - 5)), 0);
        const score = overlap * 100 + Math.abs(y - base.top) + Math.abs(x - base.left) * .4;
        if (!best || score < best.score) best = { x, y, score };
      }
    }
    if (best) { box.style.left = `${best.x + base.width / 2}px`; box.style.top = `${best.y}px`; box.style.bottom = 'auto'; }
  }
  function positionStatus(id = 'risk-status') {
    if (legacyMode) return;
    const box = $(id);
    if (box.hidden) { delete statusLayoutKeys[id]; return; }
    // During a fault this panel contains the action. Avoid a second competing hint.
    $('hint').classList.add('quiet');
    const key = `${innerWidth}/${innerHeight}/${state.nodes.length}/${box.className}/${box.textContent.replace(/\d/g, '#')}`;
    if (key === statusLayoutKeys[id]) return;
    statusLayoutKeys[id] = key;
    box.style.width = ''; box.style.left = '50%'; box.style.top = '';
    const natural = box.getBoundingClientRect(), scale = worldScale();
    const blocked = state.nodes.map(n => {
      const p = toScreen(n), side = Math.max(85 * scale, 44);
      return { left: p.x - side, right: p.x + side, top: p.y - Math.max(52 * scale, 22), bottom: p.y + Math.max(65 * scale, 22) };
    });
    for (const el of document.querySelectorAll('.hud,.toolbox,.utility,#cable-meter,.orientation-note')) {
      if (!el.hidden && getComputedStyle(el).display !== 'none') blocked.push(el.getBoundingClientRect());
    }
    let best = null;
    for (const width of [...new Set([natural.width, Math.min(220, innerWidth - 32), Math.min(170, innerWidth - 32)])]) {
      box.style.width = `${width}px`;
      const height = box.getBoundingClientRect().height;
      const xs = [(innerWidth - width) / 2, 16, innerWidth - width - 16, ...blocked.flatMap(r => [r.left - width - 6, r.right + 6])];
      const ys = [natural.top, 64, innerHeight - height - 65, ...blocked.flatMap(r => [r.top - height - 6, r.bottom + 6])];
      for (const x of xs) for (const y of ys) {
        if (x < 16 || x + width > innerWidth - 16 || y < 64 || y + height > innerHeight - 65) continue;
        const overlap = blocked.reduce((sum, r) => sum + Math.max(0, Math.min(x + width, r.right + 5) - Math.max(x, r.left - 5)) * Math.max(0, Math.min(y + height, r.bottom + 5) - Math.max(y, r.top - 5)), 0);
        const score = overlap * 1000 + Math.abs(y - natural.top) + Math.abs(x - (innerWidth - width) / 2) * .4 + Math.abs(natural.width - width) * .3;
        if (!best || score < best.score) best = { x, y, width, score };
      }
    }
    if (best) { box.style.width = `${best.width}px`; box.style.left = `${best.x + best.width / 2}px`; box.style.top = `${best.y}px`; }
  }

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
  function electricalText(status) {
    const format = value => Math.abs(value) < .005
      ? '0'
      : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${format(status?.voltage || 0)}V, ${format(status?.current || 0)}A`;
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
    positionHint();
    if (!legacyMode && (!$('risk-status').hidden || !$('demand-status').hidden)) $('hint').classList.add('quiet');
  }
  function tone(kind) {
    if (!sound) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const o = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const pitches = { connect: [760, 1120, .09], pop: [430, 620, .15], snap: [135, 35, .25], warning: [240, 180, .18], win: [523, 784, .8], measure: [600, 600, .05] };
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
  function reset(options = {}) {
    cancelDrag();
    if (options.seed !== undefined) scenarioIndex = Runs.indexFor(options.seed);
    if (legacyMode) scenarioIndex = 0;
    if (!options.keepHistory) runHistory.length = 0;
    loadPlan = Runs.plan(baseLoadPlan, scenarioIndex);
    state = {
      mode: 'intro', time: 0, stableFor: 0, victoryFor: 0, tool: 'connect', paused: false,
      nodes: [{ id: 'source', type: 'source', x: 245, y: 415, label: '건전지' }, ...(!legacyMode ? G.feeders() : []), { ...loadPlan[0] }],
      edges: [], analysis: null, firstConnection: false, ampUnlocked: false, branchUnlocked: false,
      noticedDim: false, noticedOverload: false, lateHint: false, breaks: 0, didBranch: false,
      firstStableLight: false, firstStableFor: 0,
      director: window.BlackoutDirector.create(),
      overloadActive: false, overloadEpisode: 0, recovering: false, recoveryStarted: 0,
      recoveries: 0, observations: {}, lastSampleAt: 0,
      seed: Runs.scenarios[scenarioIndex].seed, resultShown: false,
      lessonStarted: false, lessonSolved: false,
      surgeId: 'lamp-1', demandChanged: legacyMode, demandNotice: false,
    };
    wireCounter = 0; junctionCounter = 0; selected = null; measured = null; keyboardStart = null; focusedCircuit = null;
    if (!legacyMode) state.edges = G.infrastructure(makeWire);
    clearUndo();
    statusLayoutKeys = {};
    journal = window.BlackoutTelemetry.create({ runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, variant: 'v2-r4', seed: state.seed, testMode, legacyMode });
    views.clear(); wireViews.clear();
    game.className = 'game intro-mode';
    $('intro').hidden = false; $('intro').classList.remove('leaving');
    $('intro').inert = false;
    for (const id of ['result', 'pause-panel', 'help-panel', 'schematic-panel', 'wire-actions']) $(id).hidden = true;
    $('amp-tool').disabled = true;
    $('amp-tool').setAttribute('aria-label', '전류계 · 잠김');
    $('amp-tool').title = '전류계는 잠시 후 열립니다';
    $('pause-button').setAttribute('aria-label', '일시 정지');
    $('phase-label').textContent = '전력 복구';
    $('district-name').textContent = Runs.scenarios[scenarioIndex].name;
    $('run-description').textContent = Runs.scenarios[scenarioIndex].description;
    $('result-story').textContent = '';
    $('next-preview').textContent = '';
    $('clock').textContent = '00:00';
    $('ambient-light').setAttribute('opacity', '.018');
    $('city').innerHTML = window.BlackoutCity.markup();
    $('measure-layer').innerHTML = '';
    $('toast').classList.remove('visible');
    $('demand-status').hidden = true;
    $('risk-status').hidden = true;
    setTool('connect');
    recalculate(); rebuild();
    fitBoard();
    hint('한 바퀴 이어져야, 빛이 켜집니다.', legacyMode ? '건전지 + → 전구 한쪽 단자 · 전구 반대쪽 → 건전지 −' : 'A 배전함 + → 주택 한쪽 단자 · 주택 반대쪽 → A 배전함 −', Infinity);
    lockPlayfield(true);
  }
  function start() {
    if (state.mode !== 'intro') return;
    state.mode = 'playing';
    record('run_start');
    hint(`${Runs.scenarios[scenarioIndex].name} · 첫 불빛을 이어 주세요.`, legacyMode ? '건전지 + → 전구 한쪽 단자 · 전구 반대쪽 → 건전지 −' : '배전함 + → 주택 → 같은 배전함 − · 두 선을 이어 주세요', Infinity);
    updateConnectionGuide();
    updateCable();
    game.classList.remove('intro-mode');
    $('intro').classList.add('leaving');
    $('intro').inert = true;
    lockPlayfield(false);
    lastFrame = performance.now();
    tone('pop');
  }
  function recalculate() {
    state.analysis = analyzeCircuit();
    topologyDirty = true;
  }
  function analyzeCircuit() {
    const analysis = E.analyze(state.nodes, state.edges);
    if (!legacyMode) for (const item of G.status(state.nodes, state.edges, analysis)) {
      Object.assign(analysis.nodes[item.id], { current: item.current, voltage: item.tripped ? 0 : Math.abs(analysis.nodes[item.id].terminals.plus - analysis.nodes[item.id].terminals.minus), powered: !item.tripped, brightness: item.tripped ? 0 : 1 });
      if (item.tripped) analysis.allStable = false;
    }
    return analysis;
  }
  function resetFeeder(id) {
    if (!canInteract() || legacyMode) return false;
    const result = G.resetFeeder(E, state.nodes, state.edges, id);
    record('feeder_reset', { id, ...result });
    if (!result.ok) { toast(result.reason); return false; }
    recalculate(); rebuild(); selectWire(null); tone('connect');
    hint('회선에 전력이 돌아왔어요.', '모든 시설의 연결과 전류가 안정되는지 살펴보세요.', 8);
    return true;
  }
  function terminalPoint(id, port) {
    const node = state.nodes.find(n => n.id === id);
    if (!node || !E.ports(node).includes(port)) return null;
    return { id, port, x: node.x + (port === 'minus' || port === 'left' ? -46 : port === 'plus' || port === 'right' ? 46 : 0), y: node.y };
  }
  function makeWire(a, b, aPort, bPort, heat = 0, route = null) {
    const from = terminalPoint(a, aPort), to = terminalPoint(b, bPort);
    return { id: `wire-${++wireCounter}`, a, b, aPort, bPort, route: route || wireRoute(from, to), heat, capacity: E.WIRE_CAPACITY, born: state.time };
  }
  function cableStatus() {
    return C.status(state.edges, state.nodes.filter(n => ['lamp', 'motor'].includes(n.type)).length);
  }
  function updateCable(previewCost = null) {
    const meter = $('cable-meter');
    if (!state) { meter.hidden = true; return; }
    meter.hidden = legacyMode || state.mode !== 'playing' || state.paused;
    if (meter.hidden) return;
    if (!state.analysis) return;
    const circuits = G.status(state.nodes, state.edges, state.analysis);
    $('cable-value').textContent = circuits.map(s => `${s.id.slice(-1)} ${s.tripped ? '차단' : `${s.current.toFixed(2)} / ${s.capacity.toFixed(2)} A`}`).join(' · ');
    $('cable-note').textContent = '길이 제한 없음 · 시설의 전류를 두 회선에 배분';
    meter.classList.toggle('tight', circuits.some(s => s.tripped || s.current > s.capacity));
    const selectedEdge = state.edges.find(e => e.id === selected);
    if (selectedEdge?.fixed) $('delete-wire').disabled = !state.nodes.find(n => n.id === selectedEdge.feeder)?.tripped;
  }
  function approveCable(route) {
    return true;
  }
  function addConnection(from, to, fromPort, toPort) {
    if (!legacyMode && !canInteract()) return false;
    let check = E.canConnect(state.nodes, state.edges, from, to, fromPort, toPort);
    if (check.ok && !legacyMode) check = G.canConnect(state.nodes, state.edges, from, to, fromPort, toPort);
    if (!check.ok) {
      record('connect_result', { from, to, fromPort, toPort, ok: false, reason: check.reason });
      toast(check.reason); return false;
    }
    const route = wireRoute(terminalPoint(from, fromPort), terminalPoint(to, toPort));
    if (!approveCable(route)) {
      record('connect_result', { from, to, fromPort, toPort, ok: false, reason: 'cable' });
      return false;
    }
    clearUndo();
    state.edges.push(makeWire(from, to, fromPort, toPort, 0, route));
    record('connect_result', { from, to, fromPort, toPort, ok: true });
    connected();
    return true;
  }
  function connected() {
    recalculate(); rebuild();
    tone('connect');
    state.stableFor = 0;
    if (!legacyMode) state.director.stableFor = 0;
    if (!state.firstConnection && state.analysis.nodes['lamp-1'].powered) {
      state.firstConnection = true;
      record('first_power');
      hint('한 바퀴의 연결, 하나의 빛.', '전류는 +극에서 전구를 지나 −극으로 돌아옵니다.', 9);
    }
    if (state.analysis.shortCircuit) {
      hint('기기를 거치지 않고 +극과 −극이 이어졌어요.', '합선된 전선을 끊고, 전구를 지나는 길을 만들어 주세요.', Infinity);
    } else if (!state.firstConnection && state.edges.length) {
      hint('전구의 양쪽 단자까지 이어 주세요.', legacyMode ? '한쪽은 건전지 +극에, 반대쪽은 −극에 연결해야 켜집니다.' : '한쪽은 배전함 +극에, 반대쪽은 같은 배전함 −극에 연결해야 켜집니다.', Infinity);
    }
    if (!state.noticedDim && state.nodes.some(n => n.type === 'lamp' && state.analysis.nodes[n.id].powered && state.analysis.nodes[n.id].brightness < .8)) {
      state.noticedDim = true;
      hint('시설에 도착한 전압이 낮아요.', legacyMode ? '다른 곳에서 전선을 가져오면 어떤 변화가 생길까요?' : '기존 선을 끊어 각 시설의 공급·귀환 경로를 바꿔 보세요.', 10);
    }
    settledFeedback();
    updateConnectionGuide();
  }
  function settledFeedback() {
    if (!state.overloadEpisode || state.analysis.shortCircuit || state.edges.some(e => state.analysis.edges[e.id]?.overloaded)) return;
    const loads = state.nodes.filter(n => ['lamp', 'motor'].includes(n.type));
    if (loads.every(n => state.analysis.nodes[n.id].powered && state.analysis.nodes[n.id].brightness >= E.STABLE_BRIGHTNESS)) {
      hint('모든 시설에 전류가 돌아왔어요.', '공급선과 귀환선이 이어졌고, 전류도 안전해요.', 7);
    }
  }
  function updateConnectionGuide() {
    const guide = $('connection-guide');
    for (const el of $('nodes').querySelectorAll('.guided')) el.classList.remove('guided');
    guide.hidden = state.mode !== 'playing' || state.firstConnection || state.paused;
    if (guide.hidden) return;
    const portAt = sourcePort => {
      const sourceId = legacyMode ? 'source' : (G.assignment(state.nodes, state.edges, 'lamp-1') || 'feeder-A');
      for (const e of state.edges) {
        if (e.a === sourceId && e.aPort === sourcePort && e.b === 'lamp-1') return e.bPort;
        if (e.b === sourceId && e.bPort === sourcePort && e.a === 'lamp-1') return e.aPort;
      }
      return null;
    };
    const supply = portAt('plus'), back = portAt('minus');
    const opposite = p => p === 'left' ? 'right' : 'left';
    let targets;
    if (state.analysis.shortCircuit) {
      guide.textContent = '합선된 전선을 선택해 끊은 뒤, 전구를 지나는 길을 만드세요.';
      targets = [];
    } else if (supply && back && supply === back) {
      guide.textContent = '두 전선이 같은 단자에 닿았어요. 하나를 전구 반대쪽 단자로 옮겨 주세요.';
      targets = [['lamp-1', opposite(supply)]];
    } else if (supply || back) {
      guide.textContent = supply
        ? '1 / 2 연결 · 전구 반대쪽에서 −극까지 돌아오는 길을 이어 주세요.'
        : '1 / 2 연결 · +극에서 전구 반대쪽까지 전기를 보내는 길을 이어 주세요.';
      targets = [['lamp-1', opposite(supply || back)], [legacyMode ? 'source' : (G.assignment(state.nodes, state.edges, 'lamp-1') || 'feeder-A'), supply ? 'minus' : 'plus']];
    } else {
      guide.textContent = '0 / 2 연결 · 반짝이는 +단자에서 전구 단자까지 끌어 주세요.';
      targets = [[legacyMode ? 'source' : 'feeder-A', 'plus'], ['lamp-1', 'left']];
    }
    for (const [id, port] of targets) $(`terminal-${id}-${port}`)?.classList.add('guided');
  }
  function addBranch(edgeId, origin, targetId, targetPort) {
    if (!legacyMode) { toast('새 갈래는 A 또는 B 배전함의 단자에서 시작하세요.'); return false; }
    const edge = state.edges.find(e => e.id === edgeId);
    if (!edge) return;
    if (!state.branchUnlocked) { toast('조금 뒤에 전선 중간에서도 새 갈래를 만들 수 있어요.'); return; }
    const a = terminalPoint(edge.a, edge.aPort);
    const b = terminalPoint(edge.b, edge.bPort);
    const pieces = R.split(edge.route, origin);
    origin = pieces.point;
    if (distance(origin, a) < 26) { addConnection(a.id, targetId, a.port, targetPort); return; }
    if (distance(origin, b) < 26) { addConnection(b.id, targetId, b.port, targetPort); return; }
    const j = { id: `junction-${junctionCounter + 1}`, type: 'junction', x: origin.x, y: origin.y, label: '' };
    const remaining = state.edges.filter(e => e.id !== edgeId);
    // Validate before mutation. Failed drops never leave orphan junctions.
    const candidate = [...remaining, { id: '_a', a: edge.a, b: j.id, aPort: edge.aPort, bPort: 'joint' }, { id: '_b', a: j.id, b: edge.b, aPort: 'joint', bPort: edge.bPort }];
    const check = E.canConnect([...state.nodes, j], candidate, j.id, targetId, 'joint', targetPort);
    if (!check.ok) { toast(check.reason); return; }
    const branchRoute = wireRoute(origin, terminalPoint(targetId, targetPort));
    if (!approveCable(branchRoute)) return false;
    junctionCounter++;
    state.nodes.push(j);
    state.edges = [...remaining, makeWire(edge.a, j.id, edge.aPort, 'joint', edge.heat, pieces.before), makeWire(j.id, edge.b, 'joint', edge.bPort, edge.heat, pieces.after)];
    state.edges.push(makeWire(j.id, targetId, 'joint', targetPort, 0, branchRoute));
    state.didBranch = true;
    record('branch_created', { edgeId, targetId, targetPort });
    selected = null; $('wire-actions').hidden = true;
    connected();
  }
  function removeWire(id, broken = false) {
    if (!legacyMode && !broken && !canInteract()) return false;
    const original = state.edges.find(e => e.id === id);
    if (original?.fixed) { toast('고정 회선은 철거하지 않아요. 연결된 시설을 옮겨 전류를 나눠 주세요.'); return false; }
    if (!state.edges.some(e => e.id === id)) return;
    if (!legacyMode) {
      clearUndo();
      if (!broken) { undoEdit = { edge: JSON.parse(JSON.stringify(original)), at: state.time }; $('undo-wire').hidden = false; }
      state.director.stableFor = 0;
    }
    record(broken ? 'wire_break' : 'wire_removed', { id, episode: state.overloadEpisode || null });
    const wasShorted = state.analysis.shortCircuit;
    state.edges = state.edges.filter(e => e.id !== id);
    const used = new Set(state.edges.flatMap(e => [e.a, e.b]));
    state.nodes = state.nodes.filter(n => n.type !== 'junction' || used.has(n.id));
    if (selected === id) selectWire(null);
    if (measured?.id === id) { measured = null; $('measure-layer').innerHTML = ''; }
    state.stableFor = 0;
    recalculate(); rebuild();
    updateConnectionGuide();
    if (!broken && wasShorted && !state.analysis.shortCircuit) {
      hint('합선이 해소됐어요.', '각 기기의 양쪽 단자를 연결해, +극에서 −극으로 돌아오는 길을 만드세요.', 9);
    } else if (!broken && state.nodes.some(n => (n.type === 'lamp' || n.type === 'motor') && !state.analysis.nodes[n.id].powered)) {
      hint('끊어진 회로에는 전류가 흐르지 않아요.', '가는 전선과 돌아오는 전선을 모두 이어 주세요.', 9);
    }
    if (!broken) {
      if (!legacyMode && state.lessonStarted && !state.lessonSolved) hint('기존 연결을 바꿀 수 있어요.', '빈 단자를 배전함으로 이어 주세요. 잘못 끊었다면 ↶ 버튼으로 되돌릴 수 있어요.', 10);
      settledFeedback(); tone('snap');
    }
    return true;
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
    const edge = state.edges.find(e => e.id === id);
    const name = nodeId => state.nodes.find(n => n.id === nodeId)?.label || '분기점';
    $('wire-actions').querySelector('span').textContent = `${name(edge.a)} ↔ ${name(edge.b)}`;
    $('delete-wire').textContent = edge.fixed ? '회선 복구 ↗' : '연결 끊기 ×';
    $('delete-wire').disabled = !!edge.fixed && !state.nodes.find(n => n.id === edge.feeder)?.tripped;
    const p = toScreen(point || wireViews.get(id).geometry.at(.5));
    $('wire-actions').style.left = `${Math.max(130, Math.min(innerWidth - 130, p.x))}px`;
    $('wire-actions').style.top = `${Math.max(130, p.y - 20)}px`;
  }
  function measure(id, p, explicit = true) {
    measured = { id, x: Math.max(75, Math.min(1125, p.x)), y: Math.max(110, p.y - 45) };
    const current = state.analysis.edges[id]?.current || 0;
    if (explicit) record('measure', { id, current });
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
  function closestTerminal(p, exclude) {
    const radius = Math.min(37, Math.max(22, 20 / worldScale()));
    let found = null, nearest = radius;
    for (const n of state.nodes) {
      if (!legacyMode && n.type === 'source') continue;
      for (const port of E.ports(n)) {
        if (n.id === exclude?.id && port === exclude.port) continue;
        const terminal = terminalPoint(n.id, port);
        const d = distance(p, terminal);
        if (d < nearest) { found = terminal; nearest = d; }
      }
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
    const label = n.type === 'source' ? '건전지' : n.type === 'junction' ? '분기점' : n.label;
    let art;
    if (n.type === 'source') {
      art = '<rect class="node-shell" x="-26" y="-17" width="50" height="34" rx="5"/><path class="battery-tip" d="M24-7h6V7h-6"/><path class="node-symbol battery-mark" d="M-16 0h9M6 0h10M11-5v10"/>';
    } else if (n.type === 'feeder') {
      art = `<rect class="node-shell" x="-22" y="-18" width="44" height="36" rx="6"/><text class="feeder-letter" text-anchor="middle" y="5">${n.id.slice(-1)}</text>`;
    } else if (n.type === 'lamp') {
      art = '<circle class="node-shell" r="22"/><path class="node-symbol" d="M-8-5a8 8 0 1 1 16 0c0 4-4 5-4 9h-8c0-4-4-5-4-9Z M-4 8h8 M-2 11h4 M-3-5l3 4 3-4M0-1v5"/>';
    } else if (n.type === 'motor') {
      art = '<circle class="node-shell" r="24"/><circle class="node-symbol" r="18"/><g class="rotor"><path class="node-symbol" d="M0 0C-15-4-8-16-2-11Z M0 0C4-15 16-8 11-2Z M0 0C15 4 8 16 2 11Z M0 0C-4 15-16 8-11 2Z"/></g><circle class="node-symbol" r="3"/>';
    } else {
      art = '<circle class="node-shell" r="9"/><circle class="junction-core" r="3"/>';
    }
    const terminals = (n.type === 'source' && !legacyMode ? [] : E.ports(n)).map(port => {
      const x = terminalPoint(n.id, port).x - n.x;
      const name = port === 'plus' ? '+극' : port === 'minus' ? '−극' : port === 'left' ? '왼쪽 단자' : port === 'right' ? '오른쪽 단자' : '분기점';
      return `<g id="terminal-${n.id}-${port}" class="terminal ${port}" data-node="${n.id}" data-port="${port}" role="button" tabindex="0" aria-label="${label} ${name}, 전선 연결" transform="translate(${x} 0)"><circle class="terminal-hit" r="22"/><circle class="terminal-ring" r="8"/>${['source','feeder'].includes(n.type) ? `<path class="polarity" d="M-4 0h8${port === 'plus' ? 'M0-4v8' : ''}"/><text class="polarity-label" text-anchor="middle" y="-20">${port === 'plus' ? '+' : '−'}</text>` : '<circle class="terminal-core" r="2.5"/>'}</g>`;
    }).join('');
    const reading = n.type === 'lamp' || n.type === 'motor'
      ? `<text class="device-reading" text-anchor="middle" y="42" aria-hidden="true">0V, 0A</text><text class="facility-name" text-anchor="middle" y="-38">${n.label.replace(/^\d+ \/ /, '')}${n.nominalCurrent ? ' · 수요 ↑' : ''}</text>`
      : n.label ? `<text class="node-label" text-anchor="middle" y="49">${n.label}</text>` : '';
    return `<g id="node-${n.id}" class="node ${n.type}" data-node="${n.id}" role="group" aria-label="${label}" transform="translate(${n.x} ${n.y})">${n.type !== 'junction' ? '<path class="terminal-lead" d="M-46 0h24M22 0h24"/>' : ''}<g class="node-art">${art}</g>${terminals}${reading}</g>`;
  }
  function rebuild() {
    const focused = document.activeElement?.closest?.('.terminal');
    const focusedId = focused?.id;
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
    if (measured && state.edges.some(e => e.id === measured.id)) measure(measured.id, { x: measured.x, y: measured.y + 45 }, false);
    topologyDirty = false;
    resizeHits();
    focusCircuit(focusedCircuit);
    updateConnectionGuide();
    updateCable();
    if (focusedId && $(focusedId)) $(focusedId).focus({ preventScroll: true });
    positionHint();
  }
  function resizeHits() {
    const scale = worldScale();
    const radius = Math.min(37, Math.max(22, 20 / scale));
    const artScale = Math.min(1.15, Math.max(1, .65 / scale));
    for (const v of views.values()) {
      for (const hit of v.el.querySelectorAll('.terminal-hit')) hit.setAttribute('r', radius);
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
    for (const terminal of $('nodes').querySelectorAll('.terminal.snap')) terminal.classList.remove('snap');
    updateCable();
  }
  board.addEventListener('pointerdown', event => {
    if (!canInteract() || event.button !== 0 || drag) return;
    event.preventDefault();
    const p = pointFromEvent(event);
    const node = closestTerminal(p);
    const feederBody = !legacyMode && !node && state.nodes.find(n => n.type === 'feeder' && distance(n, p) < 26);
    const wire = node || feederBody ? null : closestWire(p);
    if (state.tool === 'amp') {
      if (feederBody) measure(`${feederBody.id}-plus`, feederBody);
      else if (wire) measure(wire.id, wire.point);
      else { measured = null; $('measure-layer').innerHTML = ''; }
      return;
    }
    if (feederBody) { focusCircuit(feederBody.id); selectWire(`${feederBody.id}-plus`, feederBody); return; }
    if (legacyMode && wire && selected === wire.id) { removeWire(wire.id); return; }
    if (!legacyMode && wire) { selectWire(wire.id, wire.point); return; }
    selectWire(null);
    if (!node && !wire) {
      const facility = state.nodes.find(n => n.type !== 'junction' && distance(n, p) < 26);
      focusCircuit(facility?.id || null);
      if (facility?.type === 'feeder') { selectWire(`${facility.id}-plus`); return; }
      if (facility) toast('이 시설의 연결을 강조했어요. 작은 단자에서 연결하고, 전선을 선택해 수정하세요.');
      return;
    }
    record('connect_attempt', { inputMode: event.pointerType || 'mouse', kind: node ? 'terminal' : 'branch' });
    drag = { pointerId: event.pointerId, kind: node ? 'node' : 'wire', from: node, edgeId: wire?.id, origin: node || wire.point, down: p, point: p, target: null, moved: false, held: false, started: performance.now() };
    board.setPointerCapture(event.pointerId);
  });
  board.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId || !canInteract()) return;
    const p = pointFromEvent(event);
    drag.point = p;
    if (distance(p, drag.down) * worldScale() > 8) drag.moved = true;
    if (!drag.moved) return;
    for (const terminal of $('nodes').querySelectorAll('.terminal.snap')) terminal.classList.remove('snap');
    const target = closestTerminal(p, drag.from);
    drag.target = target;
    const end = target || p;
    if (drag.kind === 'wire' && drag.held) {
      $('preview').setAttribute('d', '');
      return;
    }
    $('preview').setAttribute('d', geometry(drag.origin, end).d);
    updateCable(target ? C.length(wireRoute(drag.origin, target)) : null);
    $('preview').classList.toggle('snapped', !!target);
    $('snap-ring').setAttribute('visibility', target ? 'visible' : 'hidden');
    if (target) {
      $(`terminal-${target.id}-${target.port}`).classList.add('snap');
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
      if (pending.kind === 'node') addConnection(pending.from.id, pending.target.id, pending.from.port, pending.target.port);
      else addBranch(pending.edgeId, pending.origin, pending.target.id, pending.target.port);
    } else if (pending.kind === 'wire' && !pending.moved) {
      selectWire(pending.edgeId, pending.origin);
    } else if (pending.moved) {
      record('connect_miss', { reason: 'no_terminal' });
      toast('단자 가까이에서 놓아 주세요. 반짝이는 작은 원이 연결 지점이에요.');
    }
  });
  board.addEventListener('pointercancel', cancelDrag);
  board.addEventListener('lostpointercapture', () => { if (drag) cancelDrag(); });
  board.addEventListener('contextmenu', e => e.preventDefault());
  board.addEventListener('keydown', event => {
    if (!canInteract() || !['Enter', ' '].includes(event.key)) return;
    const terminal = event.target.closest('[data-port]');
    const nodeId = terminal?.dataset.node;
    const port = terminal?.dataset.port;
    const edgeId = event.target.closest('[data-wire]')?.dataset.wire;
    if (!nodeId && !edgeId) return;
    event.preventDefault(); event.stopPropagation();
    if (edgeId) {
      const p = wireViews.get(edgeId).geometry.at(.5);
      if (state.tool === 'amp') measure(edgeId, p); else selectWire(edgeId, p);
    } else if (state.tool === 'connect') {
      if (keyboardStart) {
        record('connect_attempt', { inputMode: 'keyboard', kind: 'terminal' });
        const from = keyboardStart; cancelDrag(); addConnection(from.id, nodeId, from.port, port);
      } else {
        keyboardStart = { id: nodeId, port };
        terminal.classList.add('snap');
        toast('Tab으로 다른 단자를 선택하고 Enter로 연결하세요.');
      }
    }
  });
  function pause(value) {
    if (state.mode !== 'playing') return;
    cancelDrag();
    state.paused = value;
    updateCable();
    record(value ? 'pause' : 'resume');
    updateConnectionGuide();
    updateRiskUi();
    $('demand-status').hidden = true;
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
    record(show ? 'help_open' : 'help_close');
    updateCable();
    updateConnectionGuide();
    updateRiskUi();
    $('demand-status').hidden = true;
  }
  function update(dt) {
    if (state.paused || state.mode === 'intro') return;
    if (state.mode === 'won') {
      state.victoryFor += dt;
      $('ambient-light').setAttribute('opacity', Math.min(1, .018 + state.victoryFor / 2));
      if (state.victoryFor >= 1.5) game.classList.add('restored');
      // Let the player see the whole city before adding the quiet end card.
      if (state.victoryFor >= 7 && $('schematic-panel').hidden) {
        $('result').hidden = false;
        if (!state.resultShown) { state.resultShown = true; record('result_shown', { seed: state.seed }); }
      }
      return;
    }
    state.time += dt;
    $('clock').textContent = timeText(state.time);
    const spawn = plan => {
      if (!legacyMode && plan.id === loadPlan[1].id) { openRepairDistrict(); return; }
      state.nodes.push({ ...plan }); recalculate(); rebuild(); tone('pop');
      record('facility_spawn', { id: plan.id, type: plan.type });
      hint(`${plan.label.replace(/^\d+ \/ /, '')}에도 전력이 필요해요.`, legacyMode ? '새 시설도 양쪽 단자를 연결해 건전지로 돌아오는 길을 만들어 주세요.' : 'A와 B의 전류 여유를 보고, 같은 배전함으로 공급·귀환을 이어 주세요.', 11);
    };
    if (legacyMode) {
      for (const plan of loadPlan) if (state.time >= plan.at && !state.nodes.some(n => n.id === plan.id)) spawn(plan);
    } else {
      const next = loadPlan.find(p => !state.nodes.some(n => n.id === p.id));
      const change = !next && !state.demandChanged ? state.nodes.find(n => n.id === state.surgeId) : null;
      const pending = next || change;
      const progress = window.BlackoutDirector.step(state.director, {
        time: state.time, dt, allStable: state.analysis.allStable, hasNext: !!pending,
      });
      if (progress.spawn) { if (next) spawn(next); else applyDemand(); }
      if (progress.announce) record('demand_preview', { id: pending.id, kind: change ? 'increase' : 'new_facility' });
      if (change && progress.remaining !== null && !state.demandNotice) {
        state.demandNotice = true;
        record('demand_notice', { id: change.id, nominalCurrent: .45 });
      }
      if (progress.help) hint('지금 있는 불빛부터 되찾아 주세요.', state.lessonStarted && !state.lessonSolved ? '선택한 전선의 연결 끊기 버튼으로 기존 연결을 바꿀 수 있어요. 각 시설의 전압을 살펴보세요.' : '새 수요는 기다려 줍니다. 양쪽 연결과 회선의 과열을 살펴보세요.', 12);
      $('demand-status').hidden = !state.firstConnection || progress.remaining === null || progress.spawn;
      if (!$('demand-status').hidden) {
        const forecast = change ? `${change.label.replace(/^\d+ \/ /, '')} 수요 0.30 → 0.45 A`
          : next.id === loadPlan[1].id ? '골목·공원의 기존 배선 점검' : `${next.label.replace(/^\d+ \/ /, '')} · ${next.type === 'motor' ? '0.45' : '0.30'} A`;
        $('demand-status').textContent = progress.remaining > 3 ? `다음 변화 · ${forecast}` : `${forecast} · ${Math.max(1, Math.ceil(progress.remaining))}초`;
      }
      const lit = state.nodes.filter(n => ['lamp', 'motor'].includes(n.type) && state.analysis.nodes[n.id]?.brightness >= E.STABLE_BRIGHTNESS).length;
      $('phase-label').textContent = `${lit} / ${loadPlan.length} 복구${change ? ' · 추가 수요 예정' : ''}`;
    }
    const secondPresent = state.nodes.some(n => n.id === loadPlan[1].id);
    if ((legacyMode ? state.time >= 65 : secondPresent) && !state.ampUnlocked) {
      state.ampUnlocked = true; $('amp-tool').disabled = false;
      record('tool_unlock', { tool: 'amp' });
      $('amp-tool').setAttribute('aria-label', '전류 측정'); $('amp-tool').title = '전류 측정 (A)';
      toast('A 도구가 열렸어요. 전선을 눌러 흐르는 전류를 살펴보세요.', 6500);
    }
    if (legacyMode && state.time >= 90 && !state.branchUnlocked) {
      state.branchUnlocked = true;
      record('tool_unlock', { tool: 'branch' });
      toast('전선 중간에서 새 시설의 단자로 끌면 분기점이 생깁니다. 반대쪽 단자의 귀환선도 이어 주세요.', 7000);
    }
    if (legacyMode && state.time >= 150 && !state.didBranch && !state.branchReminder) {
      state.branchReminder = true;
      hint('빛은 여러 갈래로 이어질 수 있어요.', '공급선에서 갈래를 만들고, 새 시설의 반대쪽은 −극으로 이어 주세요.', 9);
    }
    const overheated = state.edges.some(e => state.analysis.edges[e.id]?.overloaded);
    if (overheated && !state.overloadActive) {
      state.overloadActive = true;
      state.overloadEpisode++;
      state.noticedOverload = true;
      record('overload_start', { episode: state.overloadEpisode, shortCircuit: state.analysis.shortCircuit,
        edges: state.edges.filter(e => state.analysis.edges[e.id]?.overloaded).map(e => e.id) });
      tone('warning');
      hint(state.analysis.shortCircuit ? '합선으로 전류가 너무 많이 흐르고 있어요.' : '전선이 너무 많은 전류를 견디고 있어요.', state.analysis.shortCircuit ? '+극과 −극 사이에 전구나 펌프를 연결해 주세요.' : '가는 길과 돌아오는 길 모두, 한 전선의 부담을 나눠 주세요.', 9);
    }
    const broken = E.tickHeat(state.edges, state.analysis, dt);
    if (broken.length) {
      if (!state.recovering) {
        state.recovering = true; state.recoveryStarted = state.time;
        record('recovery_start', { episode: state.overloadEpisode });
      }
      if (!legacyMode) {
        const tripped = G.trip(state.nodes, state.edges, broken, state.analysis);
        for (const id of tripped) record('feeder_trip', { id, current: state.nodes.find(n => n.id === id).tripCurrent, loads: G.status(state.nodes, state.edges, state.analysis).find(s => s.id === id).loads });
      }
      broken.filter(id => !state.edges.find(e => e.id === id)?.fixed).forEach(id => removeWire(id, true));
      state.breaks++;
      tone('snap');
      $('blackout').classList.remove('flash');
      void $('blackout').offsetWidth;
      $('blackout').classList.add('flash');
      hint('괜찮아요. 다시 이어 주세요.', legacyMode ? '전구를 지나는 닫힌 길을 만들고, 공급선과 귀환선의 전류를 나눠 주세요.' : '시설 일부를 다른 회선으로 옮긴 뒤, 꺼진 배전함을 눌러 회선을 복구하세요.', 12);
    }
    // Cooling participates in stability, so recompute after heat changes too.
    state.analysis = analyzeCircuit();
    if (state.overloadActive && !state.edges.some(e => state.analysis.edges[e.id]?.overloaded)) {
      state.overloadActive = false;
      record('overload_end', { episode: state.overloadEpisode, reason: broken.length ? 'break' : 'redesign' });
      if (!broken.length) settledFeedback();
    }
    if (state.recovering && state.analysis.allStable) {
      state.recovering = false; state.recoveries++;
      record('recovery_complete', { seconds: state.time - state.recoveryStarted, recoveries: state.recoveries });
      hint('다시, 도시의 흐름을 되찾았어요.', '모든 시설의 닫힌 길과 전류가 안정됐습니다.', 7);
    }
    observeFacilities(dt);
    if (state.lessonStarted && !state.lessonSolved && ['lamp-2', 'lamp-3'].every(id => state.analysis.nodes[id]?.brightness >= E.STABLE_BRIGHTNESS)) {
      state.lessonSolved = true;
      record('repair_completed', { circuits: G.status(state.nodes, state.edges, state.analysis) });
      hint('연결을 바꾸자, 불빛이 돌아왔어요.', '이제 새 수요를 어느 회선에 나눌지 살펴보세요.', 7);
    }
    updateRiskUi();
    updateCable();
    positionStatus('demand-status');
    const allPresent = loadPlan.every(p => state.nodes.some(n => n.id === p.id));
    const firstLamp = state.analysis.nodes['lamp-1'];
    state.firstStableFor = firstLamp.powered && firstLamp.brightness >= E.STABLE_BRIGHTNESS
      ? state.firstStableFor + dt : 0;
    if (!state.firstStableLight && state.firstStableFor >= .25 - 1e-9) {
      state.firstStableLight = true;
      record('first_light', { brightness: firstLamp.brightness, stableSeconds: state.firstStableFor });
    }
    if (allPresent && state.demandChanged && state.analysis.allStable) {
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
  function observeFacilities(dt) {
    for (const n of state.nodes.filter(n => ['lamp', 'motor'].includes(n.type))) {
      const value = state.analysis.nodes[n.id];
      const current = !value.powered ? 'off' : value.brightness >= E.STABLE_BRIGHTNESS ? 'stable' : 'dim';
      const entry = state.observations[n.id] ||= { state: 'off', candidate: 'off', for: 0 };
      if (entry.candidate !== current) { entry.candidate = current; entry.for = 0; }
      entry.for += dt;
      if (entry.state !== current && entry.for >= .25 - 1e-9) {
        const previous = entry.state; entry.state = current;
        record('facility_state', { id: n.id, from: previous, to: current, brightness: value.brightness, current: value.current });
      }
    }
    if (state.time - state.lastSampleAt >= 1 - 1e-9) {
      state.lastSampleAt = state.time;
      record('sample', { loads: Object.fromEntries(Object.entries(state.observations).map(([id, value]) => [id, value.state])),
        maxHeat: Math.max(0, ...state.edges.map(e => e.heat || 0)), recovering: state.recovering,
        circuits: legacyMode ? null : G.status(state.nodes, state.edges, state.analysis) });
    }
  }
  function updateRiskUi() {
    const panel = $('risk-status');
    const tripped = !legacyMode && G.status(state.nodes, state.edges, state.analysis).find(s => s.tripped);
    if (tripped && state.mode === 'playing' && !state.paused) {
      panel.hidden = false; panel.classList.remove('cooling');
      $('connection-guide').hidden = true; $('demand-status').hidden = true;
      $('risk-title').textContent = `${tripped.id.slice(-1)} 회선 차단 · ${tripped.tripCurrent.toFixed(2)} / ${tripped.capacity.toFixed(2)} A`;
      const names = tripped.tripLoads.map(id => state.nodes.find(n => n.id === id)?.label.replace(/^\d+ \/ /, '')).join('·');
      $('risk-detail').textContent = `${names}의 전류가 몰렸어요 · 시설을 옮긴 뒤 배전함에서 복구`;
      $('heat-gauge').setAttribute('aria-valuenow', String(Math.round(tripped.heat * 100)));
      $('heat-gauge').firstElementChild.style.width = `${tripped.heat * 100}%`;
      positionStatus();
      return;
    }
    const previouslyVisible = !panel.hidden;
    const active = state.edges.filter(e => state.analysis.edges[e.id]?.overloaded);
    const warm = state.edges.filter(e => e.heat > 1e-9);
    const hottest = (active.length ? active : warm).reduce((best, e) => !best || e.heat > best.heat ? e : best, null);
    panel.hidden = state.mode !== 'playing' || state.paused || (!hottest && !state.recovering);
    if (panel.hidden) {
      if (previouslyVisible) {
        updateConnectionGuide();
        if (state.mode === 'playing' && state.time <= hintUntil) { $('hint').classList.remove('quiet'); positionHint(); }
      }
      delete statusLayoutKeys['risk-status'];
      return;
    }
    $('connection-guide').hidden = true;
    $('demand-status').hidden = true;
    const heat = hottest?.heat || 0;
    panel.classList.toggle('cooling', !active.length);
    if (active.length) {
      $('risk-title').textContent = state.analysis.shortCircuit ? '합선 · 기기를 지나는 길이 필요해요' : hottest.feeder ? `${hottest.feeder.slice(-1)} 회선 과열 · 시설 일부를 다른 회선으로 옮겨 주세요` : '과열 · 한 전선의 부담을 나눠 주세요';
      $('risk-detail').textContent = `${state.analysis.edges[hottest.id].current.toFixed(2)} A / ${(hottest.capacity ?? E.WIRE_CAPACITY).toFixed(2)} A · ${hottest.fixed ? '차단' : '끊어지기'}까지 약 ${Math.max(.1, (1 - heat) * E.HEAT_LIMIT_SECONDS).toFixed(1)}초`;
    } else if (hottest) {
      $('risk-title').textContent = '전류는 안전해요 · 전선이 식고 있어요';
      $('risk-detail').textContent = `냉각까지 약 ${(heat * E.COOLING_SECONDS).toFixed(1)}초 · 열이 식으면 안정화가 시작됩니다`;
    } else {
      const restored = state.nodes.filter(n => ['lamp', 'motor'].includes(n.type) && state.analysis.nodes[n.id].brightness >= E.STABLE_BRIGHTNESS).length;
      const count = state.nodes.filter(n => ['lamp', 'motor'].includes(n.type)).length;
      $('risk-title').textContent = `복구 중 · ${restored} / ${count} 불빛`;
      $('risk-detail').textContent = '끊어진 길을 다시 잇거나, 기존 길을 나눠 연결하세요';
    }
    $('heat-gauge').setAttribute('aria-valuenow', String(Math.round(heat * 100)));
    $('heat-gauge').firstElementChild.style.width = `${heat * 100}%`;
    positionStatus();
  }
  function win() {
    if (state.mode !== 'playing') return;
    state.mode = 'won'; state.victoryFor = 0;
    updateCable();
    updateRiskUi();
    $('demand-status').hidden = true;
    record('run_end', { reason: 'won', breaks: state.breaks });
    updateConnectionGuide();
    lockPlayfield(true);
    cancelDrag(); selectWire(null); measured = null; $('measure-layer').innerHTML = '';
    $('hint').classList.add('quiet'); $('toast').classList.remove('visible');
    $('result-time').textContent = timeText(state.time);
    $('result-story').textContent = legacyMode ? `전류가 갈라지는 곳 ${state.analysis.branches.length} · 되찾은 위기 ${state.recoveries}회` : G.status(state.nodes, state.edges, state.analysis).map(s => `${s.id.slice(-1)} 회선 ${s.current.toFixed(2)} / ${s.capacity.toFixed(2)} A`).join(' · ');
    const next = Runs.scenarios[legacyMode ? 0 : (scenarioIndex + 1) % Runs.scenarios.length];
    $('next-preview').textContent = `다음 구역 · ${next.name}\n${next.description}`;
    $('replay-button').textContent = legacyMode ? '다시 연결하기' : '다음 구역 복구하기';
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
      v.el.classList.toggle('powered', status.powered);
      const symbol = v.el.querySelector('.node-art');
      symbol.style.opacity = target > 0 ? String(.45 + .55 * v.brightness) : '1';
      const reading = v.el.querySelector('.device-reading');
      if (reading) reading.textContent = electricalText(status);
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
      const forward = electrical.from === e.a && electrical.fromPort === e.aPort;
      v.light.style.strokeDashoffset = forward ? '0' : String(reveal - 1);
      const count = lit ? Math.min(32, Math.max(2, Math.round(v.geometry.length * current * .09))) : 0;
      for (let i = 0; i < v.particles.length; i++) {
        const dot = v.particles[i];
        if (i >= count) { dot.setAttribute('opacity', '0'); continue; }
        let progress = reducedMotion ? i / count : (i / count + (state.time + state.victoryFor) * 82 / Math.max(1, v.geometry.length)) % 1;
        if (!forward) progress = 1 - progress;
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
    if (!testMode) update(dt);
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
  $('undo-wire').addEventListener('click', undoWire);
  $('delete-wire').addEventListener('click', () => {
    if (!canInteract() || !selected) return;
    const edge = state.edges.find(e => e.id === selected);
    if (edge?.fixed) resetFeeder(edge.feeder); else removeWire(selected);
  });
  $('pause-button').addEventListener('click', () => pause(!state.paused));
  $('resume-button').addEventListener('click', () => pause(false));
  $('help-button').addEventListener('click', () => showHelp(true));
  $('close-help').addEventListener('click', () => showHelp(false));
  function beginAgain(nextDistrict) {
    if (nextDistrict ? state.mode !== 'won' || !state.resultShown : state.mode !== 'playing') return;
    if (state.mode === 'playing') record('run_end', { reason: 'restart' });
    const nextIndex = nextDistrict && !legacyMode ? (scenarioIndex + 1) % Runs.scenarios.length : scenarioIndex;
    record(nextDistrict ? 'replay_start' : 'restart', { fromSeed: state.seed, toSeed: Runs.scenarios[nextIndex].seed });
    runHistory.push(journal.export());
    if (runHistory.length > 5) runHistory.shift();
    scenarioIndex = nextIndex;
    reset({ keepHistory: true }); $('intro').inert = false; start();
  }
  $('restart-button').addEventListener('click', () => beginAgain(false));
  $('replay-button').addEventListener('click', () => beginAgain(true));
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
      : '전류는 건전지의 +극에서 시설의 두 단자를 지나 −극으로 돌아옵니다. 한 곳이라도 끊어지면 전류가 멈춥니다.';
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
    if (!legacyMode && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undoWire(); return; }
    if (event.key.toLowerCase() === 'c') setTool('connect');
    if (['Delete', 'Backspace'].includes(event.key) && selected) { event.preventDefault(); removeWire(selected); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.mode === 'playing' && !state.paused) pause(true); });
  window.addEventListener('blur', () => cancelDrag());
  window.addEventListener('resize', () => { cancelDrag(); selectWire(null); fitBoard(); });
  reset();
  requestAnimationFrame(frame);
  // Deterministic integration testing only; ordinary play has no speed controls.
  if (testMode) {
    window.BlackoutTesting = Object.freeze({
      snapshot: () => JSON.parse(JSON.stringify(state)),
      advance(seconds) { for (let t = 0; t < seconds; t += .05) { update(Math.min(.05, seconds - t)); draw(.05); } },
      start, reset, connect: addConnection, branch: addBranch, remove: removeWire,
      geometry: id => wireViews.get(id)?.geometry,
      terminalPoint,
      events: () => journal.export(),
      cable: cableStatus,
      circuits: () => G.status(state.nodes, state.edges, state.analysis), resetFeeder,
      undo: undoWire,
    });
  }
  window.BlackoutSession = Object.freeze({ export: () => journal.export(), history: () => JSON.parse(JSON.stringify(runHistory)) });
})();
