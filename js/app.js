/* =====================================================================
 * app.js · 应用状态 / 路由 / 顶部导航 / 本地持久化入口
 * ---------------------------------------------------------------------
 *  - CW.state 新增：service / lastDiff / clarify / lastPlanConditions /
 *    recognized / error / empty / planMeta / storageEnabled
 *  - 收藏与草稿通过 CW.storage 持久化（storage.js 由并行工程师实现）；
 *    能力检测：storage 缺失时退化为本次会话内存状态，界面如实提示。
 *  - 所有 git 操作与提交不在此文件处理。
 * ===================================================================== */
(function () {
  const CW = (window.CW = window.CW || {});
  const D = CW.data, U = CW.ui;

  /* ---------------- 默认值 ---------------- */
  function defaultDraft() {
    return {
      text: '',
      interests: [],
      durationMin: 240,
      pace: 'mid',
      budgetMax: null,
      budgetBasis: 'total',
      startTime: '14:00',
      endTime: '',
      startLocation: '',
      transport: 'walk',
      party: 'solo',
      walkingTolerance: 'mid',
      foodPreferences: [],
      foodText: '',
      accessibility: [],
      weather: 'any',
      avoid: [],
      avoidText: '',
      mustVisit: [],
      mustVisitText: '',
      date: '今天'
    };
  }
  function safeDefaultConditions() {
    try {
      if (CW.agent && typeof CW.agent.defaultConditions === 'function') return CW.agent.defaultConditions();
    } catch (e) { /* 使用下面的兜底 */ }
    return {
      city: 'nanjing', startLocation: '', durationMin: 240, startTime: '14:00', endTime: '',
      interests: [], budgetMax: null, budgetBasis: 'total', party: 'solo',
      walkingTolerance: 'mid', transport: 'walk', pace: 'mid',
      foodPreferences: [], accessibility: [], weather: 'any', avoid: [], mustVisit: [],
      additionalRequirements: ''
    };
  }

  /* ---------------- 全局状态 ---------------- */
  const state = {
    nav: 'home',                 // home | discover | favorites
    city: 'nanjing',
    conditions: safeDefaultConditions(),
    draft: defaultDraft(),
    view: 'idle',                // idle | loading | result | error | empty
    loadStep: 0,
    route: null,
    routeStore: {},              // 本次会话生成/载入过的路线
    chat: [],
    chatChips: null,
    selectedPlace: null,
    favorites: { routes: [], places: [], routeData: {} },
    discoverFilter: { theme: 'all', duration: 'all' },
    ui: { advOpen: false, moreOpen: false, chatOpen: true, orderBusy: false, refineBusy: false },
    service: {
      mode: 'mock', connected: false, endpoint: '', fallback: 'mock',
      provider: '', mapProvider: '', lastLatencyMs: null, lastError: null,
      degraded: false, degradeReason: '', degradeCode: null,
      mapFailed: null, mapFallback: null, expanded: false
    },
    lastDiff: null,
    clarify: null,
    lastPlanConditions: null,
    recognized: null,
    error: null,
    empty: null,
    planMeta: null,
    storageEnabled: false
  };
  CW.state = state;

  function storageAvailable() {
    try {
      if (!CW.storage) return false;
      const en = CW.storage.enabled;
      if (typeof en === 'function') return !!en();
      return en !== false;
    } catch (e) { return false; }
  }

  /* ---------------- 持久化 ---------------- */
  function uniqStrings(arr) {
    const out = [];
    (Array.isArray(arr) ? arr : []).forEach(x => {
      if (typeof x !== 'string') return;
      const s = x.trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }
  function normalizeFavorites(raw) {
    if (!raw || typeof raw !== 'object') return { routes: [], places: [], routeData: {} };
    const src = raw.favorites && typeof raw.favorites === 'object' ? raw.favorites : raw;
    return {
      routes: uniqStrings(src.routes),
      places: uniqStrings(src.places),
      routeData: src.routeData && typeof src.routeData === 'object' && !Array.isArray(src.routeData)
        ? src.routeData : {}
    };
  }
  function normalizeDraft(input) {
    const out = defaultDraft();
    if (!input || typeof input !== 'object') return out;
    Object.keys(out).forEach(k => {
      if (input[k] !== undefined) out[k] = input[k];
    });
    /* 兼容旧字段名 */
    if (input.startAt !== undefined && input.startTime === undefined) out.startTime = input.startAt;
    if (input.mustEnd !== undefined && input.endTime === undefined) out.endTime = input.mustEnd;
    if (input.from !== undefined && input.startLocation === undefined) out.startLocation = input.from;
    ['interests', 'foodPreferences', 'accessibility', 'avoid', 'mustVisit'].forEach(k => {
      out[k] = uniqStrings(out[k]);
    });
    ['text', 'foodText', 'avoidText', 'mustVisitText', 'startTime', 'endTime', 'startLocation', 'date', 'budgetBasis', 'party', 'walkingTolerance', 'transport', 'pace', 'weather'].forEach(k => {
      if (typeof out[k] !== 'string') out[k] = defaultDraft()[k];
    });
    out.foodText = out.foodText || '';
    out.avoidText = out.avoidText || '';
    out.mustVisitText = out.mustVisitText || out.mustVisit.join('、');
    const dur = Number(out.durationMin);
    out.durationMin = Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 0;
    const budget = out.budgetMax;
    out.budgetMax = budget === null || budget === '' || !Number.isFinite(Number(budget)) ? null : Math.max(0, Math.round(Number(budget)));
    return out;
  }
  function applyFavorites(raw) {
    state.favorites = normalizeFavorites(raw);
    Object.keys(state.favorites.routeData).forEach(id => {
      if (!state.routeStore[id]) state.routeStore[id] = state.favorites.routeData[id];
    });
  }
  function applyDraft(raw) {
    if (!raw || typeof raw !== 'object') return;
    const payload = raw.draft && typeof raw.draft === 'object' ? raw : { draft: raw };
    const nextCity = payload.city || (payload.draft && payload.draft.city);
    if (nextCity && D && D.city && D.city(nextCity)) state.city = nextCity;
    state.draft = normalizeDraft(payload.draft);
  }
  function handleAsync(value, apply) {
    if (value && typeof value.then === 'function') {
      value.then(apply).catch(() => {});
      return true;
    }
    apply(value);
    return false;
  }
  let booted = false;
  function restorePersisted() {
    if (!CW.storage) { state.storageEnabled = false; return; }
    try {
      const f = CW.storage.loadFavorites && CW.storage.loadFavorites();
      handleAsync(f, v => {
        applyFavorites(v);
        if (booted) render();
      });
    } catch (e) { /* 隐私模式 / 损坏数据：保持内存态 */ }
    try {
      const d = CW.storage.loadDraft && CW.storage.loadDraft();
      handleAsync(d, v => {
        applyDraft(v);
        if (booted) render();
      });
    } catch (e) { /* 同上 */ }
  }
  function pruneRouteData() {
    const out = {};
    state.favorites.routes.forEach(id => {
      const r = state.favorites.routeData[id] || state.routeStore[id];
      if (r) out[id] = r;
    });
    return out;
  }
  function persistFavorites() {
    state.storageEnabled = storageAvailable();
    if (!CW.storage || typeof CW.storage.saveFavorites !== 'function') return;
    try {
      CW.storage.saveFavorites({
        version: 1,
        routes: uniqStrings(state.favorites.routes),
        places: uniqStrings(state.favorites.places),
        routeData: pruneRouteData()
      });
    } catch (e) { /* 配额满 / 隐私模式：不阻塞主流程 */ }
  }
  let draftTimer = null;
  function persistDraftNow() {
    if (!CW.storage || typeof CW.storage.saveDraft !== 'function') return;
    try {
      CW.storage.saveDraft({ version: 1, city: state.city, draft: state.draft });
    } catch (e) { /* 同上 */ }
  }
  function persistDraftSoon() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { draftTimer = null; persistDraftNow(); }, 420);
  }

  /* 供页面调用的小 API */
  CW.persistFavorites = persistFavorites;
  CW.saveDraftSoon = persistDraftSoon;
  CW.saveDraftNow = persistDraftNow;
  CW.saveFavoriteRoute = function (route) {
    if (!route || !route.id) return;
    state.favorites.routeData[route.id] = route;
    state.routeStore[route.id] = route;
    persistFavorites();
  };
  CW.forgetRouteData = function (id) {
    if (state.favorites.routeData) delete state.favorites.routeData[id];
    persistFavorites();
  };
  CW.storageIsEnabled = storageAvailable;
  CW.clearLocalData = function () {
    try {
      if (CW.storage && typeof CW.storage.clearAll === 'function') CW.storage.clearAll();
    } catch (e) { /* 忽略 */ }
    state.favorites = { routes: [], places: [], routeData: {} };
    state.routeStore = {};
    state.route = null;
    state.view = 'idle';
    state.loadStep = 0;
    state.chat = [];
    state.chatChips = null;
    state.selectedPlace = null;
    state.lastDiff = null;
    state.clarify = null;
    state.recognized = null;
    state.error = null;
    state.empty = null;
    state.planMeta = null;
    state.lastPlanConditions = null;
    state.conditions = safeDefaultConditions();
    state.draft = defaultDraft();
    state.city = 'nanjing';
    state.service.degraded = false;
    state.service.degradeReason = '';
    state.service.mapFailed = null;
    state.service.mapFallback = null;
    render();
  };
  CW.resetDemoData = function () {
    CW.clearLocalData();
    U.toast('演示数据与本地存储已重置');
  };

  /* ---------------- 埋点（白名单，绝不带自由文本 / 预算 / 坐标） ---------------- */
  const TRACK_KEYS = ['task', 'mode', 'routeId', 'durationMs', 'errorCode', 'degraded', 'placeCount',
    'changed', 'changesCount', 'missingCount', 'answeredCount', 'skippedCount', 'conflictType',
    'optionId', 'source', 'format', 'reasonCode', 'provider', 'context'];
  CW.track = function (event, props) {
    try {
      if (!event || !CW.telemetry || typeof CW.telemetry.track !== 'function') return;
      const safe = {};
      if (props && typeof props === 'object') {
        TRACK_KEYS.forEach(k => {
          if (props[k] === undefined || props[k] === null) return;
          const v = props[k];
          if (typeof v === 'string') safe[k] = v.slice(0, 60);
          else if (typeof v === 'number' && Number.isFinite(v)) safe[k] = v;
          else if (typeof v === 'boolean') safe[k] = v;
        });
      }
      CW.telemetry.track(event, safe);
    } catch (e) { /* 埋点永不阻塞主流程 */ }
  };

  /* ---------------- 路由 ---------------- */
  const NAVS = [
    { id: 'home', name: '首页' },
    { id: 'discover', name: '发现路线' },
    { id: 'favorites', name: '我的收藏' }
  ];

  function navigate(nav, opts) {
    if (NAVS.every(n => n.id !== nav)) nav = 'home';
    if (state.nav === 'home' && nav !== 'home' && CW.pages && CW.pages.home && typeof CW.pages.home.destroyMap === 'function') {
      CW.pages.home.destroyMap();
    }
    state.nav = nav;
    try { history.replaceState(null, '', '#' + nav); } catch (e) { /* 预览环境可能不支持 */ }
    render();
    if (!opts || !opts.keepScroll) {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { /* 部分嵌入环境不支持 */ }
    }
  }
  CW.navigate = navigate;

  function closeMenus(focus) {
    let any = false;
    const pairs = [['cityMenu', 'cityBtn'], ['avatarMenu', 'avatarBtn']];
    pairs.forEach(([menuId, btnId]) => {
      const menu = document.getElementById(menuId);
      const btn = document.getElementById(btnId);
      const wasOpen = menu && menu.classList.contains('open');
      if (menu) menu.classList.remove('open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (wasOpen) {
        any = true;
        if (focus && btn) { try { btn.focus(); } catch (e) { /* 忽略 */ } }
      }
    });
    return any;
  }
  CW.closeMenus = closeMenus;

  /* ---------------- 顶部：Logo / 导航 / 城市 / 头像 ---------------- */
  function renderTopbar() {
    document.getElementById('brandMark').innerHTML = U.icon('logo');
    document.getElementById('mainNav').innerHTML = NAVS.map(n =>
      `<button class="nav-item${state.nav === n.id ? ' on' : ''}" type="button" data-nav="${n.id}"${state.nav === n.id ? ' aria-current="page"' : ''}>${n.name}</button>`).join('');

    const cur = D.city(state.city) || D.CITIES[0];
    const cp = document.getElementById('cityPicker');
    cp.innerHTML = `
      <button class="city-btn" id="cityBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="cityMenu" aria-label="选择城市，当前 ${U.esc(cur.name)}">
        <span class="dot"></span>${U.esc(cur.name)}${U.icon('chevron')}
      </button>
      <div class="city-menu" id="cityMenu">
        ${D.CITIES.map(c => `<button class="cm-item${c.id === state.city ? ' on' : ''}" type="button" data-city="${c.id}"${c.id === state.city ? ' aria-current="true"' : ''}>
            ${U.esc(c.name)}<span>${U.esc(c.note)}</span></button>`).join('')}
        <div class="cm-note">当前示例数据仅覆盖南京老城区域，其他城市为占位。</div>
      </div>`;
    const cityBtn = cp.querySelector('#cityBtn');
    const cityMenu = cp.querySelector('#cityMenu');
    cityBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = !cityMenu.classList.contains('open');
      closeMenus(false);
      cityMenu.classList.toggle('open', open);
      cityBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    cityMenu.addEventListener('click', e => {
      const b = e.target.closest('[data-city]');
      if (!b) return;
      const id = b.dataset.city;
      const target = D.city(id);
      if (!target) return;
      state.city = id;
      state.conditions.city = id;
      closeMenus(false);
      if (!target.ready) {
        U.toast(`${target.name}的示例数据还在筹备中，已为你切到该城市的空态`, 'warn');
      } else {
        U.toast(`已切换到${target.name}`);
      }
      state.route = null;
      state.view = 'idle';
      state.selectedPlace = null;
      state.lastDiff = null;
      state.clarify = null;
      state.error = null;
      state.empty = null;
      state.planMeta = null;
      persistDraftSoon();
      render();
    });

    /* 帮助 */
    const helpBtn = document.getElementById('btnHelp');
    helpBtn.innerHTML = U.icon('help');
    helpBtn.setAttribute('aria-label', '帮助与数据说明');
    helpBtn.setAttribute('title', '帮助与数据说明');
    helpBtn.addEventListener('click', openHelp);

    /* 头像菜单 */
    const aw = document.getElementById('avatarWrap');
    aw.innerHTML = `
      <button class="avatar" id="avatarBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="avatarMenu" aria-label="账户与数据菜单">游</button>
      <div class="avatar-menu" id="avatarMenu">
        <div class="am-head"><b>游客用户</b><span>无需登录 · 收藏可保存在本机</span></div>
        <button data-act="profile" type="button">${U.icon('users')}个人中心</button>
        <button data-act="fav" type="button">${U.icon('bookmark')}我的收藏</button>
        <button data-act="reset" type="button">${U.icon('refresh')}重置演示数据</button>
      </div>`;
    const avatarBtn = aw.querySelector('#avatarBtn');
    const avatarMenu = aw.querySelector('#avatarMenu');
    avatarBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = !avatarMenu.classList.contains('open');
      closeMenus(false);
      avatarMenu.classList.toggle('open', open);
      avatarBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    avatarMenu.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      closeMenus(false);
      const act = b.dataset.act;
      if (act === 'profile') openProfile();
      else if (act === 'fav') navigate('favorites');
      else if (act === 'reset') CW.resetDemoData();
    });
  }

  function bindGlobal() {
    document.addEventListener('click', e => {
      if (e.target.closest('[data-nav]')) {
        const t = e.target.closest('[data-nav]');
        e.preventDefault();
        navigate(t.dataset.nav);
        return;
      }
      if (e.target.closest('#cityPicker') || e.target.closest('#avatarWrap')) return;
      closeMenus(false);
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (closeMenus(true)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    window.addEventListener('beforeunload', () => { CW.saveDraftNow(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) CW.saveDraftNow();
    });
  }

  /* ---------------- 帮助 / 个人中心 ---------------- */
  function openHelp() {
    U.modal({
      title: '使用说明与数据说明',
      sub: 'CityWalk AI · 可运行的演示原型',
      body: `
        <div class="help-list">
          <div class="help-item"><div class="hi-n">1</div><div class="hi-b"><b>怎么生成路线</b>
            <p>在首页用一句话描述你的想法（城市、时长、兴趣、预算、同行人、天气等），也可以展开「高级筛选」逐项填写。两者会互相补充：自然语言里识别到的条件会自动同步到筛选面板，并回显「已识别」。</p></div></div>
          <div class="help-item"><div class="hi-n">2</div><div class="hi-b"><b>信息不全时会追问</b>
            <p>缺少城市或时长时不会硬生成，而是出现「还需要 1–3 个信息」卡片。选择快捷选项或直接填写后会自动继续；标为「可选」的问题可以跳过，按默认值生成。</p></div></div>
          <div class="help-item"><div class="hi-n">3</div><div class="hi-b"><b>生成后怎么改</b>
            <p>右侧地图、约束清单、数据来源与时间线始终联动。想调整就打开左侧 AI 助手，直接说「少走一点路」「把咖啡馆换成书店」「五点前结束」，结果会给出前后差异与仍未解决的项。</p></div></div>
          <div class="help-item"><div class="hi-n">4</div><div class="hi-b"><b>手动排序会重新计算</b>
            <p>拖动卡片或使用上移/下移调整顺序后，系统会重新估算距离、时间与预算，并在差异面板中保留这次修改；如果重算失败，会保留原顺序并提示，不会显示「已重算」的假结果。</p></div></div>
          <div class="help-item"><div class="hi-n">5</div><div class="hi-b"><b>关于数据真实性（重要）</b>
            <p>地点名称取自真实地标，但停留时长、消费区间、步行耗时、距离<b>均为估算值</b>；没有可靠来源的营业时间一律显示「信息待确认」。只有 OpenStreetMap 可核验点位才标「坐标已核验」，其余标「示例地点」。地图可能是手绘示意地图，不能用于导航。</p></div></div>
          <div class="help-item"><div class="hi-n">6</div><div class="hi-b"><b>服务状态与降级</b>
            <p>右上角的结果区顶部有服务状态条，显示「本地模拟 / 已连接服务」「示意地图 / 真实地图」。远程服务失败并降级时会显著提示并保留 degraded 标记；地图加载失败时列表与时间线仍可用，可单独重试地图。</p></div></div>
          <div class="help-item"><div class="hi-n">7</div><div class="hi-b"><b>收藏与本地数据</b>
            <p>收藏路线、地点与首页草稿保存在此浏览器本地（localStorage），不上传服务器；可在「我的收藏」里导出或清除。浏览器禁用本地存储时，收藏仅当前会话有效，个人中心会显示存储状态。</p></div></div>
        </div>`,
      footer: `<button class="btn btn-primary" type="button" data-mclose>我知道了</button>`
    });
  }

  function openProfile() {
    state.storageEnabled = storageAvailable();
    const p = state.favorites;
    const mode = state.service && state.service.mode === 'remote' && state.service.connected ? '已连接智能体服务' : '本地模拟（未连接远程服务）';
    const mapId = (function () {
      try {
        if (CW.MapEngine && typeof CW.MapEngine.getProviderId === 'function') return CW.MapEngine.getProviderId();
        if (CW.map && typeof CW.map.getProviderName === 'function') return CW.map.getProviderName();
      } catch (e) { /* 忽略 */ }
      return 'mock';
    })();
    const m = U.modal({
      title: '个人中心',
      sub: '演示模式 · 无需登录',
      width: 540,
      body: `
        <div class="detail-rows">
          <div class="kv"><span>昵称</span><b>游客用户</b></div>
          <div class="kv"><span>当前城市</span><b>${U.esc((D.city(state.city) || D.CITIES[0]).name)}</b></div>
          <div class="kv"><span>收藏路线</span><b>${p.routes.length} 条</b></div>
          <div class="kv"><span>收藏地点</span><b>${p.places.length} 个</b></div>
          <div class="kv"><span>数据存储</span><b>${state.storageEnabled ? '浏览器本地存储（localStorage）' : '已关闭，仅当前会话有效'}</b></div>
          <div class="kv"><span>智能体服务</span><b>${U.esc(mode)}</b></div>
          <div class="kv"><span>地图 Provider</span><b>${U.esc(mapId)}</b></div>
        </div>
        <div class="note-box" style="margin-top:16px">${U.icon('info')}
          <span>收藏与草稿只保存在当前浏览器，不会上传服务器。清除本地数据后无法恢复，请先导出需要的路线。</span></div>`,
      footer: `<button class="btn btn-ghost" type="button" data-mclose>关闭</button>
               <button class="btn btn-soft" type="button" data-act="clear">${U.icon('trash')}清除本地数据</button>
               <button class="btn btn-primary" type="button" data-act="gotoFav">查看我的收藏</button>`
    });
    if (!m.el) return;
    const goto = m.el.querySelector('[data-act="gotoFav"]');
    if (goto) goto.addEventListener('click', () => { m.close(); navigate('favorites'); });
    const clear = m.el.querySelector('[data-act="clear"]');
    if (clear) clear.addEventListener('click', () => { m.close(); openClearDataConfirm(); });
  }

  function openClearDataConfirm() {
    const m = U.modal({
      title: '清除本地数据？',
      sub: '此操作不可撤销',
      width: 520,
      body: `<p style="font-size:13.5px;line-height:1.8">这会清除收藏的路线、收藏的地点、首页草稿与本地会话记录。导出过的文件不受影响；清除后无法恢复。</p>
        <div class="note-box amber" style="margin-top:14px">${U.icon('alert')}
          <span>如果还想保留某条路线，请先在收藏里「导出」为 Markdown 或 JSON。</span></div>`,
      footer: `<button class="btn btn-ghost" type="button" data-mclose>取消</button>
               <button class="btn btn-primary" type="button" data-act="ok">${U.icon('trash')}确认清除</button>`
    });
    if (!m.el) return;
    const ok = m.el.querySelector('[data-act="ok"]');
    if (ok) ok.addEventListener('click', () => {
      m.close();
      CW.clearLocalData();
      U.toast('本地数据已清除');
    });
  }
  CW.openClearDataConfirm = openClearDataConfirm;

  /* ---------------- 渲染入口 ---------------- */
  function render() {
    state.storageEnabled = storageAvailable();
    renderTopbar();
    const view = document.getElementById('view');
    if (state.nav === 'home') CW.pages.home.render(view, state);
    else if (state.nav === 'discover') CW.pages.discover.render(view, state);
    else CW.pages.favorites.render(view, state);
  }
  CW.render = render;

  /* ---------------- 启动 ---------------- */
  let started = false;
  function boot() {
    if (started) return;
    started = true;
    restorePersisted();
    bindGlobal();
    const h = (location.hash || '').replace('#', '');
    if (NAVS.some(n => n.id === h)) state.nav = h;
    state.storageEnabled = storageAvailable();
    render();
    booted = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
