/* =====================================================================
 * logger.js · JSON 行结构化日志（脱敏白名单）
 * ---------------------------------------------------------------------
 * 只输出白名单字段，从机制上避免把用户原文、条件、预算、IP 等写进日志。
 * 一行一个 JSON 对象，方便本地排查与后续采集。
 * ===================================================================== */
'use strict';

const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
});

/**
 * 允许落日志的字段。任何不在这个集合里的字段都会被丢弃——
 * 这是「不记录 body / 条件 / 文本 / IP」的强制实现，而不是口头约定。
 */
const ALLOWED_FIELDS = new Set([
  'event',
  'requestId',
  'traceId',
  'method',
  'path',
  'status',
  'durationMs',
  'errorCode',
  'task',
  'mode',
  'degraded',
  'provider',
  'schemaOk',
  'placeCount',
  'attempts',
  'injectionSuspected',
  'eventCount',
  'ignored',
  'accepted',
  'events',
  'port',
  'version',
  'message',
  'signal',
  'errName',
  'errMessage',
  'stack',
  'uptimeMs',
  'pid'
]);

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

function normalizeLevel(value) {
  return Object.prototype.hasOwnProperty.call(LEVELS, value) ? value : 'info';
}

function sanitizeEvents(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {};
  Object.keys(value).forEach(key => {
    if (!EVENT_NAME_PATTERN.test(key)) return;
    const n = value[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[key] = Math.floor(n);
  });
  return out;
}

/**
 * @param {{level?: string, sink?: (line: string) => void, now?: () => number}} [options]
 */
function createLogger(options) {
  const opts = options || {};
  const threshold = LEVELS[normalizeLevel(opts.level || 'info')];
  const sink = typeof opts.sink === 'function'
    ? opts.sink
    : line => process.stdout.write(line + '\n');
  const now = typeof opts.now === 'function' ? opts.now : Date.now;

  function log(levelName, fields) {
    const level = normalizeLevel(levelName);
    if (LEVELS[level] < threshold || level === 'silent') return;
    const line = {
      ts: new Date(now()).toISOString(),
      level
    };
    const src = fields && typeof fields === 'object' ? fields : {};
    Object.keys(src).forEach(key => {
      if (!ALLOWED_FIELDS.has(key)) return;
      if (key === 'events') {
        const events = sanitizeEvents(src.events);
        if (events) line.events = events;
        return;
      }
      const v = src[key];
      if (v === undefined) return;
      if (v === null) {
        line[key] = null;
        return;
      }
      const t = typeof v;
      if (t === 'string') {
        // 日志字段单值限长，避免异常堆栈/消息无限膨胀。
        line[key] = v.length > 1200 ? v.slice(0, 1200) : v;
      } else if (t === 'number' || t === 'boolean') {
        line[key] = v;
      }
    });
    let text;
    try {
      text = JSON.stringify(line);
    } catch (_) {
      text = JSON.stringify({ ts: line.ts, level, event: 'log_serialize_failed' });
    }
    try {
      sink(text);
    } catch (_) {
      /* 日志失败不能影响请求处理 */
    }
  }

  return {
    level: normalizeLevel(opts.level || 'info'),
    log,
    debug: (fields) => log('debug', fields),
    info: (fields) => log('info', fields),
    warn: (fields) => log('warn', fields),
    error: (fields) => log('error', fields),
    isEnabled: (levelName) => LEVELS[normalizeLevel(levelName)] >= threshold
  };
}

module.exports = { createLogger, LEVELS, ALLOWED_FIELDS };
