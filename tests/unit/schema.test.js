'use strict';
/* Schema 契约单测：条件归一化、Route/Refine 校验、错误路径 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const S = require(path.resolve(__dirname, '../../js/schema.js'));

function baseConditions(extra) {
  return Object.assign({
    city: 'nanjing',
    durationMin: 240,
    startTime: '14:00',
    interests: ['coffee'],
    budgetMax: 150,
    party: 'friends',
    walkingTolerance: 'mid',
    pace: 'mid'
  }, extra || {});
}

function baseRoute(extra) {
  const conditions = S.normalizeConditions(baseConditions());
  const route = {
    schemaVersion: 'route.v1',
    id: 'r_test',
    city: 'nanjing',
    name: '测试路线',
    source: 'mock',
    createdAt: '2026-10-26T06:00:00.000Z',
    conditions,
    places: ['p_cafe_sh', 'p_book_xf'],
    segments: [
      { placeId: 'p_cafe_sh', stayMin: 35, walkFromPrevMin: 0, distanceFromPrevKm: 0, indoor: true },
      { placeId: 'p_book_xf', stayMin: 38, walkFromPrevMin: 8, distanceFromPrevKm: 0.6, indoor: true }
    ],
    durationMin: 240,
    actualMin: 81,
    stayTotalMin: 73,
    walkTotalMin: 8,
    distanceKm: 0.6,
    budget: { min: 35, max: 150, currency: 'CNY', basis: 'total' },
    style: ['咖啡'],
    scores: {
      overall: 0.7, interest: 0.8, timeFit: 0.6, efficiency: 0.7,
      budgetFit: 0.8, diversity: 0.5,
      weights: { interest: 0.35, timeFit: 0.2, efficiency: 0.15, budgetFit: 0.15, diversity: 0.15 },
      method: 'heuristic-v1'
    },
    constraints: [{ id: 'duration', label: '时长', kind: 'hard', status: 'met', detail: '在预算内' }],
    conflict: null,
    explanations: [
      { placeId: 'p_cafe_sh', why: '命中咖啡偏好', evidence: [] },
      { placeId: 'p_book_xf', why: '距离上一站近', evidence: [] }
    ],
    sources: [],
    notes: [],
    dataQuality: {
      placesTotal: 12, placesWithCoords: 8, placesWithHours: 0, placesVerified: 8,
      disclaimer: '示例数据'
    }
  };
  return Object.assign(route, extra || {});
}

test('normalizeConditions: 默认值', () => {
  const c = S.normalizeConditions({ city: 'nanjing', durationMin: 180 });
  assert.equal(c.city, 'nanjing');
  assert.equal(c.durationMin, 180);
  assert.equal(c.startTime, '14:00');
  assert.equal(c.pace, 'mid');
  assert.equal(c.party, 'solo');
  assert.equal(c.budgetMax, null);
  assert.deepEqual(c.interests, []);
});

test('normalizeConditions: 由起止时间推导时长', () => {
  const c = S.normalizeConditions({ city: 'nanjing', startTime: '14:00', endTime: '17:30' });
  assert.equal(c.durationMin, 210);
});

test('normalizeConditions: 非法兴趣被过滤，预算夹紧', () => {
  const c = S.normalizeConditions({ city: 'nanjing', durationMin: 120, interests: ['coffee', 'nope'], budgetMax: 99999 });
  assert.deepEqual(c.interests, ['coffee']);
  assert.equal(c.budgetMax, 10000);
});

test('normalizeConditions: 跨零点', () => {
  assert.equal(S.durationFromTimes('22:00', '01:00'), 180);
});

test('validateConditions: 完整条件通过', () => {
  const r = S.validateConditions(S.normalizeConditions(baseConditions()), { requireComplete: true });
  assert.equal(r.ok, true, S.formatErrors(r.errors));
});

test('validateConditions: 缺城市/时长', () => {
  const r = S.validateConditions(S.normalizeConditions({ interests: ['coffee'] }), { requireComplete: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /city/.test(e.path)));
  assert.ok(r.errors.some(e => /durationMin/.test(e.path)));
});

test('validateConditions: 时长越界', () => {
  const r = S.validateConditions({ city: 'nanjing', durationMin: 5 }, { requireComplete: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /durationMin/.test(e.path)));
});

test('validateRoute: 合法路线通过', () => {
  const r = S.validateRoute(baseRoute());
  assert.equal(r.ok, true, S.formatErrors(r.errors));
});

test('validateRoute: 缺 schemaVersion 失败', () => {
  const route = baseRoute();
  delete route.schemaVersion;
  assert.equal(S.validateRoute(route).ok, false);
});

test('validateRoute: places 与 segments 不一致失败', () => {
  const route = baseRoute();
  route.segments = route.segments.slice(0, 1);
  const r = S.validateRoute(route);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /segments/.test(e.path)));
});

test('validateRoute: 重复地点失败', () => {
  const route = baseRoute();
  route.places = ['p_cafe_sh', 'p_cafe_sh'];
  route.segments[1].placeId = 'p_cafe_sh';
  const r = S.validateRoute(route);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /重复/.test(e.message)));
});

test('validateRoute: 解释引用不存在地点失败', () => {
  const route = baseRoute();
  route.explanations[0].placeId = 'p_nope';
  const r = S.validateRoute(route);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /explanations/.test(e.path)));
});

test('validateRoute: 评分越界失败', () => {
  const route = baseRoute();
  route.scores.overall = 1.5;
  assert.equal(S.validateRoute(route).ok, false);
});

test('validateRoute: 预算 min > max 失败', () => {
  const route = baseRoute();
  route.budget = { min: 200, max: 100, currency: 'CNY', basis: 'total' };
  const r = S.validateRoute(route);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.path === 'route.budget.max'));
});

test('validateRoute: 冲突必须有选项且约束 violated', () => {
  const route = baseRoute({
    conflict: { type: 'time', title: '时间不足', detail: '超出', options: [] }
  });
  const r = S.validateRoute(route);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /options/.test(e.path)));
  assert.ok(r.errors.some(e => /conflict/.test(e.path)));
});

test('validateRoute: 合法冲突通过', () => {
  const route = baseRoute({
    constraints: [{ id: 'duration', label: '时长', kind: 'hard', status: 'violated', detail: '超出 20 分钟' }],
    conflict: {
      type: 'time', title: '时间预算不足', detail: '至少需要 4 小时',
      options: [{ id: 'extend_time', label: '延长到 4 小时', action: { durationMin: 240 } }]
    }
  });
  const r = S.validateRoute(route);
  assert.equal(r.ok, true, S.formatErrors(r.errors));
});

test('validateRefine: 合法调整通过', () => {
  const route = baseRoute();
  const res = {
    schemaVersion: 'refine.v1',
    changed: true,
    reply: '已替换',
    bullets: ['替换 1 站'],
    changes: [{ type: 'replace', label: '咖啡馆 → 书店', from: '咖啡馆', to: '书店' }],
    constraintsAfter: route.constraints,
    unresolved: [],
    conflict: null,
    route
  };
  const r = S.validateRefine(res);
  assert.equal(r.ok, true, S.formatErrors(r.errors));
});

test('validateRefine: 非法 change type 失败', () => {
  const route = baseRoute();
  const res = {
    schemaVersion: 'refine.v1', changed: true, reply: 'x', bullets: [],
    changes: [{ type: 'magic', label: 'x' }],
    constraintsAfter: route.constraints, unresolved: [], conflict: null, route
  };
  assert.equal(S.validateRefine(res).ok, false);
});

test('formatErrors: 只保留前 5 条并带路径', () => {
  const errs = Array.from({ length: 8 }, (_, i) => ({ path: 'p' + i, message: 'm' + i }));
  const text = S.formatErrors(errs);
  assert.ok(text.indexOf('p0') >= 0);
  assert.ok(text.indexOf('p5') < 0);
});
