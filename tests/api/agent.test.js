/* =====================================================================
 * tests/api/agent.test.js · /api/agent/run 接口测试
 * ---------------------------------------------------------------------
 * 真实启动 createApp() 返回的 http.Server，监听 127.0.0.1:0，
 * 用全局 fetch 走完整 HTTP 链路。远程 Provider 用注入的 fake fetchImpl。
 * 运行：node --test tests/api
 * ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../../server/index.js');
const schema = require('../../js/schema.js');

const CONDITIONS = {
  city: 'nanjing',
  durationMin: 240,
  startTime: '14:00',
  interests: ['coffee', 'history', 'photo'],
  budgetMax: 200,
  budgetBasis: 'total',
  pace: 'mid',
  transport: 'walk',
  walkingTolerance: 'mid',
  party: 'friends',
  weather: 'any',
  mustVisit: [],
  avoid: []
};

function baseConfig(overrides) {
  return Object.assign({
    agentMode: 'mock',
    agentFallback: 'mock',
    agentTimeoutMs: 2000,
    rateLimitPerMin: 1000,
    telemetryEnabled: true,
    logLevel: 'silent',
    corsOrigins: [],
    nodeEnv: 'test',
    version: '1.0.0'
  }, overrides || {});
}

function startServer(overrides) {
  const config = baseConfig(overrides);
  const server = createApp({
    config,
    fetchImpl: overrides && overrides.fetchImpl
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        base: 'http://127.0.0.1:' + server.address().port,
        close: () => new Promise(done => {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(() => done());
        })
      });
    });
  });
}

function post(base, path, body, headers) {
  return fetch(base + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('响应不是合法 JSON：' + text.slice(0, 200));
  }
}

async function planOnce(app) {
  const response = await post(app.base, '/api/agent/run', {
    task: 'plan',
    payload: { conditions: Object.assign({}, CONDITIONS) }
  });
  const json = await readJson(response);
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.code, 0);
  return json;
}

function fakeChatFetch(content, counter) {
  return async function fakeFetch() {
    if (counter) counter.calls += 1;
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  };
}

/* ------------------------------------------------------------------ */

test('GET /api/health 返回健康信息', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await fetch(app.base + '/api/health');
  const json = await readJson(response);
  assert.equal(response.status, 200);
  assert.equal(json.status, 'ok');
  assert.equal(json.mode, 'mock');
  assert.equal(json.provider, 'mock-rules');
  assert.equal(json.version, '1.0.0');
  assert.equal(typeof json.uptimeMs, 'number');
  assert.ok(json.uptimeMs >= 0);
  assert.ok(!Number.isNaN(Date.parse(json.time)));
});

test('GET /api/config 不泄露密钥', async t => {
  const app = await startServer({
    agentMode: 'remote',
    llm: {
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'fake-test-key-not-real',
      model: 'fake-model'
    }
  });
  t.after(() => app.close());

  const response = await fetch(app.base + '/api/config');
  const text = await response.text();
  const json = JSON.parse(text);
  assert.equal(response.status, 200);
  assert.equal(json.mode, 'remote');
  assert.equal(json.remoteConfigured, true);
  assert.equal(json.mapProvider, 'mock');
  assert.equal(json.telemetryEnabled, true);
  assert.equal(json.version, '1.0.0');
  assert.ok(!text.includes('fake-test-key-not-real'));
  assert.ok(!Object.prototype.hasOwnProperty.call(json, 'llm'));
  assert.ok(!Object.prototype.hasOwnProperty.call(json, 'coze'));
});

test('POST /api/agent/run plan：Mock 返回通过 Schema 的路线', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const json = await planOnce(app);
  assert.equal(json.task, 'plan');
  assert.equal(json.mode, 'mock');
  assert.equal(json.degraded, false);
  assert.equal(json.meta.schemaVersion, 'route.v1');
  assert.equal(json.meta.provider, 'mock-rules');
  assert.equal(typeof json.requestId, 'string');
  assert.equal(typeof json.traceId, 'string');

  const check = schema.validateRoute(json.data);
  assert.equal(check.ok, true, schema.formatErrors(check.errors));
  assert.equal(json.data.source, 'mock');
  assert.ok(json.data.places.length >= 1 && json.data.places.length <= 8);
  assert.equal(json.data.places.length, json.data.segments.length);
});

test('POST /api/agent/run 继承 X-Request-Id / X-Trace-Id', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    task: 'plan',
    payload: { conditions: Object.assign({}, CONDITIONS) }
  }, {
    'X-Request-Id': 'client-request-001',
    'X-Trace-Id': 'client-trace-001'
  });
  const json = await readJson(response);
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.requestId, 'client-request-001');
  assert.equal(json.traceId, 'client-trace-001');
  assert.equal(response.headers.get('x-request-id'), 'client-request-001');
  assert.equal(response.headers.get('x-trace-id'), 'client-trace-001');
});

test('缺 city / duration 时返回 clarification（200），不生成路线', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    task: 'plan',
    payload: { conditions: { interests: ['coffee'] } }
  });
  const json = await readJson(response);
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.code, 0);
  assert.ok(json.data.clarification, '应有 clarification');
  assert.equal(typeof json.data.clarification, 'object');
  assert.ok(Array.isArray(json.data.clarification.missing));
  assert.ok(json.data.clarification.missing.includes('city'));
  assert.ok(json.data.clarification.missing.includes('duration'));
  assert.ok(Array.isArray(json.data.clarification.questions));
  assert.ok(json.data.clarification.questions.length >= 1);
  assert.ok(json.data.conditions);
  assert.equal(json.data.places, undefined);
  assert.equal(json.degraded, false);
});

test('POST /api/agent/run refine：返回通过 Schema 的 RefineResult', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const planned = await planOnce(app);
  const response = await post(app.base, '/api/agent/run', {
    task: 'refine',
    payload: { text: '少走一点路，节奏轻松一点', route: planned.data }
  });
  const json = await readJson(response);
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.code, 0);
  assert.equal(json.task, 'refine');
  assert.equal(json.meta.schemaVersion, 'refine.v1');

  const check = schema.validateRefine(json.data);
  assert.equal(check.ok, true, schema.formatErrors(check.errors));
  assert.equal(typeof json.data.reply, 'string');
  assert.ok(json.data.reply.length > 0);
  assert.equal(typeof json.data.changed, 'boolean');
  assert.ok(Array.isArray(json.data.changes));
  assert.ok(json.data.route);
  assert.equal(schema.validateRoute(json.data.route).ok, true);
});

test('refine 的 route 非法时返回 400 INVALID_INPUT', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    task: 'refine',
    payload: { text: '少走一点路', route: { schemaVersion: 'route.v1' } }
  });
  const json = await readJson(response);
  assert.equal(response.status, 400);
  assert.equal(json.code, 'INVALID_INPUT');
  assert.ok(Array.isArray(json.details));
  assert.ok(json.requestId);
  assert.ok(json.traceId);
});

test('task 非法时返回 400 INVALID_INPUT', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    task: 'unknown-task',
    payload: {}
  });
  const json = await readJson(response);
  assert.equal(response.status, 400);
  assert.equal(json.code, 'INVALID_INPUT');
});

test('未知 /api 路由返回 404 NOT_FOUND', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await fetch(app.base + '/api/does-not-exist');
  const json = await readJson(response);
  assert.equal(response.status, 404);
  assert.equal(json.code, 'NOT_FOUND');
  assert.ok(json.requestId);
});

test('远程输出非法 JSON：fallback=mock 时降级为 Mock 路线', async t => {
  const counter = { calls: 0 };
  const app = await startServer({
    agentMode: 'remote',
    agentFallback: 'mock',
    agentTimeoutMs: 5000,
    fetchImpl: fakeChatFetch('这不是 JSON，也没有地点', counter),
    llm: {
      baseUrl: 'http://fake.local/v1',
      apiKey: 'fake-test-key-not-real',
      model: 'fake-model'
    }
  });
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    task: 'plan',
    payload: { conditions: Object.assign({}, CONDITIONS) }
  });
  const json = await readJson(response);
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.code, 0);
  assert.equal(json.mode, 'remote');
  assert.equal(json.degraded, true);
  assert.equal(json.meta.provider, 'mock-rules');
  assert.equal(json.data.degraded, true);
  assert.equal(typeof json.data.degradeReason, 'string');
  assert.equal(counter.calls, 3, '首次 + 2 次修复');
  assert.equal(schema.validateRoute(json.data).ok, true);
});

test('远程输出非法 JSON：fallback=error 时返回 502 INVALID_OUTPUT', async t => {
  const counter = { calls: 0 };
  const app = await startServer({
    agentMode: 'remote',
    agentFallback: 'error',
    agentTimeoutMs: 5000,
    fetchImpl: fakeChatFetch('{"places": "not-an-array"}', counter),
    llm: {
      baseUrl: 'http://fake.local/v1',
      apiKey: 'fake-test-key-not-real',
      model: 'fake-model'
    }
  });
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    task: 'plan',
    payload: { conditions: Object.assign({}, CONDITIONS) }
  });
  const json = await readJson(response);
  assert.equal(response.status, 502);
  assert.equal(json.code, 'INVALID_OUTPUT');
  assert.equal(counter.calls, 3);
  assert.ok(json.details);
  assert.equal(json.details.attempts, 3);
});

test('远程超时：fallback=error 时返回 504 UPSTREAM_TIMEOUT', async t => {
  const fetchImpl = (url, options) => new Promise((resolve, reject) => {
    const signal = options && options.signal;
    const timer = setTimeout(() => reject(new Error('fake fetch never resolved')), 5000);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    }
  });
  const app = await startServer({
    agentMode: 'remote',
    agentFallback: 'error',
    agentTimeoutMs: 80,
    fetchImpl,
    llm: {
      baseUrl: 'http://fake.local/v1',
      apiKey: 'fake-test-key-not-real',
      model: 'fake-model'
    }
  });
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    task: 'plan',
    payload: { conditions: Object.assign({}, CONDITIONS) }
  });
  const json = await readJson(response);
  assert.equal(response.status, 504);
  assert.equal(json.code, 'UPSTREAM_TIMEOUT');
});

test('远程返回合法 places：服务端重算并标记 mode=remote', async t => {
  const counter = { calls: 0 };
  const app = await startServer({
    agentMode: 'remote',
    agentFallback: 'error',
    agentTimeoutMs: 5000,
    fetchImpl: fakeChatFetch('{"places":["p_yihe","p_xuanwu"]}', counter),
    llm: {
      baseUrl: 'http://fake.local/v1',
      apiKey: 'fake-test-key-not-real',
      model: 'fake-model'
    }
  });
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    task: 'plan',
    payload: { conditions: Object.assign({}, CONDITIONS) }
  });
  const json = await readJson(response);
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.code, 0);
  assert.equal(json.mode, 'remote');
  assert.equal(json.degraded, false);
  assert.equal(json.meta.provider, 'openai-compatible');
  assert.equal(counter.calls, 1);
  assert.equal(json.data.source, 'remote');
  assert.equal(schema.validateRoute(json.data).ok, true);
  assert.deepEqual(json.data.places.slice().sort(), ['p_xuanwu', 'p_yihe']);
});

test('远程模式未配置时返回 503 REMOTE_NOT_CONFIGURED', async t => {
  const app = await startServer({ agentMode: 'remote', agentFallback: 'mock' });
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    task: 'plan',
    payload: { conditions: Object.assign({}, CONDITIONS) }
  });
  const json = await readJson(response);
  assert.equal(response.status, 503);
  assert.equal(json.code, 'REMOTE_NOT_CONFIGURED');
  assert.ok(json.message.includes('LLM_BASE_URL'));
});

test('暂无数据的城市返回 400，不是 500', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    task: 'plan',
    payload: {
      conditions: Object.assign({}, CONDITIONS, { city: 'suzhou' })
    }
  });
  const json = await readJson(response);
  assert.equal(response.status, 400);
  assert.equal(json.code, 'INVALID_INPUT');
  assert.ok(json.message.includes('南京'));
});

test('请求体里的 requestId / traceId 在无头部时被继承', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await post(app.base, '/api/agent/run', {
    requestId: 'body-request-123',
    traceId: 'body-trace-456',
    task: 'plan',
    payload: { conditions: Object.assign({}, CONDITIONS) }
  });
  const json = await readJson(response);
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.requestId, 'body-request-123');
  assert.equal(json.traceId, 'body-trace-456');
  assert.equal(response.headers.get('x-request-id'), 'body-request-123');
  assert.equal(response.headers.get('x-trace-id'), 'body-trace-456');
});

test('Content-Type 带 charset 也接受', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await fetch(app.base + '/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      task: 'plan',
      payload: { conditions: Object.assign({}, CONDITIONS) }
    })
  });
  assert.equal(response.status, 200);
  assert.equal((await readJson(response)).code, 0);
});

test('远程 refine：服务端重算并生成 changes', async t => {
  const mockApp = await startServer();
  t.after(() => mockApp.close());
  const planned = await planOnce(mockApp);
  const firstPlace = planned.data.places[0];

  const counter = { calls: 0 };
  const fake = async function fakeRefineFetch() {
    counter.calls += 1;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                places: [firstPlace],
                reply: '已按你的要求把路线精简为一个地点。',
                bullets: ['路线更短了']
              })
            }
          }]
        };
      }
    };
  };

  const remoteApp = await startServer({
    agentMode: 'remote',
    agentFallback: 'error',
    agentTimeoutMs: 5000,
    fetchImpl: fake,
    llm: {
      baseUrl: 'http://fake.local/v1',
      apiKey: 'fake-test-key-not-real',
      model: 'fake-model'
    }
  });
  t.after(() => remoteApp.close());

  const response = await post(remoteApp.base, '/api/agent/run', {
    task: 'refine',
    payload: { text: '只保留一个地点', route: planned.data }
  });
  const json = await readJson(response);
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.code, 0);
  assert.equal(json.task, 'refine');
  assert.equal(json.mode, 'remote');
  assert.equal(json.degraded, false);
  assert.equal(counter.calls, 1);

  const check = schema.validateRefine(json.data);
  assert.equal(check.ok, true, schema.formatErrors(check.errors));
  assert.equal(json.data.changed, true);
  assert.equal(json.data.reply, '已按你的要求把路线精简为一个地点。');
  assert.deepEqual(json.data.route.places, [firstPlace]);
  assert.ok(json.data.changes.length >= 1);
  assert.ok(Array.isArray(json.data.constraintsAfter));
  assert.equal(schema.validateRoute(json.data.route).ok, true);
});
