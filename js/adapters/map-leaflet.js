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

  /* 只在用户明确选择 leaflet、且 SDK 已加载时注册 */
  if (!CW.MapEngine || !root.L || readMapConfig().provider !== 'leaflet') return;

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

    host.innerHTML =
      '<div class="real-map" id="leafletMap"></div>' +
      '<div class="map-note">' + icon('info') +
      '<span>' + esc(attribution) + ' · 路线为直线连接，示意图，非导航路径；点位为示例数据</span></div>' +
      '<div class="leaflet-notices"></div>';

    const mapEl = host.querySelector('.real-map');
    const noticesEl = host.querySelector('.leaflet-notices');

    const map = L.map(mapEl, { zoomControl: true, attributionControl: true });
    const tiles = L.tileLayer(tileUrl, {
      maxZoom: maxZoom,
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
      coords = [];
      missingCount = 0;

      routeIds.forEach((id, index) => {
        const place = CW.data.place(id);
        const ll = validCoord(place);
        if (!ll) { missingCount += 1; return; }

        coords.push(ll);
        const isStart = index === 0;
        const isEnd = index === routeIds.length - 1 && routeIds.length > 1;
        const num = isStart ? '起' : (isEnd ? '终' : String(index + 1));
        const marker = L.marker(ll, {
          title: place.name,
          icon: L.divIcon({
            className: 'cw-marker' + (isStart ? ' start' : isEnd ? ' end' : ''),
            html: '<span>' + esc(num) + '</span>',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          })
        });
        marker.bindTooltip(place.name, { direction: 'top', offset: [0, -12] });
        marker.on('click', function () {
          if (opts.onSelect) opts.onSelect(place.id);
        });
        markerById[place.id] = marker;
        pinLayer.addLayer(marker);
      });

      if (coords.length > 1) {
        // 直线连接：不是路径规划结果，不能标成导航
        routeLine = L.polyline(coords, { color: '#1F3D2B', weight: 3, dashArray: '6 6' });
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
        map.setView(DEFAULT_CENTER, 12);
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
