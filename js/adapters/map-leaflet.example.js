/* =====================================================================
 * map-leaflet.example.js · 真实地图适配器【参考实现 · 默认不加载】
 * ---------------------------------------------------------------------
 * 这是把示意地图替换成「真实地图」的样例，演示如何实现统一适配器接口：
 *
 *   render(host, route, opts) → { update(route), select(id), destroy() }
 *
 * 启用步骤：
 *   1. 在 index.html（以及 build.js 的 JS_ORDER 之后）引入：
 *        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9/dist/leaflet.css">
 *        <script src="https://unpkg.com/leaflet@1.9/dist/leaflet.js"></script>
 *        <script src="./js/adapters/map-leaflet.example.js"></script>
 *   2. 给 js/data.js 中每个地点补充真实经纬度字段：lng / lat
 *        （示意坐标 mapX/mapY 不能用于真实地图）
 *   3. 在 js/config.js 设置：
 *        CW_CONFIG.map.provider = 'leaflet'
 *        CW_CONFIG.map.leaflet.tileUrl / routerUrl
 *
 * 高德 / 腾讯地图同理：把下面的 L.* 调用换成对应 SDK，并在 config.js
 * 里填 key（建议经自己的后端代理取 key，不要把密钥硬编码进前端）。
 * ===================================================================== */
(function () {
  const CW = window.CW = window.CW || {};
  const cfg = () => (window.CW_CONFIG && window.CW_CONFIG.map) || {};

  function renderLeaflet(host, route, opts) {
    opts = opts || {};
    const conf = cfg().leaflet || {};
    if (typeof L === 'undefined') {
      throw new Error('Leaflet SDK 未加载');
    }

    host.innerHTML = '<div class="real-map" id="leafletHost"></div>' +
      '<div class="map-note">' + (CW.ui.icon ? CW.ui.icon('info') : 'ℹ️') +
      '<span>真实地图 · 路线为直线连接示意，步行路径需接入路径规划服务；点位坐标上线前需核验</span></div>';
    const el = host.querySelector('#leafletHost');

    const map = L.map(el, { zoomControl: true, attributionControl: true });
    L.tileLayer(conf.tileUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: conf.attribution || '© OpenStreetMap contributors'
    }).addTo(map);

    let markers = [], polyline = null;

    /* 从地点对象取坐标：优先真实 lng/lat；没有则调用 config 的 geocode 兜底 */
    async function llOf(place) {
      if (place.lng != null && place.lat != null) return [place.lat, place.lng];
      if (typeof cfg().geocode === 'function') {
        const g = await cfg().geocode(place);
        if (g && g.lng != null) return [g.lat, g.lng];
      }
      return null;   // 缺坐标时不臆造位置
    }

    async function draw(r) {
      markers.forEach(m => m.remove()); markers = [];
      if (polyline) { polyline.remove(); polyline = null; }
      if (!r) return;

      const places = CW.data.places(r.places);
      const latlngs = [];
      for (let i = 0; i < places.length; i++) {
        const p = places[i], ll = await llOf(p);
        if (!ll) continue;                 // 无真实坐标的点直接跳过，不画到错误位置
        latlngs.push(ll);
        const isStart = i === 0, isEnd = i === places.length - 1 && places.length > 1;
        const num = isStart ? '起' : (isEnd ? '终' : String(i + 1));
        const marker = L.marker(ll, {
          title: p.name,
          icon: L.divIcon({
            className: 'cw-marker' + (isStart ? ' start' : isEnd ? ' end' : ''),
            html: '<span>' + num + '</span>',
            iconSize: [24, 24], iconAnchor: [12, 12]
          })
        }).addTo(map);
        marker.on('click', () => opts.onSelect && opts.onSelect(p.id));
        markers.push(marker);
      }
      if (latlngs.length > 1) {
        // 注意：这是直线连接。真实步行路径应请求路径规划服务（如 OSRM）后替换坐标串
        polyline = L.polyline(latlngs, { color: '#1F3D2B', weight: 3, dashArray: '6 6' }).addTo(map);
      }
      if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.25));
    }

    draw(route);

    return {
      provider: 'leaflet',
      update(newRoute) { draw(newRoute); },
      async select(id) {
        const p = CW.data.place(id); if (!p) return;
        const ll = await llOf(p);
        if (ll) map.panTo(ll);
      },
      destroy() { map.remove(); host.innerHTML = ''; }
    };
  }

  // 注册到地图适配器表；业务侧无需任何改动
  CW.map.registerProvider('leaflet', renderLeaflet);
})();
