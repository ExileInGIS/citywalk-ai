/* =====================================================================
 * storage.js · 本地持久化（可关闭）
 * ---------------------------------------------------------------------
 * 只存三类数据，且都在浏览器本地：
 *   · 收藏（地点 / 路线 id 或轻量快照）
 *   · 路线快照（可选，用于刷新后恢复）
 *   · 行程草稿
 * 不存账号、身份、token。所有读写都 try/catch；隐私模式或配额失败时
 * enabled=false，读返回 null、写返回 false，页面据此退回内存态。
 *
 * localStorage 键统一加 CW_CONFIG.STORAGE.keyPrefix（默认 cw.v1.）：
 *   cw.v1.favorites / cw.v1.routes / cw.v1.draft / cw.v1.sessionId
 * ===================================================================== */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const CW = (root.CW = root.CW || {});

  const DEFAULT_PREFIX = 'cw.v1.';
  const KEYS = {
    favorites: 'favorites',
    routes: 'routes',
    draft: 'draft',
    sessionId: 'sessionId'
  };

  let enabled = false;
  let lastError = null;
  let memorySessionId = null;

  function readConfig() {
    return (root.CW_CONFIG && (root.CW_CONFIG.STORAGE || root.CW_CONFIG.storage)) || {};
  }

  function keyPrefix() {
    const prefix = readConfig().keyPrefix;
    return (typeof prefix === 'string' && prefix) ? prefix : DEFAULT_PREFIX;
  }

  function fullKey(name) {
    return keyPrefix() + name;
  }

  function featureEnabled(name) {
    return readConfig()[name] !== false;
  }

  function errorText(err) {
    return (err && err.message) ? String(err.message) : '本地存储不可用';
  }

  function storage() {
    try {
      return root.localStorage || null;
    } catch (err) {
      lastError = errorText(err);
      return null;
    }
  }

  function disable(err) {
    enabled = false;
    lastError = errorText(err);
  }

  function probe() {
    const ls = storage();
    if (!ls) {
      if (!lastError) lastError = '浏览器未提供 localStorage';
      return false;
    }
    try {
      const probeKey = fullKey('__probe__');
      ls.setItem(probeKey, '1');
      ls.removeItem(probeKey);
      return true;
    } catch (err) {
      disable(err);
      return false;
    }
  }

  function parse(raw) {
    if (raw == null || raw === '') return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function readRaw(name) {
    if (!enabled) return null;
    const ls = storage();
    if (!ls) { disable(lastError || '浏览器未提供 localStorage'); return null; }
    try {
      return ls.getItem(fullKey(name));
    } catch (err) {
      disable(err);
      return null;
    }
  }

  function writeRaw(name, text) {
    if (!enabled) return false;
    const ls = storage();
    if (!ls) { disable(lastError || '浏览器未提供 localStorage'); return false; }
    try {
      ls.setItem(fullKey(name), text);
      return true;
    } catch (err) {
      // 配额满、Safari 隐私模式、企业策略都会走到这里
      disable(err);
      return false;
    }
  }

  function removeRaw(name) {
    if (!enabled) return false;
    const ls = storage();
    if (!ls) return false;
    try {
      ls.removeItem(fullKey(name));
      return true;
    } catch (err) {
      disable(err);
      return false;
    }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function loadJson(name) {
    if (!enabled) return null;
    const value = parse(readRaw(name));
    return isPlainObject(value) ? value : null;
  }

  function saveJson(name, value) {
    if (!enabled) return false;
    if (!isPlainObject(value)) {
      lastError = name + ' 必须是对象';
      return false;
    }
    let text;
    try {
      text = JSON.stringify(value);
    } catch (err) {
      lastError = '序列化失败：' + errorText(err);
      return false;
    }
    return writeRaw(name, text);
  }

  function makeId() {
    try {
      const webCrypto = root.crypto;
      if (webCrypto && typeof webCrypto.randomUUID === 'function') {
        const id = webCrypto.randomUUID();
        if (id) return String(id);
      }
    } catch (e) { /* 忽略，走兜底 */ }
    return 'cw-session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ---------------- 生命周期 ---------------- */
  enabled = probe();

  /**
   * 开关本地持久化。
   * 关闭不会删除已有数据（需要删除请调用 clearAll），只是当前会话不再读写。
   */
  function setEnabled(value) {
    if (value) {
      lastError = null;
      enabled = probe();
    } else {
      enabled = false;
    }
    return enabled;
  }

  function clearAll() {
    const ls = storage();
    if (!ls) { enabled = false; return false; }
    let ok = true;
    try {
      const prefix = keyPrefix();
      // 先删本项目已知键；再扫描所有键，清理旧前缀遗留数据
      Object.keys(KEYS).forEach(name => ls.removeItem(fullKey(KEYS[name])));
      for (let i = ls.length - 1; i >= 0; i--) {
        const key = ls.key(i);
        if (key && key.indexOf(prefix) === 0) ls.removeItem(key);
      }
      memorySessionId = null;
    } catch (err) {
      disable(err);
      ok = false;
    }
    return ok;
  }

  /* ---------------- 收藏 / 路线 / 草稿 ---------------- */
  function loadFavorites() {
    if (!featureEnabled('favorites')) return null;
    return loadJson(KEYS.favorites);
  }

  function saveFavorites(value) {
    if (!featureEnabled('favorites')) return false;
    return saveJson(KEYS.favorites, value);
  }

  function loadRoutes() {
    if (!featureEnabled('favorites')) return null;
    return loadJson(KEYS.routes);
  }

  function saveRoutes(value) {
    if (!featureEnabled('favorites')) return false;
    return saveJson(KEYS.routes, value);
  }

  function loadDraft() {
    if (!featureEnabled('draft')) return null;
    return loadJson(KEYS.draft);
  }

  function saveDraft(value) {
    if (!featureEnabled('draft')) return false;
    return saveJson(KEYS.draft, value);
  }

  /* ---------------- 会话 id（匿名） ---------------- */
  function sessionId() {
    if (memorySessionId) return memorySessionId;
    if (enabled) {
      const stored = readRaw(KEYS.sessionId);
      if (typeof stored === 'string' && stored) {
        memorySessionId = stored;
        return stored;
      }
    }
    const id = makeId();
    memorySessionId = id;
    if (enabled) writeRaw(KEYS.sessionId, id);
    return id;
  }

  /* ---------------- 诊断信息（不含内容） ---------------- */
  function getMeta() {
    const keys = [];
    ['favorites', 'routes', 'draft', 'sessionId'].forEach(name => {
      if (enabled) {
        try {
          const ls = storage();
          if (ls && ls.getItem(fullKey(name)) != null) keys.push(fullKey(name));
        } catch (e) { /* 只做诊断，不抛错 */ }
      }
    });
    return {
      enabled: enabled,
      keyPrefix: keyPrefix(),
      favorites: featureEnabled('favorites'),
      draft: featureEnabled('draft'),
      keys: keys,
      hasFavorites: keys.indexOf(fullKey(KEYS.favorites)) >= 0,
      hasRoutes: keys.indexOf(fullKey(KEYS.routes)) >= 0,
      hasDraft: keys.indexOf(fullKey(KEYS.draft)) >= 0,
      hasSessionId: keys.indexOf(fullKey(KEYS.sessionId)) >= 0,
      lastError: lastError
    };
  }

  const api = {
    loadFavorites: loadFavorites,
    saveFavorites: saveFavorites,
    loadRoutes: loadRoutes,
    saveRoutes: saveRoutes,
    loadDraft: loadDraft,
    saveDraft: saveDraft,
    clearAll: clearAll,
    sessionId: sessionId,
    getMeta: getMeta,
    setEnabled: setEnabled
  };

  /* enabled 用 getter，写失败后外部能立刻读到 false */
  Object.defineProperty(api, 'enabled', {
    enumerable: true,
    get: function () { return enabled; }
  });

  CW.storage = api;
})();
