/* =====================================================================
 * pages/favorites.js · 我的收藏
 *   说明：本原型无账号系统与数据库，收藏保存在浏览器内存中，
 *        刷新页面后会重置（界面已明确提示）。
 * ===================================================================== */
(function () {
  const CW = (window.CW = window.CW || {});
  const D = CW.data, U = CW.ui;

  /* 收藏的路线 id → 路线对象 */
  function resolve(id) {
    if (CW.state.routeStore[id]) return CW.state.routeStore[id];
    if (id.indexOf('cur_') === 0) {
      const cur = D.route(id.slice(4));
      if (cur) return CW.pages.home.routeFromCurated(cur);
    }
    return null;
  }

  function render(host, state) {
    const routes = state.favorites.routes.map(resolve);
    const lost = state.favorites.routes.length - routes.filter(Boolean).length;
    const places = D.places(state.favorites.places);

    host.innerHTML = `
      <div class="page-head">
        <h1>我的收藏</h1>
        <p>收藏的路线与地点会保存在这里，方便下次直接使用。</p>
      </div>

      <div class="section-title">
        <h2>收藏的路线</h2>
        <span class="st-sub">${routes.filter(Boolean).length} 条${lost > 0 ? ' · ' + lost + ' 条已失效' : ''}</span>
      </div>
      ${routes.filter(Boolean).length ? `<div class="grid-2" style="gap:14px">
        ${routes.filter(Boolean).map(routeRow).join('')}
      </div>` : emptyBlock('bookmark', '还没有收藏路线',
        '生成一条路线或从「发现路线」里挑一条，点「收藏路线」就会出现在这里。',
        `<button class="btn btn-primary" data-act="toHome">${U.icon('sparkle')}去规划一条路线</button>
         <button class="btn btn-ghost" data-act="toDiscover">浏览发现路线</button>`)}

      ${lost > 0 ? `<div class="note-box amber" style="margin-top:14px">${U.icon('alert')}
        <span>有 ${lost} 条收藏来自已重置的会话数据，无法还原，已从列表中隐藏。</span></div>` : ''}

      <div class="section-title" style="margin-top:34px">
        <h2>收藏的地点</h2>
        <span class="st-sub">${places.length} 个</span>
      </div>
      ${places.length ? `<div class="grid-2" style="gap:14px">
        ${places.map(placeRow).join('')}
      </div>` : emptyBlock('heart', '还没有收藏地点',
        '在路线卡片或地点详情里点一下爱心，就会收藏到这里。',
        `<button class="btn btn-ghost" data-act="toDiscover">去发现地点</button>`)}

      <div class="note-box" style="margin-top:26px">${U.icon('info')}
        <span>本原型没有账号系统与数据库，收藏仅保存在当前会话的内存中，刷新页面后会回到初始状态。</span></div>
    `;

    const on = (act, fn) => { const b = host.querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener('click', fn); };
    on('toHome', () => CW.navigate('home'));
    on('toDiscover', () => CW.navigate('discover'));
    host.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openSavedRoute(b.dataset.open)));
    host.querySelectorAll('[data-reuse]').forEach(b => b.addEventListener('click', () => reuse(b.dataset.reuse)));
    host.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => removeRoute(b.dataset.rm)));
    host.querySelectorAll('[data-pdetail]').forEach(b => b.addEventListener('click', () => CW.pages.home.openPlace(b.dataset.pdetail)));
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

  function routeRow(r) {
    const first = D.place(r.places[0]);
    const cover = r.source === 'curated' && r.curatedId ? D.route(r.curatedId).cover : (first ? first.img : '');
    return `<div class="saved-route">
      <div class="sr-img" style="background-image:url('${cover}')"></div>
      <div class="sr-body">
        <h4>${U.esc(r.name)}</h4>
        <p>${U.fmtDuration(r.actualMin)} · ${r.places.length} 个地点 · 约 ${r.distanceKm} km · ${U.fmtCost(r.budget)}
          ${r.orderDirty ? ' · <span style="color:var(--amber-2)">顺序已调整（未重算距离）</span>' : ''}</p>
        <div class="chips" style="margin-top:8px">
          ${r.style.slice(0, 3).map(s => `<span class="tag">${U.esc(s)}</span>`).join('')}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button class="btn btn-primary btn-sm" data-reuse="${r.id}">${U.icon('sparkle')}再次规划</button>
        <button class="btn btn-ghost btn-sm" data-open="${r.id}">查看详情</button>
        <button class="btn btn-soft btn-sm" data-rm="${r.id}">${U.icon('trash')}移除收藏</button>
      </div>
    </div>`;
  }

  function placeRow(p) {
    return `<div class="saved-place">
      <div class="sp-img" style="background-image:url('${p.img}')"></div>
      <div class="sp-body">
        <b>${U.esc(p.name)}</b>
        <span>${U.esc(D.cat(p.cat).name)} · ${U.esc(p.area)}</span>
        <span style="display:block;margin-top:3px">建议停留 ${p.stay} 分钟 · ${U.fmtCost(p.cost)} · ${U.esc(p.hours ? p.hours : D.DISCLAIMER.hours)}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button class="btn btn-ghost btn-sm" data-pdetail="${p.id}">查看详情</button>
        <button class="btn btn-soft btn-sm" data-prm="${p.id}">${U.icon('trash')}移除</button>
      </div>
    </div>`;
  }

  /* ---------------- 操作 ---------------- */
  function reuse(id) {
    const r = resolve(id); if (!r) { U.toast('这条路线已失效', 'err'); return; }
    const state = CW.state;
    state.city = r.city;
    state.route = r;
    state.conditions = r.conditions;
    state.view = 'result';
    state.selectedPlace = null;
    state.draft.interests = r.conditions.interests.slice();
    state.draft.durationMin = r.conditions.durationMin;
    state.draft.budgetMax = r.conditions.budgetMax;
    state.draft.pace = r.conditions.pace;
    state.chat = [
      { who: 'me', text: '我想再看看「' + r.name + '」' },
      { who: 'ai', text: '已载入这条路线。可以直接改，比如「缩短步行距离」「加一家咖啡馆」「改成 3 小时」。' }
    ];
    state.chatChips = null;
    CW.navigate('home');
    U.toast('已载入收藏的路线');
  }

  function removeRoute(id) {
    const arr = CW.state.favorites.routes, i = arr.indexOf(id);
    if (i < 0) return;
    const r = resolve(id);
    U.modal({
      title: '移除这条收藏？',
      sub: '只影响收藏列表，不会删除任何数据',
      body: `<p style="font-size:13.5px;line-height:1.75">即将从「我的收藏」移除：<b>${U.esc(r ? r.name : id)}</b>。
        移除后如需再次使用，可以重新生成或从「发现路线」重新收藏。</p>`,
      footer: `<button class="btn btn-ghost" data-mclose>取消</button>
               <button class="btn btn-primary" data-act="ok">确认移除</button>`
    });
    document.getElementById('modalRoot').querySelector('[data-act="ok"]').addEventListener('click', () => {
      const j = CW.state.favorites.routes.indexOf(id);
      if (j >= 0) CW.state.favorites.routes.splice(j, 1);
      const m = document.querySelector('.modal-mask'); if (m) m.remove();
      CW.render(); U.toast('已移除收藏');
    });
  }

  function removePlace(id) {
    const arr = CW.state.favorites.places, i = arr.indexOf(id);
    if (i < 0) return;
    arr.splice(i, 1);
    CW.render();
    U.toast('已移除收藏地点');
  }

  function openSavedRoute(id) {
    const r = resolve(id); if (!r) { U.toast('这条路线已失效', 'err'); return; }
    const places = D.places(r.places);
    U.modal({
      title: r.name,
      sub: `${U.fmtDuration(r.actualMin)} · ${r.places.length} 个地点 · 约 ${r.distanceKm} km`,
      width: 680,
      body: `
        <div class="detail-rows">
          <div class="kv"><span>来源</span><b>${r.source === 'curated' ? '精选路线' : 'AI 模拟规划'}</b></div>
          <div class="kv"><span>预算估算</span><b>${U.fmtCost(r.budget)}${r.conditions.budgetMax ? '（上限 ¥' + r.conditions.budgetMax + '）' : ''}</b></div>
          <div class="kv"><span>路线风格</span><b>${r.style.join('、')}</b></div>
          <div class="kv"><span>规划条件</span><b>${r.conditions.interests.length ? r.conditions.interests.map(i => D.interest(i).name).join('、') : '未指定兴趣'}</b></div>
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
        <div class="note-box" style="margin-top:14px">${U.icon('info')}
          <span>${D.DISCLAIMER.sample} · ${D.DISCLAIMER.estimate}${r.orderDirty ? ' · 顺序经过手动调整，距离与时间未重新计算' : ''}</span></div>`,
      footer: `<button class="btn btn-ghost" data-mclose>关闭</button>
               <button class="btn btn-primary" data-act="reuse2">${U.icon('sparkle')}再次规划</button>`
    });
    document.getElementById('modalRoot').querySelector('[data-act="reuse2"]').addEventListener('click', () => {
      const m = document.querySelector('.modal-mask'); if (m) m.remove();
      reuse(id);
    });
  }

  CW.pages = CW.pages || {};
  CW.pages.favorites = { render, resolve };
})();
