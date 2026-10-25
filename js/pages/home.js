/* =====================================================================
 * pages/home.js · 首页：AI 路线规划工作台
 *   左 42%：需求输入 + 高级筛选 + 规划条件 + AI 对话
 *   右 58%：地图 + 路线摘要 + 地点时间线（未生成时为示例与地点发现）
 * ===================================================================== */
(function () {
  const CW = (window.CW = window.CW || {});
  const D = CW.data, U = CW.ui, A = CW.agent;

  const LOAD_STEPS = [
    '正在理解你的出行偏好',
    '正在筛选合适的地点',
    '正在组织路线顺序',
    '正在检查时间与路线约束'
  ];
  const DEFAULT_CHIPS = ['缩短步行距离', '加一家咖啡馆', '去掉书店', '改成 3 小时', '预算控制在 100 元以内', '节奏慢一点'];

  let chatQueue = Promise.resolve();   // 串行化对话指令，避免连续点击相互踩踏
  let dragId = null;
  let busy = false;

  /* ---------------- 工具 ---------------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const px = n => n + 'px';
  function imgStyle(path) { return `background-image:url('${path}')`; }
  function favPlace(id) { return CW.state.favorites.places.indexOf(id) >= 0; }
  function hoursText(p) { return p.hours ? p.hours : D.DISCLAIMER.hours; }

  /* 精选路线 → 规划条件（供「一键体验 / 使用此路线重新规划」复用） */
  function curatedToConditions(cur) {
    const cond = A.defaultConditions();
    cond.city = cur.city;
    cond.durationMin = cur.duration;
    cond.interests = [];
    cur.themes.forEach(t => {
      const th = D.theme(t); if (!th) return;
      th.interests.forEach(n => {
        const it = D.INTERESTS.find(x => x.name === n);
        if (it && cond.interests.indexOf(it.id) < 0) cond.interests.push(it.id);
      });
    });
    if (cur.duration >= 240) cond.pace = 'light';
    cond.budgetMax = cur.budget[1];
    return cond;
  }
  function routeFromCurated(cur) {
    const cond = curatedToConditions(cur);
    const route = A.buildRoute(cond, cur.places, { note: `来自精选路线「${cur.name}」，地点顺序为预设，非实时计算` });
    route.id = 'cur_' + cur.id;          // 稳定 id：收藏后仍可还原
    route.name = cur.name;
    route.source = 'curated';
    route.curatedId = cur.id;
    route.durationMin = cur.duration;
    CW.state.routeStore[route.id] = route;
    return route;
  }

  /* =====================================================================
   * 渲染
   * ===================================================================== */
  function render(host, state) {
    host.innerHTML = `<div class="workspace">
      <div class="ws-left" id="wsLeft"></div>
      <div class="ws-right" id="wsRight"></div>
    </div>`;
    renderLeft(state);
    renderRight(state);
  }

  /* ---------------- 左栏 ---------------- */
  function renderLeft(state) {
    const d = state.draft;
    const box = document.getElementById('wsLeft');
    const generating = state.view === 'loading';
    const hasResult = state.view === 'result' && state.route;

    const ctaLabel = generating ? '正在为你规划…' : (hasResult ? '按当前条件重新生成' : '生成我的 CityWalk 路线');

    box.innerHTML = `
      <div class="hero-card">
        <h1>今天，想怎么<em>逛这座城市</em>？</h1>
        <p class="sub">告诉我你的兴趣和时间，让 AI 帮你规划一场恰到好处的城市漫步。</p>

        <div class="prompt-box">
          <textarea id="promptInput" rows="4" maxlength="200"
            placeholder="例如：周日下午想在南京老城逛 4 小时，喜欢咖啡馆、历史街区和适合拍照的地方，尽量少走回头路，预算 150 元以内。">${U.esc(d.text)}</textarea>
          <div class="prompt-foot">
            <span class="prompt-count"><b id="pCount">${d.text.length}</b>/200</span>
            <button class="link-btn" data-act="example">${U.icon('sparkle')}填入示例需求</button>
          </div>
        </div>

        <div class="quick-label">快速选择你感兴趣的</div>
        <div class="chips" id="quickTags">
          ${D.INTERESTS.map(i => `<button class="pill${d.interests.indexOf(i.id) >= 0 ? ' on' : ''}" data-tag="${i.id}">${U.esc(i.name)}</button>`).join('')}
        </div>

        <button class="adv-toggle${state.ui.advOpen ? ' open' : ''}" id="advToggle">
          <span class="l">${U.icon('filter')}高级筛选：位置 · 时间 · 预算 · 步行强度</span>
          <span class="caret">${U.icon('chevron')}</span>
        </button>
        <div class="adv-panel${state.ui.advOpen ? ' open' : ''}" id="advPanel">
          <div class="adv-inner">
            <div class="adv-grid">
              <div class="field"><label>出发位置</label>
                <input class="input" id="fFrom" placeholder="如：新街口地铁站" value="${U.esc(d.from)}"></div>
              <div class="field"><label>出行日期</label>
                <select class="select" id="fDate">
                  ${['今天', '明天', '本周末', '下周末'].map(x => `<option>${x}</option>`).join('')}
                </select></div>
              <div class="field"><label>开始时间</label>
                <input class="input" type="time" id="fStart" value="${U.esc(d.startAt)}"></div>
              <div class="field"><label>可用时长</label>
                <div class="seg" id="fDur">
                  ${[120, 180, 240, 360].map(m => `<button data-dur="${m}" class="${d.durationMin === m ? 'on' : ''}">${m / 60} 小时</button>`).join('')}
                </div></div>
              <div class="field"><label>预算范围（元）</label>
                <input class="input" type="number" min="0" step="10" id="fBudget" placeholder="留空表示未指定" value="${d.budgetMax == null ? '' : d.budgetMax}"></div>
              <div class="field"><label>步行强度</label>
                <div class="seg" id="fPace">
                  ${D.PACES.map(p => `<button data-pace="${p.id}" class="${d.pace === p.id ? 'on' : ''}" title="${U.esc(p.desc)}">${U.esc(p.name)}</button>`).join('')}
                </div></div>
              <div class="field full"><label>兴趣偏好（可多选，与上方标签同步）</label>
                <div class="chips" id="advTags">
                  ${D.INTERESTS.map(i => `<button class="pill${d.interests.indexOf(i.id) >= 0 ? ' on' : ''}" data-tag="${i.id}">${U.esc(i.name)}</button>`).join('')}
                </div></div>
              <div class="field"><label>出行方式</label>
                <div class="seg" id="fTrans">
                  ${D.TRANSPORTS.map(t => `<button data-trans="${t.id}" class="${d.transport === t.id ? 'on' : ''}">${U.esc(t.name)}</button>`).join('')}
                </div></div>
              <div class="field"><label>必须到达 / 结束时间</label>
                <input class="input" type="time" id="fMust" value="${U.esc(d.mustEnd)}"></div>
            </div>
            <div class="hint" style="margin-top:4px">留空的项目会按默认值处理；预算留空时路线照常生成，但会标注「未指定」。</div>
          </div>
        </div>

        <div class="gen-area">
          <button class="btn btn-primary btn-lg" id="genBtn"${generating ? ' disabled' : ''}>
            ${U.icon('sparkle')}${ctaLabel}</button>
          <div class="gen-note"><span class="dot-live"></span>演示模式 · 本地模拟规划，未接入真实地图与导航服务</div>
        </div>
      </div>

      ${hasResult ? condCard(state) + chatCard(state) : ''}
    `;

    bindLeft(state);
  }

  function condCard(state) {
    const c = state.route.conditions;
    const row = (k, v, miss) => `<div class="cond-row"><span class="k">${k}</span><span class="v${miss ? ' miss' : ''}">${U.esc(v)}</span></div>`;
    const interests = c.interests.length ? c.interests.map(id => D.interest(id).name).join('、') : '未指定（按均衡偏好）';
    return `<div class="card card-pad">
      <div class="card-title">
        <h3>本次规划条件</h3>
        <button class="link-btn" data-act="editCond">${U.icon('edit')}修改条件</button>
      </div>
      <div class="cond-list">
        ${row('城市', D.city(c.city).name)}
        ${row('可用时长', U.fmtDuration(c.durationMin))}
        ${row('兴趣偏好', interests, !c.interests.length)}
        ${row('预算范围', c.budgetMax ? '¥' + c.budgetMax + ' 以内' : '未指定', !c.budgetMax)}
        ${row('步行强度', (D.PACES.find(p => p.id === c.pace) || {}).name || '适中')}
        ${row('出行方式', (D.TRANSPORTS.find(t => t.id === c.transport) || {}).name || '全程步行')}
        ${row('出发位置', c.from || '未指定', !c.from)}
        ${row('必须结束时间', c.mustEnd || '未指定', !c.mustEnd)}
      </div>
    </div>`;
  }

  function chatCard(state) {
    const msgs = state.chat.length ? state.chat : [{
      who: 'ai', text: '路线已经生成。想调整的话直接告诉我，比如「缩短步行距离」「加一家咖啡馆」「改成 3 小时」。'
    }];
    const chips = state.chatChips && state.chatChips.length ? state.chatChips : DEFAULT_CHIPS;
    return `<div class="card chat-card">
      <div class="chat-head">
        <div class="chat-avatar">${U.icon('sparkle')}</div>
        <div class="ch-t"><b>AI 行程助手</b><span>${A.status().connected ? '已连接智能体服务' : '演示模式 · 本地规则模拟'}</span></div>
        <button class="link-btn" data-act="chatReset">清空对话</button>
      </div>
      <div class="chat-body" id="chatBody">${msgs.map(chatMsg).join('')}</div>
      <div class="chat-chips" id="chatChips">
        ${chips.map(c => `<button data-chip="${U.esc(c)}">${U.esc(c)}</button>`).join('')}
      </div>
      <div class="chat-input">
        <input id="chatInput" placeholder="描述你想怎么调整这条路线…" maxlength="120">
        <button class="btn btn-primary btn-sm" data-act="chatSend">${U.icon('send')}</button>
      </div>
    </div>`;
  }

  function chatMsg(m) {
    const diff = m.changes && m.changes.length ? `
      <div class="diff-box">
        <div class="d-h">本次调整</div>
        ${m.changes.map(c => `<div class="diff-row">${U.esc(c.label)}
          <span class="from">${U.esc(c.from)}</span>${U.icon('arrowRight')}
          <span class="to">${U.esc(c.to)}</span></div>`).join('')}
      </div>` : '';
    const bullets = m.bullets && m.bullets.length
      ? `<ul>${m.bullets.map(b => `<li>${U.esc(b)}</li>`).join('')}</ul>` : '';
    const opts = m.options && m.options.length
      ? `<div class="chips" style="margin-top:8px">${m.options.map(o => `<button class="pill pill-amber" data-opt="${o.id}">${U.esc(o.label)}</button>`).join('')}</div>`
      : '';
    return `<div class="msg ${m.who}">
      <div class="av">${m.who === 'ai' ? 'AI' : '我'}</div>
      <div class="bubble">${m.title ? `<div class="b-title">${U.esc(m.title)}</div>` : ''}${U.nl2br(U.esc(m.text))}${bullets}${diff}${opts}</div>
    </div>`;
  }

  function bindLeft(state) {
    const box = document.getElementById('wsLeft');
    const ta = box.querySelector('#promptInput');
    const cnt = box.querySelector('#pCount');
    ta.addEventListener('input', () => { state.draft.text = ta.value; cnt.textContent = ta.value.length; });

    /* 兴趣标签（两处同步） */
    box.querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.tag;
      const i = state.draft.interests.indexOf(id);
      if (i >= 0) state.draft.interests.splice(i, 1); else state.draft.interests.push(id);
      box.querySelectorAll('[data-tag="' + id + '"]').forEach(x => x.classList.toggle('on', i < 0));
    }));

    /* 高级筛选 */
    const tog = box.querySelector('#advToggle'), panel = box.querySelector('#advPanel');
    tog.addEventListener('click', () => {
      const open = panel.classList.toggle('open');
      tog.classList.toggle('open', open);
      state.ui.advOpen = open;
    });
    box.querySelector('#fFrom').addEventListener('input', e => state.draft.from = e.target.value);
    box.querySelector('#fStart').addEventListener('change', e => state.draft.startAt = e.target.value);
    box.querySelector('#fBudget').addEventListener('input', e => {
      const v = e.target.value.trim();
      state.draft.budgetMax = v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
    });
    box.querySelector('#fMust').addEventListener('change', e => state.draft.mustEnd = e.target.value);
    const segBind = (sel, attr, key, cast) => {
      box.querySelector(sel).addEventListener('click', e => {
        const b = e.target.closest('[' + attr + ']'); if (!b) return;
        box.querySelectorAll(sel + ' button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        state.draft[key] = cast ? cast(b.getAttribute(attr)) : b.getAttribute(attr);
      });
    };
    segBind('#fDur', 'data-dur', 'durationMin', v => parseInt(v, 10));
    segBind('#fPace', 'data-pace', 'pace');
    segBind('#fTrans', 'data-trans', 'transport');

    /* 示例需求 */
    box.querySelector('[data-act="example"]').addEventListener('click', () => {
      state.draft.text = '周日下午想在南京老城逛 4 小时，喜欢咖啡馆、历史街区和适合拍照的地方，尽量少走回头路，预算 150 元以内。';
      state.draft.interests = ['coffee', 'history', 'photo'];
      state.draft.durationMin = 240; state.draft.budgetMax = 150; state.draft.pace = 'mid';
      renderLeft(state); renderRight(state);
      U.toast('已填入示例需求，可以直接生成');
    });

    /* 生成 */
    box.querySelector('#genBtn').addEventListener('click', () => startGenerate(state));

    /* 修改条件 */
    const ec = box.querySelector('[data-act="editCond"]');
    if (ec) ec.addEventListener('click', () => {
      state.ui.advOpen = true;
      panel.classList.add('open'); tog.classList.add('open');
      const rect = panel.getBoundingClientRect();
      if ((rect.top < 0 || rect.top > window.innerHeight) && panel.scrollIntoView) {
        try { panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* 部分环境不支持 */ }
      }
      U.toast('已展开高级筛选，修改后点「按当前条件重新生成」');
    });

    /* AI 对话 */
    const ci = box.querySelector('#chatInput');
    if (ci) {
      const send = () => { const v = ci.value.trim(); if (!v) return; ci.value = ''; sendChat(state, v); };
      box.querySelector('[data-act="chatSend"]').addEventListener('click', send);
      ci.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    }
    const chips = box.querySelector('#chatChips');
    if (chips) chips.addEventListener('click', e => {
      const b = e.target.closest('[data-chip]'); if (!b) return;
      sendChat(state, b.dataset.chip);
    });
    const body = box.querySelector('#chatBody');
    if (body) {
      body.addEventListener('click', e => {
        const b = e.target.closest('[data-opt]'); if (!b) return;
        const res = A.resolveConflict(b.dataset.opt, state.route);
        state.chat.push({ who: 'ai', text: res.reply, changes: res.changes });
        if (state.route.conflict) {
          state.chat.push({ who: 'ai', title: state.route.conflict.title, text: state.route.conflict.detail, options: state.route.conflict.options });
        }
        state.chatChips = DEFAULT_CHIPS;
        refreshResult(state);
        U.toast('已按你的选择调整');
      });
    }
    const cr = box.querySelector('[data-act="chatReset"]');
    if (cr) cr.addEventListener('click', () => {
      state.chat = []; state.chatChips = DEFAULT_CHIPS;
      renderLeft(state); U.toast('对话已清空');
    });
  }

  /* =====================================================================
   * 生成流程
   * ===================================================================== */
  function conditionsFromDraft(state) {
    const d = state.draft;
    const cond = A.defaultConditions();
    cond.city = state.city;
    cond.durationMin = d.durationMin || 240;
    cond.interests = d.interests.slice();
    cond.pace = d.pace;
    cond.budgetMax = d.budgetMax;
    cond.transport = d.transport;
    cond.startAt = d.startAt;
    cond.from = d.from;
    cond.mustEnd = d.mustEnd;
    return cond;
  }

  /* 自然语言里识别到的条件 → 同步回表单（两种输入方式互相配合） */
  function mergeIntent(state, intent) {
    const d = state.draft;
    const applied = [];
    if (intent.durationMin) { d.durationMin = intent.durationMin; applied.push('时长 ' + U.fmtDuration(intent.durationMin)); }
    if (intent.budgetMax != null) { d.budgetMax = intent.budgetMax; applied.push('预算 ¥' + intent.budgetMax); }
    if (intent.pace) { d.pace = intent.pace; applied.push('节奏 ' + (D.PACES.find(p => p.id === intent.pace) || {}).name); }
    if (intent.interests && intent.interests.length) {
      intent.interests.forEach(i => { if (d.interests.indexOf(i) < 0) d.interests.push(i); });
      applied.push('兴趣 ' + intent.interests.map(i => D.interest(i).name).join('、'));
    }
    if (intent.signals.from) { d.from = intent.signals.from; applied.push('出发地 ' + intent.signals.from); }
    return applied;
  }

  async function startGenerate(state) {
    if (busy) return;
    busy = true;
    const intent = A.parseIntent(state.draft.text, state.city);
    const applied = mergeIntent(state, intent);
    const cond = conditionsFromDraft(state);
    const check = A.checkCompleteness(cond);

    if (!check.ok) {
      busy = false;
      state.chat = state.chat.concat([
        { who: 'me', text: state.draft.text || '帮我规划一条 CityWalk 路线' },
        { who: 'ai', title: '还需要两个信息', text: check.ask.question + '\n' + check.ask.detail }
      ]);
      state.chatChips = check.ask.chips;
      if (state.view !== 'result') { state.view = 'idle'; }
      renderLeft(state);
      U.toast('信息还不够，我在对话里问了你两个问题', 'warn');
      const body = document.getElementById('chatBody');
      if (body) body.scrollTop = body.scrollHeight;
      return;
    }

    /* 进入加载态 */
    state.view = 'loading'; state.loadStep = 0;
    renderLeft(state); renderRight(state);
    if (applied.length) U.toast('已从描述中识别：' + applied.join(' · '));

    for (let i = 0; i < LOAD_STEPS.length; i++) {
      state.loadStep = i;
      paintSteps(i);
      await sleep(420 + Math.random() * 220);
    }
    state.loadStep = LOAD_STEPS.length;
    paintSteps(LOAD_STEPS.length);

    let route;
    try {
      route = await A.run('plan', { conditions: cond });
    } catch (err) {
      busy = false;
      state.view = state.route ? 'result' : 'idle';
      renderLeft(state); renderRight(state);
      state.chat.push({ who: 'ai', title: '规划服务暂时不可用', text: (err && err.message ? err.message : '请求失败') + '。请稍后重试，或检查 config.js 中的智能体服务配置。' });
      renderLeft(state);
      return;
    }
    if (check.note) route.notes.push(check.note);

    state.route = route;
    state.routeStore[route.id] = route;
    state.view = 'result';
    state.selectedPlace = null;
    state.chat = state.chat.concat([
      { who: 'me', text: state.draft.text || '（使用筛选条件）' },
      {
        who: 'ai', title: '路线已生成',
        text: `按你给的条件排了一条 ${route.places.length} 个地点的路线，全程约 ${U.fmtDuration(route.actualMin)}，步行约 ${route.distanceKm} km。所有时长与距离均为估算值。`,
        bullets: [
          '地图标记与下方卡片一一对应，点卡片会高亮地图上的点',
          '想调整直接说，例如「缩短步行距离」「加一家咖啡馆」'
        ]
      }
    ]);
    if (route.conflict) {
      state.chat.push({ who: 'ai', title: '⚠️ ' + route.conflict.title, text: route.conflict.detail, options: route.conflict.options });
    } else if (route.timeNote) {
      state.chat.push({ who: 'ai', title: '时间提示', text: route.timeNote });
    } else if (route.spareNote) {
      state.chat.push({ who: 'ai', title: '还有富余时间', text: route.spareNote });
    }
    if (route.degraded) {
      state.chat.push({ who: 'ai', title: '已切换为本地模拟', text: '智能体服务暂时不可用（' + (route.degradeReason || '请求失败') + '），本次结果由本地规则生成，仅供参考。' });
    }
    state.chatChips = DEFAULT_CHIPS;
    busy = false;
    renderLeft(state); renderRight(state);
    U.toast('路线已生成');
  }

  function paintSteps(done) {
    const wrap = document.getElementById('loadSteps');
    if (!wrap) return;
    wrap.querySelectorAll('.lstep').forEach((el, i) => {
      el.classList.toggle('done', i < done);
      el.classList.toggle('doing', i === done);
      const ic = el.querySelector('.ls-ico');
      if (ic) ic.innerHTML = i < done ? U.icon('check') : '';
    });
  }

  async function sendChat(state, text) {
    // 串行化：把任务接到队列末尾，保证多条指令顺序执行、状态不互相覆盖
    const prev = chatQueue;
    chatQueue = prev.then(() => _sendChatImpl(state, text), () => _sendChatImpl(state, text));
    return chatQueue;
  }
  async function _sendChatImpl(state, text) {
    if (!state.route) return;
    state.chat.push({ who: 'me', text: text });
    let res;
    try {
      res = await A.run('refine', { text: text, route: state.route });
    } catch (err) {
      state.chat.push({ who: 'ai', title: '调整失败', text: (err && err.message ? err.message : '请求失败') + '。请稍后重试，或在高级筛选里手动修改条件。' });
      refreshResult(state);
      return;
    }
    if (res.route) state.route = res.route;
    state.chat.push({ who: 'ai', text: res.reply, bullets: res.bullets, changes: res.changes, options: res.conflict ? res.conflict.options : null });
    state.chatChips = res.ask && res.ask.chips ? res.ask.chips : DEFAULT_CHIPS;
    refreshResult(state);
    if (res.degraded) {
      state.chat.push({ who: 'ai', title: '已切换为本地模拟', text: '智能体服务暂时不可用（' + (res.degradeReason || '请求失败') + '），本次调整由本地规则完成。' });
      refreshResult(state);
    }
    if (res.changed) U.toast('路线已更新');
  }

  /* =====================================================================
   * 右栏
   * ===================================================================== */
  function renderRight(state) {
    const box = document.getElementById('wsRight');
    if (state.view === 'loading') {
      box.innerHTML = `<div class="card">
        <div class="loading-wrap">
          <div class="loading-ring">${U.icon('sparkle')}</div>
          <h3>正在为你规划路线</h3>
          <div class="lw-sub">预计几秒内完成，你可以继续修改左侧的条件</div>
          <div class="loading-steps" id="loadSteps">
            ${LOAD_STEPS.map((s, i) => `<div class="lstep${i === 0 ? ' doing' : ''}">
              <span class="ls-ico"></span><span>${i + 1}. ${s}</span></div>`).join('')}
          </div>
        </div>
      </div>`;
      paintSteps(state.loadStep);
      return;
    }
    if (state.view === 'result' && state.route) { renderResult(state); return; }

    /* 未生成：示例路线 + 地点发现 */
    const cur = D.route('r_old_town');
    box.innerHTML = `
      <div class="preview-card">
        <div class="preview-head">
          <div><h3>先看看别人怎么逛</h3><div class="sub">精选路线 · 可直接体验，也可作为规划参考</div></div>
          <button class="btn btn-ghost btn-sm" data-act="gotoDiscover">更多路线${U.icon('arrowRight')}</button>
        </div>
        <div class="preview-body">
          <div class="saved-route" style="border:none;padding:0">
            <div class="sr-img" style="${imgStyle(cur.cover)}"></div>
            <div class="sr-body">
              <h4>${U.esc(cur.name)}</h4>
              <p>${U.esc(cur.desc)}</p>
              <div class="chips" style="margin-top:9px">
                <span class="tag">${U.fmtDuration(cur.duration)}</span>
                <span class="tag">${cur.places.length} 个地点</span>
                <span class="tag">约 ${cur.distanceKm} km</span>
                <span class="tag-amber tag">¥${cur.budget[0]}–${cur.budget[1]}</span>
              </div>
            </div>
            <button class="btn btn-amber btn-sm" data-curated="${cur.id}">一键体验</button>
          </div>
        </div>
      </div>

      <div class="card card-pad">
        <div class="card-title">
          <h3>南京 · 地点发现</h3>
          <span class="sub">示例数据 · 营业信息待确认</span>
        </div>
        <div class="discover-grid">
          ${D.places(D.FEATURED_PLACE_IDS).map(p => `
            <button class="place-mini" data-place="${p.id}">
              <div class="pm-img" style="${imgStyle(p.img)}">
                <span class="pm-cat">${U.esc(D.cat(p.cat).name)}</span>
              </div>
              <div class="pm-body">
                <b>${U.esc(p.name)}</b>
                <span>${U.esc(p.area)}</span>
                <span>建议停留 ${p.stay} 分钟 · ${U.fmtCost(p.cost)}</span>
              </div>
            </button>`).join('')}
        </div>
        <div class="note-box" style="margin-top:16px">${U.icon('info')}
          <span>这些地点可以点开看详情并收藏。生成路线后，它们会根据你的兴趣与时间被自动挑选和排序。</span></div>
      </div>`;

    box.querySelector('[data-act="gotoDiscover"]').addEventListener('click', () => CW.navigate('discover'));
    box.querySelector('[data-curated]').addEventListener('click', e => useCurated(e.currentTarget.dataset.curated, state));
    box.querySelectorAll('[data-place]').forEach(b => b.addEventListener('click', () => openPlace(b.dataset.place)));
  }

  /* ---------------- 结果区 ---------------- */
  function renderResult(state) {
    const box = document.getElementById('wsRight');
    box.innerHTML = `
      <div id="summarySlot"></div>
      <div class="map-card">
        <div class="map-head">
          <div class="mh-l">${U.icon('route')}
            <div><h3>路线示意图</h3><span>编号与下方卡片顺序一致</span></div></div>
          <div class="chips">
            <span class="tag">${state.route.places.length} 个地点</span>
            <span class="tag-green tag">${state.route.distanceKm} km</span>
          </div>
        </div>
        <div id="mapSlot"></div>
      </div>
      <div id="timelineSlot"></div>`;

    mapApi = CW.map.render(box.querySelector('#mapSlot'), state.route, {
      onSelect: id => selectPlace(state, id, true)
    });
    paintSummary(state); paintTimeline(state);
  }

  function paintSummary(state) {
    const r = state.route, slot = document.getElementById('summarySlot');
    if (!slot) return;
    const dirty = r.orderDirty;
    slot.innerHTML = `
      <div class="summary-card">
        <div class="sc-eyebrow">${r.source === 'curated' ? 'Curated Route · 精选路线' : 'AI Planned · 模拟规划结果'}</div>
        <h2>${U.esc(r.name)}</h2>
        <div class="sc-style">${r.style.map(s => `<span>${U.esc(s)}</span>`).join('')}</div>
        <div class="sc-metrics">
          <div class="m"><b>${U.fmtDuration(r.actualMin)}</b><span>预计总时长（含停留与步行）</span></div>
          <div class="m"><b>${r.places.length} <small>个</small></b><span>地点数量</span></div>
          <div class="m"><b>${r.distanceKm} <small>km</small></b><span>预计步行距离</span></div>
          <div class="m"><b>${r.budgetMax == null && r.budget[1] === 0 ? '免费' : U.fmtCost(r.budget)}</b>
            <span>预算估算${r.conditions.budgetMax ? '（上限 ¥' + r.conditions.budgetMax + '）' : ' · 未指定预算'}</span></div>
        </div>
        <div class="sc-actions">
          <button class="btn btn-amber-on-dark" data-act="favRoute">${U.icon(favRoute() ? 'check' : 'bookmark')}${favRoute() ? '已收藏' : '收藏路线'}</button>
          <button class="btn btn-on-dark" data-act="replan">${U.icon('refresh')}重新规划</button>
          <button class="btn btn-on-dark" data-act="editCond2">${U.icon('edit')}编辑条件</button>
          <button class="btn btn-on-dark" data-act="share">${U.icon('share')}分享路线</button>
        </div>
      </div>
      ${r.conflict ? `<div class="note-box amber" style="margin-top:14px">
        ${U.icon('alert')}
        <span><b>${U.esc(r.conflict.title)}</b>：${U.esc(r.conflict.detail)}</span>
      </div>` : ''}
      ${r.timeNote ? `<div class="note-box blue" style="margin-top:10px">${U.icon('clock')}<span>${U.esc(r.timeNote)}</span></div>` : ''}
      ${r.spareNote ? `<div class="note-box blue" style="margin-top:10px">${U.icon('info')}<span>${U.esc(r.spareNote)}</span></div>` : ''}
      <div class="note-box" style="margin-top:10px">
        ${U.icon('info')}
        <span>${D.DISCLAIMER.sample} · ${D.DISCLAIMER.estimate} · ${D.DISCLAIMER.hours}</span>
      </div>
      ${dirty ? `<div class="note-box blue" style="margin-top:10px">${U.icon('info')}
        <span><b>顺序已手动调整。</b>本原型不具备真实路径计算能力，因此<b>距离与时间未重新计算</b>，仍为原顺序的估算值，地图标记编号已同步更新。</span></div>` : ''}`;

    const slotEl = slot;
    const on = (act, fn) => { const b = slotEl.querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener('click', fn); };
    on('favRoute', () => toggleFavRoute(state));
    on('replan', () => { U.toast('已按当前条件重新生成'); startGenerate(state); });
    on('editCond2', () => {
      state.ui.advOpen = true;
      const p = document.getElementById('advPanel'), t = document.getElementById('advToggle');
      if (p) p.classList.add('open'); if (t) t.classList.add('open');
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { /* 部分嵌入环境不支持 */ }
      U.toast('已展开高级筛选，修改后点「按当前条件重新生成」');
    });
    on('share', () => {
      const r2 = state.route;
      const text = `${r2.name}｜${U.fmtDuration(r2.actualMin)} · ${r2.places.length} 个地点 · ${r2.distanceKm} km\n`
        + D.places(r2.places).map((p, i) => `${i + 1}. ${p.name}（${D.cat(p.cat).name}）`).join('\n')
        + `\n——由 CityWalk AI 原型生成，数据为示例估算值`;
      U.modal({
        title: '分享路线', sub: '复制下面这段文字即可发给朋友',
        body: `<textarea class="textarea" rows="9" readonly>${U.esc(text)}</textarea>
               <div class="note-box" style="margin-top:12px">${U.icon('info')}
                 <span>演示原型未接入真实分享服务，这里仅提供可复制的文本内容。</span></div>`,
        footer: `<button class="btn btn-ghost" data-mclose>关闭</button>
                 <button class="btn btn-primary" data-act="copy">${U.icon('check')}复制内容</button>`
      });
      const cbtn = document.getElementById('modalRoot').querySelector('[data-act="copy"]');
      if (cbtn) cbtn.addEventListener('click', () => {
        const ta = document.getElementById('modalRoot').querySelector('textarea');
        ta.select();
        try { document.execCommand('copy'); U.toast('已复制到剪贴板'); }
        catch (e) { U.toast('复制失败，请手动选中复制', 'warn'); }
      });
    });
  }

  function favRoute() {
    const s = CW.state;
    return !!s.route && s.favorites.routes.indexOf(s.route.id) >= 0;
  }
  function toggleFavRoute(state) {
    const id = state.route.id, arr = state.favorites.routes;
    const i = arr.indexOf(id);
    if (i >= 0) { arr.splice(i, 1); U.toast('已取消收藏'); }
    else { arr.push(id); U.toast('已收藏到「我的收藏」'); }
    paintSummary(state);
  }

  function paintTimeline(state) {
    const r = state.route, slot = document.getElementById('timelineSlot');
    if (!slot) return;
    const places = D.places(r.places);
    slot.innerHTML = `
      <div class="card card-pad">
        <div class="card-title">
          <h3>行程时间线</h3>
          <span class="sub">可拖动卡片或使用上下按钮调整顺序</span>
        </div>
        <div class="timeline" id="timeline">
          ${places.map((p, i) => timelineItem(p, i, r)).join('')}
        </div>
        <div class="note-box" style="margin-top:16px">${U.icon('info')}
          <span>停留时长、消费区间与步行耗时均为<b>估算值</b>；营业时间未核实，一律显示「信息待确认」。排序只调整展示顺序，不代表真实最优路径。</span></div>
      </div>`;

    const tl = slot.querySelector('#timeline');
    tl.addEventListener('click', e => {
      const fav = e.target.closest('[data-fav]');
      if (fav) { toggleFavPlace(fav.dataset.fav, state); return; }
      const up = e.target.closest('[data-up]');
      if (up) { movePlace(state, up.dataset.up, -1); return; }
      const down = e.target.closest('[data-down]');
      if (down) { movePlace(state, down.dataset.down, 1); return; }
      const det = e.target.closest('[data-detail]');
      if (det) { openPlace(det.dataset.detail); return; }
      const card = e.target.closest('.place-card');
      if (card) selectPlace(state, card.dataset.id, false);
    });
    /* 拖动排序 */
    tl.addEventListener('dragstart', e => {
      const c = e.target.closest('.place-card'); if (!c) return;
      dragId = c.dataset.id; c.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (err) { }
    });
    tl.addEventListener('dragover', e => {
      const c = e.target.closest('.place-card'); if (!c || !dragId) return;
      e.preventDefault();
      tl.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
      if (c.dataset.id !== dragId) c.classList.add('drop-target');
    });
    tl.addEventListener('drop', e => {
      const c = e.target.closest('.place-card'); if (!c || !dragId) return;
      e.preventDefault();
      const ids = state.route.places.slice();
      const from = ids.indexOf(dragId), to = ids.indexOf(c.dataset.id);
      if (from < 0 || to < 0 || from === to) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      applyOrder(state, ids);
    });
    tl.addEventListener('dragend', () => {
      dragId = null;
      tl.querySelectorAll('.dragging,.drop-target').forEach(x => x.classList.remove('dragging', 'drop-target'));
    });
  }

  function timelineItem(p, i, r) {
    const seg = r.segments[i] || {};
    const last = i === r.places.length - 1;
    const walkTxt = last ? '路线终点'
      : (r.orderDirty || seg.walkFromPrev == null
        ? '与下一站的距离待重新计算'
        : `步行约 ${seg.walkFromPrev} 分钟到下一站（估算）`);
    const on = favPlace(p.id);
    return `<div class="tl-item${CW.state.selectedPlace === p.id ? ' sel' : ''}">
      <div class="tl-rail"><div class="tl-num">${i + 1}</div><div class="tl-line"></div></div>
      <div class="place-card${CW.state.selectedPlace === p.id ? ' sel' : ''}" data-id="${p.id}" draggable="true">
        <div class="pc-img" style="${imgStyle(p.img)}"><span class="pc-order">${String(i + 1).padStart(2, '0')}</span></div>
        <div class="pc-body">
          <div class="pc-top">
            <div>
              <h4>${U.esc(p.name)}</h4>
              <div class="pc-cat">
                <span class="tag" style="background:${D.cat(p.cat).color}1A;color:${D.cat(p.cat).color}">${U.esc(D.cat(p.cat).name)}</span>
                <span>${U.esc(p.area)}</span>
              </div>
            </div>
            <div class="pc-acts">
              <button class="fav-btn${on ? ' on' : ''}" data-fav="${p.id}" title="${on ? '取消收藏' : '收藏地点'}">${U.icon('heart')}</button>
              <button class="sort-btn" data-up="${p.id}" ${i === 0 ? 'disabled' : ''} title="上移">${U.icon('arrowUp')}</button>
              <button class="sort-btn" data-down="${p.id}" ${last ? 'disabled' : ''} title="下移">${U.icon('arrowDown')}</button>
            </div>
          </div>
          <div class="pc-reason">${U.esc(p.reason)}<br><span class="hint">推荐理由：${U.esc(A.explainPlace(p, r, i))}</span></div>
          <div class="pc-meta">
            <span class="mm">${U.icon('clock')}建议停留 ${seg.stay || p.stay} 分钟</span>
            <span class="mm">${U.icon('wallet')}${U.fmtCost(p.cost)}${p.costNote ? ' · ' + U.esc(p.costNote) : ''}</span>
            <span class="mm">${U.icon('info')}${U.esc(hoursText(p))}</span>
          </div>
          <div class="pc-foot">
            <span class="pc-walk">${U.icon('walk')}${U.esc(walkTxt)}</span>
            <button class="btn btn-ghost btn-sm" data-detail="${p.id}">查看详情</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  /* 手动排序：只改顺序，不重算距离与时间（如实提示） */
  function applyOrder(state, ids) {
    const r = state.route;
    const stayMap = {};
    r.segments.forEach(s => { stayMap[s.placeId] = s.stay; });
    r.places = ids;
    r.orderDirty = true;
    r.segments = ids.map((id, i) => ({
      placeId: id,
      stay: stayMap[id] || D.place(id).stay,
      walkFromPrev: i === 0 ? 0 : null
    }));
    refreshResult(state);
    U.toast('顺序已更新，距离与时间未重新计算', 'warn');
  }

  function movePlace(state, id, dir) {
    const ids = state.route.places.slice();
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    applyOrder(state, ids);
  }

  function selectPlace(state, id, fromMap) {
    state.selectedPlace = (state.selectedPlace === id) ? null : id;
    const sel = state.selectedPlace;
    const tl = document.getElementById('timeline');
    if (tl) {
      tl.querySelectorAll('.tl-item').forEach(it => {
        const card = it.querySelector('.place-card');
        const on = card && card.dataset.id === sel;
        it.classList.toggle('sel', on);
        card.classList.toggle('sel', on);
      });
    }
    if (mapApi) mapApi.select(sel);
    if (sel && fromMap) {
      const tl2 = document.getElementById('timeline');
      const card = tl2 && tl2.querySelector('.place-card[data-id="' + sel + '"]');
      if (card && card.scrollIntoView) { try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* 部分环境不支持 */ } }
    }
  }

  function toggleFavPlace(id, state) {
    const arr = state.favorites.places, i = arr.indexOf(id);
    if (i >= 0) { arr.splice(i, 1); U.toast('已取消收藏地点'); }
    else { arr.push(id); U.toast('已收藏地点，可在「我的收藏」查看'); }
    const tl = document.getElementById('timeline');
    if (tl) {
      const b = tl.querySelector('[data-fav="' + id + '"]');
      if (b) b.classList.toggle('on', i < 0);
    }
  }

  /* ---------------- 地点详情 ---------------- */
  function openPlace(id) {
    const p = D.place(id); if (!p) return;
    const on = favPlace(id);
    const inRoute = CW.state.route && CW.state.route.places.indexOf(id) >= 0;
    const idx = inRoute ? CW.state.route.places.indexOf(id) + 1 : null;
    U.modal({
      title: p.name,
      sub: `${D.cat(p.cat).name} · ${p.area}`,
      width: 640,
      body: `
        <div class="detail-hero" style="${imgStyle(p.img)}"><span class="dh-cat">${U.esc(D.cat(p.cat).name)}</span></div>
        <div class="detail-rows">
          <div class="kv"><span>为什么推荐</span><b style="text-align:right;max-width:62%">${U.esc(p.reason)}</b></div>
          <div class="kv"><span>建议停留</span><b>${p.stay} 分钟（估算）</b></div>
          <div class="kv"><span>预计消费</span><b>${U.fmtCost(p.cost)}${p.costNote ? ' · ' + U.esc(p.costNote) : ''}</b></div>
          <div class="kv"><span>营业时间</span><b>${U.esc(hoursText(p))}</b></div>
          <div class="kv"><span>适合偏好</span><b>${p.interests.map(i => U.esc(D.interest(i).name)).join('、')}</b></div>
          <div class="kv"><span>位置</span><b>示意地图坐标（非真实经纬度）</b></div>
          ${idx ? `<div class="kv"><span>在路线中</span><b>第 ${idx} 站</b></div>` : ''}
        </div>
        <div class="note-box" style="margin-top:14px">${U.icon('alert')}
          <span>${U.esc(p.tip)}<br>本页信息为演示数据，出行前请以现场或官方渠道为准。</span></div>`,
      footer: `<button class="btn btn-ghost" data-mclose>关闭</button>
               <button class="btn ${on ? 'btn-soft' : 'btn-primary'}" data-act="fav">${U.icon('heart')}${on ? '取消收藏' : '收藏这个地点'}</button>`
    });
    const fb = document.getElementById('modalRoot').querySelector('[data-act="fav"]');
    if (fb) fb.addEventListener('click', () => {
      toggleFavPlace(id, CW.state);
      const now = favPlace(id);
      fb.className = 'btn ' + (now ? 'btn-soft' : 'btn-primary');
      fb.innerHTML = U.icon('heart') + (now ? '取消收藏' : '收藏这个地点');
    });
  }

  /* ---------------- 使用精选路线 ---------------- */
  function useCurated(id, state) {
    const cur = D.route(id); if (!cur) return;
    state.city = cur.city;
    state.route = routeFromCurated(cur);
    state.conditions = state.route.conditions;
    state.view = 'result';
    state.selectedPlace = null;
    state.draft.interests = state.route.conditions.interests.slice();
    state.draft.durationMin = state.route.conditions.durationMin;
    state.draft.budgetMax = state.route.conditions.budgetMax;
    state.draft.pace = state.route.conditions.pace;
    state.chat = [
      { who: 'me', text: '我想按「' + cur.name + '」这条路线走' },
      { who: 'ai', title: '已载入精选路线', text: `地点顺序为预设内容，时长与距离为估算值。你可以直接改，比如「缩短步行距离」「去掉书店」。` }
    ];
    state.chatChips = DEFAULT_CHIPS;
    CW.navigate('home');
    U.toast('已载入精选路线，可直接调整');
  }

  /* 局部刷新（保持地图实例与缩放状态） */
  function refreshResult(state) {
    if (state.view !== 'result' || !state.route) return;
    paintSummary(state);
    if (mapApi) mapApi.update(state.route);
    paintTimeline(state);
    const body = document.getElementById('chatBody');
    if (body) {
      const msgs = state.chat;
      body.innerHTML = msgs.map(chatMsg).join('');
      body.scrollTop = body.scrollHeight;
    }
    const chips = document.getElementById('chatChips');
    if (chips) chips.innerHTML = (state.chatChips && state.chatChips.length ? state.chatChips : DEFAULT_CHIPS)
      .map(c => `<button data-chip="${U.esc(c)}">${U.esc(c)}</button>`).join('');
  }

  CW.pages = CW.pages || {};
  CW.pages.home = {
    render, useCurated, openPlace, routeFromCurated,
    /* 供测试/外部等待对话队列排空：每次 sendChat 后该 promise 会更新 */
    get chatQueue() { return chatQueue; }
  };
})();
