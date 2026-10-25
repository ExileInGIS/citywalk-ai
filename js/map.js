/* =====================================================================
 * map.js · 地图层（适配器模式）
 * ---------------------------------------------------------------------
 * ⚠️ 默认 provider 为【SVG 示意地图】：水系、绿地、道路均为手绘的相对
 *    位置示意，不含真实经纬度，不能用于导航，仅展示标记与路线的对应。
 *
 * 接入真实地图：在 js/config.js 把 CW_CONFIG.map.provider 改成
 *   'amap' | 'tencent' | 'leaflet' | 'custom'，并按
 *   docs/API-INTEGRATION.md 实现/引入对应适配器（参考 js/adapters/*.js）。
 * 适配器只需实现统一接口：
 *   render(host, route, opts) -> { update(route), select(id), destroy() }
 * 业务侧始终只调用 CW.map.render(...)，不感知底层是哪家地图。
 * ===================================================================== */
(function () {
  const CW = (window.CW = window.CW || {});
  const D = CW.data;
  const VW = 1000, VH = 640;

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

  /* ---- 内置 provider：SVG 示意地图 ---- */
  function renderSvg(host, route, opts) {
    opts = opts || {};
    const state = {
      scale: 1, tx: 0, ty: 0,
      layers: { base: true, route: true, pins: true },
      selected: null,
      route: route
    };
    host.innerHTML = `
      <div class="map-stage" id="mapStage">
        <svg id="mapSvg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid meet">
          <g id="mapRoot">${BASE}
            <g id="gRoute"></g>
            <g id="gPins"></g>
          </g>
        </svg>
        <div class="map-layers" id="mapLayers">
          <button data-layer="base" class="on">街区底图</button>
          <button data-layer="route" class="on">步行路线</button>
          <button data-layer="pins" class="on">兴趣点</button>
        </div>
        <div class="map-ctrl">
          <button data-zoom="in" title="放大">${CW.ui.icon('plus')}</button>
          <button data-zoom="out" title="缩小">${CW.ui.icon('minus')}</button>
          <button data-zoom="reset" title="回到全览">${CW.ui.icon('locate')}</button>
        </div>
        <div class="map-legend" id="mapLegend"></div>
      </div>
      <div class="map-note">${CW.ui.icon('info')}<span>${D.DISCLAIMER.map} · ${D.DISCLAIMER.sample}，仅用于展示标记与路线的对应关系</span></div>`;

    const stage = host.querySelector('#mapStage');
    const root = host.querySelector('#mapRoot');
    const gRoute = host.querySelector('#gRoute');
    const gPins = host.querySelector('#gPins');
    const svg = host.querySelector('#mapSvg');

    /* ---- 图例 ---- */
    function renderLegend() {
      const cats = {};
      const r = state.route;
      if (r) r.places.forEach(id => { const p = D.place(id); if (p) cats[p.cat] = true; });
      if (!Object.keys(cats).length) {
        D.placesOfCity(r ? r.city : 'nanjing').forEach(p => { cats[p.cat] = true; });
      }
      const rows = Object.keys(cats).map(c => {
        const cc = D.cat(c);
        return `<div class="lg-row"><span class="lg-dot" style="background:${cc.color}"></span>${CW.ui.esc(cc.name)}</div>`;
      });
      if (r && r.places.length > 1) {
        rows.push('<div class="lg-row"><span class="lg-dot lg-ring"></span>起点 · 终点</div>');
      }
      host.querySelector('#mapLegend').innerHTML = rows.join('');
    }

    /* ---- 变换 ---- */
    function applyTransform() {
      root.setAttribute('transform', `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
    }

    /* ---- 绘制路线与标记 ---- */
    function draw() {
      const r = state.route;
      const routeIds = r ? r.places.slice() : [];
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
        return `<g class="mk${sel}${role}" data-pin="${p.id}" transform="translate(${p.mapX} ${p.mapY})">
          <circle class="mk-halo" r="${idx != null ? 15 : 12}"/>
          <circle class="mk-body" r="${idx != null ? 11.5 : 8.5}" fill="${cc.color}"/>
          ${num !== '' ? `<text y="0.5">${num}</text>` : ''}
          ${idx != null ? `<text class="mk-label" y="${-19}" style="font-weight:700">${CW.ui.esc(p.name.length > 9 ? p.name.slice(0, 8) + '…' : p.name)}</text>` : ''}
          ${tag ? `<text class="mk-tag" y="28">${tag}</text>` : ''}
        </g>`;
      };
      gPins.innerHTML = others.map(p => pin(p, null)).join('') + places.map((p, i) => pin(p, i)).join('');
      gPins.style.display = state.layers.pins ? '' : 'none';
      host.querySelector('#gBase').style.display = state.layers.base ? '' : 'none';
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
    host.querySelector('.map-ctrl').addEventListener('click', e => {
      const b = e.target.closest('[data-zoom]'); if (!b) return;
      if (b.dataset.zoom === 'in') zoom(1.25);
      else if (b.dataset.zoom === 'out') zoom(0.8);
      else { state.scale = 1; state.tx = 0; state.ty = 0; applyTransform(); }
    });
    let dragging = false, last = null, moved = false;
    svg.addEventListener('pointerdown', e => {
      dragging = true; moved = false; last = { x: e.clientX, y: e.clientY };
      stage.classList.add('dragging');
    });
    window.addEventListener('pointermove', e => {
      if (!dragging) return;
      const rect = svg.getBoundingClientRect();
      const k = VW / rect.width;
      const dx = (e.clientX - last.x) * k, dy = (e.clientY - last.y) * k;
      if (Math.abs(dx) + Math.abs(dy) > 1.5) moved = true;
      state.tx += dx; state.ty += dy;
      last = { x: e.clientX, y: e.clientY };
      clampPan(); applyTransform();
    });
    window.addEventListener('pointerup', () => { dragging = false; stage.classList.remove('dragging'); });
    svg.addEventListener('wheel', e => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < 2) return;
      e.preventDefault();
      zoom(e.deltaY > 0 ? 0.9 : 1.12);
    }, { passive: false });

    /* ---- 图层切换 ---- */
    host.querySelector('#mapLayers').addEventListener('click', e => {
      const b = e.target.closest('[data-layer]'); if (!b) return;
      const key = b.dataset.layer;
      state.layers[key] = !state.layers[key];
      b.classList.toggle('on', state.layers[key]);
      draw();
    });

    renderLegend(); draw(); applyTransform();

    return {
      provider: 'svg',
      update(newRoute) { state.route = newRoute; draw(); renderLegend(); },
      select(id) {
        state.selected = id;
        draw();
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
      destroy() { host.innerHTML = ''; }
    };
  }

  /* =====================================================================
   * 适配器注册与统一入口
   * ===================================================================== */
  const providers = { svg: renderSvg };
  function registerProvider(name, fn) { providers[name] = fn; }
  function getProviderName() {
    const c = (window.CW_CONFIG && window.CW_CONFIG.map) || {};
    return c.provider || 'svg';
  }

  function render(host, route, opts) {
    opts = opts || {};
    const name = getProviderName();
    const fn = providers[name];
    if (typeof fn === 'function') return fn(host, route, opts);

    // 配置了真实地图但未加载适配器 → 给出明确提示，不静默画错图
    const c = (window.CW_CONFIG && window.CW_CONFIG.map) || {};
    host.innerHTML =
      '<div class="card" style="padding:22px">' +
      '<div class="note-box amber">' + (CW.ui.icon ? CW.ui.icon('alert') : '⚠️') +
      '<span><b>地图适配器未就绪。</b>config.js 指定的 <code>' + name + '</code> 地图缺少实现或密钥。' +
      '请按 docs/API-INTEGRATION.md 引入 js/adapters/map-' + name + '.js 并填写配置；' +
      '当前临时回退到 SVG 示意地图。</span></div></div>';
    return renderSvg(host, route, opts);
  }

  CW.map = { render, registerProvider, getProviderName, providers };
})();
