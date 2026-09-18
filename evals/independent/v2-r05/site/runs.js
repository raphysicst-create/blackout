(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BlackoutRuns = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const scenarios = Object.freeze([
    Object.freeze({ seed: 101, name: '주택가의 밤', surgeId: 'lamp-1', guided: true, motors: Object.freeze([3]), description: '불빛과 펌프를 되찾고, 주택의 추가 수요에 대비해 주세요.' }),
    Object.freeze({ seed: 202, name: '골목의 물길', surgeId: 'lamp-2', guided: false, motors: Object.freeze([3]), description: '이번에는 골목의 수요가 늘어요. 회선 배분을 다시 살펴보세요.' }),
    Object.freeze({ seed: 303, name: '공원의 새벽', surgeId: 'lamp-3', guided: false, motors: Object.freeze([3]), description: '공원의 수요가 늘어납니다. 익숙한 배선도 여유를 확인해 주세요.' }),
  ]);
  function indexFor(seed) {
    const index = scenarios.findIndex(s => s.seed === Number(seed));
    return index < 0 ? 0 : index;
  }
  function plan(base, index) {
    const scenario = scenarios[index] || scenarios[0];
    return base.map((node, i) => {
      const type = scenario.motors.includes(i) ? 'motor' : 'lamp';
      const label = i === 1 && type === 'motor' ? '02 / 골목 펌프'
        : i === 2 && type === 'motor' ? '03 / 공원 펌프' : node.label;
      return { ...node, type, label };
    });
  }
  return { scenarios, indexFor, plan };
});
