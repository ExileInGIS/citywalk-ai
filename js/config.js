/* =====================================================================
 * config.js · 全局唯一配置入口
 * ---------------------------------------------------------------------
 * 所有可替换能力（Agent / 地图 / 存储 / 埋点 / 品牌）都从这里读取。
 * 业务代码不允许再写死 endpoint、provider 或 localStorage 键名。
 *
 * 默认值完全离线可用：
 *   · AGENT.mode = 'mock'      → 浏览器本地调用 shared/core.js
 *   · MAP.provider = 'mock'    → 自绘 SVG 示意地图
 *   · TELEMETRY.enabled = true → 事件只进内存队列，flush() 时才上报
 *
 * 本地手测（仅 localhost / 127.0.0.1 / file:// 生效）：
 *   ?mode=mock|remote   覆盖 AGENT.mode
 *   ?map=mock|leaflet   覆盖 MAP.provider
 * 例如：http://localhost:3000/?mode=remote&map=leaflet
 * 生产环境会忽略这两个参数，避免被 URL 随意切换后端行为。
 *
 * 旧字段别名（agent/map/storage/telemetry/app）指向同一对象，旧代码
 * 不需要修改；新代码只使用大写键。
 * ===================================================================== */
(function () {
  'use strict';

  const config = {
    /* ---------------- 智能体（浏览器 → 自家服务端） ---------------- */
    AGENT: {
      // 'mock'   → 本地确定性核心（离线可用）
      // 'remote' → POST 到下面同源 endpoint，由服务端调用真实模型
      mode: 'mock',

      // 默认指向本仓库 Node 服务的统一入口；页面与服务端同源部署。
      endpoint: '/api/agent/run',
      timeoutMs: 20000,

      // 远程失败时的策略：'mock' 回退本地核心并标 degraded；'error' 直接抛错
      fallback: 'mock',

      // 额外请求头（不要在这里放模型密钥；密钥只能在服务端环境变量里）
      headers: {},

      // 请求 id 头名；trace id 固定使用 X-Trace-Id
      requestIdHeader: 'X-Request-Id',

      /* ---- 旧字段兼容：旧版 agent-custom.example.js 会读这两项 ---- */
      auth: { type: 'none', token: '', headerName: 'X-Api-Key' },
      request: null
    },

    /* ---------------- 地图 ---------------- */
    MAP: {
      // 'mock'    → 现有 SVG 示意地图（默认，离线）
      // 'leaflet' → 需先按 index.html 注释启用 CDN，并加载 js/adapters/map-leaflet.js
      provider: 'mock',

      leaflet: {
        tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        // 归属标注必须非空；地图适配器会原样展示
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        // 预留：接入真实步行路径规划后可换掉直线示意
        routerUrl: ''
      },

      mock: { id: 'mock' },

      /* ---- 旧字段兼容（旧适配器 / 接入文档示例会读） ---- */
      geocode: null,
      apiKeyFromProxy: '',
      amap: { key: '', securityCode: '' },
      tencent: { key: '' }
    },

    /* ---------------- 本地持久化 ---------------- */
    STORAGE: {
      favorites: true,
      draft: true,
      keyPrefix: 'cw.v1.'
    },

    /* ---------------- 匿名埋点 ---------------- */
    TELEMETRY: {
      enabled: true,
      endpoint: '/api/events'
    },

    /* ---------------- 品牌与展示 ---------------- */
    APP: {
      brand: 'CityWalk AI',
      defaultCity: 'nanjing',
      version: '1.0.0',
      showDemoBadge: true
    }
  };

  /* ---------------- 本地 URL 覆盖（仅供手测） ---------------- */
  function isLocalDebug() {
    const loc = window.location;
    if (!loc) return false;
    if (loc.protocol === 'file:') return true;
    const host = String(loc.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' ||
      host === '0.0.0.0' || host === '::1' || host === '[::1]';
  }

  function applyLocalQueryOverrides() {
    if (!isLocalDebug()) return;
    let params;
    try {
      params = new URLSearchParams(window.location.search || '');
    } catch (e) {
      return; // 极老浏览器不支持 URLSearchParams 时保持默认值
    }

    const mode = params.get('mode');
    if (mode === 'mock' || mode === 'remote') config.AGENT.mode = mode;

    const map = params.get('map');
    if (map === 'mock' || map === 'leaflet') config.MAP.provider = map;
  }

  applyLocalQueryOverrides();

  /* ---------------- 兼容别名：必须指向同一个对象 ---------------- */
  config.agent = config.AGENT;
  config.map = config.MAP;
  config.storage = config.STORAGE;
  config.telemetry = config.TELEMETRY;
  config.app = config.APP;

  window.CW_CONFIG = config;
})();
