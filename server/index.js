/* =====================================================================
 * index.js · CityWalk AI HTTP 服务入口
 * ---------------------------------------------------------------------
 * 路由：
 *   POST /api/agent/run   Agent 规划 / 调整
 *   GET  /api/health      健康检查
 *   GET  /api/config      浏览器可见的非敏感配置
 *   POST /api/events      匿名事件上报（可关闭）
 *   静态资源：/、/index.html、/css/*、/js/*、/shared/*、/assets/*
 *
 * 安全：CSP、安全响应头、CORS 白名单、请求体上限、按 IP 限流、
 *       脱敏 JSON 行日志、隐藏堆栈。所有数字由 shared/core.js 计算。
 * ===================================================================== */
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const { loadConfig, resolveConfig, publicConfig } = require('./config');
const { createLogger } = require('./lib/logger');
const ids = require('./lib/ids');
const {
  ApiError,
  applySecurityHeaders,
  applyCors,
  applyPreflightHeaders,
  isJsonRequest,
  contentLength,
  readJsonBody,
  sendJson,
  sendText,
  clientKey
} = require('./lib/http');
const { createRateLimiter } = require('./lib/rate-limit');
const {
  EVENT_WHITELIST,
  validateAgentRequest,
  validateEventsBody,
  detectInjection,
  collectUserText
} = require('./lib/validate');
const { serveStatic } = require('./lib/static');
const { runAgent } = require('./agent/run');

const AGENT_BODY_LIMIT = 64 * 1024;
const EVENTS_BODY_LIMIT = 32 * 1024;
const RATE_WINDOW_MS = 60 * 1000;

function providerLabel(config) {
  if (config.agentMode === 'mock') return 'mock-rules';
  return config.remoteProvider || 'unconfigured';
}

function requestPath(req) {
  const raw = req && req.url ? String(req.url) : '/';
  try {
    return new URL(raw, 'http://localhost').pathname.slice(0, 200);
  } catch (_) {
    return raw.split('?')[0].slice(0, 200);
  }
}

/* 常量时间比较，避免用字符串 === 比较密码时泄露长度/内容。 */
function safeEqualText(a, b) {
  const left = Buffer.from(String(a == null ? '' : a), 'utf8');
  const right = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch (_) {
    return false;
  }
}

function readBasicAuth(req) {
  const header = req && req.headers && req.headers.authorization;
  if (typeof header !== 'string' || !/^Basic\s+/i.test(header)) return null;
  let decoded;
  try {
    decoded = Buffer.from(header.replace(/^Basic\s+/i, '').trim(), 'base64').toString('utf8');
  } catch (_) {
    return null;
  }
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

function hasSiteAccess(req, config) {
  if (!config.sitePassword) return true;
  const credentials = readBasicAuth(req);
  if (!credentials) return false;
  const userOk = safeEqualText(credentials.user, config.siteUser);
  const passwordOk = safeEqualText(credentials.password, config.sitePassword);
  return userOk && passwordOk;
}

function applyIdHeaders(ctx) {
  ctx.res.setHeader('X-Request-Id', ctx.requestId);
  ctx.res.setHeader('X-Trace-Id', ctx.traceId);
}

function normalizeError(err) {
  if (err instanceof ApiError) return err;
  return new ApiError('INTERNAL', '服务内部错误', { cause: err });
}

function publicMessage(apiErr, config) {
  if (config.nodeEnv === 'production' && apiErr.code === 'INTERNAL') return '服务内部错误';
  return apiErr.message;
}

function publicDetails(apiErr, config) {
  if (config.nodeEnv === 'production' && apiErr.code === 'INTERNAL') return undefined;
  return apiErr.details;
}

/**
 * 创建 HTTP Server（不 listen）。测试可直接 server.listen(0)。
 * @param {{config?: object, fetchImpl?: Function, now?: () => number, logger?: object}} [options]
 * @returns {import('node:http').Server & {config: object, logger: object, handler: Function}}
 */
function createApp(options) {
  const opts = options || {};
  const config = opts.config ? resolveConfig(opts.config) : loadConfig(process.env);
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const fetchImpl = opts.fetchImpl
    || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
  const logger = opts.logger || createLogger({ level: config.logLevel, now });
  const appStartedAt = now();
  const limiter = createRateLimiter({ limit: config.rateLimitPerMin, windowMs: RATE_WINDOW_MS, now });
  const eventCounts = Object.create(null);
  let eventTotal = 0;

  function logRequest(ctx, startedAt) {
    const status = ctx.res.statusCode || 200;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    const fields = {
      requestId: ctx.requestId,
      traceId: ctx.traceId,
      method: ctx.req.method,
      path: requestPath(ctx.req),
      status,
      durationMs: Math.max(0, Math.round(now() - startedAt)),
      errorCode: ctx.errorCode || null
    };
    if (ctx.logExtra) Object.assign(fields, ctx.logExtra);
    logger.log(level, fields);
  }

  async function respondError(ctx, err) {
    const apiErr = normalizeError(err);
    ctx.errorCode = apiErr.code;
    if (apiErr.retryAfterSec) ctx.res.setHeader('Retry-After', String(apiErr.retryAfterSec));
    applyIdHeaders(ctx);

    if (ctx.res.headersSent || ctx.res.writableEnded || ctx.res.destroyed) {
      if (!ctx.res.writableEnded && !ctx.res.destroyed) ctx.res.destroy();
      return;
    }

    const body = {
      code: apiErr.code,
      message: publicMessage(apiErr, config),
      requestId: ctx.requestId,
      traceId: ctx.traceId
    };
    const details = publicDetails(apiErr, config);
    if (details !== undefined) body.details = details;

    sendJson(ctx.res, apiErr.status || 500, body);

    if ((apiErr.status || 500) >= 500) {
      const cause = apiErr.cause;
      logger.error({
        event: 'request_internal_error',
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        errName: (cause && cause.name) || apiErr.name,
        errMessage: apiErr.message,
        stack: (cause && cause.stack) || apiErr.stack
      });
    }

    // 请求体可能还没读完；排空，避免连接挂住。
    if (!ctx.req.readableEnded) {
      try { ctx.req.resume(); } catch (_) { /* ignore */ }
    }
  }

  function applyRateLimit(ctx) {
    const result = limiter.check(clientKey(ctx.req));
    if (config.rateLimitPerMin > 0) {
      ctx.res.setHeader('X-RateLimit-Limit', String(config.rateLimitPerMin));
      ctx.res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    }
    if (!result.allowed) {
      throw new ApiError('RATE_LIMITED', '请求过于频繁，请稍后再试', {
        retryAfterSec: result.retryAfterSec
      });
    }
    return result;
  }

  function inheritIdsFromBody(ctx, body) {
    const headerRequestId = ids.pickIncomingId(ctx.req.headers['x-request-id']);
    const headerTraceId = ids.pickIncomingId(ctx.req.headers['x-trace-id']);
    if (!headerRequestId && ids.isValidId(body.requestId)) {
      ctx.requestId = body.requestId.trim();
    }
    if (!headerTraceId && ids.isValidId(body.traceId)) {
      ctx.traceId = body.traceId.trim();
    }
    applyIdHeaders(ctx);
  }

  async function handleHealth(ctx) {
    if (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD') {
      throw new ApiError('NOT_FOUND', '未知接口');
    }
    const payload = {
      status: 'ok',
      version: config.version,
      mode: config.agentMode,
      provider: providerLabel(config),
      uptimeMs: Math.max(0, Math.round(now() - appStartedAt)),
      time: new Date(now()).toISOString()
    };
    ctx.res.setHeader('Cache-Control', 'no-store');
    if (ctx.req.method === 'HEAD') {
      ctx.res.statusCode = 200;
      ctx.res.end();
      return;
    }
    sendJson(ctx.res, 200, payload);
  }

  async function handleConfig(ctx) {
    if (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD') {
      throw new ApiError('NOT_FOUND', '未知接口');
    }
    const payload = publicConfig(config);
    ctx.res.setHeader('Cache-Control', 'no-store');
    if (ctx.req.method === 'HEAD') {
      ctx.res.statusCode = 200;
      ctx.res.end();
      return;
    }
    sendJson(ctx.res, 200, payload);
  }

  async function handleAgentRun(ctx) {
    if (ctx.req.method !== 'POST') throw new ApiError('NOT_FOUND', '未知接口');
    applyRateLimit(ctx);

    if (!isJsonRequest(ctx.req)) {
      throw new ApiError('INVALID_INPUT', 'Content-Type 必须是 application/json', { status: 415 });
    }
    const declared = contentLength(ctx.req);
    if (declared !== null && declared > AGENT_BODY_LIMIT) {
      throw new ApiError('INVALID_INPUT', '请求体超过 64KB 限制', { status: 413 });
    }

    const body = await readJsonBody(ctx.req, AGENT_BODY_LIMIT);
    inheritIdsFromBody(ctx, body);

    const request = validateAgentRequest(body);
    const injectionSuspected = detectInjection(collectUserText(request.task, request.payload));

    const result = await runAgent({
      task: request.task,
      payload: request.payload,
      config,
      fetchImpl,
      now
    });

    const envelope = {
      code: 0,
      requestId: ctx.requestId,
      traceId: ctx.traceId,
      task: request.task,
      mode: result.mode,
      degraded: !!result.degraded,
      data: result.data,
      meta: {
        durationMs: result.durationMs,
        provider: result.provider,
        schemaVersion: result.schemaVersion
      }
    };

    let placeCount = null;
    if (request.task === 'plan') {
      placeCount = result.data && Array.isArray(result.data.places) ? result.data.places.length : null;
    } else {
      placeCount = result.data && result.data.route && Array.isArray(result.data.route.places)
        ? result.data.route.places.length
        : null;
    }

    ctx.logExtra = {
      task: request.task,
      mode: result.mode,
      degraded: !!result.degraded,
      provider: result.provider,
      schemaOk: true,
      placeCount,
      attempts: result.attempts,
      injectionSuspected
    };

    ctx.res.setHeader('Cache-Control', 'no-store');
    sendJson(ctx.res, 200, envelope);
  }

  async function handleEvents(ctx) {
    if (!config.telemetryEnabled) throw new ApiError('NOT_FOUND', '未开启事件上报');
    if (ctx.req.method !== 'POST') throw new ApiError('NOT_FOUND', '未知接口');
    applyRateLimit(ctx);

    if (!isJsonRequest(ctx.req)) {
      throw new ApiError('INVALID_INPUT', 'Content-Type 必须是 application/json', { status: 415 });
    }
    const declared = contentLength(ctx.req);
    if (declared !== null && declared > EVENTS_BODY_LIMIT) {
      throw new ApiError('INVALID_INPUT', '请求体超过 32KB 限制', { status: 413 });
    }

    const body = await readJsonBody(ctx.req, EVENTS_BODY_LIMIT);
    inheritIdsFromBody(ctx, body);

    const summary = validateEventsBody(body);
    eventTotal += summary.accepted;
    Object.keys(summary.counts).forEach(name => {
      if (!EVENT_WHITELIST.has(name)) return;
      eventCounts[name] = (eventCounts[name] || 0) + summary.counts[name];
    });

    // 只记事件名与数量，不记 sessionId / routeId / 任何自由文本。
    logger.info({
      requestId: ctx.requestId,
      traceId: ctx.traceId,
      event: 'events_received',
      eventCount: summary.accepted,
      ignored: summary.ignored,
      events: summary.counts
    });
    ctx.logExtra = {
      eventCount: summary.accepted,
      ignored: summary.ignored
    };

    ctx.res.setHeader('Cache-Control', 'no-store');
    sendJson(ctx.res, 202, {
      code: 0,
      requestId: ctx.requestId,
      traceId: ctx.traceId,
      accepted: summary.accepted
    });
  }

  async function handle(req, res) {
    const startedAt = now();
    const ctx = {
      req,
      res,
      requestId: ids.pickIncomingId(req.headers['x-request-id']) || ids.newRequestId(),
      traceId: ids.pickIncomingId(req.headers['x-trace-id']) || ids.newTraceId(),
      errorCode: null,
      logExtra: null
    };

    applySecurityHeaders(res);
    const cors = applyCors(req, res, config.corsOrigins);
    applyIdHeaders(ctx);

    try {
      if (req.method === 'OPTIONS') {
        if (cors.allowed) applyPreflightHeaders(res);
        res.statusCode = 204;
        res.end();
        return;
      }

      let url;
      try {
        url = new URL(req.url || '/', 'http://localhost');
      } catch (_) {
        throw new ApiError('INVALID_INPUT', '非法请求路径', { status: 400 });
      }
      const pathname = url.pathname;

      /* 全站访问密码：健康检查保持公开，供 Render/负载均衡探活。 */
      if (pathname !== '/api/health' && !hasSiteAccess(req, config)) {
        ctx.errorCode = 'AUTH_REQUIRED';
        res.setHeader('WWW-Authenticate', 'Basic realm="CityWalk AI", charset="UTF-8"');
        res.setHeader('Cache-Control', 'no-store');
        if (pathname === '/api' || pathname.startsWith('/api/')) {
          sendJson(res, 401, {
            code: 'UNAUTHORIZED',
            message: '需要访问密码',
            requestId: ctx.requestId,
            traceId: ctx.traceId
          });
        } else {
          sendText(res, 401, '需要访问密码');
        }
        return;
      }

      if (pathname === '/api/health') {
        await handleHealth(ctx);
      } else if (pathname === '/api/config') {
        await handleConfig(ctx);
      } else if (pathname === '/api/agent/run') {
        await handleAgentRun(ctx);
      } else if (pathname === '/api/events') {
        await handleEvents(ctx);
      } else if (pathname === '/api' || pathname.startsWith('/api/')) {
        throw new ApiError('NOT_FOUND', '未知接口');
      } else if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method Not Allowed');
      } else {
        await serveStatic(req, res, { root: config.staticRoot, pathname });
      }
    } catch (err) {
      await respondError(ctx, err);
    } finally {
      logRequest(ctx, startedAt);
    }
  }

  async function handleSafely(req, res) {
    try {
      await handle(req, res);
    } catch (err) {
      // handle 内部已有 try/catch；这里只兜底，保证进程不被单个请求拖垮。
      try {
        logger.error({
          event: 'unhandled_request_error',
          errName: err && err.name,
          errMessage: err && err.message
        });
        if (!res.headersSent) {
          sendJson(res, 500, { code: 'INTERNAL', message: '服务内部错误', requestId: null, traceId: null });
        } else if (!res.writableEnded) {
          res.destroy();
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  const server = http.createServer((req, res) => {
    handleSafely(req, res);
  });
  // 防止慢客户端无限占用连接；远程调用另有 AGENT_TIMEOUT_MS 预算。
  server.requestTimeout = 30000;
  server.headersTimeout = 20000;
  server.keepAliveTimeout = 5000;
  server.handler = handleSafely;
  server.config = config;
  server.logger = logger;
  server.limiter = limiter;
  server.eventStats = () => ({ total: eventTotal, counts: Object.assign({}, eventCounts) });
  return server;
}

/**
 * 启动服务（listen + 优雅退出）。直接运行 server/index.js 时自动调用。
 * @param {{config?: object, fetchImpl?: Function, now?: () => number, logger?: object, port?: number}} [options]
 */
function start(options) {
  const opts = options || {};
  const config = opts.config ? resolveConfig(opts.config) : loadConfig(process.env);
  if (opts.port !== undefined) {
    config.port = resolveConfig({ port: opts.port }).port;
  }
  const server = createApp(Object.assign({}, opts, { config }));
  const logger = server.logger;
  const provider = providerLabel(config);

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'server_shutdown', signal });
    server.close(() => {
      logger.info({ event: 'server_stopped' });
      process.exit(0);
    });
    const force = setTimeout(() => {
      logger.warn({ event: 'server_shutdown_timeout' });
      process.exit(0);
    }, 10000);
    if (typeof force.unref === 'function') force.unref();
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  server.on('error', err => {
    logger.error({
      event: 'server_error',
      errName: err && err.name,
      errMessage: err && err.message
    });
    if (err && err.code === 'EADDRINUSE') process.exitCode = 1;
  });

  server.listen(config.port, () => {
    const address = server.address();
    logger.info({
      event: 'server_started',
      port: address && typeof address === 'object' ? address.port : config.port,
      mode: config.agentMode,
      provider,
      version: config.version
    });
  });

  return server;
}

if (require.main === module) {
  start();
}

module.exports = {
  createApp,
  start,
  providerLabel
};
