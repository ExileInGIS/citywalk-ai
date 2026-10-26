/* =====================================================================
 * app.js · 应用状态 / 路由 / 顶部导航
 * ===================================================================== */
(function () {
  const CW = (window.CW = window.CW || {});
  const D = CW.data, U = CW.ui;

  /* ---------------- 全局状态（本次会话有效，不做持久化） ---------------- */
  const state = {
    nav: 'home',                 // home | discover | favorites
    city: 'nanjing',
    conditions: CW.agent.defaultConditions(),
    draft: {                     // 首页表单草稿
      text: '',
      interests: [],
      durationMin: 240,
      pace: 'mid',
      budgetMax: null,
      startAt: '14:00',
      from: '',
      transport: 'walk',
      mustEnd: ''
    },
    view: 'idle',                // idle | loading | result
    loadStep: 0,
    route: null,
    routeStore: {},              // 本次会话生成/载入过的路线（收藏后可还原）
    chat: [],
    selectedPlace: null,
    favorites: { routes: [], places: [] },
    discoverFilter: { theme: 'all', duration: 'all' },
    ui: { advOpen: false, chatOpen: true }
  };
  CW.state = state;

  /* ---------------- 路由 ---------------- */
  const NAVS = [
    { id: 'home', name: '首页' },
    { id: 'discover', name: '发现路线' },
    { id: 'favorites', name: '我的收藏' }
  ];

  function navigate(nav, opts) {
    if (NAVS.every(n => n.id !== nav)) nav = 'home';
    state.nav = nav;
    try { history.replaceState(null, '', '#' + nav); } catch (e) { /* 预览环境可能不支持 */ }
    render();
    if (!opts || !opts.keepScroll) { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { /* 部分嵌入环境不支持 */ } }
  }
  CW.navigate = navigate;

  /* 全局拦截所有 [data-nav] 点击（不依赖 hash 跳转，避免内嵌预览环境失效） */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-nav]');
    if (!t) return;
    e.preventDefault();
    navigate(t.dataset.nav);
  });

  /* ---------------- 顶部：Logo / 导航 / 城市 / 头像 ---------------- */
  function renderTopbar() {
    document.getElementById('brandMark').innerHTML = U.icon('logo');
    document.getElementById('mainNav').innerHTML = NAVS.map(n =>
      `<button class="nav-item${state.nav === n.id ? ' on' : ''}" data-nav="${n.id}">${n.name}</button>`).join('');

    /* 城市选择器 */
    const cur = D.city(state.city);
    const cp = document.getElementById('cityPicker');
    cp.innerHTML = `
      <button class="city-btn" id="cityBtn"><span class="dot"></span>${U.esc(cur.name)}
        ${U.icon('chevron')}</button>
      <div class="city-menu" id="cityMenu">
        ${D.CITIES.map(c => `<button class="cm-item${c.id === state.city ? ' on' : ''}" data-city="${c.id}">
            ${U.esc(c.name)}<span>${U.esc(c.note)}</span></button>`).join('')}
        <div class="cm-note">当前示例数据仅覆盖南京老城区域，其他城市为占位。</div>
      </div>`;
    cp.querySelector('#cityBtn').addEventListener('click', e => {
      e.stopPropagation(); cp.querySelector('#cityMenu').classList.toggle('open');
    });
    cp.querySelector('#cityMenu').addEventListener('click', e => {
      const b = e.target.closest('[data-city]'); if (!b) return;
      const id = b.dataset.city;
      state.city = id;
      state.conditions.city = id;
      cp.querySelector('#cityMenu').classList.remove('open');
      if (!D.city(id).ready) {
        U.toast(`${D.city(id).name}的示例数据还在筹备中，已为你切回南京的演示内容`, 'warn');
      } else {
        U.toast(`已切换到${D.city(id).name}`);
      }
      state.route = null; state.view = 'idle';
      render();
    });

    /* 帮助 */
    document.getElementById('btnHelp').addEventListener('click', openHelp);

    /* 头像菜单 */
    const aw = document.getElementById('avatarWrap');
    aw.innerHTML = `
      <button class="avatar" id="avatarBtn">游</button>
      <div class="avatar-menu" id="avatarMenu">
        <div class="am-head"><b>游客用户</b><span>演示模式 · 数据仅保存在本次会话</span></div>
        <button data-act="profile">${U.icon('users')}个人中心</button>
        <button data-act="fav">${U.icon('bookmark')}我的收藏</button>
        <button data-act="reset">${U.icon('refresh')}重置演示数据</button>
      </div>`;
    aw.querySelector('#avatarBtn').addEventListener('click', e => {
      e.stopPropagation(); aw.querySelector('#avatarMenu').classList.toggle('open');
    });
    U.bind(aw, {
      profile: () => openProfile(),
      fav: () => { aw.querySelector('#avatarMenu').classList.remove('open'); navigate('favorites'); },
      reset: () => {
        aw.querySelector('#avatarMenu').classList.remove('open');
        state.favorites = { routes: [], places: [] };
        state.route = null; state.routeStore = {}; state.view = 'idle'; state.chat = []; state.selectedPlace = null;
        state.conditions = CW.agent.defaultConditions();
        state.draft = { text: '', interests: [], durationMin: 240, pace: 'mid', budgetMax: null, startAt: '14:00', from: '', transport: 'walk', mustEnd: '' };
        render(); U.toast('演示数据已重置');
      }
    });

    document.addEventListener('click', () => {
      const m1 = document.getElementById('cityMenu'), m2 = document.getElementById('avatarMenu');
      if (m1) m1.classList.remove('open');
      if (m2) m2.classList.remove('open');
    });
  }

  /* ---------------- 帮助 / 个人中心 ---------------- */
  function openHelp() {
    U.modal({
      title: '使用说明与数据说明',
      sub: 'CityWalk AI 演示原型',
      body: `
        <div class="help-list">
          <div class="help-item"><div class="hi-n">1</div><div class="hi-b"><b>怎么生成路线</b>
            <p>在首页用一句话描述你的想法（城市、时长、兴趣、预算），也可以展开「高级筛选」逐项填写。两者会互相补充：自然语言里识别到的条件会自动同步到筛选面板。</p></div></div>
          <div class="help-item"><div class="hi-n">2</div><div class="hi-b"><b>生成后怎么改</b>
            <p>右侧地图和路线卡片始终联动；点卡片会高亮地图标记。想调整就打开左侧的 AI 助手，直接说「缩短步行距离」「加一家咖啡馆」「改成 3 小时」「预算控制在 100 元以内」。</p></div></div>
          <div class="help-item"><div class="hi-n">3</div><div class="hi-b"><b>手动排序会怎样</b>
            <p>你可以拖动卡片或使用上移/下移调整顺序，地图标记编号会同步更新。但本原型不具备真实路径计算能力，因此排序后<b>不会重新计算距离与时间</b>，界面会给出明确提示。</p></div></div>
          <div class="help-item"><div class="hi-n">4</div><div class="hi-b"><b>关于数据真实性（重要）</b>
            <p>地点名称取自真实地标，但停留时长、消费区间、步行耗时、距离<b>均为估算值</b>；营业时间一律显示「信息待确认」，不会虚构。地图是手绘的<b>示意地图</b>，不含真实坐标，不能用于导航。</p></div></div>
          <div class="help-item"><div class="hi-n">5</div><div class="hi-b"><b>关于 AI 能力边界</b>
            <p>当前为<b>本地规则模拟</b>，未接入任何大模型或后端服务（代码中已预留真实 Agent API 的接入位置）。最终出行决策请以现场信息为准。</p></div></div>
        </div>`,
      footer: `<button class="btn btn-primary" data-mclose>我知道了</button>`
    });
  }

  function openProfile() {
    const p = state.favorites;
    U.modal({
      title: '个人中心',
      sub: '演示模式 · 无需登录',
      width: 520,
      body: `
        <div class="detail-rows">
          <div class="kv"><span>昵称</span><b>游客用户</b></div>
          <div class="kv"><span>当前城市</span><b>${U.esc(D.city(state.city).name)}</b></div>
          <div class="kv"><span>收藏路线</span><b>${p.routes.length} 条</b></div>
          <div class="kv"><span>收藏地点</span><b>${p.places.length} 个</b></div>
          <div class="kv"><span>本次会话生成路线</span><b>${state.route ? 1 : 0} 条</b></div>
          <div class="kv"><span>数据存储</span><b>仅当前会话（刷新后重置）</b></div>
        </div>
        <div class="note-box" style="margin-top:16px">${U.icon('info')}
          <span>本原型不包含账号系统与数据库。收藏、对话记录等状态保存在浏览器内存中，刷新页面后会回到初始状态。</span></div>`,
      footer: `<button class="btn btn-ghost" data-mclose>关闭</button>
               <button class="btn btn-primary" data-act="gotoFav">查看我的收藏</button>`
    });
    const root = document.getElementById('modalRoot');
    const btn = root.querySelector('[data-act="gotoFav"]');
    if (btn) btn.addEventListener('click', () => {
      const mask = btn.closest('.modal-mask'); if (mask) mask.remove();
      navigate('favorites');
    });
  }

  /* ---------------- 渲染入口 ---------------- */
  function render() {
    renderTopbar();
    const view = document.getElementById('view');
    if (state.nav === 'home') CW.pages.home.render(view, state);
    else if (state.nav === 'discover') CW.pages.discover.render(view, state);
    else CW.pages.favorites.render(view, state);
  }
  CW.render = render;

  /* ---------------- 启动 ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    // 不依赖 hashchange：直接根据当前 hash 决定首屏（预览环境 hash 可能不可用）
    const h = (location.hash || '').replace('#', '');
    if (NAVS.some(n => n.id === h)) state.nav = h;
    render();
  });
})();
