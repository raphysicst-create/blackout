/* Browser integration checks against the real page. No API replacements. */
(() => {
  'use strict';
  const frame = document.getElementById('game-frame');
  const summary = document.getElementById('summary');
  const results = document.getElementById('results');
  const rerun = document.getElementById('rerun');
  const cityFixture = document.getElementById('fixture-city');
  const branchFixture = document.getElementById('fixture-branch');
  let running = false;
  let api, win, doc;
  const cases = [];
  const test = (name, body) => cases.push({ name, body });
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const near = (actual, expected, tolerance = 1e-6) => {
    assert(Math.abs(actual - expected) <= tolerance, `예상 ${expected}, 실제 ${actual}`);
  };
  const snapshot = () => api.snapshot();
  const element = id => {
    const found = doc.getElementById(id);
    assert(found, `화면 요소 없음: ${id}`);
    return found;
  };
  const click = id => element(id).click();
  const advanceTo = time => {
    const remaining = time - snapshot().time;
    assert(remaining >= -1e-6, '검증 시간은 뒤로 이동할 수 없습니다.');
    if (remaining > 0) api.advance(remaining);
  };
  const connect = (a, b, aPort, bPort) => assert(api.connect(a, b, aPort, bPort), `연결 실패: ${a}.${aPort} → ${b}.${bPort}`);
  const edgeBetween = (a, b, aPort, bPort) => snapshot().edges.find(edge =>
    (edge.a === a && edge.b === b && (!aPort || edge.aPort === aPort) && (!bPort || edge.bPort === bPort)) ||
    (edge.a === b && edge.b === a && (!aPort || edge.bPort === aPort) && (!bPort || edge.aPort === bPort)));
  const feed = id => connect('source', id, 'plus', 'left');
  const returnWire = id => connect(id, 'source', 'right', 'minus');
  const fullLoop = id => { feed(id); returnWire(id); };
  const loadIds = state => state.nodes.filter(node => node.type === 'lamp' || node.type === 'motor').map(node => node.id);

  function terminalPoint(id, port) {
    const screen = new win.DOMPoint(0, 0).matrixTransform(element(`terminal-${id}-${port}`).getScreenCTM());
    return screen.matrixTransform(element('board').getScreenCTM().inverse());
  }

  function terminalKey(id, port) {
    const terminal = element(`terminal-${id}-${port}`);
    terminal.focus();
    terminal.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  function assertLit(id) {
    const status = snapshot().analysis.nodes[id];
    assert(status.powered && status.brightness > .95, `${id}의 닫힌 회로가 정상 점등되지 않음`);
  }

  function assertOff(id) {
    const status = snapshot().analysis.nodes[id];
    assert(!status.powered && status.brightness < .0001 && Math.abs(status.current) < .0001,
      `${id}의 열린 회로에 전류가 흐름`);
  }

  function distanceToSegment(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  }

  function distanceToPath(point, points) {
    let distance = Infinity;
    for (let i = 1; i < points.length; i++) distance = Math.min(distance, distanceToSegment(point, points[i - 1], points[i]));
    return distance;
  }

  function assertOrthogonal(path) {
    assert(path && path.samples.length >= 2, '도로 전선 경로가 없음');
    assert(!/[cq]/i.test(path.d), '전선에 곡선 명령이 남아 있음');
    for (let i = 1; i < path.samples.length; i++) {
      const a = path.samples[i - 1], b = path.samples[i];
      assert(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6,
        `전선이 대각선으로 도로를 가로지름: (${a.x},${a.y}) → (${b.x},${b.y})`);
    }
  }

  function assertInsideRoads(path) {
    const roads = win.BlackoutCity.roads;
    assert(Array.isArray(roads) && roads.length > 0, '공유 도로 데이터가 없음');
    for (const point of path.samples) {
      const terminalStub = [path.at(0), path.at(1)].some(end => Math.hypot(point.x - end.x, point.y - end.y) <= 48);
      const inside = terminalStub || roads.some(road => distanceToPath(point, road.points) <= road.width / 2 + 1.5);
      assert(inside, `전선이 보이는 도로 바깥으로 나감: (${point.x.toFixed(2)},${point.y.toFixed(2)})`);
    }
  }

  function forkFirstWire(target, targetPort = 'left') {
    const before = snapshot();
    const edge = edgeBetween('source', 'lamp-1', 'plus', 'left');
    assert(edge, '분기할 전선 없음');
    api.branch(edge.id, api.geometry(edge.id).at(.5), target, targetPort);
    const junction = snapshot().nodes.find(node => node.type === 'junction' && !before.nodes.some(old => old.id === node.id));
    assert(junction, '전선 분기점이 생성되지 않음');
    return junction.id;
  }

  function finalNetwork() {
    advanceTo(225.1);
    for (const id of ['lamp-1', 'lamp-2', 'lamp-3', 'motor-1']) fullLoop(id);
    const state = snapshot();
    assert(state.edges.length === 8, '네 시설에 실제 공급선과 귀환선 여덟 개가 필요함');
    assert(state.analysis.allStable, '최종 네 폐회로가 안정되지 않음');
    for (const id of loadIds(state)) assertLit(id);
    near(state.analysis.totalCurrent, 1.35, .02);
    return state;
  }

  function reachResult() {
    finalNetwork();
    api.advance(8.1);
    assert(snapshot().mode === 'won', '8초 안정화 뒤 성공하지 않음');
    api.advance(8.1);
    assert(!element('result').hidden, '도시 복구 후 결과 화면이 열리지 않음');
  }

  test('시작 화면과 단순 클릭은 전선을 만들지 않습니다', () => {
    api.reset();
    assert(snapshot().mode === 'intro', '초기 화면이 아님');
    api.advance(10);
    near(snapshot().time, 0);
    assert(snapshot().edges.length === 0, '초기 전선이 존재함');
    api.start();
    for (const [id, port] of [['source', 'plus'], ['lamp-1', 'left']]) {
      element(`terminal-${id}-${port}`).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    }
    assert(snapshot().mode === 'playing', '게임 시작 실패');
    assert(snapshot().edges.length === 0, '단순 클릭으로 전선이 생성됨');
    assert(!snapshot().analysis.nodes['lamp-1'].powered, '연결 없이 전구가 켜짐');
  });

  test('30초 시설 · 65초 전류계 · 90초 분기 · 225초 마지막 시설', () => {
    advanceTo(29.9);
    assert(loadIds(snapshot()).length === 1, '30초 전에 두 번째 시설 등장');
    advanceTo(30.1);
    assert(loadIds(snapshot()).length === 2, '두 번째 시설이 등장하지 않음');
    advanceTo(64.9);
    assert(!snapshot().ampUnlocked && element('amp-tool').disabled, '전류계가 너무 일찍 열림');
    advanceTo(65.1);
    assert(snapshot().ampUnlocked && !element('amp-tool').disabled, '전류계 해금 실패');
    advanceTo(89.9);
    assert(!snapshot().branchUnlocked, '분기가 너무 일찍 열림');
    advanceTo(90.1);
    assert(snapshot().branchUnlocked && loadIds(snapshot()).length === 3, '분기/세 번째 시설 해금 실패');
    advanceTo(224.9);
    assert(!snapshot().nodes.some(node => node.id === 'motor-1'), '모터가 너무 일찍 등장');
    advanceTo(225.1);
    assert(loadIds(snapshot()).length === 4 && snapshot().nodes.some(node => node.id === 'motor-1'), '최종 네 시설이 등장하지 않음');
    assert(snapshot().mode === 'playing', '연결 없이 성공함');
  });

  test('공급선만으로는 켜지지 않고 실제 귀환선을 연결해야 빛납니다', () => {
    feed('lamp-1');
    assertOff('lamp-1');
    near(snapshot().analysis.totalCurrent, 0, .0001);
    returnWire('lamp-1');
    assertLit('lamp-1');
    near(snapshot().analysis.nodes['lamp-1'].current, .3, .01);
    assert(snapshot().edges.length === 2, '닫힌 회로의 실제 전선 두 개가 없음');
  });

  test('귀환선만으로는 꺼져 있고 양쪽 중 어느 전선을 끊어도 꺼집니다', () => {
    returnWire('lamp-1');
    assertOff('lamp-1');
    feed('lamp-1');
    assertLit('lamp-1');
    api.remove(edgeBetween('source', 'lamp-1', 'plus', 'left').id);
    assertOff('lamp-1');
    feed('lamp-1');
    assertLit('lamp-1');
    api.remove(edgeBetween('lamp-1', 'source', 'right', 'minus').id);
    assertOff('lamp-1');
  });

  test('키보드로 네 단자를 차례로 이어 실제 폐회로를 만들 수 있습니다', () => {
    terminalKey('source', 'plus');
    terminalKey('lamp-1', 'left');
    assert(edgeBetween('source', 'lamp-1', 'plus', 'left'), '키보드 입력이 공급 단자를 보존하지 않음');
    assertOff('lamp-1');
    terminalKey('lamp-1', 'right');
    terminalKey('source', 'minus');
    assert(edgeBetween('lamp-1', 'source', 'right', 'minus'), '키보드 입력이 귀환 단자를 보존하지 않음');
    assertLit('lamp-1');
  });

  test('닫힌 직렬 회로는 같은 전류가 흐르고 두 전구가 어두워집니다', () => {
    advanceTo(30.1);
    feed('lamp-1');
    connect('lamp-1', 'lamp-2', 'right', 'left');
    assertOff('lamp-1'); assertOff('lamp-2');
    returnWire('lamp-2');
    const state = snapshot();
    for (const id of ['lamp-1', 'lamp-2']) {
      near(state.analysis.nodes[id].current, .15, .01);
      near(state.analysis.nodes[id].brightness, .25, .03);
    }
    assert(state.analysis.hasSeries && !state.analysis.hasParallel, '직렬 구조 판정 오류');
    assert(state.noticedDim, '밝기 감소 관찰 안내 누락');
  });

  test('전선은 연결하지 않은 시설을 피해 가며 실제 연결 대상을 유지합니다', () => {
    advanceTo(95);
    fullLoop('lamp-3');
    const state = snapshot();
    assert(state.edges.length === 2, '시각적 회피가 공급·귀환선 이외의 전선을 생성함');
    const edge = edgeBetween('source', 'lamp-3', 'plus', 'left');
    assert(edge.a === 'source' && edge.b === 'lamp-3', '회피 경로가 실제 연결 대상을 변경함');
    assert(state.analysis.edges[edge.id].from === 'source' && state.analysis.edges[edge.id].to === 'lamp-3', '회피 경로가 전류 방향을 변경함');
    const path = api.geometry(edge.id);
    assert(path && path.samples.length > 2, '전선 경로 표본이 없음');
    for (const load of state.nodes.filter(node => node.type === 'lamp' && node.id !== 'lamp-3')) {
      const clearance = Math.min(...path.samples.map(point => Math.hypot(point.x - load.x, point.y - load.y)));
      assert(clearance >= 30, `전선이 무관한 시설 ${load.id}을 관통함: ${clearance.toFixed(2)}`);
      assert(!state.analysis.nodes[load.id].powered, `회피한 시설 ${load.id}에 전류가 연결됨`);
    }
    assertLit('lamp-3');
  });

  test('공급선 분기에도 개별 귀환선이 필요하며 A 도구가 전류를 보여 줍니다', () => {
    advanceTo(90.1);
    fullLoop('lamp-1');
    const junction = forkFirstWire('lamp-2');
    assertLit('lamp-1'); assertOff('lamp-2');
    returnWire('lamp-2');
    const state = snapshot();
    assert(state.edges.length === 5, '분기 후 공급선 세 개와 귀환선 두 개가 필요함');
    assertLit('lamp-1'); assertLit('lamp-2');
    const trunk = edgeBetween('source', junction, 'plus', 'joint');
    const branch = edgeBetween(junction, 'lamp-2', 'joint', 'left');
    near(state.analysis.edges[trunk.id].current, .6, .01);
    near(state.analysis.edges[branch.id].current, .3, .01);
    assert(state.analysis.hasParallel, '병렬 구조 판정 오류');
    click('amp-tool');
    assert(snapshot().tool === 'amp', '전류계 선택 실패');
    element(trunk.id).dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert(element('measure-layer').textContent.includes(`${state.analysis.edges[trunk.id].current.toFixed(2)} A`), '주 전선 전류 표시 오류');
    element(branch.id).dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert(element('measure-layer').textContent.includes(`${state.analysis.edges[branch.id].current.toFixed(2)} A`), '분기 전선 전류 표시 오류');
  });

  test('잠긴 분기·없는 단자·중복 배선은 유령 분기점을 남기지 않습니다', () => {
    feed('lamp-1');
    const original = snapshot().edges[0];
    const origin = api.geometry(original.id).at(.5);
    api.branch(original.id, origin, 'lamp-2', 'left');
    assert(snapshot().nodes.length === 2 && snapshot().edges.length === 1, '잠긴 분기가 회로를 변경함');
    advanceTo(90.1);
    const before = snapshot();
    const signature = state => JSON.stringify({ nodes: state.nodes.map(node => node.id), edges: state.edges.map(edge => [edge.id, edge.a, edge.aPort, edge.b, edge.bPort]) });
    for (const [target, port] of [[undefined, 'left'], ['missing-node', 'left'], ['lamp-2', 'not-a-port']]) {
      api.branch(original.id, origin, target, port);
      assert(signature(snapshot()) === signature(before), `거절된 분기가 회로를 변경함: ${target}`);
    }
    assert(!api.connect('lamp-1', 'source', 'left', 'plus'), '같은 두 단자의 중복 연결을 허용함');
    assert(signature(snapshot()) === signature(before), '중복 연결로 회로가 변경됨');
    element('board').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(signature(snapshot()) === signature(before), 'Escape 이후 유령 분기점 생성');
  });

  test('과부하 6초 뒤 주 전선이 끊어지고 하위 시설이 모두 꺼집니다', () => {
    advanceTo(90.1);
    fullLoop('lamp-1');
    const junction = forkFirstWire('lamp-2');
    returnWire('lamp-2');
    connect(junction, 'lamp-3', 'joint', 'left');
    returnWire('lamp-3');
    const main = edgeBetween('source', junction, 'plus', 'joint');
    assert(snapshot().analysis.edges[main.id].overloaded, '주 전선의 과부하 판정 누락');
    api.advance(5.8);
    assert(snapshot().edges.some(edge => edge.id === main.id), '6초 전에 단선');
    api.advance(.3);
    const state = snapshot();
    assert(!state.edges.some(edge => edge.id === main.id), '과부하 전선이 끊어지지 않음');
    assert(state.breaks === 1 && element('blackout').classList.contains('flash'), '정전 피드백 누락');
    for (const id of ['lamp-1', 'lamp-2', 'lamp-3']) assert(!state.analysis.nodes[id].powered, `단선 후에도 ${id}에 전류 공급`);
    assert(state.mode === 'playing', '정전이 게임을 종료함');
    connect('source', junction, 'plus', 'joint');
    assert(snapshot().analysis.nodes['lamp-1'].powered, '정전 직후 재연결 실패');
  });

  test('일시 정지 버튼은 진행 시간을 멈추고 계속하기로 복귀합니다', () => {
    api.advance(3);
    click('pause-button');
    const before = snapshot().time;
    assert(snapshot().paused && !element('pause-panel').hidden, '일시 정지 실패');
    api.advance(20);
    near(snapshot().time, before);
    click('resume-button');
    assert(!snapshot().paused && element('pause-panel').hidden, '계속하기 실패');
    api.advance(1);
    near(snapshot().time, before + 1, .15);
  });

  test('조작 도움말을 읽는 동안 시간이 멈춥니다', () => {
    api.advance(4);
    click('help-button');
    const before = snapshot().time;
    assert(snapshot().paused && !element('help-panel').hidden, '도움말 정지 실패');
    api.advance(20);
    near(snapshot().time, before);
    click('close-help');
    assert(!snapshot().paused && element('help-panel').hidden, '도움말 복귀 실패');
    api.advance(1);
    near(snapshot().time, before + 1, .15);
  });

  test('네 시설이 8초 안정되면 즉시 성공하고 도시 점등 후 결과가 나타납니다', () => {
    finalNetwork();
    api.advance(7.8);
    assert(snapshot().mode === 'playing' && element('result').hidden, '안정화 전에 성공함');
    api.advance(.3);
    assert(snapshot().mode === 'won', '8초 안정화 성공 누락');
    assert(snapshot().time < 240, '성공에 불필요한 시간 제한이 적용됨');
    assert(element('result').hidden, '도시를 보여주기 전에 결과가 나타남');
    const finalTime = snapshot().time;
    api.advance(1.6);
    assert(element('game').classList.contains('restored'), '도시 전체 점등 클래스 누락');
    assert(element('result').hidden, '점등 감상 시간이 너무 짧음');
    api.advance(6.5);
    assert(!element('result').hidden, '도시 전체 점등을 감상한 뒤에도 결과가 나타나지 않음');
    near(Number(element('ambient-light').getAttribute('opacity')), 1);
    near(snapshot().time, finalTime);
  });

  test('회로도는 실제 귀환선까지 보존하고 가상의 귀환선을 만들지 않습니다', () => {
    reachResult();
    const state = snapshot();
    click('schematic-button');
    assert(!element('schematic-panel').hidden && element('result').hidden, '회로도 전환 실패');
    const svg = element('schematic-svg');
    const nodeIds = [...svg.querySelectorAll('[data-node-id]')].map(node => node.getAttribute('data-node-id')).sort();
    const edgeIds = [...svg.querySelectorAll('[data-edge-id]')].map(edge => edge.getAttribute('data-edge-id')).sort();
    assert(JSON.stringify(nodeIds) === JSON.stringify(state.nodes.map(node => node.id).sort()), '회로도 노드가 실제 네트워크와 다름');
    assert(JSON.stringify(edgeIds) === JSON.stringify(state.edges.map(edge => edge.id).sort()), '회로도 전선이 실제 네트워크와 다름');
    assert(state.edges.filter(edge => edge.a === 'source' && edge.aPort === 'minus' || edge.b === 'source' && edge.bPort === 'minus').length === 4,
      '검증 회로에 실제 귀환선 네 개가 없음');
    assert(!svg.querySelector('[data-return-from], [data-return-bus]'), '사용자가 그리지 않은 가상의 귀환선이 만들어짐');
    assert(element('discovery').textContent.includes('병렬'), '실제 구조의 학습 정리 누락');
    click('close-schematic');
    assert(element('schematic-panel').hidden && !element('result').hidden, '도시 화면 복귀 실패');
  });

  test('다시 연결하기는 시간·해금·회로·도시 상태를 초기화합니다', () => {
    reachResult();
    click('replay-button');
    const state = snapshot();
    assert(state.mode === 'playing' && !state.paused, '다시 시작한 게임이 정지되어 있음');
    near(state.time, 0, .15);
    assert(state.nodes.length === 2 && state.edges.length === 0, '다시 시작한 회로가 초기 상태가 아님');
    assert(!state.ampUnlocked && !state.branchUnlocked && state.breaks === 0, '해금/정전 상태가 남아 있음');
    assert(element('amp-tool').disabled && element('result').hidden && element('schematic-panel').hidden, '다시 시작한 화면 초기화 실패');
    assert(!element('game').classList.contains('restored'), '이전 도시 점등이 남아 있음');
    assert(!state.analysis.nodes['lamp-1'].powered, '새 실행의 전구가 켜져 있음');
  });

  test('첫 공급선은 도로 안에서 직교하며 정확한 두 단자에 닿습니다', () => {
    feed('lamp-1');
    const state = snapshot();
    const edge = edgeBetween('source', 'lamp-1', 'plus', 'left');
    const path = api.geometry(edge.id);
    assert(Array.isArray(edge.route) && edge.route.length >= 2, '전선의 실제 도로 경로가 저장되지 않음');
    assertOrthogonal(path);
    assertInsideRoads(path);
    const start = terminalPoint(edge.a, edge.aPort);
    const end = terminalPoint(edge.b, edge.bPort);
    near(path.at(0).x, start.x); near(path.at(0).y, start.y);
    near(path.at(1).x, end.x); near(path.at(1).y, end.y);
    assert(element(edge.id).querySelector('.wire-base').getAttribute('d') === path.d,
      '화면에 그린 전선이 hit-test/전류 입자 경로와 다름');
    assertOff('lamp-1');
  });

  test('도로 전선을 분기해도 원래 두 조각의 길이와 모양을 보존합니다', () => {
    advanceTo(90.1);
    fullLoop('lamp-1');
    const original = edgeBetween('source', 'lamp-1', 'plus', 'left');
    const before = api.geometry(original.id);
    const originalPoints = before.samples.map(point => ({ x: point.x, y: point.y }));
    const origin = before.at(.5);
    api.branch(original.id, origin, 'lamp-2', 'left');
    returnWire('lamp-2');
    const state = snapshot();
    const junction = state.nodes.find(node => node.type === 'junction');
    assert(junction, '도로 전선의 분기점이 생기지 않음');
    near(junction.x, origin.x); near(junction.y, origin.y);
    const left = edgeBetween('source', junction.id, 'plus', 'joint');
    const right = edgeBetween(junction.id, 'lamp-1', 'joint', 'left');
    assert(left && right && !state.edges.some(edge => edge.id === original.id), '원래 전선의 두 조각이 만들어지지 않음');
    const first = api.geometry(left.id), second = api.geometry(right.id);
    near(first.length + second.length, before.length, 1e-4);
    const firstPoints = left.a === 'source' ? first.samples : [...first.samples].reverse();
    const secondPoints = right.a === junction.id ? second.samples : [...second.samples].reverse();
    const joined = [...firstPoints, ...secondPoints.slice(1)];
    for (const point of originalPoints) near(distanceToPath(point, joined), 0, 1e-4);
    for (const point of joined) near(distanceToPath(point, originalPoints), 0, 1e-4);
    for (const edge of state.edges) {
      assertOrthogonal(api.geometry(edge.id));
      assertInsideRoads(api.geometry(edge.id));
    }
    near(state.analysis.edges[left.id].current, .6, .01);
    assertLit('lamp-1'); assertLit('lamp-2');
  });

  test('같은 도로의 독립 전선은 기존 경로를 움직이거나 회로를 합치지 않습니다', () => {
    advanceTo(30.1);
    fullLoop('lamp-1');
    const first = edgeBetween('source', 'lamp-1', 'plus', 'left');
    const before = api.geometry(first.id);
    const originalRoute = JSON.stringify(first.route);
    const originalShape = before.d;
    fullLoop('lamp-2');
    const state = snapshot();
    const second = edgeBetween('source', 'lamp-2', 'plus', 'left');
    assert(state.edges.length === 4 && !state.nodes.some(node => node.type === 'junction'),
      '시각적으로 공유한 도로가 실제 회로의 분기점으로 바뀜');
    assert(JSON.stringify(edgeBetween('source', 'lamp-1', 'plus', 'left').route) === originalRoute && api.geometry(first.id).d === originalShape,
      '새 전선을 그리자 기존 도로 경로가 움직임');
    const secondPath = api.geometry(second.id);
    assertOrthogonal(secondPath);
    assertInsideRoads(secondPath);
    // Both routes leave the substation along this same street. Sample well away
    // from the deliberately common endpoint to check their independent lanes.
    const sharedStreetPoint = before.at(Math.min(55, before.length * .2) / before.length);
    const laneDistance = distanceToPath(sharedStreetPoint, secondPath.samples);
    assert(laneDistance > .5, '독립 전선이 공유 도로에서 완전히 포개져 구별되지 않음');
    assert(laneDistance < 20, '독립 전선이 공유 도로 밖으로 우회함');
    near(state.analysis.edges[first.id].current, .3, .01);
    near(state.analysis.edges[second.id].current, .3, .01);
    near(state.analysis.totalCurrent, .6, .01);
    assertLit('lamp-1'); assertLit('lamp-2');
    assert(state.analysis.allStable && state.analysis.hasParallel && !state.analysis.hasSeries,
      '시각적 lane 분리가 실제 전기적 연결을 변경함');
  });

  async function run() {
    if (running) return;
    running = true;
    rerun.disabled = true;
    cityFixture.disabled = true;
    branchFixture.disabled = true;
    document.body.classList.remove('preview-mode');
    results.replaceChildren();
    let passed = 0;
    const failures = [];
    const startedAt = performance.now();
    try {
      win = frame.contentWindow;
      doc = frame.contentDocument;
      api = win.BlackoutTesting;
      assert(api && typeof api.snapshot === 'function', '테스트 API를 불러오지 못했습니다. 같은 출처의 HTTP 서버에서 이 페이지를 열어 주세요.');
      for (const item of cases) {
        summary.textContent = `${passed + failures.length + 1} / ${cases.length} 검증 중…`;
        const row = document.createElement('li');
        row.textContent = item.name;
        results.append(row);
        try {
          api.reset();
          api.start();
          await item.body();
          row.className = 'pass';
          passed++;
        } catch (error) {
          row.className = 'fail';
          const detail = document.createElement('pre');
          detail.textContent = error.stack || error.message || String(error);
          row.append(detail);
          failures.push({ name: item.name, message: error.message || String(error) });
        }
        // Let the results paint between cases; each following case resets time.
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      const duration = ((performance.now() - startedAt) / 1000).toFixed(1);
      summary.textContent = `${passed} / ${cases.length} 통과${failures.length ? ` · ${failures.length} 실패` : ''} · ${duration}초`;
      document.title = `${failures.length ? 'FAIL' : 'PASS'} · BLACKOUT ${passed}/${cases.length}`;
      document.documentElement.dataset.testStatus = failures.length ? 'failed' : 'passed';
      window.BlackoutBrowserTestResults = Object.freeze({ passed, total: cases.length, failures });
    } catch (error) {
      summary.textContent = `검증을 시작할 수 없습니다: ${error.message}`;
      document.documentElement.dataset.testStatus = 'failed';
      window.BlackoutBrowserTestResults = Object.freeze({ passed: 0, total: cases.length, failures: [{ name: '테스트 환경', message: error.message }] });
    } finally {
      running = false;
      rerun.disabled = false;
      cityFixture.disabled = !api;
      branchFixture.disabled = !api;
    }
  }

  function showFixture(kind) {
    if (running || !api) return;
    api.reset();
    api.start();
    if (kind === 'city') {
      reachResult();
      document.getElementById('preview-note').textContent = '공급선과 귀환선을 모두 연결한 네 폐회로입니다. 화면의 ‘회로도로 보기’에서 실제 여덟 전선을 확인할 수 있습니다.';
    } else {
      advanceTo(94.5);
      fullLoop('lamp-1');
      api.advance(.5);
      document.getElementById('preview-note').textContent = '첫 전구의 공급선과 귀환선을 이은 95초 장면입니다. 공급선에서 새 전구의 왼쪽 단자로 분기한 뒤, 오른쪽 단자를 전원 −에 연결해 회로를 닫아 보세요.';
    }
    document.body.classList.add('preview-mode');
    window.scrollTo({ top: 0, behavior: 'instant' });
    // Frame enlargement changes the SVG matrix; the native resize handler adapts
    // touch areas without replacing any game behavior or editing game state.
  }

  rerun.addEventListener('click', run);
  cityFixture.addEventListener('click', () => showFixture('city'));
  branchFixture.addEventListener('click', () => showFixture('branch'));
  frame.addEventListener('load', run);
  try { if (frame.contentDocument.readyState === 'complete' && frame.contentWindow.BlackoutTesting) run(); } catch { /* load will report origin restrictions. */ }
})();
