/* =====================================================================
 * map.js · 地图层（Provider 注册 + 统一渲染）
 * ---------------------------------------------------------------------
 * 主 API：CW.MapEngine
 *   registerProvider({ id, init })
 *   render(container, route, opts) -> { provider, update, select, setLayer, fit, destroy }
 *   getProviderId() / reset()
 *
 * 默认内置 mock provider：保留原 SVG 示意地图（缩放 / 拖动 / 图层 / 图例 /
 * 标记与时间线联动）。地图上没有任何真实经纬度，不能用于导航。
 *
 * 配置 MAP.provider='leaflet' 时，只有 js/adapters/map-leaflet.js 已加载、
 * 且 window.L 存在，才会注册真实地图；否则明确提示「地图适配器未就绪」
 * 并回退 mock，不静默画错图。
 *
 * 兼容：旧代码仍可调用 CW.map.render(...)，行为与 CW.MapEngine.render 相同。
 * ===================================================================== */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const CW = (root.CW = root.CW || {});
  const VW = 1000, VH = 640;

  function icon(name) {
    return (CW.ui && typeof CW.ui.icon === 'function') ? CW.ui.icon(name) : '';
  }

  function esc(value) {
    if (CW.ui && typeof CW.ui.esc === 'function') return CW.ui.esc(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showFailure(host, message) {
    host.innerHTML =
      '<div class="map-failure note-box rose" role="alert" style="margin:12px">' +
      icon('alert') + '<span>' + esc(message) + '</span></div>';
  }

  function failureInstance(host, provider, message) {
    return {
      provider: provider || 'mock',
      update: function () { showFailure(host, message); },
      select: function () { },
      setLayer: function () { return false; },
      fit: function () { },
      destroy: function () { host.innerHTML = ''; }
    };
  }

  const BASE = `
  <defs>
    <linearGradient id="waterG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#DCE9EF"/><stop offset="100%" stop-color="#D2E2EA"/>
    </linearGradient>
    <pattern id="blockPat" width="46" height="46" patternUnits="userSpaceOnUse">
      <rect width="46" height="46" fill="none"/>
      <path d="M0 23h46M23 0v46" stroke="#EDE7DA" stroke-width="1"/>
    </pattern>
  </defs>
  <!-- 底图 -->
  <g id="gBase">
    <rect x="0" y="0" width="${VW}" height="${VH}" fill="#F7F5EE"/>
    <!-- 街区肌理 -->
    <rect x="0" y="0" width="${VW}" height="${VH}" fill="url(#blockPat)" opacity=".75"/>
    <!-- 长江 -->
    <path d="M-30 128 C110 96 250 62 400 22 L470 -30 L-30 -30 Z" fill="url(#waterG)" opacity=".95"/>
    <path d="M-30 150 C120 118 258 84 410 44" fill="none" stroke="#C6DAE4" stroke-width="1.4"/>
    <!-- 玄武湖 -->
    <path d="M632 92 C660 62 726 56 762 84 C796 110 792 158 758 178 C720 200 664 192 640 160 C624 138 618 110 632 92 Z"
          fill="url(#waterG)" stroke="#C6DAE4" stroke-width="1.2"/>
    <!-- 秦淮河 -->
    <path d="M232 392 C330 412 440 420 546 432 C640 442 712 470 792 520"
          fill="none" stroke="#CFE0E8" stroke-width="7" stroke-linecap="round"/>
    <path d="M232 392 C330 412 440 420 546 432 C640 442 712 470 792 520"
          fill="none" stroke="#BBD3DF" stroke-width="1" stroke-dasharray="4 5"/>
    <!-- 绿地 -->
    <path d="M596 106 C626 76 700 68 744 98 C786 126 784 178 746 200 C704 224 636 214 608 178 C588 152 582 126 596 106 Z"
          fill="#E4EDE0" opacity=".75"/>
    <ellipse cx="742" cy="504" rx="52" ry="34" fill="#E4EDE0" opacity=".9"/>
    <ellipse cx="252" cy="372" rx="40" ry="26" fill="#E4EDE0" opacity=".8"/>
    <ellipse cx="330" cy="180" rx="34" ry="22" fill="#E4EDE0" opacity=".7"/>
    <!-- 明城墙示意 -->
    <path d="M214 214 L470 168 L706 210 L812 344 L772 528 L560 566 L300 528 L196 396 Z"
          fill="none" stroke="#D6C8B0" stroke-width="2.2" stroke-dasharray="9 6" opacity=".95"/>
    <!-- 主干道 -->
    <path d="M522 176 L508 300 L498 470" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>
    <path d="M522 176 L508 300 L498 470" fill="none" stroke="#E7E1D2" stroke-width="1.2"/>
    <path d="M318 300 L620 292 L868 284" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>
    <path d="M318 300 L620 292 L868 284" fill="none" stroke="#E7E1D2" stroke-width="1.2"/>
    <path d="M340 244 L560 236 L760 226" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
    <path d="M300 404 L560 420 L700 462" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
    <path d="M392 300 L400 470 L470 540" fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round"/>
    <!-- 地物标签 -->
    <text class="mk-label" x="196" y="72" style="font-size:11px" fill="#9BAFB8">长江</text>
    <text class="mk-label" x="698" y="222" style="font-size:11px" fill="#8FA79A">玄武湖</text>
    <text class="mk-label" x="470" y="452" style="font-size:11px" fill="#9BAFB8">秦淮河</text>
    <text class="mk-label" x="736" y="546" style="font-size:11px" fill="#A99C86">明城墙（示意）</text>
  </g>`;

  /* =====================================================================
   * 内置 provider：SVG 示意地图（原实现保留）
   * ===================================================================== */
  function initMock(host, route, opts) {
    opts = opts || {};
    const D = CW.data;

    if (!D || typeof D.placesOfCity !== 'function' || typeof D.place !== 'function') {
      showFailure(host, '地图数据未加载，暂时无法绘制示意地图。');
      return failureInstance(host, 'mock', '地图数据未加载，暂时无法绘制示意地图。');
    }

    const state = {
      scale: 1, tx: 0, ty: 0,
      layers: { base: true, route: true, pins: true },
      selected: null,
      route: route,
      failed: false
    };

    host.innerHTML = `
      <div class="map-stage" id="mapStage">
        <svg id="mapSvg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid meet"
             role="img" aria-label="路线示意地图，编号与下方时间线一致">
          <g id="mapRoot">${BASE}
            <g id="gRoute"></g>
            <g id="gPins"></g>
          </g>
        </svg>
        <div class="map-layers" id="mapLayers">
          <button type="button" data-layer="base" class="on" aria-pressed="true">街区底图</button>
          <button type="button" data-layer="route" class="on" aria-pressed="true">步行路线</button>
          <button type="button" data-layer="pins" class="on" aria-pressed="true">兴趣点</button>
        </div>
        <div class="map-ctrl">
          <button type="button" data-zoom="in" title="放大" aria-label="放大地图">${icon('plus')}</button>
          <button type="button" data-zoom="out" title="缩小" aria-label="缩小地图">${icon('minus')}</button>
          <button type="button" data-zoom="reset" title="回到全览" aria-label="回到全览">${icon('locate')}</button>
        </div>
        <div class="map-legend" id="mapLegend"></div>
      </div>
      <div class="map-note">${icon('info')}<span>${esc(D.DISCLAIMER && D.DISCLAIMER.map)} · ${esc(D.DISCLAIMER && D.DISCLAIMER.sample)}，仅用于展示标记与路线的对应关系</span></div>`;

    const stage = host.querySelector('#mapStage');
    const rootEl = host.querySelector('#mapRoot');
    const gRoute = host.querySelector('#gRoute');
    const gPins = host.querySelector('#gPins');
    const svg = host.querySelector('#mapSvg');

    /* ---- 图例 ---- */
    function renderLegend() {
      const cats = {};
      const r = state.route;
      if (r && Array.isArray(r.places)) {
        r.places.forEach(id => { const p = D.place(id); if (p) cats[p.cat] = true; });
      }
      if (!Object.keys(cats).length) {
        D.placesOfCity(r ? r.city : 'nanjing').forEach(p => { cats[p.cat] = true; });
      }
      const rows = Object.keys(cats).map(c => {
        const cc = D.cat(c);
        return `<div class="lg-row"><span class="lg-dot" style="background:${cc.color}"></span>${esc(cc.name)}</div>`;
      });
      if (r && Array.isArray(r.places) && r.places.length > 1) {
        rows.push('<div class="lg-row"><span class="lg-dot lg-ring"></span>起点 · 终点</div>');
      }
      host.querySelector('#mapLegend').innerHTML = rows.join('');
    }

    /* ---- 变换 ---- */
    function applyTransform() {
      rootEl.setAttribute('transform', `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
    }

    /* ---- 绘制路线与标记 ---- */
    function draw() {
      const r = state.route;
      const routeIds = (r && Array.isArray(r.places)) ? r.places.slice() : [];
      const places = r ? D.places(routeIds) : [];
      const all = D.placesOfCity(r ? r.city : 'nanjing');

      // 路线连线
      let svgPath = '';
      if (places.length > 1) {
        svgPath = places.map((p, i) => (i ? 'L' : 'M') + p.mapX + ' ' + p.mapY).join(' ');
      }
      gRoute.innerHTML = svgPath
        ? `<path class="route-path" d="${svgPath}"/><path class="route-path-dash" d="${svgPath}"/>`
        : '';
      gRoute.style.display = state.layers.route ? '' : 'none';

      // 标记：先画非路线点，再画路线点（保证路线点在上层）
      const others = all.filter(p => routeIds.indexOf(p.id) < 0);
      const pin = (p, idx) => {
        const cc = D.cat(p.cat);
        const sel = state.selected === p.id ? ' mk-sel' : '';
        const num = idx != null ? idx + 1 : '';
        const isStart = idx === 0 && places.length > 1;
        const isEnd = idx != null && idx === places.length - 1 && places.length > 1;
        const role = isStart ? ' mk-start' : (isEnd ? ' mk-end' : '');
        const tag = isStart ? '起点' : (isEnd ? '终点' : '');
        return `<g class="mk${sel}${role}" data-pin="${p.id}" aria-hidden="true" transform="translate(${p.mapX} ${p.mapY})">
          <circle class="mk-halo" r="${idx != null ? 15 : 12}"/>
          <circle class="mk-body" r="${idx != null ? 11.5 : 8.5}" fill="${cc.color}"/>
          ${num !== '' ? `<text y="0.5">${num}</text>` : ''}
          ${idx != null ? `<text class="mk-label" y="${-19}" style="font-weight:700">${esc(p.name.length > 9 ? p.name.slice(0, 8) + '…' : p.name)}</text>` : ''}
          ${tag ? `<text class="mk-tag" y="28">${tag}</text>` : ''}
        </g>`;
      };
      gPins.innerHTML = others.map(p => pin(p, null)).join('') + places.map((p, i) => pin(p, i)).join('');
      gPins.style.display = state.layers.pins ? '' : 'none';
      host.querySelector('#gBase').style.display = state.layers.base ? '' : 'none';
    }

    /* ---- 渲染失败状态：不让异常冒到页面，也不留半张残图 ---- */
    function fail(err) {
      if (state.failed) return;
      state.failed = true;
      showFailure(host, '地图渲染失败：' + ((err && err.message) || '未知错误'));
    }
    function safeDraw() {
      if (state.failed) return;
      try { draw(); } catch (e) { fail(e); }
    }
    function safeLegend() {
      if (state.failed) return;
      try { renderLegend(); } catch (e) { fail(e); }
    }

    /* ---- 交互：标记点击 ---- */
    gPins.addEventListener('click', e => {
      const g = e.target.closest('[data-pin]');
      if (!g) return;
      const id = g.dataset.pin;
      if (opts.onSelect) opts.onSelect(id);
    });
    gPins.style.cursor = 'pointer';

    /* ---- 交互：缩放 / 拖动 ---- */
    function zoom(factor, cx, cy) {
      const prev = state.scale;
      let s = Math.max(0.85, Math.min(2.4, prev * factor));
      const k = s / prev;
      const px = cx == null ? VW / 2 : cx, py = cy == null ? VH / 2 : cy;
      state.tx = px - k * (px - state.tx);
      state.ty = py - k * (py - state.ty);
      state.scale = s;
      clampPan(); applyTransform();
    }
    function clampPan() {
      const max = 320 * state.scale;
      state.tx = Math.max(-max, Math.min(max, state.tx));
      state.ty = Math.max(-max * 0.7, Math.min(max * 0.7, state.ty));
    }
    function fit() {
      state.scale = 1; state.tx = 0; state.ty = 0;
      applyTransform();
    }

    host.querySelector('.map-ctrl').addEventListener('click', e => {
      const b = e.target.closest('[data-zoom]'); if (!b) return;
      if (b.dataset.zoom === 'in') zoom(1.25);
      else if (b.dataset.zoom === 'out') zoom(0.8);
      else fit();
    });

    let dragging = false, last = null, moved = false;
    function onPointerDown(e) {
      dragging = true; moved = false; last = { x: e.clientX, y: e.clientY };
      stage.classList.add('dragging');
    }
    function onPointerMove(e) {
      if (!dragging) return;
      const rect = svg.getBoundingClientRect();
      const k = VW / rect.width;
      const dx = (e.clientX - last.x) * k, dy = (e.clientY - last.y) * k;
      if (Math.abs(dx) + Math.abs(dy) > 1.5) moved = true;
      state.tx += dx; state.ty += dy;
      last = { x: e.clientX, y: e.clientY };
      clampPan(); applyTransform();
    }
    function onPointerUp() {
      dragging = false;
      stage.classList.remove('dragging');
    }
    svg.addEventListener('pointerdown', onPointerDown);
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('pointermove', onPointerMove);
      root.addEventListener('pointerup', onPointerUp);
    }
    svg.addEventListener('wheel', e => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < 2) return;
      e.preventDefault();
      zoom(e.deltaY > 0 ? 0.9 : 1.12);
    }, { passive: false });

    /* ---- 图层切换 ---- */
    function setLayer(name, on) {
      if (!Object.prototype.hasOwnProperty.call(state.layers, name)) return false;
      if (state.failed) return false;
      state.layers[name] = !!on;
      const b = host.querySelector('#mapLayers [data-layer="' + name + '"]');
      if (b) {
        b.classList.toggle('on', state.layers[name]);
        b.setAttribute('aria-pressed', String(state.layers[name]));
      }
      safeDraw();
      return true;
    }
    host.querySelector('#mapLayers').addEventListener('click', e => {
      const b = e.target.closest('[data-layer]'); if (!b) return;
      const key = b.dataset.layer;
      setLayer(key, !state.layers[key]);
    });

    safeLegend(); safeDraw(); applyTransform();

    return {
      provider: 'mock',
      update(newRoute) {
        state.route = newRoute;
        safeLegend(); safeDraw();
      },
      select(id) {
        if (state.failed) return;
        state.selected = id;
        safeDraw();
        if (id) {
          const p = D.place(id);
          if (p && state.layers.pins) {
            // 轻微聚焦：把选中点移到视口中央附近
            const dx = VW / 2 - p.mapX, dy = VH / 2 - p.mapY;
            state.tx = dx * state.scale * 0.35; state.ty = dy * state.scale * 0.35;
            clampPan(); applyTransform();
          }
        }
      },
      setLayer: setLayer,
      fit: fit,
      destroy() {
        if (typeof root.removeEventListener === 'function') {
          root.removeEventListener('pointermove', onPointerMove);
          root.removeEventListener('pointerup', onPointerUp);
        }
        host.innerHTML = '';
      }
    };
  }

  /* =====================================================================
   * Provider 注册表
   * ===================================================================== */
  const registry = Object.create(null);
  let lastProviderId = null;

  function configuredProviderId() {
    const map = (root.CW_CONFIG && (root.CW_CONFIG.MAP || root.CW_CONFIG.map)) || {};
    const id = map.provider || 'mock';
    return id === 'svg' ? 'mock' : id;
  }

  function assertInstance(inst, id) {
    if (!inst || typeof inst !== 'object') {
      throw new Error('地图 Provider「' + id + '」的 init 没有返回实例');
    }
    if (typeof inst.provider !== 'string' || !inst.provider) {
      throw new Error('地图 Provider「' + id + '」的实例缺少 provider 字段');
    }
    ['update', 'select', 'setLayer', 'fit', 'destroy'].forEach(name => {
      if (typeof inst[name] !== 'function') {
        throw new Error('地图 Provider「' + id + '」的实例缺少 ' + name + '()');
      }
    });
    return inst;
  }

  function registerProvider(def, maybeInit) {
    let id, init;
    if (typeof def === 'string' && typeof maybeInit === 'function') {
      // 兼容旧签名 registerProvider('leaflet', fn)
      id = def; init = maybeInit;
    } else if (def && typeof def === 'object') {
      id = def.id; init = def.init;
    }
    if (typeof id !== 'string' || !id.trim()) {
      throw new TypeError('registerProvider 需要合法的 id');
    }
    if (typeof init !== 'function') {
      throw new TypeError('registerProvider 需要 init 函数');
    }
    registry[id.trim()] = init;
    return MapEngine;
  }

  function reportFailure(provider, reasonCode) {
    try {
      if (CW.telemetry && typeof CW.telemetry.track === 'function') {
        CW.telemetry.track('map_failed', { provider: provider, reasonCode: reasonCode || 'UNKNOWN' });
      }
    } catch (e) { /* 埋点失败不影响地图 */ }
  }

  function createNotice(host, text) {
    const doc = (host && host.ownerDocument) || root.document;
    const box = doc.createElement('div');
    box.className = 'map-adapter-notice note-box amber';
    box.setAttribute('role', 'status');
    box.style.margin = '8px 12px 12px';

    const span = doc.createElement('span');
    span.textContent = text;
    span.style.flex = '1';

    const close = doc.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.title = '关闭提示';
    close.setAttribute('aria-label', '关闭地图提示');
    close.style.cssText = 'flex:0 0 auto;border:0;background:transparent;color:inherit;font-size:18px;line-height:1;cursor:pointer;padding:0 2px';
    close.addEventListener('click', () => box.remove());

    box.appendChild(span);
    box.appendChild(close);
    return box;
  }

  function wrapInstance(inst, notice) {
    return {
      provider: inst.provider,
      update: function (route) { return inst.update(route); },
      select: function (id) { return inst.select(id); },
      setLayer: function (name, on) { return inst.setLayer(name, on); },
      fit: function () { return inst.fit(); },
      destroy: function () {
        try { inst.destroy(); } finally { if (notice && notice.parentNode) notice.remove(); }
      }
    };
  }

  function fallbackToMock(host, route, opts, wanted, reasonCode, reasonText) {
    reportFailure(wanted, reasonCode);
    let inst = null;
    let mockErr = null;
    try {
      inst = registry.mock(host, route, opts || {});
      assertInstance(inst, 'mock');
    } catch (e) {
      mockErr = e;
      inst = null;
    }
    if (!inst) {
      const message = reasonText + (mockErr ? '；示意地图也不可用：' + mockErr.message : '');
      showFailure(host, message);
      return failureInstance(host, 'mock', message);
    }
    lastProviderId = 'mock';
    const notice = createNotice(host, reasonText);
    host.appendChild(notice);
    return wrapInstance(inst, notice);
  }

  function render(host, route, opts) {
    opts = opts || {};
    if (typeof host === 'string') {
      host = root.document && root.document.querySelector(host);
    }
    if (!host || host.nodeType !== 1) {
      throw new TypeError('MapEngine.render(container, route, opts) 需要一个 DOM 容器');
    }

    const wanted = configuredProviderId();
    const init = registry[wanted];

    if (typeof init !== 'function') {
      // 明确提示，不静默画错图；提示可关闭，但地图本身回退到示意地图
      return fallbackToMock(host, route, opts, wanted, 'PROVIDER_MISSING',
        '地图适配器未就绪：配置的「' + wanted + '」Provider 未注册，已回退到示意地图。');
    }

    try {
      const inst = init(host, route, opts);
      assertInstance(inst, wanted);
      lastProviderId = wanted;
      return inst;
    } catch (err) {
      if (wanted === 'mock') {
        const message = '地图渲染失败：' + ((err && err.message) || '未知错误');
        reportFailure('mock', 'RENDER_FAILED');
        showFailure(host, message);
        return failureInstance(host, 'mock', message);
      }
      return fallbackToMock(host, route, opts, wanted, 'INIT_FAILED',
        '地图适配器未就绪：「' + wanted + '」初始化失败（' + ((err && err.message) || '未知错误') + '），已回退到示意地图。');
    }
  }

  function getProviderId() {
    return lastProviderId || configuredProviderId();
  }

  function reset() {
    Object.keys(registry).forEach(key => { delete registry[key]; });
    registerProvider({ id: 'mock', init: initMock });
    lastProviderId = null;
    return MapEngine;
  }

  const MapEngine = {
    registerProvider: registerProvider,
    render: render,
    getProviderId: getProviderId,
    reset: reset,
    providers: registry
  };

  /* 启动即注册内置 mock */
  registerProvider({ id: 'mock', init: initMock });

  CW.MapEngine = MapEngine;

  /* 兼容旧接口：业务页面原先只调用 CW.map.render / registerProvider */
  CW.map = {
    render: render,
    registerProvider: registerProvider,
    getProviderId: getProviderId,
    getProviderName: configuredProviderId,
    reset: reset,
    providers: registry
  };
})();
