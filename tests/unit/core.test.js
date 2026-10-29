'use strict';
/* 确定性核心单测：解析、完整性、规划、约束、调整、重排、冲突处理 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const D = require(path.join(ROOT, 'js/data.js'));
const S = require(path.join(ROOT, 'js/schema.js'));
const C = require(path.join(ROOT, 'shared/core.js'));

function cond(extra) {
  return S.normalizeConditions(Object.assign({
    city: 'nanjing',
    durationMin: 240,
    startTime: '14:00',
    interests: ['coffee', 'history', 'photo'],
    budgetMax: 150,
    pace: 'mid'
  }, extra || {}));
}

function strip(route) {
  const x = JSON.parse(JSON.stringify(route));
  delete x.id;
  delete x.createdAt;
  return x;
}

test('核心导出完整', () => {
  ['defaultConditions', 'parseIntent', 'checkCompleteness', 'plan', 'buildRoute',
    'recompute', 'refine', 'resolveConflict', 'applyOrder', 'explainPlace']
    .forEach(k => assert.equal(typeof C[k], 'function', k + ' 缺失'));
  assert.equal(C.version, 'core.v1');
});

test('parseIntent 识别中文条件', () => {
  const p = C.parseIntent('南京 3 小时，喜欢咖啡馆和历史，预算 100 元，两个人', 'nanjing');
  assert.equal(p.city, 'nanjing');
  assert.equal(p.durationMin, 180);
  assert.equal(p.budgetMax, 100);
  assert.ok(p.interests.indexOf('coffee') >= 0);
  assert.ok(p.interests.indexOf('history') >= 0);
  assert.equal(p.party, 'couple');
});

test('checkCompleteness: 缺城市与时长', () => {
  const r = C.checkCompleteness(S.normalizeConditions({ interests: ['coffee'] }));
  assert.equal(r.ok, false);
  const ids = r.missing.map(m => m.id);
  assert.ok(ids.indexOf('city') >= 0);
  assert.ok(ids.indexOf('durationMin') >= 0);
  assert.ok(r.questions.length >= 2);
  r.questions.forEach(q => assert.ok(Array.isArray(q.options) && q.options.length > 0));
});

test('checkCompleteness: 完整条件通过', () => {
  const r = C.checkCompleteness(cond());
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test('plan: 240 分钟路线结构有效且不超时', () => {
  const route = C.plan(cond());
  const v = S.validateRoute(route);
  assert.equal(v.ok, true, S.formatErrors(v.errors));
  assert.ok(route.places.length >= 3 && route.places.length <= 6, 'places=' + route.places.length);
  assert.ok(route.actualMin <= route.durationMin * 1.05 + 1e-6);
  assert.equal(route.conflict, null);
  assert.equal(new Set(route.places).size, route.places.length);
});

test('plan: 必去地点被纳入', () => {
  const route = C.plan(cond({ mustVisit: ['颐和路民国公馆区', '先锋书店（五台山店）'] }));
  const names = route.places.map(id => D.place(id).name);
  assert.ok(names.some(n => n.indexOf('颐和路') >= 0));
  assert.ok(names.some(n => n.indexOf('先锋书店') >= 0));
  assert.equal(S.validateRoute(route).ok, true);
});

test('plan: 不存在的必去点产生 must_visit 冲突', () => {
  const route = C.plan(cond({ mustVisit: ['不存在的书店'] }));
  assert.ok(route.conflict, '应返回 conflict');
  assert.equal(route.conflict.type, 'must_visit');
  assert.ok(route.conflict.options.length >= 1);
});

test('plan: 低预算产生 budget 冲突与选项', () => {
  const route = C.plan(cond({ budgetMax: 20, interests: ['coffee', 'local'] }));
  assert.ok(route.conflict, '应返回 conflict');
  assert.equal(route.conflict.type, 'budget');
  assert.ok(route.conflict.options.length >= 2);
  assert.ok(route.budget.max > 20);
});

test('plan: 轻松步行超限时给 walking 冲突或控制距离', () => {
  const route = C.plan(cond({ walkingTolerance: 'light', durationMin: 300, interests: ['park', 'photo'] }));
  if (route.conflict) {
    assert.equal(route.conflict.type, 'walking');
    assert.ok(route.conflict.options.length >= 1);
  } else {
    assert.ok(route.distanceKm <= 3.0001, 'distance=' + route.distanceKm);
  }
});

test('plan: 同一输入两次结果一致（除 id/createdAt）', () => {
  const a = C.plan(cond({ budgetMax: 100, interests: ['book', 'coffee'] }), { seed: 'x' });
  const b = C.plan(cond({ budgetMax: 100, interests: ['book', 'coffee'] }), { seed: 'x' });
  assert.deepEqual(strip(a), strip(b));
});

test('refine: 把咖啡馆换成书店', () => {
  const base = C.plan(cond({ durationMin: 300, interests: ['coffee', 'book', 'photo'], budgetMax: 200 }));
  const hasCafe = base.places.some(id => D.place(id).cat === 'cafe');
  assert.ok(hasCafe, '基础路线应含咖啡馆，实际：' + base.places.join(','));
  const res = C.refine('把咖啡馆换成书店', base);
  assert.equal(S.validateRefine(res).ok, true, S.formatErrors(S.validateRefine(res).errors));
  assert.equal(res.changed, true);
  assert.ok(res.changes.some(c => c.type === 'replace'));
  assert.ok(res.route.places.some(id => D.place(id).cat === 'book'));
});

test('refine: 保留第一站和最后一站', () => {
  const base = C.plan(cond({ durationMin: 300, interests: ['coffee', 'book', 'photo'], budgetMax: 200 }));
  const before = base.places.slice();
  const res = C.refine('保留第一站和最后一站，调整中间路线', base);
  assert.equal(S.validateRefine(res).ok, true);
  assert.equal(res.route.places[0], before[0]);
  assert.equal(res.route.places[res.route.places.length - 1], before[before.length - 1]);
  assert.equal(res.changed, true);
});

test('refine: 预算控制到 100 以内', () => {
  const base = C.plan(cond({ budgetMax: 300 }));
  const res = C.refine('预算控制在 100 元以内', base);
  assert.equal(S.validateRefine(res).ok, true);
  assert.ok(res.route.budget.max <= 100.0001 || (res.conflict && res.conflict.type === 'budget'));
});

test('refine: 无法识别时不改路线', () => {
  const base = C.plan(cond());
  const res = C.refine('帮我写一首关于南京的诗', base);
  assert.equal(S.validateRefine(res).ok, true);
  assert.equal(res.changed, false);
  assert.deepEqual(res.route.places, base.places);
  assert.ok(res.reply.length > 0);
});

test('refine: 多轮修改后仍通过 Schema 与硬约束', () => {
  let route = C.plan(cond({ durationMin: 300, budgetMax: 300 }));
  ['少走一点路', '预算控制在 100 元以内', '多看一些历史建筑'].forEach(text => {
    const res = C.refine(text, route);
    assert.equal(S.validateRefine(res).ok, true, text + ': ' + S.formatErrors(S.validateRefine(res).errors));
    route = res.route;
    const time = route.constraints.find(c => c.id === 'time');
    if (time) assert.notEqual(time.status, 'violated', text + ' 后时间被违反');
  });
});

test('applyOrder: 重排后重算且 orderDirty=false', () => {
  const base = C.plan(cond({ durationMin: 300 }));
  const reversed = base.places.slice().reverse();
  const next = C.applyOrder(base, reversed);
  assert.equal(S.validateRoute(next).ok, true);
  assert.deepEqual(next.places, reversed);
  assert.equal(next.orderDirty, false);
  assert.equal(next.segments.length, reversed.length);
});

test('resolveConflict: 执行冲突选项并返回合法 RefineResult', () => {
  const base = C.plan(cond({ budgetMax: 20, interests: ['coffee', 'local'] }));
  assert.ok(base.conflict && base.conflict.options.length);
  const option = base.conflict.options[0];
  const res = C.resolveConflict(option.id, base);
  assert.equal(S.validateRefine(res).ok, true, S.formatErrors(S.validateRefine(res).errors));
  assert.ok(res.changed === true || res.changed === false);
});

test('数据质量字段与坐标一致', () => {
  const route = C.plan(cond());
  assert.equal(route.dataQuality.placesTotal, D.PLACES.length);
  assert.equal(route.dataQuality.placesWithCoords, D.PLACES.filter(p => p.geoVerified).length);
  assert.equal(route.dataQuality.placesWithHours, D.PLACES.filter(p => p.hours != null).length);
  assert.ok(route.sources.some(s => /openstreetmap/i.test(s.url)));
});
