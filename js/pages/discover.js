/* =====================================================================
 * pages/discover.js · 发现路线
 *  - 收藏写入 CW.state.favorites 并交给 app.js 持久化（CW.storage）
 *  - 收藏态有视觉与 aria-pressed 表达，不只用文案
 *  - 详情弹窗通过 U.modal 的返回值做作用域绑定，避免多个弹窗互相踩踏
 * ===================================================================== */
(function () {
  const CW = (window.CW = window.CW || {});
  const D = CW.data, U = CW.ui;

  const DUR_BUCKETS = [
    { id: 'all', name: '不限时长', test: () => true },
    { id: 'short', name: '2.5 小时内', test: m => m <= 150 },
    { id: 'mid', name: '约 3 小时', test: m => m > 150 && m <= 210 },
    { id: 'long', name: '4 小时左右', test: m => m > 210 }
  ];

  function track(event, props) {
    try { if (CW.track) CW.track(event, props); } catch (e) { /* 忽略 */ }
  }
  function favKey(id) { return 'cur_' + id; }
  function isFav(id) {
    return !!(CW.state && CW.state.favorites && CW.state.favorites.routes.indexOf(favKey(id)) >= 0);
  }
  function persistFavorites() {
    try {
      if (CW.persistFavorites) CW.persistFavorites();
      else if (CW.storage && typeof CW.storage.saveFavorites === 'function') CW.storage.saveFavorites(CW.state.favorites);
    } catch (e) { /* 忽略 */ }
  }
  function saveDraftSoon() {
    try { if (CW.saveDraftSoon) CW.saveDraftSoon(); } catch (e) { /* 忽略 */ }
  }

  function render(host, state) {
    const f = state.discoverFilter;
    const bucket = DUR_BUCKETS.find(b => b.id === f.duration) || DUR_BUCKETS[0];
    const list = D.routesOfCity(state.city).filter(r =>
      (f.theme === 'all' || r.themes.indexOf(f.theme) >= 0) && bucket.test(r.duration));

    host.innerHTML = `
      <div class="page-head">
        <h1>发现路线</h1>
        <p>精选的城市漫步路线，可以直接体验，也可以作为规划的起点。收藏会保存在本机。</p>
      </div>

      <div class="filter-bar">
        <div class="filter-group"><span class="fg-label" id="fgCity">城市</span>
          <div class="chips" role="group" aria-labelledby="fgCity">
            ${D.CITIES.map(c => `<button class="pill${state.city === c.id ? ' on' : ''}" type="button" data-fcity="${c.id}" aria-pressed="${state.city === c.id ? 'true' : 'false'}">${U.esc(c.name)}</button>`).join('')}
          </div></div>
        <div class="filter-group"><span class="fg-label" id="fgTheme">主题</span>
          <div class="chips" role="group" aria-labelledby="fgTheme">
            <button class="pill${f.theme === 'all' ? ' on' : ''}" type="button" data-ftheme="all" aria-pressed="${f.theme === 'all' ? 'true' : 'false'}">全部</button>
            ${D.THEMES.map(t => `<button class="pill${f.theme === t.id ? ' on' : ''}" type="button" data-ftheme="${t.id}" aria-pressed="${f.theme === t.id ? 'true' : 'false'}">${U.esc(t.name)}</button>`).join('')}
          </div></div>
        <div class="filter-group"><span class="fg-label" id="fgDur">时长</span>
          <div class="chips" role="group" aria-labelledby="fgDur">
            ${DUR_BUCKETS.map(b => `<button class="pill${f.duration === b.id ? ' on' : ''}" type="button" data-fdur="${b.id}" aria-pressed="${f.duration === b.id ? 'true' : 'false'}">${U.esc(b.name)}</button>`).join('')}
          </div></div>
        <button class="link-btn" type="button" data-act="reset" style="margin-left:auto">${U.icon('refresh')}重置筛选</button>
      </div>

      <div class="section-title">
        <h2>${U.esc((D.city(state.city) || { name: state.city }).name)} · 共 ${list.length} 条路线</h2>
        <span class="st-sub">示例数据 · 时长与距离为估算值</span>
      </div>

      ${list.length ? `<div class="route-grid">${list.map(routeCard).join('')}</div>` : emptyState()}
    `;

    host.querySelectorAll('[data-fcity]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.fcity;
      const city = D.city(id);
      state.city = id;
      state.conditions.city = id;
      if (city && !city.ready) U.toast(`${city.name}的示例路线还在筹备中`, 'warn');
      saveDraftSoon();
      CW.render();
    }));
    host.querySelectorAll('[data-ftheme]').forEach(b => b.addEventListener('click', () => {
      state.discoverFilter.theme = b.dataset.ftheme;
      CW.render();
    }));
    host.querySelectorAll('[data-fdur]').forEach(b => b.addEventListener('click', () => {
      state.discoverFilter.duration = b.dataset.fdur;
      CW.render();
    }));
    host.querySelectorAll('[data-act="reset"]').forEach(b => b.addEventListener('click', () => {
      state.discoverFilter = { theme: 'all', duration: 'all' };
      CW.render();
      U.toast('筛选已重置');
    }));
    host.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => openRoute(b.dataset.view)));
    host.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => useRoute(b.dataset.use)));
    host.querySelectorAll('[data-favr]').forEach(b => b.addEventListener('click', () => favCurated(b.dataset.favr)));
  }

  function routeCard(r) {
    const city = D.city(r.city) || { name: r.city };
    const faved = isFav(r.id);
    return `<div class="route-card">
      <div class="rc-img" style="background-image:url('${r.cover}')">
        <div class="rc-badges">${r.themes.map(t => `<span class="rc-badge">${U.esc((D.theme(t) || { name: t }).name)}</span>`).join('')}</div>
        <span class="rc-dur">${U.fmtDuration(r.duration)}</span>
      </div>
      <div class="rc-body">
        <h3>${U.esc(r.name)}</h3>
        <div class="rc-desc">${U.esc(r.desc)}</div>
        <div class="rc-meta">
          <span class="mm">${U.icon('pin')}${U.esc(city.name)}</span>
          <span class="mm">${U.icon('route')}${r.places.length} 个地点</span>
          <span class="mm">${U.icon('walk')}约 ${r.distanceKm} km</span>
          <span class="mm">${U.icon('wallet')}¥${r.budget[0]}–${r.budget[1]}</span>
        </div>
        <div class="rc-acts">
          <button class="btn btn-ghost btn-sm" type="button" data-view="${r.id}">查看路线</button>
          <button class="btn btn-primary btn-sm" type="button" data-use="${r.id}">${U.icon('sparkle')}使用此路线重新规划</button>
        </div>
        <button class="link-btn fav-line${faved ? ' on' : ''}" type="button" data-favr="${r.id}" aria-pressed="${faved ? 'true' : 'false'}">
          ${U.icon(faved ? 'check' : 'bookmark')}${faved ? '已收藏，点击取消' : '收藏这条路线'}</button>
      </div>
    </div>`;
  }

  function emptyState() {
    return `<div class="card"><div class="empty">
      <div class="empty-ico">${U.icon('compass')}</div>
      <h4>没有符合条件的路线</h4>
      <p>换一个主题或时长试试。目前示例数据只覆盖南京老城区域，其他城市还在筹备中。</p>
      <button class="btn btn-ghost" type="button" data-act="reset">重置筛选</button>
    </div></div>`;
  }

  function openRoute(id) {
    const r = D.route(id);
    if (!r) return;
    const places = D.places(r.places);
    const faved = isFav(r.id);
    const m = U.modal({
      title: r.name,
      sub: `${(D.city(r.city) || { name: r.city }).name} · ${U.fmtDuration(r.duration)} · ${r.places.length} 个地点`,
      width: 680,
      body: `
        <div class="detail-hero" style="background-image:url('${r.cover}')">
          <span class="dh-cat">${r.style.join(' · ')}</span></div>
        <p style="font-size:13.5px;line-height:1.75;color:var(--ink-2)">${U.esc(r.desc)}</p>
        <div class="divider"></div>
        <div class="detail-rows">
          <div class="kv"><span>预计时长</span><b>${U.fmtDuration(r.duration)}（估算）</b></div>
          <div class="kv"><span>步行距离</span><b>约 ${r.distanceKm} km（估算）</b></div>
          <div class="kv"><span>预算区间</span><b>¥${r.budget[0]}–${r.budget[1]}（估算）</b></div>
          <div class="kv"><span>路线风格</span><b>${r.style.join('、')}</b></div>
        </div>
        <div class="divider"></div>
        <div class="section-title" style="margin:0 0 10px"><h2 style="font-size:15px">路线节点</h2>
          <span class="st-sub">顺序为预设内容</span></div>
        <div class="timeline">
          ${places.map((p, i) => `<div class="tl-item">
            <div class="tl-rail"><div class="tl-num">${i + 1}</div><div class="tl-line"></div></div>
            <div class="saved-place" style="flex:1 1 auto">
              <div class="sp-img" style="background-image:url('${p.img}')"></div>
              <div class="sp-body">
                <b>${U.esc(p.name)}</b>
                <span>${U.esc(D.cat(p.cat).name)} · 建议停留 ${p.stay} 分钟 · ${U.fmtCost(p.cost)}</span>
                <div class="hint" style="margin-top:4px">${U.esc(p.reason)}</div>
              </div>
            </div>
          </div>`).join('')}
        </div>
        <div class="note-box" style="margin-top:14px">${U.icon('info')}
          <span>${D.DISCLAIMER.sample} · ${D.DISCLAIMER.estimate} · ${D.DISCLAIMER.hours}</span></div>`,
      footer: `<button class="btn btn-ghost" type="button" data-mclose>关闭</button>
               <button class="btn btn-soft" type="button" data-act="fav">${U.icon('bookmark')}${faved ? '取消收藏' : '收藏路线'}</button>
               <button class="btn btn-primary" type="button" data-act="use">${U.icon('sparkle')}使用此路线重新规划</button>`
    });
    if (!m.el) return;
    const fav = m.el.querySelector('[data-act="fav"]');
    if (fav) fav.addEventListener('click', () => { favCurated(r.id); m.close(); });
    const use = m.el.querySelector('[data-act="use"]');
    if (use) use.addEventListener('click', () => { m.close(); useRoute(r.id); });
  }

  function useRoute(id) {
    const cur = D.route(id);
    if (!cur) return;
    if (CW.pages.home && typeof CW.pages.home.useCurated === 'function') {
      CW.pages.home.useCurated(cur.id, CW.state);
    } else {
      U.toast('首页路线模块尚未加载', 'err');
    }
  }

  function favCurated(id) {
    const cur = D.route(id);
    const key = favKey(id);
    const arr = CW.state.favorites.routes;
    const i = arr.indexOf(key);
    if (i >= 0) {
      arr.splice(i, 1);
      CW.state.favorites.routeData && delete CW.state.favorites.routeData[key];
      if (CW.forgetRouteData) CW.forgetRouteData(key);
      else persistFavorites();
      U.toast('已取消收藏');
    } else {
      arr.push(key);
      if (cur && CW.pages.home && typeof CW.pages.home.routeFromCurated === 'function') {
        try {
          const route = CW.pages.home.routeFromCurated(cur);
          if (CW.saveFavoriteRoute) CW.saveFavoriteRoute(route);
          else {
            CW.state.favorites.routeData[key] = route;
            persistFavorites();
          }
        } catch (e) { persistFavorites(); }
      } else {
        persistFavorites();
      }
      track('route_saved', { source: 'discover', routeId: key });
      U.toast('已收藏，可在「我的收藏」查看');
    }
    CW.render();
  }

  CW.pages = CW.pages || {};
  CW.pages.discover = { render, openRoute };
})();
