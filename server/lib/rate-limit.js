/* =====================================================================
 * rate-limit.js · 进程内固定窗口限流
 * ---------------------------------------------------------------------
 * 按 socket.remoteAddress 计数；窗口默认 60 秒。
 * 无外部存储：进程重启即清零，和本产品「无数据库」的定位一致。
 * ===================================================================== */
'use strict';

/**
 * @param {{limit?: number, windowMs?: number, now?: () => number}} [options]
 */
function createRateLimiter(options) {
  const opts = options || {};
  const limit = Number.isFinite(opts.limit) ? Math.max(0, Math.floor(opts.limit)) : 30;
  const windowMs = Number.isFinite(opts.windowMs) && opts.windowMs > 0 ? Math.floor(opts.windowMs) : 60000;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const buckets = new Map();
  let checks = 0;

  function prune(ts) {
    // 每次检查都做会浪费 CPU；定期清理过期桶，防止长期运行时 Map 增长。
    if (buckets.size < 2000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= ts) buckets.delete(key);
    }
  }

  /**
   * @param {string} key 限流键（本项目中是 socket.remoteAddress）
   * @returns {{allowed: boolean, remaining: number, retryAfterSec: number, resetAt: number}}
   */
  function check(key) {
    const ts = now();
    checks += 1;
    if (checks % 500 === 0) prune(ts);

    if (limit <= 0) {
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSec: 0, resetAt: ts + windowMs };
    }

    const k = String(key || 'unknown');
    let bucket = buckets.get(k);
    if (!bucket || bucket.resetAt <= ts) {
      bucket = { count: 0, resetAt: ts + windowMs };
      buckets.set(k, bucket);
    }
    if (bucket.count >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - ts) / 1000));
      return { allowed: false, remaining: 0, retryAfterSec, resetAt: bucket.resetAt };
    }
    bucket.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSec: 0,
      resetAt: bucket.resetAt
    };
  }

  function reset() {
    buckets.clear();
    checks = 0;
  }

  return {
    check,
    reset,
    get size() {
      return buckets.size;
    },
    limit,
    windowMs
  };
}

module.exports = { createRateLimiter };
