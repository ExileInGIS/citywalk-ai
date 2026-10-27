/* =====================================================================
 * tests/unit/agent-adapter.test.js
 * ---------------------------------------------------------------------
 * 目标：不依赖 jsdom，直接在 Node 的 vm 沙箱里加载浏览器脚本，验证
 *   · config 兼容别名 / 缺省值
 *   · mock run 走 CW.core，且结果过 CW.schema
 *   · remote 包络 / 非法结构拒绝 / 澄清透传 / 超时 / 降级
 *   · status 字段
 *
 * 运行：
 *   node --test tests/unit/agent-adapter.test.js
 *
 * core 未就绪（shared/core.js 缺失或缺少 plan/refine/checkCompleteness）时，
 * 依赖 core 的用例会 skip 并写明原因，不会伪造通过。
 * ===================================================================== */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');

function readScript(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function loadScript(sandbox, rel) {
  vm.runInContext(readScript(rel), sandbox, { filename: rel });
}

/**
 * 建立一个浏览器式沙箱：window 指向沙箱本身，CW 挂在同一个对象上。
 * 不加载 js/ui.js、js/pages/**，保持纯逻辑测试。
 */
function makeSandbox(options) {
  const opts = options || {};
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    AbortController: AbortController,
    URLSearchParams: URLSearchParams,
    crypto: { randomUUID: randomUUID },
    location: {
      search: opts.search || '',
      hostname: opts.hostname || 'localhost',
      protocol: opts.protocol || 'http:'
    },
    fetch: opts.fetch
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  loadScript(sandbox, 'js/config.js');
  loadScript(sandbox, 'js/data.js');
  loadScript(sandbox, 'js/schema.js');

  let coreError = null;
  const corePath = path.join(ROOT, 'shared/core.js');
  if (fs.existsSync(corePath) && fs.statSync(corePath).size > 0) {
    try {
      loadScript(sandbox, 'shared/core.js');
    } catch (err) {
      coreError = err;
    }
  }

  loadScript(sandbox, 'js/agent.js');
  sandbox.__coreLoadError = coreError;
  return sandbox;
}

function coreReadiness(sandbox) {
  if (sandbox.__coreLoadError) {
    return { ok: false, reason: 'shared/core.js 加载失败：' + sandbox.__coreLoadError.message };
  }
  const core = sandbox.CW && sandbox.CW.core;
  if (!core) return { ok: false, reason: 'shared/core.js 尚未就绪（CW.core 未注册）' };
  const required = [
    'plan', 'refine', 'checkCompleteness', 'applyOrder',
    'defaultConditions', 'parseIntent', 'buildRoute', 'explainPlace', 'resolveConflict'
  ];
  const missing = required.filter(name => typeof core[name] !== 'function');
  if (missing.length) {
    return { ok: false, reason: 'shared/core.js 尚未就绪，缺少：' + missing.join(', ') };
  }
  return { ok: true };
}

function completeConditions() {
  return {
    city: 'nanjing',
    durationMin: 240,
    startTime: '14:00',
    endTime: '',
    interests: ['coffee', 'history'],
    budgetMax: 150,
    budgetBasis: 'total',
    party: 'solo',
    walkingTolerance: 'mid',
    transport: 'walk',
    pace: 'mid',
    foodPreferences: [],
    accessibility: [],
    weather: 'any',
    avoid: [],
    mustVisit: [],
    additionalRequirements: ''
  };
}

/* 与 js/schema.js 对齐的最小合法 Route，用于 remote 分支测试 */
function validRoute() {
  return {
    schemaVersion: 'route.v1',
    id: 'r_fixture_1',
    city: 'nanjing',
    name: '测试路线',
    source: 'remote',
    createdAt: '2026-10-26T10:00:00.000Z',
    conditions: completeConditions(),
    places: ['p_yihe'],
    segments: [
      { placeId: 'p_yihe', stayMin: 60, walkFromPrevMin: 0, distanceFromPrevKm: 0, indoor: false }
    ],
    durationMin: 240,
    actualMin: 60,
    stayTotalMin: 60,
    walkTotalMin: 0,
    distanceKm: 0,
    budget: { min: 0, max: 50, currency: 'CNY', basis: 'total' },
    scores: {
      overall: 0.8, interest: 0.8, timeFit: 0.8, efficiency: 0.8,
      budgetFit: 0.8, diversity: 0.8,
      weights: { interest: 0.35, timeFit: 0.2, efficiency: 0.15, budgetFit: 0.15, diversity: 0.15 },
      method: 'heuristic-v1'
    },
    constraints: [
      { id: 'time', label: '可用时长', kind: 'hard', status: 'met', detail: '在时长预算内' }
    ],
    conflict: null,
    explanations: [{ placeId: 'p_yihe', why: '测试用推荐理由', evidence: [] }],
    sources: [],
    notes: [],
    dataQuality: {
      placesTotal: 1,
      placesWithCoords: 1,
      placesWithHours: 0,
      placesVerified: 1,
      disclaimer: '示例数据，非导航结果'
    }
  };
}

function response(body, status) {
  const code = status == null ? 200 : status;
  return {
    ok: code >= 200 && code < 300,
    status: code,
    json: async function () { return body; }
  };
}

/* =====================================================================
 * config
 * ===================================================================== */

test('config: 兼容别名指向同一对象，缺省值可直接运行', () => {
  const sandbox = makeSandbox();
  const cfg = sandbox.CW_CONFIG;

  assert.equal(cfg.agent, cfg.AGENT);
  assert.equal(cfg.map, cfg.MAP);
  assert.equal(cfg.storage, cfg.STORAGE);
  assert.equal(cfg.telemetry, cfg.TELEMETRY);
  assert.equal(cfg.app, cfg.APP);

  assert.equal(cfg.AGENT.mode, 'mock');
  assert.equal(cfg.AGENT.endpoint, '/api/agent/run');
  assert.equal(cfg.AGENT.timeoutMs, 20000);
  assert.equal(cfg.AGENT.fallback, 'mock');
  assert.ok(cfg.AGENT.headers && typeof cfg.AGENT.headers === 'object');
  assert.equal(cfg.AGENT.requestIdHeader, 'X-Request-Id');

  assert.equal(cfg.MAP.provider, 'mock');
  assert.ok(cfg.MAP.leaflet.tileUrl);
  assert.ok(cfg.MAP.leaflet.attribution);
  assert.ok(cfg.MAP.leaflet.maxZoom > 0);

  assert.equal(cfg.STORAGE.keyPrefix, 'cw.v1.');
  assert.equal(cfg.STORAGE.favorites, true);
  assert.equal(cfg.STORAGE.draft, true);

  assert.equal(cfg.TELEMETRY.enabled, true);
  assert.equal(cfg.TELEMETRY.endpoint, '/api/events');

  assert.equal(cfg.APP.brand, 'CityWalk AI');
  assert.equal(cfg.APP.defaultCity, 'nanjing');
  assert.equal(cfg.APP.version, '1.0.0');
});

test('config: 本地 URL 参数可覆盖 mode/map，非本地环境忽略', () => {
  const local = makeSandbox({ search: '?mode=remote&map=leaflet', hostname: 'localhost' });
  assert.equal(local.CW_CONFIG.AGENT.mode, 'remote');
  assert.equal(local.CW_CONFIG.MAP.provider, 'leaflet');
  assert.equal(local.CW.agent.status().mapProvider, 'leaflet');

  const remoteHost = makeSandbox({ search: '?mode=remote&map=leaflet', hostname: 'example.com' });
  assert.equal(remoteHost.CW_CONFIG.AGENT.mode, 'mock');
  assert.equal(remoteHost.CW_CONFIG.MAP.provider, 'mock');
});

/* =====================================================================
 * status
 * ===================================================================== */

test('status: 字段齐全；remote 缺 endpoint 时 connected=false', () => {
  const sandbox = makeSandbox();
  const agent = sandbox.CW.agent;

  const initial = agent.status();
  assert.equal(initial.mode, 'mock');
  assert.equal(initial.connected, false);
  assert.equal(initial.endpoint, '/api/agent/run');
  assert.equal(initial.fallback, 'mock');
  assert.equal(initial.provider, 'mock-rules');
  assert.equal(initial.mapProvider, 'mock');
  assert.equal(initial.lastLatencyMs, null);
  assert.equal(initial.lastError, null);
  assert.equal(initial.checkedAt, null);
  ['mode', 'connected', 'endpoint', 'fallback', 'provider', 'mapProvider',
    'lastLatencyMs', 'lastError', 'checkedAt'].forEach(key => {
    assert.ok(Object.prototype.hasOwnProperty.call(initial, key), '缺少 status.' + key);
  });

  agent.configure({ mode: 'remote', endpoint: '' });
  const noEndpoint = agent.status();
  assert.equal(noEndpoint.mode, 'remote');
  assert.equal(noEndpoint.connected, false);
  assert.equal(noEndpoint.endpoint, '');

  agent.configure({ mode: 'remote', endpoint: '/api/agent/run' });
  assert.equal(agent.status().connected, true);

  agent.configure(null); // 清空注入，恢复 config 默认
  assert.equal(agent.status().mode, 'mock');
  assert.equal(agent.status().connected, false);
});

/* =====================================================================
 * mock（依赖 shared/core.js；没就绪则 skip）
 * ===================================================================== */

test('mock: run(plan) 走 core，返回 schema-valid Route', async (t) => {
  const sandbox = makeSandbox();
  const ready = coreReadiness(sandbox);
  if (!ready.ok) return t.skip(ready.reason);

  const res = await sandbox.CW.agent.run('plan', { conditions: completeConditions() });
  assert.ok(res && typeof res === 'object', 'run 应返回 Route 对象');
  assert.equal(res.source, 'mock', '本地结果 source 应为 mock');

  const schema = sandbox.CW.schema;
  const checked = schema.validateRoute(res);
  assert.equal(checked.ok, true,
    '路线未通过 Schema：' + (schema.formatErrors ? schema.formatErrors(checked.errors) : JSON.stringify(checked.errors)));
  assert.ok(Array.isArray(res.places) && res.places.length >= 1);
});

test('mock: run(refine) 返回 schema-valid RefineResult，路线来源仍为 mock', async (t) => {
  const sandbox = makeSandbox();
  const ready = coreReadiness(sandbox);
  if (!ready.ok) return t.skip(ready.reason);

  const route = await sandbox.CW.agent.run('plan', { conditions: completeConditions() });
  const res = await sandbox.CW.agent.run('refine', { text: '少走一点路', route: route });

  assert.ok(res && typeof res === 'object');
  const checked = sandbox.CW.schema.validateRefine(res);
  assert.equal(checked.ok, true,
    '调整结果未通过 Schema：' + (sandbox.CW.schema.formatErrors
      ? sandbox.CW.schema.formatErrors(checked.errors) : JSON.stringify(checked.errors)));
  assert.equal(res.route.source, 'mock');
});

test('mock: 缺城市/时长返回 clarification，不生造 Route', async (t) => {
  const sandbox = makeSandbox();
  const ready = coreReadiness(sandbox);
  if (!ready.ok) return t.skip(ready.reason);

  const res = await sandbox.CW.agent.run('plan', { conditions: { city: '', interests: [] } });
  assert.ok(res && res.clarification, '应返回 clarification');
  assert.equal(res.route, undefined, 'clarification 不应带 route');
  assert.ok(res.clarification.missing.indexOf('city') >= 0, 'missing 应包含 city');
  assert.ok(res.clarification.missing.indexOf('durationMin') >= 0, 'missing 应包含 durationMin');
  assert.ok(Array.isArray(res.clarification.questions) && res.clarification.questions.length >= 2);
  assert.equal(typeof res.clarification.note, 'string');
});

test('mock: applyOrder 用本地 core 重排，并重新过 Schema', async (t) => {
  const sandbox = makeSandbox();
  const ready = coreReadiness(sandbox);
  if (!ready.ok) return t.skip(ready.reason);

  const route = await sandbox.CW.agent.run('plan', { conditions: completeConditions() });
  assert.ok(route.places.length >= 2, '测试路线至少需要 2 个地点');
  const reversed = route.places.slice().reverse();
  const next = sandbox.CW.agent.applyOrder(route, reversed);

  assert.notEqual(next, route, 'applyOrder 应返回新 Route');
  assert.equal(next.places[0], reversed[0], '第一站应被重排');
  const checked = sandbox.CW.schema.validateRoute(next);
  assert.equal(checked.ok, true,
    '重排后未通过 Schema：' + (sandbox.CW.schema.formatErrors
      ? sandbox.CW.schema.formatErrors(checked.errors) : JSON.stringify(checked.errors)));
});

/* =====================================================================
 * remote
 * ===================================================================== */

test('remote: 合法包络取 data、二次校验，并写入 status', async () => {
  const sandbox = makeSandbox();
  const calls = [];
  const payloadCondition = { city: 'nanjing', durationMin: 240 };
  const fakeFetch = async function (url, init) {
    calls.push({ url: url, init: init });
    return response({
      code: 0,
      requestId: 'srv-req',
      traceId: 'srv-trace',
      task: 'plan',
      mode: 'remote',
      degraded: false,
      data: validRoute(),
      meta: { durationMs: 15, provider: 'openai-compatible', schemaVersion: 'route.v1' }
    });
  };

  sandbox.CW.agent.configure({
    mode: 'remote',
    endpoint: '/api/agent/run',
    fallback: 'error',
    headers: { 'X-Client': 'unit-test' },
    fetch: fakeFetch
  });

  const res = await sandbox.CW.agent.run('plan', { conditions: payloadCondition });
  assert.equal(res.id, 'r_fixture_1');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/agent/run');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.headers['X-Client'], 'unit-test');

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.task, 'plan');
  assert.deepEqual(body.payload, { conditions: payloadCondition });
  assert.ok(body.requestId);
  assert.ok(body.traceId);
  assert.equal(calls[0].init.headers['X-Request-Id'], body.requestId);
  assert.equal(calls[0].init.headers['X-Trace-Id'], body.traceId);

  const st = sandbox.CW.agent.status();
  assert.equal(st.mode, 'remote');
  assert.equal(st.connected, true);
  assert.equal(typeof st.lastLatencyMs, 'number');
  assert.equal(st.lastError, null);
  assert.equal(typeof st.checkedAt, 'string');
  assert.equal(st.provider, 'openai-compatible');
});

test('remote: 非法结构被拒绝，不返回未校验对象', async () => {
  const sandbox = makeSandbox();
  const fakeFetch = async function () {
    return response({ code: 0, data: { schemaVersion: 'route.v1', id: 'bad', places: [] } });
  };
  sandbox.CW.agent.configure({
    mode: 'remote',
    endpoint: '/api/agent/run',
    fallback: 'error',
    fetch: fakeFetch
  });

  await assert.rejects(
    () => sandbox.CW.agent.run('plan', { conditions: completeConditions() }),
    err => {
      assert.equal(err.code, 'INVALID_OUTPUT');
      assert.ok(/路线结构不合法/.test(err.message), '错误信息应说明结构不合法');
      assert.ok(Array.isArray(err.details));
      return true;
    }
  );

  const st = sandbox.CW.agent.status();
  assert.ok(/INVALID_OUTPUT/.test(st.lastError), 'status.lastError 应记录错误码');
});

test('remote: plan 的 clarification 直接透传，不按 Route 校验', async () => {
  const sandbox = makeSandbox();
  const fakeFetch = async function () {
    return response({
      code: 0,
      data: {
        clarification: {
          missing: [{ id: 'city', label: '城市' }],
          questions: [{ id: 'city', text: '你想在哪座城市漫步？', options: [{ value: 'nanjing', label: '南京' }] }],
          note: '先确认城市'
        },
        conditions: { city: '', durationMin: 0 }
      }
    });
  };
  sandbox.CW.agent.configure({
    mode: 'remote',
    endpoint: '/api/agent/run',
    fallback: 'error',
    fetch: fakeFetch
  });

  const res = await sandbox.CW.agent.run('plan', { conditions: {} });
  assert.deepEqual(Object.keys(res), ['clarification']);
  assert.equal(Array.from(res.clarification.missing).join(','), 'city');
  assert.equal(res.clarification.questions[0].text, '你想在哪座城市漫步？');
  assert.equal(res.clarification.note, '先确认城市');
});

test('remote: HTTP 错误读取统一错误结构并带 code', async () => {
  const sandbox = makeSandbox();
  const fakeFetch = async function () {
    return response({ code: 'INVALID_INPUT', message: '请求不合法', details: [{ path: 'city', reason: 'required' }] }, 400);
  };
  sandbox.CW.agent.configure({
    mode: 'remote',
    endpoint: '/api/agent/run',
    fallback: 'error',
    fetch: fakeFetch
  });

  await assert.rejects(
    () => sandbox.CW.agent.run('plan', { conditions: {} }),
    err => {
      assert.equal(err.code, 'INVALID_INPUT');
      assert.equal(err.status, 400);
      assert.equal(err.message, '请求不合法');
      assert.ok(Array.isArray(err.details));
      return true;
    }
  );
});

test('remote: AbortController 超时抛 UPSTREAM_TIMEOUT', async () => {
  const sandbox = makeSandbox();
  const hangingFetch = function (url, init) {
    return new Promise(function (resolve, reject) {
      if (init.signal) {
        init.signal.addEventListener('abort', function () {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });
  };
  sandbox.CW.agent.configure({
    mode: 'remote',
    endpoint: '/api/agent/run',
    fallback: 'error',
    timeoutMs: 100,
    fetch: hangingFetch
  });

  await assert.rejects(
    () => sandbox.CW.agent.run('plan', { conditions: completeConditions() }),
    err => {
      assert.equal(err.code, 'UPSTREAM_TIMEOUT');
      assert.ok(/超时/.test(err.message));
      return true;
    }
  );
});

test('remote 失败 + fallback=mock：本地结果标 degraded，并保留原因', async (t) => {
  const sandbox = makeSandbox();
  const ready = coreReadiness(sandbox);
  if (!ready.ok) return t.skip(ready.reason);

  const fakeFetch = async function () {
    return response({ code: 'UPSTREAM_ERROR', message: 'upstream down' }, 502);
  };
  sandbox.CW.agent.configure({
    mode: 'remote',
    endpoint: '/api/agent/run',
    fallback: 'mock',
    fetch: fakeFetch
  });

  const res = await sandbox.CW.agent.run('plan', { conditions: completeConditions() });
  assert.equal(res.degraded, true);
  assert.ok(/upstream down/.test(res.degradeReason), '降级原因应保留');
  assert.equal(res.degradeCode, 'UPSTREAM_ERROR');
  assert.equal(sandbox.CW.schema.validateRoute(res).ok, true);
  assert.ok(/UPSTREAM_ERROR/.test(sandbox.CW.agent.status().lastError));
});

/* =====================================================================
 * 兼容导出
 * ===================================================================== */

test('兼容导出: core 未就绪时抛出明确错误，不静默 undefined', () => {
  const sandbox = makeSandbox();
  const ready = coreReadiness(sandbox);
  if (ready.ok) {
    // core 就绪时验证委托结果不是 undefined
    const cond = sandbox.CW.agent.defaultConditions();
    assert.ok(cond && typeof cond === 'object');
    assert.equal(sandbox.CW.agent.isMock(), true);
    return;
  }
  assert.throws(
    () => sandbox.CW.agent.parseIntent('南京两小时'),
    err => {
      assert.equal(err.code, 'CORE_UNAVAILABLE');
      assert.ok(/shared\/core\.js/.test(err.message));
      return true;
    }
  );
});
