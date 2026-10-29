/* =====================================================================
 * map-bootstrap.js · 按服务端配置启用高德栅格瓦片（Leaflet）
 * ---------------------------------------------------------------------
 * 采用 Leaflet + 高德栅格瓦片，不加载高德 JS API。
 * 页面先以 mock 启动；拿到 /api/config 后切换为 leaflet。
 * 如果 Leaflet CDN 失败，Provider 缺失，MapEngine 会回退 mock 并提示。
 * 非商用/自用；瓦片接口不是高德官方 JS API，公开部署前需评估条款。
 * ===================================================================== */
(function (root) {
  'use strict';

  const CW = (root.CW = root.CW || {});
  let readyPromise = null;
  const AMAP_TILE_URL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';

  function mapConfig() {
    return (root.CW_CONFIG && (root.CW_CONFIG.MAP || root.CW_CONFIG.map)) || {};
  }

  function fetchServerConfig() {
    if (typeof root.fetch !== 'function') return Promise.resolve(null);
    const controller = typeof root.AbortController === 'function'
      ? new root.AbortController() : null;
    const timer = controller
      ? root.setTimeout(() => { try { controller.abort(); } catch (_) { /* ignore */ } }, 3000)
      : null;
    return root.fetch('/api/config', {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    }).then(response => {
      if (timer) root.clearTimeout(timer);
      if (!response || !response.ok) return null;
      return response.json();
    }).catch(() => {
      if (timer) root.clearTimeout(timer);
      return null;
    });
  }

  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = fetchServerConfig().then(server => {
      const cfg = mapConfig();
      if (!server || server.mapProvider !== 'amap') {
        return { provider: cfg.provider || 'mock', loaded: false };
      }
      cfg.provider = 'leaflet';
      cfg.leaflet = Object.assign({}, cfg.leaflet || {}, {
        tileUrl: AMAP_TILE_URL,
        attribution: '© 高德地图（栅格底图，非商用自用）',
        maxZoom: 18,
        subdomains: '1234',
        coordSystem: 'gcj02'
      });
      return { provider: 'leaflet', loaded: true };
    }).catch(() => ({ provider: mapConfig().provider || 'mock', loaded: false }));
    return readyPromise;
  }

  CW.mapBootstrap = { ready: ready };
})(typeof window !== 'undefined' ? window : globalThis);