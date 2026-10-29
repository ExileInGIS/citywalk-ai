/* =====================================================================
 * map-leaflet.js · Leaflet + OSM 地图 Provider
 * ---------------------------------------------------------------------
 * 启用条件（三条同时满足才注册，否则 MapEngine 会回退 mock 并提示）：
 *   1. CW_CONFIG.MAP.provider === 'leaflet'
 *   2. window.L 存在（index.html 里按注释引入 Leaflet CDN）
 *   3. CW.MapEngine 已加载
 *
 * 本文件不加载 Leaflet SDK 本身，也不请求任何路径规划服务：
 *   · 只画有 lat/lng 的地点；缺失或坐标非法的点跳过并统计；
 *   · 路线是直线示意，不是导航路径；
 *   · 必须展示 OSM 归属；
 *   · 瓦片失败时提示，但列表 / 时间线不依赖地图，仍然可用。
 * ===================================================================== */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const CW = (root.CW = root.CW || {});

  const DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const DEFAULT_ATTRIBUTION = '© OpenStreetMap contributors';
  const DEFAULT_CENTER = [32.04, 118.78]; // 仅在没有可用坐标时给 OSM 一个合理视口

  function readMapConfig() {
    return (root.CW_CONFIG && (root.CW_CONFIG.MAP || root.CW_CONFIG.map)) || {};
  }

  /* 先注册 Provider；运行时会由 MapEngine 按 MAP.provider 选择是否使用。
     不能在加载时判断 provider，因为 map-bootstrap 可能在脚本加载后才切到 leaflet。 */
  if (!CW.MapEngine || !root.L) return;

  function esc(value) {
    if (CW.ui && typeof CW.ui.esc === 'function') return CW.ui.esc(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icon(name) {
    return (CW.ui && typeof CW.ui.icon === 'function') ? CW.ui.icon(name) : '';
  }

  function validCoord(place) {
    if (!place || typeof place.lat !== 'number' || typeof place.lng !== 'number') return null;
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
    if (place.lat < -90 || place.lat > 90) return null;
    if (place.lng < -180 || place.lng > 180) return null;
    return [place.lat, place.lng];
  }

  /* 高德栅格瓦片使用 GCJ-02；数据层仍是 WGS84，只在显示时转换。 */
  const PI = Math.PI;
  const GCJ_A = 6378245.0;
  const GCJ_EE = 0.00669342162296594323;
  function outOfChina(lat, lng) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }
  function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
  }
  function wgs84ToGcj02(lat, lng) {
    if (outOfChina(lat, lng)) return [lat, lng];
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * PI;
    let magic = Math.sin(radLat);
    magic = 1 - GCJ_EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * PI);
    dLng = (dLng * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * PI);
    return [lat + dLat, lng + dLng];
  }

  function initLeaflet(host, route, opts) {
    opts = opts || {};
    if (!CW.data || typeof CW.data.place !== 'function') {
      throw new Error('地点数据未加载');
    }
    const L = root.L;
    const conf = readMapConfig().leaflet || {};
    const tileUrl = (typeof conf.tileUrl === 'string' && conf.tileUrl.trim())
      ? conf.tileUrl.trim() : DEFAULT_TILE_URL;
    const attribution = (typeof conf.attribution === 'string' && conf.attribution.trim())
      ? conf.attribution.trim() : DEFAULT_ATTRIBUTION;
    const parsedMaxZoom = Number(conf.maxZoom);
    const maxZoom = Number.isFinite(parsedMaxZoom) && parsedMaxZoom > 0
      ? Math.round(parsedMaxZoom) : 19;
    const isGcj = conf.coordSystem === 'gcj02' || /autonavi\.com|amap\.com/i.test(tileUrl);
    const subdomains = (typeof conf.subdomains === 'string' && conf.subdomains.trim())
      ? conf.subdomains.trim() : 'abc';

    function displayCoord(place) {
      const c = validCoord(place);
      if (!c) return null;
      return isGcj ? wgs84ToGcj02(c[0], c[1]) : c;
    }
    function displayCenter() {
      return isGcj ? wgs84ToGcj02(DEFAULT_CENTER[0], DEFAULT_CENTER[1]) : DEFAULT_CENTER.slice();
    }

    host.innerHTML =
      '<div class="real-map" id="leafletMap"></div>' +
      '<div class="map-note">' + icon('info') +
      '<span>' + esc(attribution) + ' · 路线为直线连接，示意图，非导航路径；点位来自 OSM 数据</span></div>' +
      '<div class="leaflet-notices"></div>';

    const mapEl = host.querySelector('.real-map');
    const noticesEl = host.querySelector('.leaflet-notices');

    const map = L.map(mapEl, { zoomControl: true, attributionControl: true });
    const tiles = L.tileLayer(tileUrl, {
      maxZoom: maxZoom,
      subdomains: subdomains,
      attribution: attribution + ' · Leaflet'
    });
    tiles.addTo(map);

    const pinLayer = L.layerGroup();
    const layers = { base: true, route: true, pins: true };
    const markerById = Object.create(null);
    let routeLine = null;
    let coords = [];
    let missingCount = 0;
    let missingNotice = null;
    let tileErrorNotice = null;
    let tileErrors = 0;
    let destroyed = false;

    function addNotice(text) {
      const doc = host.ownerDocument || root.document;
      const box = doc.createElement('div');
      box.className = 'note-box amber';
      box.setAttribute('role', 'status');
      box.style.margin = '8px 12px 12px';
      box.textContent = text;
      noticesEl.appendChild(box);
      return box;
    }

    function onTileError() {
      tileErrors += 1;
      if (tileErrorNotice || destroyed) return;
      tileErrorNotice = addNotice('地图瓦片加载失败，列表与时间线仍可用');
    }
    tiles.on('tileerror', onTileError);

    function updateMissingNotice() {
      if (missingCount > 0) {
        if (!missingNotice) missingNotice = addNotice('');
        missingNotice.textContent = missingCount + ' 个地点缺少坐标，未在真实地图上显示；列表与时间线仍完整。';
      } else if (missingNotice) {
        missingNotice.remove();
        missingNotice = null;
      }
    }

    function clearOverlays() {
      pinLayer.clearLayers();
      Object.keys(markerById).forEach(id => { delete markerById[id]; });
      if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
      }
    }

    function draw(r, doFit) {
      if (destroyed) return;
      clearOverlays();

      const routeIds = (r && Array.isArray(r.places)) ? r.places : [];
      const routeSet = Object.create(null);
      routeIds.forEach(id => { routeSet[id] = true; });
      const routePositions = [];
      coords = [];
      missingCount = 0;

      /* 全部有坐标地点；路线点用数字/起终样式，其余用圆点。 */
      const allPlaces = (CW.data.placesOfCity && CW.data.placesOfCity('nanjing')) || [];
      allPlaces.forEach(place => {
        const ll = displayCoord(place);
        if (!ll) { missingCount += 1; return; }
        coords.push(ll);
        const routeIndex = routeIds.indexOf(place.id);
        const onRoute = routeIndex >= 0;
        if (onRoute) routePositions.push(ll);
        const isStart = onRoute && routeIndex === 0;
        const isEnd = onRoute && routeIndex === routeIds.length - 1 && routeIds.length > 1;
        const num = isStart ? '起' : (isEnd ? '终' : String(routeIndex + 1));
        const marker = L.marker(ll, {
          title: place.name,
          icon: L.divIcon(onRoute ? {
            className: 'cw-marker' + (isStart ? ' start' : isEnd ? ' end' : ''),
            html: '<span>' + esc(num) + '</span>',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          } : {
            className: 'cw-marker dot',
            html: '<span></span>',
            iconSize: [8, 8],
            iconAnchor: [4, 4]
          })
        });
        marker.bindTooltip(place.name, { direction: 'top', offset: [0, -8] });
        marker.on('click', function () {
          if (opts.onSelect) opts.onSelect(place.id);
        });
        markerById[place.id] = marker;
        pinLayer.addLayer(marker);
      });

      if (routePositions.length > 1) {
        // 直线连接：不是路径规划结果，不能标成导航
        routeLine = L.polyline(routePositions, { color: '#1F3D2B', weight: 3, dashArray: '6 6' });
      }

      if (layers.pins) pinLayer.addTo(map); else map.removeLayer(pinLayer);
      if (layers.route && routeLine) routeLine.addTo(map);
      if (layers.base) tiles.addTo(map); else map.removeLayer(tiles);

      updateMissingNotice();
      if (doFit) fit();
    }

    function fit() {
      if (destroyed) return;
      if (!coords.length) {
        map.setView(displayCenter(), 12);
        return;
      }
      if (coords.length === 1) {
        map.setView(coords[0], 14);
        return;
      }
      map.fitBounds(L.latLngBounds(coords).pad(0.25));
    }

    function setLayer(name, on) {
      if (!Object.prototype.hasOwnProperty.call(layers, name)) return false;
      layers[name] = !!on;
      if (name === 'base') {
        if (layers.base) tiles.addTo(map); else map.removeLayer(tiles);
      } else if (name === 'pins') {
        if (layers.pins) pinLayer.addTo(map); else map.removeLayer(pinLayer);
      } else if (name === 'route' && routeLine) {
        if (layers.route) routeLine.addTo(map); else map.removeLayer(routeLine);
      }
      return true;
    }

    draw(route, true);

    return {
      provider: 'leaflet',
      update: function (newRoute) {
        if (destroyed) return;
        draw(newRoute, true);
      },
      select: function (id) {
        if (destroyed) return;
        const marker = markerById[id];
        if (!marker) return;
        map.panTo(marker.getLatLng());
        if (typeof marker.openTooltip === 'function') marker.openTooltip();
      },
      setLayer: setLayer,
      fit: fit,
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        try { tiles.off('tileerror', onTileError); } catch (e) { /* 已移除 */ }
        clearOverlays();
        try { map.remove(); } catch (e) { /* 已销毁 */ }
        host.innerHTML = '';
      }
    };
  }

  CW.MapEngine.registerProvider({ id: 'leaflet', init: initLeaflet });
})();
