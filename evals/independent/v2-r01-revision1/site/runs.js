(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BlackoutRuns = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const scenarios = Object.freeze([
    Object.freeze({ seed: 101, name: '주택가의 밤', motors: Object.freeze([3]), description: '세 불빛과 급수 펌프에 전력을 돌려주세요.' }),
    Object.freeze({ seed: 202, name: '골목의 물길', motors: Object.freeze([1, 3]), description: '골목과 급수장에 펌프가 필요해요. 두 펌프의 전류를 나눠 주세요.' }),
    Object.freeze({ seed: 303, name: '공원의 새벽', motors: Object.freeze([2, 3]), description: '공원과 급수장에 펌프가 필요해요. 안전한 길을 다시 찾아보세요.' }),
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
