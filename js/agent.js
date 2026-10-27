/* =====================================================================
 * agent.js · Agent 薄适配层（浏览器脚本）
 * ---------------------------------------------------------------------
 * 页面只调用 CW.agent.run(task, payload, opts)，不直接 fetch 任何第三方 AI。
 *
 *   task = 'plan'   → mock 调 CW.core.plan；remote POST /api/agent/run
 *   task = 'refine' → mock 调 CW.core.refine；remote POST /api/agent/run
 *
 * 必须保持的三条边界：
 *   1. 本地结果也过 CW.schema 校验，页面永远拿不到未校验数据；
 *   2. 远程失败按 AGENT.fallback 决定降级或抛错，降级结果标 degraded；
 *   3. plan 可能返回 { clarification }，这不是错误，也不生成假路线。
 *
 * 兼容导出（parseIntent / checkCompleteness / ...）全部委托 CW.core；
 * core 未加载时抛出明确错误，绝不静默返回 undefined。
 * ===================================================================== */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const CW = (root.CW = root.CW || {});

  const TASKS = { plan: true, refine: true };
  const TRACE_HEADER = 'X-Trace-Id';

  const DEFAULT_AGENT = {
    mode: 'mock',
    endpoint: '/api/agent/run',
    timeoutMs: 20000,
    fallback: 'mock',
    headers: {},
    requestIdHeader: 'X-Request-Id'
  };

  /* 测试可通过 configure({ fetch }) 注入；运行时只保留最近一次远程状态 */
  let overrides = {};
  const runtime = {
    lastLatencyMs: null,
    lastError: null,
    checkedAt: null,
    lastProvider: null
  };

  /* =====================================================================
   * 一、配置与状态
   * ===================================================================== */

  function normalizeTimeout(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_AGENT.timeoutMs;
    return Math.min(120000, Math.max(100, Math.round(n)));
  }

  function readConfig() {
    const raw = (root.CW_CONFIG && (root.CW_CONFIG.AGENT || root.CW_CONFIG.agent)) || {};
    const cfg = Object.assign({}, DEFAULT_AGENT, raw, overrides);
    cfg.headers = Object.assign({}, DEFAULT_AGENT.headers, raw.headers || {}, overrides.headers || {});
    cfg.mode = cfg.mode === 'remote' ? 'remote' : 'mock';
    cfg.fallback = cfg.fallback === 'error' ? 'error' : 'mock';
    cfg.endpoint = typeof cfg.endpoint === 'string' ? cfg.endpoint.trim() : '';
    cfg.requestIdHeader = (typeof cfg.requestIdHeader === 'string' && cfg.requestIdHeader.trim())
      ? cfg.requestIdHeader.trim() : DEFAULT_AGENT.requestIdHeader;
    cfg.timeoutMs = normalizeTimeout(cfg.timeoutMs);
    return cfg;
  }

  function isRemote(cfg) {
    return cfg.mode === 'remote' && !!cfg.endpoint;
  }

  function readMapProvider() {
    const map = (root.CW_CONFIG && (root.CW_CONFIG.MAP || root.CW_CONFIG.map)) || {};
    const id = map.provider || 'mock';
    // 旧配置 'svg' 等价于新 provider 'mock'
    return id === 'svg' ? 'mock' : id;
  }

  function status() {
    const cfg = readConfig();
    const connected = isRemote(cfg);
    return {
      mode: cfg.mode,
      connected: connected,
      endpoint: cfg.endpoint,
      fallback: cfg.fallback,
      provider: connected ? (runtime.lastProvider || 'remote') : 'mock-rules',
      mapProvider: readMapProvider(),
      lastLatencyMs: runtime.lastLatencyMs,
      lastError: runtime.lastError,
      checkedAt: runtime.checkedAt
    };
  }

  /**
   * 测试 / 运行时注入配置。
   * configure(null) 清空注入；普通对象与已有注入浅合并。
   */
  function configure(config) {
    if (config == null) {
      overrides = {};
      return status();
    }
    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('CW.agent.configure(config) 需要对象');
    }
    overrides = Object.assign({}, overrides, config);
    if (config.headers) {
      overrides.headers = Object.assign({}, overrides.headers || {}, config.headers);
    }
    return status();
  }

  /* =====================================================================
   * 二、错误、ID、校验
   * ===================================================================== */

  function makeError(code, message, extra) {
    const err = new Error(message || '智能体请求失败');
    err.name = 'CwAgentError';
    err.code = code || 'INTERNAL';
    if (extra) {
      Object.keys(extra).forEach(key => {
        if (extra[key] !== undefined) err[key] = extra[key];
      });
    }
    return err;
  }

  function makeId() {
    try {
      const webCrypto = root.crypto;
      if (webCrypto && typeof webCrypto.randomUUID === 'function') {
        const id = webCrypto.randomUUID();
        if (id) return String(id);
      }
    } catch (e) { /* 隐私模式或旧浏览器：走时间戳兜底 */ }
    return 'cw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function requireSchema() {
    const schema = CW.schema;
    if (!schema || typeof schema.validateRoute !== 'function' || typeof schema.validateRefine !== 'function') {
      throw makeError('SCHEMA_UNAVAILABLE',
        '数据校验模块未就绪：缺少 CW.schema.validateRoute / validateRefine（请确认 js/schema.js 已加载）');
    }
    return schema;
  }

  function schemaErrorText(schema, errors) {
    if (errors && errors.length && typeof schema.formatErrors === 'function') {
      return schema.formatErrors(errors);
    }
    if (!errors || !errors.length) return '';
    return errors.slice(0, 5).map(e => (e.path || '') + ': ' + (e.message || '')).join('; ');
  }

  function validateRouteOrThrow(route) {
    const schema = requireSchema();
    const result = schema.validateRoute(route);
    if (!result || !result.ok) {
      const detail = schemaErrorText(schema, result && result.errors);
      throw makeError('INVALID_OUTPUT', '路线结构不合法' + (detail ? '：' + detail : ''),
        { details: (result && result.errors) || [] });
    }
    return route;
  }

  function validateRefineOrThrow(refine) {
    const schema = requireSchema();
    const result = schema.validateRefine(refine);
    if (!result || !result.ok) {
      const detail = schemaErrorText(schema, result && result.errors);
      throw makeError('INVALID_OUTPUT', '调整结果结构不合法' + (detail ? '：' + detail : ''),
        { details: (result && result.errors) || [] });
    }
    return refine;
  }

  /* =====================================================================
   * 三、澄清结果归一化
   * ===================================================================== */

  const QUESTION_FALLBACK = {
    city: '你想在哪座城市漫步？',
    duration: '这次大概有多少时间？',
    durationMin: '这次大概有多少时间？',
    startTime: '大概几点出发？',
    endTime: '大概几点结束？',
    interests: '你更想逛哪一类地方？',
    budgetMax: '预算大概是多少？',
    party: '这次和谁一起？',
    walkingTolerance: '能接受多长的步行？',
    accessibility: '有需要照顾的无障碍需求吗？'
  };

  function toText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeQuestion(q, fallbackId) {
    if (typeof q === 'string') {
      const text = q.trim();
      return text ? { id: fallbackId || '', text: text } : null;
    }
    if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
    const out = Object.assign({}, q);
    if (!toText(out.text) && toText(out.question)) out.text = toText(out.question);
    if (Array.isArray(out.options)) {
      out.options = out.options.filter(o => o && (typeof o === 'string' ||
        (typeof o === 'object' && (toText(o.label) || toText(o.text)))));
    }
    if (!toText(out.id) && fallbackId) out.id = fallbackId;
    return out;
  }

  function normalizeMissing(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    list.forEach(item => {
      let id = '';
      if (typeof item === 'string') id = item.trim();
      else if (item && typeof item === 'object') id = toText(item.field || item.id || item.path);
      if (id && out.indexOf(id) < 0) out.push(id);
    });
    return out;
  }

  function normalizeClarification(raw) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const missing = normalizeMissing(src.missing || src.missingFields);
    let questions = [];

    const push = q => { const n = normalizeQuestion(q, missing[questions.length] || ''); if (n) questions.push(n); };
    if (Array.isArray(src.questions)) src.questions.forEach(push);
    else if (src.questions && typeof src.questions === 'object') push(src.questions);
    else if (Array.isArray(src.ask)) src.ask.forEach(push);
    else if (src.ask && typeof src.ask === 'object') {
      const q = normalizeQuestion(src.ask, missing[0] || '');
      if (q) {
        // 旧版 ask.chips 是字符串数组；保留给旧页面渲染
        if (!q.options && Array.isArray(src.ask.chips)) q.chips = src.ask.chips.filter(c => typeof c === 'string');
        questions.push(q);
      }
    } else if (src.question) push(src.question);

    if (!missing.length) {
      questions.forEach(q => { if (toText(q.id) && missing.indexOf(q.id) < 0) missing.push(q.id); });
    }
    if (!questions.length && missing.length) {
      missing.forEach(id => { if (QUESTION_FALLBACK[id]) questions.push({ id: id, text: QUESTION_FALLBACK[id] }); });
    }

    const note = toText(src.note) ||
      (src.ask && typeof src.ask === 'object' ? toText(src.ask.detail) : '') ||
      (questions.length ? '' : '还需要补充一些条件，才能生成可靠的路线。');

    return { missing: missing, questions: questions, note: note };
  }

  function isIncomplete(check) {
    if (!check || typeof check !== 'object') return false;
    if (check.ok === false) return true;
    if (check.ok === true) return false;
    return !!(
      (Array.isArray(check.missing) && check.missing.length) ||
      (Array.isArray(check.questions) && check.questions.length) ||
      check.ask
    );
  }

  /* =====================================================================
   * 四、本地核心（mock / fallback）
   * ===================================================================== */

  function requireCore(name) {
    const core = CW.core;
    if (!core || typeof core[name] !== 'function') {
      throw makeError('CORE_UNAVAILABLE',
        '本地规划核心未就绪：缺少 CW.core.' + name + '（请确认 shared/core.js 已加载）');
    }
    return core[name];
  }

  function markLocalSource(result, task) {
    if (!result || typeof result !== 'object') return result;
    if (task === 'plan') {
      if (result.source !== 'mock') result.source = 'mock';
    } else if (task === 'refine' && result.route && typeof result.route === 'object') {
      if (result.route.source !== 'mock') result.route.source = 'mock';
    }
    return result;
  }

  async function runLocal(task, payload) {
    const p = (payload && typeof payload === 'object') ? payload : {};

    if (task === 'plan') {
      const checkFn = requireCore('checkCompleteness');
      const check = checkFn.call(CW.core, p.conditions);
      if (!check || typeof check !== 'object') {
        throw makeError('CORE_UNAVAILABLE', '本地规划核心 checkCompleteness 返回了非法结构');
      }
      if (isIncomplete(check)) {
        return { clarification: normalizeClarification(check) };
      }

      const route = requireCore('plan').call(CW.core, p.conditions);
      if (route && typeof route === 'object' && route.clarification) {
        return { clarification: normalizeClarification(route.clarification) };
      }
      markLocalSource(route, 'plan');
      return validateRouteOrThrow(route);
    }

    if (task === 'refine') {
      const refine = requireCore('refine').call(CW.core, p.text, p.route);
      markLocalSource(refine, 'refine');
      return validateRefineOrThrow(refine);
    }

    throw makeError('INVALID_INPUT', '不支持的 task：' + String(task));
  }

  /* =====================================================================
   * 五、远程调用
   * ===================================================================== */

  function pickFetch(cfg, opts) {
    const candidates = [
      opts && opts.fetch,
      cfg && cfg.fetch,
      root.fetch
    ];
    for (let i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === 'function') return candidates[i];
    }
    throw makeError('REMOTE_NOT_CONFIGURED', '当前环境没有 fetch，无法连接智能体服务');
  }

  function pickAbortController() {
    if (typeof root.AbortController === 'function') return root.AbortController;
    if (typeof AbortController === 'function') return AbortController;
    return null;
  }

  function statusToCode(statusCode) {
    switch (Number(statusCode)) {
      case 400: return 'INVALID_INPUT';
      case 404: return 'NOT_FOUND';
      case 408: return 'UPSTREAM_TIMEOUT';
      case 429: return 'RATE_LIMITED';
      case 502: return 'UPSTREAM_ERROR';
      case 503: return 'REMOTE_NOT_CONFIGURED';
      case 504: return 'UPSTREAM_TIMEOUT';
      default: return 'UPSTREAM_ERROR';
    }
  }

  function errorFromResponse(res, json) {
    const statusCode = Number(res && res.status) || 0;
    const body = (json && typeof json === 'object') ? json : {};
    const code = (typeof body.code === 'string' && body.code) || statusToCode(statusCode);
    const message = (typeof body.message === 'string' && body.message)
      ? body.message
      : '智能体服务返回 HTTP ' + (statusCode || '未知');
    return makeError(code, message, {
      status: statusCode,
      requestId: body.requestId,
      traceId: body.traceId,
      details: body.details
    });
  }

  async function readJson(res) {
    if (!res) throw makeError('UPSTREAM_ERROR', '智能体服务没有返回响应');
    const ok = (typeof res.ok === 'boolean') ? res.ok : (Number(res.status) >= 200 && Number(res.status) < 300);

    if (typeof res.json === 'function') {
      try {
        return await res.json();
      } catch (e) {
        // 错误响应允许没有 JSON 体；成功响应必须是 JSON
        if (!ok) return {};
        throw makeError('UPSTREAM_ERROR', '智能体服务返回的不是有效 JSON', { cause: e });
      }
    }
    if (typeof res.text === 'function') {
      const text = await res.text();
      if (!text) return ok ? null : {};
      try {
        return JSON.parse(text);
      } catch (e) {
        if (!ok) return {};
        throw makeError('UPSTREAM_ERROR', '智能体服务返回的不是有效 JSON', { cause: e });
      }
    }
    return null;
  }

  function unwrapEnvelope(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw makeError('INVALID_OUTPUT', '智能体服务响应必须是 JSON 对象');
    }
    const hasCode = Object.prototype.hasOwnProperty.call(json, 'code');
    if (hasCode && json.code !== 0 && json.code !== '0') {
      const code = (typeof json.code === 'string' && json.code) ? json.code : 'UPSTREAM_ERROR';
      throw makeError(code, (typeof json.message === 'string' && json.message)
        ? json.message : '智能体服务返回错误', {
        requestId: json.requestId,
        traceId: json.traceId,
        details: json.details
      });
    }
    if (Object.prototype.hasOwnProperty.call(json, 'data')) {
      return {
        data: json.data,
        meta: (json.meta && typeof json.meta === 'object') ? json.meta : null,
        degraded: json.degraded === true,
        degradeReason: typeof json.degradeReason === 'string' ? json.degradeReason : ''
      };
    }
    // 兼容旧接口：直接返回 Route / RefineResult，不包 envelope
    return { data: json, meta: null, degraded: false, degradeReason: '' };
  }

  function applyEnvelopeDegraded(data, envelope) {
    if (!envelope.degraded || !data || typeof data !== 'object') return data;
    data.degraded = true;
    if (!data.degradeReason && envelope.degradeReason) data.degradeReason = envelope.degradeReason;
    return data;
  }

  async function callRemote(task, payload, cfg, opts) {
    const fetchImpl = pickFetch(cfg, opts);
    const AbortCtor = pickAbortController();
    if (!AbortCtor) {
      throw makeError('REMOTE_NOT_CONFIGURED', '当前环境不支持 AbortController，无法安全设置请求超时');
    }

    const requestId = (opts && opts.requestId) ? String(opts.requestId) : makeId();
    const traceId = (opts && opts.traceId) ? String(opts.traceId) : makeId();

    const headers = {};
    Object.keys(cfg.headers || {}).forEach(key => {
      if (cfg.headers[key] != null) headers[key] = String(cfg.headers[key]);
    });
    headers['Content-Type'] = 'application/json';
    headers['Accept'] = 'application/json';
    headers[cfg.requestIdHeader] = requestId;
    headers[TRACE_HEADER] = traceId;

    let body;
    try {
      body = JSON.stringify({
        requestId: requestId,
        traceId: traceId,
        task: task,
        payload: payload == null ? {} : payload
      });
    } catch (e) {
      throw makeError('INVALID_INPUT', '请求数据无法序列化为 JSON', { cause: e });
    }

    const timeoutMs = (opts && Number.isFinite(Number(opts.timeoutMs)) && Number(opts.timeoutMs) > 0)
      ? normalizeTimeout(opts.timeoutMs)
      : cfg.timeoutMs;

    const controller = new AbortCtor();
    let timedOut = false;
    let timer = null;
    const started = Date.now();

    try {
      timer = setTimeout(() => {
        timedOut = true;
        try { controller.abort(); } catch (e) { /* 已结束 */ }
      }, timeoutMs);

      const res = await fetchImpl(cfg.endpoint, {
        method: 'POST',
        headers: headers,
        body: body,
        credentials: 'same-origin',
        signal: controller.signal
      });

      const json = await readJson(res);
      if (timedOut) {
        throw makeError('UPSTREAM_TIMEOUT', '请求智能体服务超时（' + timeoutMs + 'ms）');
      }

      const ok = (typeof res.ok === 'boolean') ? res.ok : (Number(res.status) >= 200 && Number(res.status) < 300);
      if (!ok) throw errorFromResponse(res, json);

      const envelope = unwrapEnvelope(json);
      runtime.lastProvider = (envelope.meta && envelope.meta.provider)
        ? String(envelope.meta.provider) : 'remote';

      let data = envelope.data;
      if (task === 'plan' && data && typeof data === 'object' && data.clarification) {
        // 澄清是正常业务结果，不是错误，也不是 Route
        return { clarification: normalizeClarification(data.clarification) };
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw makeError('INVALID_OUTPUT', '智能体服务未返回有效数据');
      }

      data = applyEnvelopeDegraded(data, envelope);
      if (task === 'plan') return validateRouteOrThrow(data);
      if (task === 'refine') return validateRefineOrThrow(data);
      throw makeError('INVALID_INPUT', '不支持的 task：' + String(task));
    } catch (err) {
      if (err && err.code) throw err;
      if (timedOut || (err && err.name === 'AbortError')) {
        throw makeError('UPSTREAM_TIMEOUT', '请求智能体服务超时（' + timeoutMs + 'ms）', { cause: err });
      }
      const detail = err && err.message ? '：' + err.message : '';
      throw makeError('UPSTREAM_ERROR', '无法连接智能体服务' + detail, { cause: err });
    } finally {
      if (timer) clearTimeout(timer);
      runtime.lastLatencyMs = Date.now() - started;
      runtime.checkedAt = new Date().toISOString();
    }
  }

  function markDegraded(result, err) {
    if (!result || typeof result !== 'object') return result;
    const reason = (err && err.message) ? err.message : '远程服务不可用';
    result.degraded = true;
    result.degradeReason = reason.length > 300 ? reason.slice(0, 300) : reason;
    if (err && err.code) result.degradeCode = err.code;
    if (result.route && typeof result.route === 'object') {
      result.route.degraded = true;
      if (!result.route.degradeReason) result.route.degradeReason = result.degradeReason;
    }
    return result;
  }

  function runtimeErrorText(err) {
    if (!err) return '未知错误';
    const code = err.code ? String(err.code) : 'INTERNAL';
    return code + ': ' + (err.message || '请求失败');
  }

  /**
   * 统一入口。
   * opts（可选）：{ fetch, timeoutMs, requestId, traceId } —— 主要供测试注入。
   */
  async function run(task, payload, opts) {
    if (!TASKS[task]) {
      throw makeError('INVALID_INPUT', '不支持的 task：' + String(task) + '（只支持 plan / refine）');
    }
    const cfg = readConfig();

    if (!isRemote(cfg)) {
      return runLocal(task, payload);
    }

    try {
      const result = await callRemote(task, payload, cfg, opts || {});
      runtime.lastError = null;
      return result;
    } catch (err) {
      runtime.lastError = runtimeErrorText(err);
      runtime.checkedAt = new Date().toISOString();
      if (cfg.fallback !== 'mock') throw err;

      let local;
      try {
        local = await runLocal(task, payload);
      } catch (localErr) {
        throw makeError(err.code || 'UPSTREAM_ERROR',
          (err.message || '远程服务不可用') + '；本地降级也失败：' + (localErr.message || '未知错误'),
          { cause: err, fallbackError: localErr });
      }
      return markDegraded(local, err);
    }
  }

  /* =====================================================================
   * 六、兼容导出（全部委托 CW.core）
   * ===================================================================== */

  function delegate(name) {
    return function () {
      const fn = requireCore(name);
      return fn.apply(CW.core, arguments);
    };
  }

  /**
   * 兼容旧页面：旧版 ask 结构为 { question, detail, chips }，
   * 新版核心返回 { missing, questions, note }。这里保留原对象并补 ask，
   * 新页面仍可直接读 missing/questions/note。
   */
  function checkCompleteness(conditions) {
    const fn = requireCore('checkCompleteness');
    const res = fn.call(CW.core, conditions);
    if (!res || typeof res !== 'object') return res;
    if (res.ok === false && !res.ask) {
      const clarified = normalizeClarification(res);
      const first = clarified.questions[0] || {};
      const questionText = clarified.questions
        .map(q => toText(q.text) || toText(q.question))
        .filter(Boolean)
        .join('；') || '还需要补充一些信息';
      const chips = Array.isArray(first.chips) ? first.chips.slice()
        : (Array.isArray(first.options)
          ? first.options.map(o => (typeof o === 'string' ? o : (o.label || o.text || ''))).filter(Boolean)
          : []);
      return Object.assign({}, res, {
        missing: Array.isArray(res.missing) ? res.missing : clarified.missing,
        ask: {
          question: questionText,
          detail: clarified.note || toText(first.detail) || '',
          chips: chips
        }
      });
    }
    return res;
  }

  /**
   * 旧名 planRoute 对应新核心的 plan()。
   * 核心若仍提供 planRoute 则优先用它；两者都没有时给出可识别错误。
   */
  function planRoute(conditions, options) {
    const core = CW.core;
    if (core && typeof core.planRoute === 'function') {
      return core.planRoute(conditions, options);
    }
    return requireCore('plan').call(core, conditions, options);
  }

  /**
   * 本地确定性重排。即使当前是 remote 模式也走 core：
   * 顺序调整不需要大模型，远程往返只会引入不确定性。
   * 返回新的 Route，并重新过 Schema。
   */
  function applyOrder(route, placeIds) {
    if (!Array.isArray(placeIds)) {
      throw makeError('INVALID_INPUT', 'applyOrder(route, placeIds) 的 placeIds 必须是数组');
    }
    const fn = requireCore('applyOrder');
    const next = fn.call(CW.core, route, placeIds);
    if (!next || typeof next !== 'object') {
      throw makeError('CORE_UNAVAILABLE', 'CW.core.applyOrder 未返回新的 Route');
    }
    return validateRouteOrThrow(next);
  }

  CW.agent = {
    /* 新契约 */
    run: run,
    status: status,
    configure: configure,
    applyOrder: applyOrder,

    /* 兼容导出：全部委托 shared/core.js */
    parseIntent: delegate('parseIntent'),
    checkCompleteness: checkCompleteness,
    defaultConditions: delegate('defaultConditions'),
    planRoute: planRoute,
    buildRoute: delegate('buildRoute'),
    explainPlace: delegate('explainPlace'),
    resolveConflict: delegate('resolveConflict'),

    /* 旧页面可能读取的便捷方法 */
    isMock: function () { return !isRemote(readConfig()); }
  };
})();
