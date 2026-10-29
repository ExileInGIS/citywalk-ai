/* =====================================================================
 * tests/api/security.test.js · HTTP 安全边界测试
 * ---------------------------------------------------------------------
 * 覆盖：安全响应头、请求体上限、Content-Type、限流、路径穿越、
 *       未知 API、CORS 白名单、事件接口开关与白名单。
 * 运行：node --test tests/api
 * ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../../server/index.js');

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://webapi.amap.com https://*.amap.com https://unpkg.com; "
  + "style-src 'self' 'unsafe-inline' https://webapi.amap.com https://*.amap.com https://unpkg.com; "
  + "img-src 'self' data: https:; connect-src 'self' https://restapi.amap.com https://*.amap.com https://*.autonavi.com; "
  + "worker-src 'self' blob:; font-src 'self' https://webapi.amap.com; "
  + "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

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
  const server = createApp({ config });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        base: 'http://127.0.0.1:' + server.address().port,
        close: () => new Promise(done => {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(() => done());
        })
      });
    });
  });
}

function rawRequest(port, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: opts.method || 'GET',
      path: opts.path || '/',
      headers: opts.headers || {}
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
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

const CONDITIONS = {
  city: 'nanjing',
  durationMin: 240,
  startTime: '14:00',
  interests: ['coffee', 'history'],
  budgetMax: 200,
  pace: 'mid',
  transport: 'walk'
};

/* ------------------------------------------------------------------ */

test('安全响应头：CSP / nosniff / Referrer-Policy / Permissions-Policy / X-Frame-Options', async t => {
  const app = await startServer();
  t.after(() => app.close());

  for (const path of ['/api/health', '/', '/css/style.css']) {
    const response = await fetch(app.base + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-security-policy'), CSP, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', path);
    assert.ok(response.headers.get('permissions-policy'), path);
    assert.equal(response.headers.get('x-frame-options'), 'DENY', path);
  }
});

test('请求体超过 64KB 返回 413', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const body = JSON.stringify({
    task: 'plan',
    payload: {
      conditions: Object.assign({}, CONDITIONS, { padding: 'x'.repeat(70 * 1024) })
    }
  });
  const response = await post(app.base, '/api/agent/run', body);
  const json = await readJson(response);
  assert.equal(response.status, 413);
  assert.equal(json.code, 'INVALID_INPUT');
  assert.equal(response.headers.get('content-security-policy'), CSP);
});

test('非 application/json 的 Content-Type 返回 415', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await fetch(app.base + '/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{"task":"plan","payload":{"conditions":{}}}'
  });
  const json = await readJson(response);
  assert.equal(response.status, 415);
  assert.equal(json.code, 'INVALID_INPUT');
  assert.equal(response.headers.get('content-security-policy'), CSP);
});

test('限流：超过每分钟阈值返回 429 + Retry-After', async t => {
  const app = await startServer({ rateLimitPerMin: 2 });
  t.after(() => app.close());

  const body = { task: 'plan', payload: { conditions: Object.assign({}, CONDITIONS) } };
  const first = await post(app.base, '/api/agent/run', body);
  const second = await post(app.base, '/api/agent/run', body);
  const third = await post(app.base, '/api/agent/run', body);

  assert.notEqual(first.status, 429);
  assert.notEqual(second.status, 429);
  assert.equal(third.status, 429);
  const json = await readJson(third);
  assert.equal(json.code, 'RATE_LIMITED');
  assert.equal(third.headers.get('x-ratelimit-remaining'), '0');
  const retryAfter = Number(third.headers.get('retry-after'));
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1);
});

test('路径穿越与受限目录一律 404', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const paths = [
    '/../package.json',
    '/%2e%2e/package.json',
    '/js/%2e%2e/%2e%2e/package.json',
    '/js/../server/index.js',
    '/server/index.js',
    '/tests/api/security.test.js',
    '/.env',
    '/js/.hidden.js',
    '/css/../../package.json'
  ];
  for (const path of paths) {
    const response = await rawRequest(app.port, { path });
    assert.equal(response.status, 404, path);
    assert.ok(!response.body.includes('citywalk-ai'), path);
    assert.ok(!response.body.includes('sk-'), path);
  }
});

test('未知 /api 路由返回 404 JSON', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await fetch(app.base + '/api/not-a-real-route');
  const json = await readJson(response);
  assert.equal(response.status, 404);
  assert.equal(json.code, 'NOT_FOUND');
});

test('CORS：默认不发跨域头，白名单精确匹配', async t => {
  const plain = await startServer();
  t.after(() => plain.close());
  const noCors = await fetch(plain.base + '/api/health');
  assert.equal(noCors.headers.get('access-control-allow-origin'), null);

  const corsApp = await startServer({ corsOrigins: ['https://allowed.example'] });
  t.after(() => corsApp.close());

  const allowed = await rawRequest(corsApp.port, {
    path: '/api/health',
    headers: { Origin: 'https://allowed.example' }
  });
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://allowed.example');
  assert.ok(String(allowed.headers.vary || '').includes('Origin'));

  const denied = await rawRequest(corsApp.port, {
    path: '/api/health',
    headers: { Origin: 'https://evil.example' }
  });
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('事件接口关闭时返回 404', async t => {
  const app = await startServer({ telemetryEnabled: false });
  t.after(() => app.close());

  const response = await post(app.base, '/api/events', {
    events: [{ event: 'plan_started' }]
  });
  const json = await readJson(response);
  assert.equal(response.status, 404);
  assert.equal(json.code, 'NOT_FOUND');
});

test('事件接口只接受白名单事件名，返回 202', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await post(app.base, '/api/events', {
    events: [
      { event: 'plan_started', sessionId: 'should-not-be-logged' },
      { event: 'plan_succeeded', placeCount: 4 },
      { event: 'evil_event_name', text: 'should be ignored' }
    ]
  });
  const json = await readJson(response);
  assert.equal(response.status, 202);
  assert.equal(json.code, 0);
  assert.equal(json.accepted, 2);
  assert.ok(json.requestId);
  assert.ok(json.traceId);
});

test('事件请求体超过 32KB 返回 413', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const payload = JSON.stringify({
    events: [{ event: 'plan_started', padding: 'x'.repeat(33 * 1024) }]
  });
  const response = await post(app.base, '/api/events', payload);
  assert.equal(response.status, 413);
});

test('静态资源白名单：允许 css/js/shared/assets，拒绝其它目录', async t => {
  const app = await startServer();
  t.after(() => app.close());

  const css = await fetch(app.base + '/css/style.css');
  assert.equal(css.status, 200);
  assert.ok(String(css.headers.get('content-type')).startsWith('text/css'));

  const shared = await fetch(app.base + '/shared/core.js');
  assert.equal(shared.status, 200);

  const js = await fetch(app.base + '/js/schema.js');
  assert.equal(js.status, 200);
  assert.ok(String(js.headers.get('content-type')).startsWith('text/javascript'));

  const index = await fetch(app.base + '/');
  assert.equal(index.status, 200);
  assert.ok(String(index.headers.get('content-type')).startsWith('text/html'));

  const missing = await fetch(app.base + '/css/not-exist.css');
  assert.equal(missing.status, 404);
});
