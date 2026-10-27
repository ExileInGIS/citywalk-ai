/* =====================================================================
 * schema.js · Conditions / Route / RefineResult 数据契约与校验
 * ---------------------------------------------------------------------
 * UMD：浏览器挂到 CW.schema；Node 通过 require 使用。
 * 目标：任何进入渲染层的数据都必须先过这里，远程模型输出也不例外。
 * 只做结构与范围校验，不做业务规则（业务规则在 shared/core.js）。
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CW = root.CW || {};
    root.CW.schema = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 'route.v1';
  const REFINE_VERSION = 'refine.v1';

  const ENUMS = {
    city: ['nanjing', 'suzhou', 'hangzhou', 'shanghai', 'chengdu'],
    interest: ['coffee', 'history', 'photo', 'book', 'park', 'local'],
    pace: ['light', 'mid', 'deep'],
    walkingTolerance: ['light', 'mid', 'deep'],
    party: ['solo', 'friends', 'couple', 'family'],
    transport: ['walk', 'mix', 'bike'],
    weather: ['any', 'rain', 'sunny', 'hot', 'cold'],
    budgetBasis: ['total', 'per_person'],
    source: ['mock', 'remote', 'curated'],
    constraintStatus: ['met', 'partial', 'violated', 'unknown'],
    constraintKind: ['hard', 'soft'],
    conflictType: ['time', 'budget', 'must_visit', 'walking', 'accessibility', 'no_candidates'],
    changeType: ['add', 'remove', 'replace', 'reorder', 'duration', 'budget']
  };

  const LIMITS = {
    durationMin: [30, 720],
    budgetMax: [0, 10000],
    places: [1, 8],
    arrayLen: 30,
    stringLen: 120,
    textLen: 2000,
    additionalLen: 200,
    routeNameLen: 80,
    replyLen: 2000
  };

  /* ---------------- 小工具 ---------------- */
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const isInt = v => isNum(v) && Number.isInteger(v);
  const isStr = v => typeof v === 'string';
  const isBool = v => typeof v === 'boolean';
  const isArr = v => Array.isArray(v);

  function err(list, path, message) { list.push({ path, message }); }

  function clampInt(v, min, max) {
    if (!isNum(v)) return null;
    return Math.max(min, Math.min(max, Math.round(v)));
  }

  function uniqStrings(v, maxLen) {
    if (!isArr(v)) return [];
    const out = [];
    v.forEach(x => {
      if (typeof x !== 'string') return;
      const s = x.trim().slice(0, maxLen || LIMITS.stringLen);
      if (s && out.indexOf(s) < 0 && out.length < LIMITS.arrayLen) out.push(s);
    });
    return out;
  }

  function timeToMin(hhmm) {
    if (!isStr(hhmm)) return null;
    const m = hhmm.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function durationFromTimes(startTime, endTime) {
    const s = timeToMin(startTime);
    const e = timeToMin(endTime);
    if (s == null || e == null) return null;
    let d = e - s;
    if (d <= 0) d += 24 * 60; // 允许跨零点，产品上按次日处理
    return d;
  }

  function normalizeConditions(input) {
    const src = isObj(input) ? input : {};
    const out = {};

    out.city = isStr(src.city) ? src.city.trim().slice(0, 40) : '';
    out.startLocation = isStr(src.startLocation) ? src.startLocation.trim().slice(0, 80) : '';
    out.startTime = timeToMin(src.startTime) != null ? src.startTime : '14:00';
    out.endTime = timeToMin(src.endTime) != null ? src.endTime : '';
    out.interests = uniqStrings(src.interests, 20).filter(x => ENUMS.interest.indexOf(x) >= 0);
    out.budgetMax = isNum(src.budgetMax) && src.budgetMax >= 0
      ? Math.min(LIMITS.budgetMax[1], Math.round(src.budgetMax)) : null;
    out.budgetBasis = ENUMS.budgetBasis.indexOf(src.budgetBasis) >= 0 ? src.budgetBasis : 'total';
    out.party = ENUMS.party.indexOf(src.party) >= 0 ? src.party : 'solo';
    out.walkingTolerance = ENUMS.walkingTolerance.indexOf(src.walkingTolerance) >= 0 ? src.walkingTolerance : 'mid';
    out.transport = ENUMS.transport.indexOf(src.transport) >= 0 ? src.transport : 'walk';
    out.pace = ENUMS.pace.indexOf(src.pace) >= 0 ? src.pace : 'mid';
    out.foodPreferences = uniqStrings(src.foodPreferences, 20);
    out.accessibility = uniqStrings(src.accessibility, 20);
    out.weather = ENUMS.weather.indexOf(src.weather) >= 0 ? src.weather : 'any';
    out.avoid = uniqStrings(src.avoid, 40);
    out.mustVisit = uniqStrings(src.mustVisit, 40);
    out.additionalRequirements = isStr(src.additionalRequirements)
      ? src.additionalRequirements.trim().slice(0, LIMITS.additionalLen) : '';

    // 时长：显式值优先；否则由开始/结束时间推导
    let duration = isNum(src.durationMin) ? src.durationMin : null;
    if (duration == null) duration = durationFromTimes(out.startTime, out.endTime);
    out.durationMin = duration == null ? 0 : clampInt(duration, LIMITS.durationMin[0], LIMITS.durationMin[1]);
    if (out.durationMin === 0) out.durationMin = 0; // 由 checkCompleteness 判定缺失
    return out;
  }

  function validateConditions(cond, opts) {
    const errors = [];
    const requireComplete = !!(opts && opts.requireComplete);
    if (!isObj(cond)) { err(errors, 'conditions', '必须是对象'); return { ok: false, errors }; }
    if (!isStr(cond.city) || !cond.city.trim()) err(errors, 'conditions.city', '城市必填');
    if (isNum(cond.durationMin)) {
      if (cond.durationMin < LIMITS.durationMin[0] || cond.durationMin > LIMITS.durationMin[1]) {
        err(errors, 'conditions.durationMin', '时长必须在 30–720 分钟之间');
      }
    } else if (requireComplete) {
      err(errors, 'conditions.durationMin', '时长必填或由结束时间推导');
    }
    if (cond.startTime && timeToMin(cond.startTime) == null) err(errors, 'conditions.startTime', '开始时间格式应为 HH:mm');
    if (cond.endTime && timeToMin(cond.endTime) == null) err(errors, 'conditions.endTime', '结束时间格式应为 HH:mm');
    if (cond.budgetMax != null && (!isNum(cond.budgetMax) || cond.budgetMax < 0 || cond.budgetMax > LIMITS.budgetMax[1])) {
      err(errors, 'conditions.budgetMax', '预算必须在 0–10000 之间');
    }
    ['interests', 'avoid', 'mustVisit', 'foodPreferences', 'accessibility'].forEach(k => {
      if (cond[k] != null && !isArr(cond[k])) err(errors, 'conditions.' + k, '必须是数组');
    });
    if (isArr(cond.interests)) {
      cond.interests.forEach((x, i) => {
        if (ENUMS.interest.indexOf(x) < 0) err(errors, 'conditions.interests[' + i + ']', '未知兴趣: ' + x);
      });
    }
    if (cond.pace && ENUMS.pace.indexOf(cond.pace) < 0) err(errors, 'conditions.pace', '未知节奏');
    if (cond.walkingTolerance && ENUMS.walkingTolerance.indexOf(cond.walkingTolerance) < 0) err(errors, 'conditions.walkingTolerance', '未知步行强度');
    if (cond.party && ENUMS.party.indexOf(cond.party) < 0) err(errors, 'conditions.party', '未知同行人类型');
    if (cond.transport && ENUMS.transport.indexOf(cond.transport) < 0) err(errors, 'conditions.transport', '未知交通方式');
    if (cond.weather && ENUMS.weather.indexOf(cond.weather) < 0) err(errors, 'conditions.weather', '未知天气偏好');
    if (cond.additionalRequirements && cond.additionalRequirements.length > LIMITS.additionalLen) {
      err(errors, 'conditions.additionalRequirements', '补充要求不能超过 200 字');
    }
    return { ok: errors.length === 0, errors };
  }

  function validateSource(src, path, errors) {
    if (!isObj(src)) { err(errors, path, '来源必须是对象'); return; }
    if (!isStr(src.title) || !src.title.trim()) err(errors, path + '.title', '来源标题必填');
    if (!isStr(src.url) || !/^https?:\/\//.test(src.url)) err(errors, path + '.url', '来源 URL 必须是 http(s)');
    if (src.accessedAt && !isStr(src.accessedAt)) err(errors, path + '.accessedAt', '访问日期格式错误');
  }

  function validateConstraint(c, path, errors) {
    if (!isObj(c)) { err(errors, path, '约束必须是对象'); return; }
    if (!isStr(c.id) || !c.id) err(errors, path + '.id', '约束 id 必填');
    if (!isStr(c.label) || !c.label) err(errors, path + '.label', '约束 label 必填');
    if (ENUMS.constraintKind.indexOf(c.kind) < 0) err(errors, path + '.kind', 'kind 必须是 hard/soft');
    if (ENUMS.constraintStatus.indexOf(c.status) < 0) err(errors, path + '.status', 'status 非法');
    if (!isStr(c.detail)) err(errors, path + '.detail', 'detail 必须是字符串');
  }

  function validateConflict(conflict, path, errors) {
    if (conflict == null) return;
    if (!isObj(conflict)) { err(errors, path, '冲突必须是对象或 null'); return; }
    if (ENUMS.conflictType.indexOf(conflict.type) < 0) err(errors, path + '.type', '未知冲突类型');
    if (!isStr(conflict.title) || !conflict.title) err(errors, path + '.title', '冲突标题必填');
    if (!isStr(conflict.detail) || !conflict.detail) err(errors, path + '.detail', '冲突说明必填');
    if (!isArr(conflict.options) || !conflict.options.length) {
      err(errors, path + '.options', '冲突必须给出至少一个选项');
      return;
    }
    conflict.options.forEach((o, i) => {
      if (!isObj(o) || !isStr(o.id) || !o.id || !isStr(o.label) || !o.label) {
        err(errors, path + '.options[' + i + ']', '选项必须包含 id 与 label');
      }
    });
  }

  function validateRoute(route, opts) {
    const errors = [];
    const strictSources = !!(opts && opts.strictSources);
    if (!isObj(route)) { err(errors, 'route', '路线必须是对象'); return { ok: false, errors }; }

    if (route.schemaVersion !== SCHEMA_VERSION) err(errors, 'route.schemaVersion', '必须是 ' + SCHEMA_VERSION);
    if (!isStr(route.id) || !route.id) err(errors, 'route.id', 'id 必填');
    if (!isStr(route.city) || !route.city) err(errors, 'route.city', 'city 必填');
    if (!isStr(route.name) || !route.name) err(errors, 'route.name', 'name 必填');
    else if (route.name.length > LIMITS.routeNameLen) err(errors, 'route.name', 'name 过长');
    if (ENUMS.source.indexOf(route.source) < 0) err(errors, 'route.source', 'source 非法');

    const c = validateConditions(route.conditions, { requireComplete: true });
    if (!c.ok) c.errors.forEach(e => errors.push({ path: 'route.' + e.path, message: e.message }));

    if (!isArr(route.places) || route.places.length < LIMITS.places[0] || route.places.length > LIMITS.places[1]) {
      err(errors, 'route.places', '地点数量必须在 1–8 之间');
    } else {
      const seen = {};
      route.places.forEach((id, i) => {
        if (!isStr(id) || !id) err(errors, 'route.places[' + i + ']', '地点 id 必须是字符串');
        else if (seen[id]) err(errors, 'route.places[' + i + ']', '地点重复: ' + id);
        seen[id] = true;
      });
    }

    if (!isArr(route.segments)) {
      err(errors, 'route.segments', 'segments 必填');
    } else if (isArr(route.places) && route.segments.length !== route.places.length) {
      err(errors, 'route.segments', 'segments 必须与 places 等长');
    } else {
      route.segments.forEach((s, i) => {
        const p = 'route.segments[' + i + ']';
        if (!isObj(s)) { err(errors, p, 'segment 必须是对象'); return; }
        if (isArr(route.places) && s.placeId !== route.places[i]) err(errors, p + '.placeId', '与 places 顺序不一致');
        if (!isNum(s.stayMin) || s.stayMin < 0 || s.stayMin > 240) err(errors, p + '.stayMin', '停留时间必须在 0–240 分钟');
        if (!isNum(s.walkFromPrevMin) || s.walkFromPrevMin < 0 || s.walkFromPrevMin > 600) err(errors, p + '.walkFromPrevMin', '步行时间非法');
        if (!isNum(s.distanceFromPrevKm) || s.distanceFromPrevKm < 0) err(errors, p + '.distanceFromPrevKm', '距离非法');
        if (s.indoor != null && !isBool(s.indoor)) err(errors, p + '.indoor', 'indoor 必须是布尔或 null');
      });
    }

    ['durationMin', 'actualMin', 'stayTotalMin', 'walkTotalMin', 'distanceKm'].forEach(k => {
      if (!isNum(route[k]) || route[k] < 0) err(errors, 'route.' + k, k + ' 必须是非负数');
    });
    if (isNum(route.durationMin) && (route.durationMin < LIMITS.durationMin[0] || route.durationMin > LIMITS.durationMin[1])) {
      err(errors, 'route.durationMin', '总时长超出允许范围');
    }
    if (!isObj(route.budget)) {
      err(errors, 'route.budget', 'budget 必须是对象');
    } else {
      if (!isNum(route.budget.min) || route.budget.min < 0) err(errors, 'route.budget.min', '预算下限非法');
      if (!isNum(route.budget.max) || route.budget.max < 0) err(errors, 'route.budget.max', '预算上限非法');
      if (isNum(route.budget.min) && isNum(route.budget.max) && route.budget.max < route.budget.min) {
        err(errors, 'route.budget.max', '预算上限不能小于下限');
      }
      if (route.budget.currency !== 'CNY') err(errors, 'route.budget.currency', '仅支持 CNY');
    }

    if (!isObj(route.scores)) {
      err(errors, 'route.scores', 'scores 必填');
    } else {
      ['overall', 'interest', 'timeFit', 'efficiency', 'budgetFit', 'diversity'].forEach(k => {
        if (!isNum(route.scores[k]) || route.scores[k] < 0 || route.scores[k] > 1) {
          err(errors, 'route.scores.' + k, '评分必须在 0–1');
        }
      });
      if (!isObj(route.scores.weights)) err(errors, 'route.scores.weights', 'weights 必填');
      if (route.scores.method !== 'heuristic-v1') err(errors, 'route.scores.method', '未知评分方法');
    }

    if (!isArr(route.constraints) || !route.constraints.length) {
      err(errors, 'route.constraints', '至少包含一条约束结果');
    } else {
      route.constraints.forEach((x, i) => validateConstraint(x, 'route.constraints[' + i + ']', errors));
    }

    validateConflict(route.conflict, 'route.conflict', errors);

    if (!isArr(route.explanations)) {
      err(errors, 'route.explanations', 'explanations 必须是数组');
    } else {
      route.explanations.forEach((e, i) => {
        const p = 'route.explanations[' + i + ']';
        if (!isObj(e)) { err(errors, p, '解释必须是对象'); return; }
        if (!isStr(e.placeId) || (isArr(route.places) && route.places.indexOf(e.placeId) < 0)) {
          err(errors, p + '.placeId', '解释引用了不存在的地点');
        }
        if (!isStr(e.why) || !e.why) err(errors, p + '.why', '推荐理由必填');
        if (!isArr(e.evidence)) err(errors, p + '.evidence', 'evidence 必须是数组');
        else e.evidence.forEach((s, j) => validateSource(s, p + '.evidence[' + j + ']', errors));
      });
    }

    if (!isArr(route.sources)) {
      err(errors, 'route.sources', 'sources 必须是数组');
    } else if (strictSources) {
      route.sources.forEach((s, i) => validateSource(s, 'route.sources[' + i + ']', errors));
    }

    if (!isArr(route.notes)) err(errors, 'route.notes', 'notes 必须是数组');
    if (!isObj(route.dataQuality)) {
      err(errors, 'route.dataQuality', 'dataQuality 必填');
    } else {
      ['placesTotal', 'placesWithCoords', 'placesWithHours', 'placesVerified'].forEach(k => {
        if (!isNum(route.dataQuality[k]) || route.dataQuality[k] < 0) err(errors, 'route.dataQuality.' + k, '必须是非负数');
      });
      if (!isStr(route.dataQuality.disclaimer)) err(errors, 'route.dataQuality.disclaimer', 'disclaimer 必填');
    }
    if (route.degraded != null && !isBool(route.degraded)) err(errors, 'route.degraded', 'degraded 必须是布尔');
    if (route.degradeReason != null && !isStr(route.degradeReason)) err(errors, 'route.degradeReason', 'degradeReason 必须是字符串');
    if (route.conflict && route.constraints) {
      const violated = route.constraints.some(x => x.status === 'violated');
      if (!violated) err(errors, 'route.conflict', '存在冲突时至少应有一条 violated 约束');
    }
    return { ok: errors.length === 0, errors };
  }

  function validateRefine(res) {
    const errors = [];
    if (!isObj(res)) { err(errors, 'refine', '调整结果必须是对象'); return { ok: false, errors }; }
    if (res.schemaVersion !== REFINE_VERSION) err(errors, 'refine.schemaVersion', '必须是 ' + REFINE_VERSION);
    if (!isBool(res.changed)) err(errors, 'refine.changed', 'changed 必须是布尔');
    if (!isStr(res.reply) || !res.reply) err(errors, 'refine.reply', 'reply 必填');
    else if (res.reply.length > LIMITS.replyLen) err(errors, 'refine.reply', 'reply 过长');
    if (!isArr(res.bullets)) err(errors, 'refine.bullets', 'bullets 必须是数组');
    if (!isArr(res.changes)) err(errors, 'refine.changes', 'changes 必须是数组');
    else res.changes.forEach((c, i) => {
      if (!isObj(c) || ENUMS.changeType.indexOf(c.type) < 0 || !isStr(c.label)) {
        err(errors, 'refine.changes[' + i + ']', '变更项必须包含合法 type 与 label');
      }
    });
    if (!isArr(res.constraintsAfter)) err(errors, 'refine.constraintsAfter', 'constraintsAfter 必须是数组');
    else res.constraintsAfter.forEach((c, i) => validateConstraint(c, 'refine.constraintsAfter[' + i + ']', errors));
    if (!isArr(res.unresolved)) err(errors, 'refine.unresolved', 'unresolved 必须是数组');
    validateConflict(res.conflict, 'refine.conflict', errors);
    const r = validateRoute(res.route);
    if (!r.ok) r.errors.forEach(e => errors.push({ path: 'refine.' + e.path, message: e.message }));
    return { ok: errors.length === 0, errors };
  }

  function formatErrors(errors) {
    return (errors || []).slice(0, 5).map(e => e.path + ': ' + e.message).join('; ');
  }

  return {
    SCHEMA_VERSION, REFINE_VERSION, ENUMS, LIMITS,
    normalizeConditions, validateConditions, validateRoute, validateRefine,
    durationFromTimes, timeToMin, formatErrors,
    isObj, isNum, isInt, isStr, isBool, isArr
  };
});
