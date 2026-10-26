/* =====================================================================
 * http.js · HTTP 小工具：错误、响应、请求体、CORS、安全头
 * ---------------------------------------------------------------------
 * 只依赖 Node 内置模块。index.js 负责路由，这里只放可复用、可单测的零件。
 * ===================================================================== */
'use strict';

/** 应用错误码 → HTTP 状态码。 */
const STATUS_BY_CODE = Object.freeze({
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  INVALID_OUTPUT: 502,
  REMOTE_NOT_CONFIGURED: 503,
  INTERNAL: 500
});

/**
 * 可安全返回给客户端的错误。details 只放结构化、无敏感内容的数据。
 */
class ApiError extends Error {
  /**
   * @param {keyof STATUS_BY_CODE | string} code
   * @param {string} message
   * @param {{status?: number, details?: unknown, retryAfterSec?: number, cause?: Error}} [options]
   */
  constructor(code, message, options) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = (options && options.status) || STATUS_BY_CODE[code] || 500;
    this.details = options ? options.details : undefined;
    this.retryAfterSec = options ? options.retryAfterSec : undefined;
    if (options && options.cause) this.cause = options.cause;
  }
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ');

/** 所有响应都带的浏览器安全头。 */
function applySecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-Frame-Options', 'DENY');
}

/**
 * CORS：未配置来源时不发任何跨域头；配置后精确匹配 Origin 并带 Vary。
 * @returns {{configured: boolean, allowed: boolean, origin: string|null}}
 */
function applyCors(req, res, origins) {
  const list = Array.isArray(origins) ? origins : [];
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
  if (!list.length) return { configured: false, allowed: false, origin: null };
  res.setHeader('Vary', 'Origin');
  if (origin && list.indexOf(origin) >= 0) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    return { configured: true, allowed: true, origin };
  }
  return { configured: true, allowed: false, origin: null };
}

function applyPreflightHeaders(res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id, X-Trace-Id');
  res.setHeader('Access-Control-Max-Age', '600');
}

function isJsonRequest(req) {
  const ct = req.headers['content-type'];
  if (Array.isArray(ct)) return ct.some(v => /^application\/json\b/i.test(String(v).trim()));
  return typeof ct === 'string' && /^application\/json\b/i.test(ct.trim());
}

function contentLength(req) {
  const raw = req.headers['content-length'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * 读取请求体，超过 limit 立即失败（413）并继续排空连接，避免客户端挂住。
 * @returns {Promise<Buffer>}
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let settled = false;
    const chunks = [];

    function cleanup() {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
    }

    function finish(err, buf) {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) {
        try { req.resume(); } catch (_) { /* ignore */ }
        reject(err);
      } else {
        resolve(buf);
      }
    }

    function onData(chunk) {
      total += chunk.length;
      if (total > limit) {
        finish(new ApiError('INVALID_INPUT', '请求体超过大小限制', { status: 413 }));
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      finish(null, Buffer.concat(chunks, total));
    }

    function onError(err) {
      finish(new ApiError('INVALID_INPUT', '读取请求体失败', { status: 400, cause: err }));
    }

    function onAborted() {
      finish(new ApiError('INVALID_INPUT', '请求被中断', { status: 400 }));
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

function parseJsonBuffer(buf) {
  if (!buf || buf.length === 0) {
    throw new ApiError('INVALID_INPUT', '请求体不能为空');
  }
  let text;
  try {
    text = buf.toString('utf8');
  } catch (err) {
    throw new ApiError('INVALID_INPUT', '请求体不是合法 UTF-8', { cause: err });
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    // 不把解析器原文（可能带输入片段）返回给客户端。
    throw new ApiError('INVALID_INPUT', '请求体不是合法 JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_INPUT', '请求体必须是 JSON 对象');
  }
  return body;
}

/**
 * 校验 Content-Type 后读取并解析 JSON。
 * @returns {Promise<object>}
 */
async function readJsonBody(req, limit) {
  if (!isJsonRequest(req)) {
    throw new ApiError('INVALID_INPUT', 'Content-Type 必须是 application/json', { status: 415 });
  }
  const buffer = await readBody(req, limit);
  return parseJsonBuffer(buffer);
}

function sendJson(res, status, payload, headers) {
  if (res.writableEnded || res.destroyed) return;
  let text;
  try {
    text = JSON.stringify(payload);
  } catch (_) {
    status = 500;
    text = JSON.stringify({
      code: 'INTERNAL',
      message: '响应序列化失败',
      requestId: payload && payload.requestId,
      traceId: payload && payload.traceId
    });
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  if (headers) {
    Object.keys(headers).forEach(name => res.setHeader(name, headers[name]));
  }
  res.end(text);
}

function sendText(res, status, text) {
  if (res.writableEnded || res.destroyed) return;
  const body = String(text == null ? '' : text);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function sendEmpty(res, status) {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.end();
}

/** socket 地址就是限流键；不信任 X-Forwarded-For。 */
function clientKey(req) {
  const socket = req.socket || req.connection;
  return (socket && socket.remoteAddress) || 'unknown';
}

module.exports = {
  STATUS_BY_CODE,
  CSP,
  ApiError,
  applySecurityHeaders,
  applyCors,
  applyPreflightHeaders,
  isJsonRequest,
  contentLength,
  readBody,
  parseJsonBuffer,
  readJsonBody,
  sendJson,
  sendText,
  sendEmpty,
  clientKey
};
