/* =====================================================================
 * telemetry.js · 匿名事件队列（默认开启，可关闭）
 * ---------------------------------------------------------------------
 * 只接受 docs/PRODUCT-METRICS.md 第 2.2 节白名单里的事件名。
 * 属性也走白名单：free text、conditions、预算、同行人、坐标、IP 一律丢弃。
 *
 * 用法：
 *   CW.telemetry.track('plan_succeeded', { task:'plan', durationMs: 42, placeCount: 5 });
 *   CW.telemetry.flush();          // 批量 POST，keepalive:true，失败静默重试 1 次
 *   CW.telemetry.setEnabled(false) // 关闭并清空队列
 *
 * 上报体：{ events: [...] }；单批最多 50 条（与 POST /api/events 限制一致）。
 * 队列最多 100 条，满了丢最旧的。
 * ===================================================================== */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const CW = (root.CW = root.CW || {});

  const MAX_QUEUE = 100;
  const BATCH_SIZE = 50;

  /* 事件白名单：与文档 2.2 节逐项对应，新增事件先改文档 */
  const EVENT_PROPS = {
    plan_started: ['task', 'mode'],
    clarify_shown: ['missingCount'],
    clarify_answered: ['answeredCount', 'skippedCount'],
    plan_succeeded: ['placeCount', 'durationMs', 'degraded'],
    plan_failed: ['errorCode', 'durationMs'],
    refine_started: ['mode'],
    refine_succeeded: ['changed', 'changesCount', 'durationMs'],
    refine_failed: ['errorCode'],
    conflict_shown: ['conflictType'],
    conflict_option_clicked: ['conflictType', 'optionId'],
    route_saved: ['source'],
    route_exported: ['format'],
    route_copied: [],
    agent_degraded: ['reasonCode'],
    map_failed: ['provider', 'reasonCode'],
    retry_clicked: ['context']
  };

  const COMMON_PROPS = ['routeId', 'task', 'mode', 'durationMs', 'errorCode', 'degraded', 'appVersion'];
  const NUMBER_PROPS = ['durationMs', 'placeCount', 'missingCount', 'answeredCount', 'skippedCount', 'changesCount'];
  const BOOLEAN_PROPS = ['changed', 'degraded'];
  const STRING_PROPS = ['routeId', 'errorCode', 'conflictType', 'optionId', 'source', 'format', 'reasonCode', 'provider', 'context', 'task', 'mode', 'appVersion'];

  let enabled = readEnabled();
  let queue = [];
  let flushing = null;
  let ephemeralSessionId = null;

  function readConfig() {
    return (root.CW_CONFIG && (root.CW_CONFIG.TELEMETRY || root.CW_CONFIG.telemetry)) || {};
  }

  function readEnabled() {
    return readConfig().enabled !== false;
  }

  function endpoint() {
    const value = readConfig().endpoint;
    return typeof value === 'string' ? value : '';
  }

  function appVersion() {
    const app = (root.CW_CONFIG && (root.CW_CONFIG.APP || root.CW_CONFIG.app)) || {};
    const version = app.version;
    return (typeof version === 'string' && /^[0-9A-Za-z._-]{1,40}$/.test(version)) ? version : '1.0.0';
  }

  function agentMode() {
    const agent = (root.CW_CONFIG && (root.CW_CONFIG.AGENT || root.CW_CONFIG.agent)) || {};
    return agent.mode === 'remote' ? 'remote' : 'mock';
  }

  function sessionId() {
    try {
      if (CW.storage && typeof CW.storage.sessionId === 'function') {
        const id = CW.storage.sessionId();
        if (typeof id === 'string' && id) return id.slice(0, 80);
      }
    } catch (e) { /* 存储不可用时退回内存 id */ }
    if (!ephemeralSessionId) {
      try {
        if (root.crypto && typeof root.crypto.randomUUID === 'function') {
          ephemeralSessionId = root.crypto.randomUUID();
        }
      } catch (e) { /* 忽略 */ }
      if (!ephemeralSessionId) {
        ephemeralSessionId = 'cw-session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      }
    }
    return ephemeralSessionId;
  }

  function safeCode(value, maxLen) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > (maxLen || 80)) return null;
    // 只允许机器可读的枚举/短码，避免把用户原文当错误码写出去
    if (!/^[A-Za-z0-9_.:-]+$/.test(text)) return null;
    return text;
  }

  function safeNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 10000000) return null;
    return Math.round(n);
  }

  function sanitizeProp(key, value) {
    if (NUMBER_PROPS.indexOf(key) >= 0) return safeNumber(value);
    if (BOOLEAN_PROPS.indexOf(key) >= 0) return typeof value === 'boolean' ? value : null;
    if (STRING_PROPS.indexOf(key) >= 0) {
      if (key === 'mode') return (value === 'mock' || value === 'remote') ? value : null;
      if (key === 'task') return (value === 'plan' || value === 'refine') ? value : null;
      if (key === 'routeId') return safeCode(value, 120);
      return safeCode(value, 80);
    }
    return null;
  }

  function buildEvent(event, props) {
    const src = (props && typeof props === 'object' && !Array.isArray(props)) ? props : {};
    const record = {
      event: event,
      ts: new Date().toISOString(),
      sessionId: sessionId(),
      appVersion: appVersion(),
      mode: agentMode()
    };

    const allowed = COMMON_PROPS.concat(EVENT_PROPS[event] || []);
    const seen = {};
    allowed.forEach(key => {
      if (seen[key]) return;
      seen[key] = true;
      if (!Object.prototype.hasOwnProperty.call(src, key)) return;
      const value = sanitizeProp(key, src[key]);
      if (value !== null && value !== undefined) record[key] = value;
    });

    return record;
  }

  function getFetch() {
    if (typeof root.fetch === 'function') return root.fetch;
    if (typeof fetch === 'function') return fetch;
    return null;
  }

  async function postBatch(batch) {
    const url = endpoint();
    if (!url) return false;
    const fetchImpl = getFetch();
    if (!fetchImpl) return false;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
        credentials: 'same-origin'
      });
      return !!(res && (res.ok === true || (typeof res.ok !== 'boolean' && Number(res.status) >= 200 && Number(res.status) < 300)));
    } catch (e) {
      return false;
    }
  }

  function requeueAtFront(batch) {
    queue = batch.concat(queue);
    if (queue.length > MAX_QUEUE) queue = queue.slice(0, MAX_QUEUE);
  }

  /**
   * 发送当前队列头部一批。失败静默重试一次；仍失败则把批次放回队首，
   * 等下一次 flush（页面关闭时丢失，可接受）。
   * @returns {Promise<boolean>}
   */
  function flush() {
    if (!enabled || !queue.length) return Promise.resolve(!queue.length ? true : false);
    if (flushing) return flushing;

    const batch = queue.slice(0, BATCH_SIZE);
    queue = queue.slice(batch.length);

    flushing = (async function () {
      let ok = await postBatch(batch);
      if (!ok) ok = await postBatch(batch); // 失败只重试一次
      if (!ok) requeueAtFront(batch);
      return ok;
    })();

    const current = flushing;
    current.then(function () { if (flushing === current) flushing = null; },
      function () { if (flushing === current) flushing = null; });

    return flushing;
  }

  function track(event, props) {
    if (!enabled) return false;
    if (typeof event !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_PROPS, event)) return false;
    queue.push(buildEvent(event, props));
    if (queue.length > MAX_QUEUE) queue.shift();
    return true;
  }

  function setEnabled(value) {
    enabled = !!value;
    if (!enabled) queue = [];
    return enabled;
  }

  function queueSize() {
    return queue.length;
  }

  function peek() {
    return queue.slice();
  }

  /* 页面隐藏时尽力发出；keepalive 让浏览器在卸载过程中继续发送 */
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('pagehide', function () {
      try { flush(); } catch (e) { /* 静默 */ }
    });
  }

  CW.telemetry = {
    track: track,
    flush: flush,
    setEnabled: setEnabled,
    queueSize: queueSize,
    peek: peek,
    events: Object.keys(EVENT_PROPS)
  };
})();
