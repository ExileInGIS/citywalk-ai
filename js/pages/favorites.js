/* =====================================================================
 * pages/favorites.js · 我的收藏
 *  - 收藏与草稿由 app.js + CW.storage 持久化；刷新后仍可恢复
 *  - 支持导出 Markdown / JSON、清除本地数据（二次确认）
 *  - 恢复旧结构路线时优先 CW.core.recompute，失败则降级展示并标注
 * ===================================================================== */
(function () {
  const CW = (window.CW = window.CW || {});
  const D = CW.data, U = CW.ui;

  function storageEnabled() {
    try {
      if (CW.storageIsEnabled) return !!CW.storageIsEnabled();
      if (!CW.storage) return false;
      const en = CW.storage.enabled;
      return typeof en === 'function' ? !!en() : en !== false;
    } catch (e) { return false; }
  }
  function persistFavorites() {
    try {
      if (CW.persistFavorites) CW.persistFavorites();
      else if (CW.storage && typeof CW.storage.saveFavorites === 'function') CW.storage.saveFavorites(CW.state.favorites);
    } catch (e) { /* 忽略 */ }
  }
  function hydrate(route) {
    try {
      if (CW.pages.home && typeof CW.pages.home.hydrateRoute === 'function') return CW.pages.home.hydrateRoute(route);
    } catch (e) { /* 降级展示 */ }
    return route;
  }

  /* 收藏的路线 id → 路线对象 */
  function resolve(id) {
    const state = CW.state;
    if (state.routeStore[id]) return hydrate(state.routeStore[id]);
    const stored = state.favorites.routeData && state.favorites.routeData[id];
    if (stored) {
      const route = hydrate(stored);
      state.routeStore[id] = route;
      return route;
    }
    if (id.indexOf('cur_') === 0) {
      const cur = D.route(id.slice(4));
      if (cur && CW.pages.home && typeof CW.pages.home.routeFromCurated === 'function') {
        return CW.pages.home.routeFromCurated(cur);
      }
    }
    return null;
  }

  function render(host, state) {
    const routes = state.favorites.routes.map(resolve);
    const lost = state.favorites.routes.length - routes.filter(Boolean).length;
    const places = D.places(state.favorites.places);
    const enabled = storageEnabled();
    host.innerHTML = `
      <div class="page-head page-head-row">
        <div>
          <h1>我的收藏</h1>
          <p>收藏的路线与地点保存在${enabled ? '此浏览器本地' : '本次会话内存中'}，可导出或一键清除。</p>
        </div>
        <div class="page-head-actions">
          <button class="btn btn-ghost" type="button" data-act="clearData">${U.icon('trash')}清除本地数据</button>
        </div>
      </div>

      <div class="section-title">
        <h2>收藏的路线</h2>
        <span class="st-sub">${routes.filter(Boolean).length} 条${lost > 0 ? ' · ' + lost + ' 条已失效' : ''}</span>
      </div>
      ${routes.filter(Boolean).length ? `<div class="grid-2" style="gap:14px">
        ${routes.filter(Boolean).map(routeRow).join('')}
      </div>` : emptyBlock('bookmark', '还没有收藏路线',
        '生成一条路线或从「发现路线」里挑一条，点「收藏路线」就会出现在这里。',
        `<button class="btn btn-primary" type="button" data-act="toHome">${U.icon('sparkle')}去规划一条路线</button>
         <button class="btn btn-ghost" type="button" data-act="toDiscover">浏览发现路线</button>`)}

      ${lost > 0 ? `<div class="note-box amber" style="margin-top:14px">${U.icon('alert')}
        <span>有 ${lost} 条收藏无法还原（数据可能来自旧版本或被清除），已从列表中隐藏。可重新生成或再次收藏。</span></div>` : ''}

      <div class="section-title" style="margin-top:34px">
        <h2>收藏的地点</h2>
        <span class="st-sub">${places.length} 个</span>
      </div>
      ${places.length ? `<div class="grid-2" style="gap:14px">
        ${places.map(placeRow).join('')}
      </div>` : emptyBlock('heart', '还没有收藏地点',
        '在路线卡片或地点详情里点一下爱心，就会收藏到这里。',
        `<button class="btn btn-ghost" type="button" data-act="toDiscover">去发现地点</button>`)}

      <div class="note-box" style="margin-top:26px">${U.icon('info')}
        <span>${enabled
          ? '收藏与草稿只保存在当前浏览器的 localStorage 中，不会上传服务器；在「个人中心」或此处可清除。'
          : '浏览器本地存储当前不可用（可能被禁用或处于隐私模式），收藏仅在本次会话有效。'}</span></div>
    `;

    const on = (act, fn) => {
      const b = host.querySelector('[data-act="' + act + '"]');
      if (b) b.addEventListener('click', fn);
    };
    on('toHome', () => CW.navigate('home'));
    on('toDiscover', () => CW.navigate('discover'));
    on('clearData', () => openClearDataConfirm());
    host.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openSavedRoute(b.dataset.open)));
    host.querySelectorAll('[data-reuse]').forEach(b => b.addEventListener('click', () => reuse(b.dataset.reuse)));
    host.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => removeRoute(b.dataset.rm)));
    host.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => exportRoute(b.dataset.export)));
    host.querySelectorAll('[data-pdetail]').forEach(b => b.addEventListener('click', () => {
      if (CW.pages.home && typeof CW.pages.home.openPlace === 'function') CW.pages.home.openPlace(b.dataset.pdetail);
    }));
    host.querySelectorAll('[data-prm]').forEach(b => b.addEventListener('click', () => removePlace(b.dataset.prm)));
  }

  function emptyBlock(ico, title, desc, actions) {
    return `<div class="card"><div class="empty">
      <div class="empty-ico">${U.icon(ico)}</div>
      <h4>${U.esc(title)}</h4>
      <p>${U.esc(desc)}</p>
      <div class="chips" style="justify-content:center">${actions}</div>
    </div></div>`;
  }

  function routeBudget(route) {
    return U.fmtBudget ? U.fmtBudget(route.budget) : U.fmtCost(route.budget);
  }
  function routeRow(r) {
    const first = D.place((r.places || [])[0]);
    const curated = r.source === 'curated' && r.curatedId ? D.route(r.curatedId) : null;
    const cover = curated ? curated.cover : (first ? first.img : '');
    const legacy = r._legacy ? ' · <span class="legacy-flag">旧版数据</span>' : '';
    return `<div class="saved-route">
      <div class="sr-img" style="background-image:url('${cover}')"></div>
      <div class="sr-body">
        <h4>${U.esc(r.name)}</h4>
        <p>${U.fmtDuration(r.actualMin)} · ${(r.places || []).length} 个地点 · 约 ${r.distanceKm != null ? r.distanceKm : '—'} km · ${routeBudget(r)}${legacy}</p>
        <div class="chips" style="margin-top:8px">
          ${(r.style || []).slice(0, 3).map(s => `<span class="tag">${U.esc(s)}</span>`).join('')}
          ${r.degraded ? '<span class="tag tag-amber">已降级</span>' : ''}
        </div>
      </div>
      <div class="saved-actions">
        <button class="btn btn-primary btn-sm" type="button" data-reuse="${r.id}">${U.icon('sparkle')}再次规划</button>
        <button class="btn btn-ghost btn-sm" type="button" data-open="${r.id}">查看详情</button>
        <button class="btn btn-ghost btn-sm" type="button" data-export="${r.id}">${U.icon('download')}导出</button>
        <button class="btn btn-soft btn-sm" type="button" data-rm="${r.id}">${U.icon('trash')}移除收藏</button>
      </div>
    </div>`;
  }

  function placeRow(p) {
    return `<div class="saved-place">
      <div class="sp-img" style="background-image:url('${p.img}')"></div>
      <div class="sp-body">
        <b>${U.esc(p.name)}</b>
        <span>${U.esc(D.cat(p.cat).name)} · ${U.esc(p.area)}</span>
        <span style="display:block;margin-top:3px">建议停留 ${p.stay} 分钟 · ${U.fmtCost(p.cost)} · 营业时间：信息待确认</span>
      </div>
      <div class="saved-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-pdetail="${p.id}">查看详情</button>
        <button class="btn btn-soft btn-sm" type="button" data-prm="${p.id}">${U.icon('trash')}移除</button>
      </div>
    </div>`;
  }

  /* ---------------- 操作 ---------------- */
  function reuse(id) {
    const r = resolve(id);
    if (!r) { U.toast('这条路线已失效', 'err'); return; }
    const state = CW.state;
    const c = r.conditions || {};
    state.city = r.city || c.city || state.city;
    state.route = r;
    state.conditions = c;
    state.lastPlanConditions = JSON.parse(JSON.stringify(c));
    state.view = 'result';
    state.selectedPlace = null;
    state.lastDiff = null;
    state.clarify = null;
    state.error = null;
    state.empty = null;
    state.planMeta = { date: state.draft.date, requestedAt: new Date().toISOString(), restored: true };
    const d = state.draft;
    if (Array.isArray(c.interests)) d.interests = c.interests.filter(x => D.interest(x));
    if (c.durationMin) d.durationMin = c.durationMin;
    d.budgetMax = c.budgetMax == null ? null : c.budgetMax;
    if (c.budgetBasis) d.budgetBasis = c.budgetBasis;
    d.startTime = c.startTime || c.startAt || d.startTime;
    d.endTime = c.endTime || c.mustEnd || '';
    d.startLocation = c.startLocation || c.from || '';
    if (c.party) d.party = c.party;
    if (c.walkingTolerance) d.walkingTolerance = c.walkingTolerance;
    if (c.transport) d.transport = c.transport;
    if (c.pace) d.pace = c.pace;
    if (c.weather) d.weather = c.weather;
    if (Array.isArray(c.foodPreferences)) d.foodPreferences = c.foodPreferences.slice();
    if (Array.isArray(c.accessibility)) d.accessibility = c.accessibility.slice();
    if (Array.isArray(c.avoid)) d.avoid = c.avoid.slice();
    if (Array.isArray(c.mustVisit)) { d.mustVisit = c.mustVisit.slice(); d.mustVisitText = c.mustVisit.join('、'); }
    state.chat = [
      { who: 'me', text: '我想再看看「' + r.name + '」' },
      { who: 'ai', text: r._legacy
        ? '已载入这条旧版收藏路线。部分评分、来源与约束信息可能缺失；建议重新生成后再调整。'
        : '已载入这条路线。可以直接改，比如「少走一点路」「加一家咖啡馆」「改成 3 小时」。' }
    ];
    state.chatChips = null;
    try { if (CW.saveDraftSoon) CW.saveDraftSoon(); } catch (e) { /* 忽略 */ }
    CW.navigate('home');
    U.toast(r._legacy ? '已载入旧版路线（降级显示）' : '已载入收藏的路线', r._legacy ? 'warn' : 'ok');
  }

  function exportRoute(id) {
    const r = resolve(id);
    if (!r) { U.toast('这条路线已失效，无法导出', 'err'); return; }
    if (CW.pages.home && typeof CW.pages.home.openExport === 'function') {
      CW.pages.home.openExport(CW.state, r);
    } else {
      U.toast('导出模块尚未加载', 'err');
    }
  }

  function removeRoute(id) {
    const arr = CW.state.favorites.routes;
    const i = arr.indexOf(id);
    if (i < 0) return;
    const r = resolve(id);
    const m = U.modal({
      title: '移除这条收藏？',
      sub: '只影响收藏列表，不会删除任何已生成的数据',
      body: `<p style="font-size:13.5px;line-height:1.75">即将从「我的收藏」移除：<b>${U.esc(r ? r.name : id)}</b>。
        移除后如需再次使用，可以重新生成或从「发现路线」重新收藏。建议先导出需要保留的路线。</p>`,
      footer: `<button class="btn btn-ghost" type="button" data-mclose>取消</button>
               <button class="btn btn-primary" type="button" data-act="ok">确认移除</button>`
    });
    if (!m.el) return;
    const ok = m.el.querySelector('[data-act="ok"]');
    if (ok) ok.addEventListener('click', () => {
      const j = CW.state.favorites.routes.indexOf(id);
      if (j >= 0) CW.state.favorites.routes.splice(j, 1);
      if (CW.state.favorites.routeData) delete CW.state.favorites.routeData[id];
      if (CW.forgetRouteData) CW.forgetRouteData(id);
      else persistFavorites();
      m.close();
      CW.render();
      U.toast('已移除收藏');
    });
  }

  function removePlace(id) {
    const arr = CW.state.favorites.places;
    const i = arr.indexOf(id);
    if (i < 0) return;
    arr.splice(i, 1);
    persistFavorites();
    CW.render();
    U.toast('已移除收藏地点');
  }

  function openClearDataConfirm() {
    if (typeof CW.openClearDataConfirm === 'function') { CW.openClearDataConfirm(); return; }
    const m = U.modal({
      title: '清除本地数据？',
      sub: '此操作不可撤销',
      body: `<p style="font-size:13.5px;line-height:1.8">这会清除收藏的路线、收藏的地点与首页草稿。清除后无法恢复，建议先导出需要的路线。</p>`,
      footer: `<button class="btn btn-ghost" type="button" data-mclose>取消</button>
               <button class="btn btn-primary" type="button" data-act="ok">确认清除</button>`
    });
    if (!m.el) return;
    const ok = m.el.querySelector('[data-act="ok"]');
    if (ok) ok.addEventListener('click', () => {
      m.close();
      if (typeof CW.clearLocalData === 'function') CW.clearLocalData();
      U.toast('本地数据已清除');
    });
  }

  function openSavedRoute(id) {
    const r = resolve(id);
    if (!r) { U.toast('这条路线已失效', 'err'); return; }
    const places = D.places(r.places || []);
    const constraints = (CW.pages.home && CW.pages.home.helpers && CW.pages.home.helpers.constraintsOf)
      ? CW.pages.home.helpers.constraintsOf(r) : (r.constraints || []);
    const m = U.modal({
      title: r.name,
      sub: `${U.fmtDuration(r.actualMin)} · ${(r.places || []).length} 个地点 · 约 ${r.distanceKm != null ? r.distanceKm : '—'} km`,
      width: 680,
      body: `
        <div class="detail-rows">
          <div class="kv"><span>来源</span><b>${r.source === 'curated' ? '精选路线' : (r.degraded ? 'AI 模拟规划（已降级）' : 'AI 模拟规划')}</b></div>
          <div class="kv"><span>预算估算</span><b>${routeBudget(r)}${r.conditions && r.conditions.budgetMax ? '（上限 ¥' + r.conditions.budgetMax + '）' : '（未指定）'}</b></div>
          <div class="kv"><span>路线风格</span><b>${(r.style || []).join('、') || '未指定'}</b></div>
          <div class="kv"><span>规划条件</span><b>${r.conditions && r.conditions.interests && r.conditions.interests.length ? r.conditions.interests.map(i => (D.interest(i) || {}).name || i).join('、') : '未指定兴趣'}</b></div>
          ${r._legacy ? '<div class="kv"><span>数据版本</span><b>旧版路线（降级显示）</b></div>' : ''}
        </div>
        <div class="divider"></div>
        <div class="timeline">
          ${places.map((p, i) => `<div class="tl-item">
            <div class="tl-rail"><div class="tl-num">${i + 1}</div><div class="tl-line"></div></div>
            <div class="saved-place" style="flex:1 1 auto">
              <div class="sp-img" style="background-image:url('${p.img}')"></div>
              <div class="sp-body">
                <b>${U.esc(p.name)}</b>
                <span>${U.esc(D.cat(p.cat).name)} · 建议停留 ${p.stay} 分钟 · ${U.fmtCost(p.cost)}</span>
              </div>
            </div>
          </div>`).join('')}
        </div>
        ${constraints.length ? `<div class="divider"></div><div class="dp-h">约束清单</div>
          <div class="constraint-list" style="margin-top:8px">${constraints.map(c => {
            const meta = ({ met: '已满足', partial: '部分满足', violated: '未满足', unknown: '无法确认' })[c.status] || '无法确认';
            return `<div class="constraint-item st-${U.esc(c.status || 'unknown')}">
              <span class="ci-ico">${U.icon(c.status === 'met' ? 'check' : (c.status === 'violated' ? 'close' : 'info'))}</span>
              <div class="ci-body"><div class="ci-top"><b>${U.esc(c.label || c.id)}</b><span class="ci-status">${meta}</span></div>
                <div class="ci-detail">${U.esc(c.detail || '')}</div></div></div>`;
          }).join('')}</div>` : ''}
        <div class="note-box" style="margin-top:14px">${U.icon('info')}
          <span>${D.DISCLAIMER.sample} · ${D.DISCLAIMER.estimate} · 营业时间未核实，一律「信息待确认」。</span></div>`,
      footer: `<button class="btn btn-ghost" type="button" data-mclose>关闭</button>
               <button class="btn btn-ghost" type="button" data-act="export">${U.icon('download')}导出</button>
               <button class="btn btn-primary" type="button" data-act="reuse2">${U.icon('sparkle')}再次规划</button>`
    });
    if (!m.el) return;
    const exp = m.el.querySelector('[data-act="export"]');
    if (exp) exp.addEventListener('click', () => { m.close(); exportRoute(id); });
    const reuse2 = m.el.querySelector('[data-act="reuse2"]');
    if (reuse2) reuse2.addEventListener('click', () => { m.close(); reuse(id); });
  }

  CW.pages = CW.pages || {};
  CW.pages.favorites = { render, resolve };
})();
