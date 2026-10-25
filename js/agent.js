/* =====================================================================
 * agent.js · AI Agent 层
 * ---------------------------------------------------------------------
 * 【模拟实现 与 未来真实接入 的边界说明 —— 重要】
 *
 *  本文件当前 100% 为【本地规则模拟】，用于演示产品交互与状态流转：
 *    · 需求解析：关键词规则（parseIntent），非大模型语义理解；
 *    · 路线生成：本地打分 + 贪心填充（planRoute），非真实路径规划；
 *    · 对话修改：规则匹配 + 状态更新（applyInstruction）。
 *
 *  与真实 Agent API 的接入点已预留为单一函数 run()：
 *    当 CONFIG.mode 由 'mock' 改为 'remote' 并填入 endpoint 时，
 *    run() 会改为请求真实服务，其余业务代码无需改动。
 *    → 目前 endpoint 为空，界面会明确标注「演示模式 · 本地模拟」，
 *      不会声称已接入任何大模型或后端服务。
 * ===================================================================== */
(function () {
  const CW = (window.CW = window.CW || {});
  const D = CW.data;

  /* ---------------- 接入配置（来自 js/config.js，可被部署覆盖） ---------------- */
  const DEFAULT_CONFIG = {
    mode: 'mock',        // 'mock'（当前） | 'remote'（未来接入真实 Agent API）
    endpoint: '',        // 例如 'https://your-domain/api/agent'
    auth: { type: 'none', token: '', headerName: 'X-Api-Key' },
    request: null,       // 可选：自定义请求函数（接 Coze/大模型 SDK 时使用）
    fallback: 'mock',    // 远程失败时 'mock' 回退 | 'error' 只报错
    timeoutMs: 20000,
    latency: [420, 780]  // 模拟思考延迟（毫秒），仅 mock 模式使用
  };
  function getConfig() {
    const c = (window.CW_CONFIG && window.CW_CONFIG.agent) || {};
    return Object.assign({}, DEFAULT_CONFIG, c, {
      auth: Object.assign({}, DEFAULT_CONFIG.auth, c.auth || {})
    });
  }
  const CONFIG = getConfig();
  const isMock = () => CONFIG.mode !== 'remote' || !CONFIG.endpoint;

  /* =====================================================================
   * 一、需求解析
   * ===================================================================== */
  const CITY_ALIAS = { 南京: 'nanjing', 苏州: 'suzhou', 杭州: 'hangzhou', 上海: 'shanghai', 成都: 'chengdu' };

  function parseIntent(text, fallbackCity) {
    const t = String(text || '');
    const out = { city: fallbackCity || 'nanjing', interests: [], raw: t, signals: {} };

    // 城市
    for (const name in CITY_ALIAS) if (t.includes(name)) { out.city = CITY_ALIAS[name]; out.signals.city = name; }

    // 时长
    let m = t.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(小时|h|H|钟头)/);
    if (m) { out.durationMin = Math.round(parseFloat(m[1]) * 60); out.signals.duration = m[0]; }
    else if ((m = t.match(/(\d+)\s*分钟/))) { out.durationMin = parseInt(m[1], 10); out.signals.duration = m[0]; }

    // 预算
    if ((m = t.match(/(?:预算|花费|人均)?\s*(\d+)\s*(?:元|块)\s*(?:以内|以下|左右|之内)?/))) {
      out.budgetMax = parseInt(m[1], 10); out.signals.budget = m[0];
    }

    // 兴趣
    const rules = [
      { id: 'coffee',  re: /咖啡|甜品|下午茶|喝点|喝杯/ },
      { id: 'history', re: /历史|老街|老城|古建|文化|人文|秦淮/ },
      { id: 'photo',   re: /拍照|摄影|出片|打卡|机位|建筑/ },
      { id: 'book',    re: /书店|看书|阅读|读书/ },
      { id: 'park',    re: /公园|绿地|湖边|湖|散步|绿道|自然/ },
      { id: 'local',   re: /本地|特色|小吃|市集|烟火|在地/ }
    ];
    rules.forEach(r => { if (r.re.test(t)) out.interests.push(r.id); });

    // 节奏 / 步行（先摘掉「少走回头路」这类路线偏好词，避免被误判成慢节奏）
    const paceText = t.replace(/少走回头路|不走回头路|不要绕路|尽量少走|少走/g, '');
    if (/慢|轻松|悠闲|不要太累|不赶时间/.test(paceText)) out.pace = 'light';
    if (/深度|多逛|多安排|走遍|尽量多|暴走/.test(paceText)) out.pace = 'deep';
    if (/少走回头路|不走回头|不要绕|尽量少走/.test(t)) out.noBacktrack = true;

    // 时间点
    if ((m = t.match(/(今天|明天|周六|周日|周末|上午|下午|傍晚|晚上)/))) out.signals.when = m[0];
    if ((m = t.match(/(\d{1,2})[:：点](\d{2})?/))) out.signals.startAt = m[0];

    // 出发位置（简单识别）
    if ((m = t.match(/从\s*([^\s，,。]{2,10}?)\s*(出发|开始)/))) out.signals.from = m[1];

    return out;
  }

  /* 需求完整度校验 → 决定「直接生成」还是「主动澄清」 */
  function checkCompleteness(cond) {
    const missing = [];
    if (!cond.interests || !cond.interests.length) missing.push('interests');
    if (!cond.durationMin) missing.push('duration');
    // 城市始终有默认值（来自顶部选择器），但会在澄清话术中一并确认
    if (missing.length >= 2) {
      return {
        ok: false,
        ask: {
          question: '你想在哪座城市漫步？预计有多少时间？',
          detail: '有了城市和时长，我才能判断能安排几个地点、是否需要控制步行距离。',
          chips: ['南京 · 2 小时', '南京 · 3 小时', '南京 · 4 小时', '半天（6 小时）']
        }
      };
    }
    if (missing.includes('duration')) {
      return {
        ok: false,
        ask: {
          question: '这次大概有多少时间？',
          detail: '时间决定了路线里能安排几个地点，以及每个地点停留多久。',
          chips: ['2 小时', '3 小时', '4 小时', '6 小时']
        }
      };
    }
    if (missing.includes('interests')) {
      return {
        ok: true,
        note: '你没有选择兴趣偏好，我先按均衡偏好生成一版；可以随时在对话里补充，比如「多安排一家咖啡馆」。'
      };
    }
    return { ok: true };
  }

  /* =====================================================================
   * 二、路线生成（本地打分 + 贪心填充）
   * ===================================================================== */
  const MAP_UNIT_M = 8;      // 1 地图单位 ≈ 8 米（示意地图自定标尺）
  const WALK_M_PER_MIN = 75; // 步行速度 ≈ 4.5km/h
  const PLACE_LIMIT = 7;

  function walkMinutes(a, b) {
    const d = Math.sqrt(Math.pow(a.mapX - b.mapX, 2) + Math.pow(a.mapY - b.mapY, 2));
    return Math.max(3, Math.round((d * MAP_UNIT_M) / WALK_M_PER_MIN));
  }

  function defaultConditions() {
    return {
      city: 'nanjing', durationMin: 240, interests: [], budgetMax: null,
      pace: 'mid', transport: 'walk', startAt: '14:00', from: '', mustEnd: '',
      noBacktrack: true
    };
  }

  /* 打分：兴趣匹配度 + 与偏好节奏的契合度
     直接命中地点标签记高分，仅类别沾边记低分，避免「勾选越多、专类地点越吃亏」 */
  function scorePlace(p, cond) {
    let s = 0;
    cond.interests.forEach(id => {
      if (p.interests.indexOf(id) >= 0) s += 5;
      const it = D.interest(id);
      if (it && it.cats.indexOf(p.cat) >= 0) s += 1;
    });
    if (!cond.interests.length) s += 1;                 // 无偏好时全部候选基础分一致
    if (cond.pace === 'light' && p.cat === 'park') s += 1;
    if (cond.pace === 'deep' && p.cat !== 'park') s += 1;
    if (p.cost[1] > 0 && cond.budgetMax && cond.budgetMax < 80) s -= 1;  // 低预算时弱化高消费点
    return s;
  }

  /* 排序：按地理走向（西北 → 东南）扫掠，减少回头路 */
  function sweepKey(p) { return p.mapY + p.mapX * 0.35; }

  function estimateStay(p, cond) {
    const pace = D.PACES.find(x => x.id === cond.pace) || D.PACES[1];
    return Math.round(p.stay * pace.stayFactor);
  }

  /* 核心：根据条件与候选顺序，贪心填充出一份可行路线 */
  function planRoute(cond, options) {
    options = options || {};
    const pool = D.placesOfCity(cond.city);
    const pace = D.PACES.find(x => x.id === cond.pace) || D.PACES[1];

    // 目标地点数（按时长与节奏换算，仅作为上限）
    let target = Math.round((cond.durationMin / 60) * 1.4 * pace.placeBudget);
    target = Math.max(2, Math.min(PLACE_LIMIT, target));

    let cands;
    if (options.forceIds) {
      // 精选路线：保留作者编排的顺序，不再筛选
      return buildRoute(cond, options.forceIds, { target: options.forceIds.length });
    }

    /* 1) 先按兴趣偏好打分，取分数靠前的一小批作为候选 */
    const ranked = pool.slice().sort((a, b) => {
      const sa = scorePlace(a, cond), sb = scorePlace(b, cond);
      if (sb !== sa) return sb - sa;
      return sweepKey(a) - sweepKey(b);
    });
    const positive = ranked.filter(p => scorePlace(p, cond) > 0);
    const base = positive.length >= 2 ? positive : ranked;   // 有匹配地点时，不混入完全无关的地点
    cands = base.slice(0, Math.min(base.length, target + 2));

    /* 2) 以「就近插入成本」贪心填充：既保住高分地点，又避免为了顺路牺牲偏好 */
    const picked = [];
    let used = 0;
    const limit = Math.round(cond.durationMin * 0.98);
    const insertCost = p => {
      const stay = estimateStay(p, cond);
      if (!picked.length) return stay;
      let nearest = Infinity;
      picked.forEach(q => { nearest = Math.min(nearest, walkMinutes(p, q)); });
      return stay + nearest;
    };
    for (const p of cands) {
      if (picked.length >= target) break;
      const add = insertCost(p);
      if (picked.length >= 2 && used + add > limit) continue;   // 预算内放不下，看看后面更近的
      picked.push(p); used += add;
    }

    /* 至少保留 2 个地点，否则路线不成立 */
    if (picked.length < 2) {
      for (const p of ranked) {
        if (picked.length >= 2) break;
        if (picked.indexOf(p) >= 0) continue;
        picked.push(p);
        used += estimateStay(p, cond) + (picked.length > 1 ? walkMinutes(picked[0], p) : 0);
      }
    }

    /* 3) 最后按地理走向（西北 → 东南）排序，形成少走回头路的步行序列 */
    picked.sort((a, b) => sweepKey(a) - sweepKey(b));

    const route = buildRoute(cond, picked.map(p => p.id), { usedMin: used, target });
    const spare = cond.durationMin - route.actualMin;
    if (spare > cond.durationMin * 0.25 && !route.conflict) {
      route.spareNote = '示例地点库里符合当前兴趣的地点已排完：实际安排约 ' + CW.ui.fmtDuration(route.actualMin) +
        '，比预算少约 ' + CW.ui.fmtDuration(spare) + '。可以放宽兴趣偏好，或把节奏调成「深度探索」。';
    }
    return route;
  }

  /* 由地点序列构建完整路线对象（含分段步行、汇总、冲突检测） */
  function buildRoute(cond, placeIds, meta) {
    meta = meta || {};
    const places = D.places(placeIds);
    const segments = [];
    let walkTotal = 0, stayTotal = 0;
    places.forEach((p, i) => {
      const stay = estimateStay(p, cond);
      stayTotal += stay;
      let walk = 0;
      if (i > 0) { walk = walkMinutes(places[i - 1], p); walkTotal += walk; }
      segments.push({ placeId: p.id, stay, walkFromPrev: walk });
    });
    const totalMin = stayTotal + walkTotal;
    const distanceKm = D.minutesToKm(walkTotal);
    const costLo = places.reduce((s, p) => s + p.cost[0], 0);
    const costHi = places.reduce((s, p) => s + p.cost[1], 0);

    const route = {
      id: 'r_' + Date.now(),
      name: routeName(cond, places),
      city: cond.city,
      source: 'ai',
      places: places.map(p => p.id),
      segments,
      durationMin: cond.durationMin,
      actualMin: totalMin,
      stayTotal, walkTotal, distanceKm,
      budget: costHi === 0 ? [0, 0] : [costLo, costHi],
      budgetMax: cond.budgetMax,
      style: styleTags(cond, places),
      conditions: JSON.parse(JSON.stringify(cond)),
      notes: [],
      conflict: null,
      orderDirty: false,   // 手动排序后置 true → 提示「距离与时间未重新计算」
      createdAt: new Date().toISOString()
    };
    route.notes.push(D.DISCLAIMER.sample + ' · ' + D.DISCLAIMER.estimate);
    if (meta.note) route.notes.push(meta.note);

    // ---- 冲突检测 ----
    const conflicts = [];
    const overMin = totalMin - cond.durationMin;
    if (overMin > cond.durationMin * 0.10) {
      // 明显超时 → 硬冲突，交给用户选优先级
      conflicts.push({
        type: 'time',
        title: '时间预算不足',
        detail: '按当前安排，全程约需 ' + CW.ui.fmtDuration(totalMin) + '，超出你给的 ' +
          CW.ui.fmtDuration(cond.durationMin) + '。',
        options: [
          { id: 'drop_last', label: '减少一个地点' },
          { id: 'pace_light', label: '把节奏调整为轻松' }
        ]
      });
    } else if (overMin > 0) {
      // 轻微超出 → 只做提示，不打断
      route.timeNote = '实际安排约 ' + CW.ui.fmtDuration(totalMin) + '，比预算多约 ' +
        CW.ui.fmtDuration(overMin) + '，如需严格卡点可以减少一站。';
    }
    if (cond.budgetMax && costHi > cond.budgetMax) {
      conflicts.push({
        type: 'budget',
        title: '预算可能超出',
        detail: '按示例消费区间估算，全程约 ¥' + costLo + '–' + costHi + '，上限高于你设定的 ¥' + cond.budgetMax + '。',
        options: [
          { id: 'drop_costly', label: '去掉最贵的一站' },
          { id: 'keep', label: '保留，我自己控制消费' }
        ]
      });
    }
    route.conflict = conflicts.length ? conflicts[0] : null;
    route.conflicts = conflicts;
    return route;
  }

  function routeName(cond, places) {
    const city = D.city(cond.city) ? D.city(cond.city).name : '城市';
    const word = { coffee: '咖啡', history: '老城', photo: '建筑', book: '书店', park: '绿道', local: '市井' };
    const key = cond.interests[0];
    const area = key && word[key] ? word[key] : '城市';
    const paceWord = { light: '慢节奏漫游', mid: '均衡漫步', deep: '深度探索' }[cond.pace] || '漫步';
    return `${city}${area} · ${paceWord}`;
  }

  function styleTags(cond, places) {
    const tags = [];
    cond.interests.forEach(id => { const it = D.interest(id); if (it) tags.push(it.name); });
    if (cond.noBacktrack) tags.push('少走回头路');
    const pace = D.PACES.find(p => p.id === cond.pace); if (pace) tags.push(pace.name);
    if (places.some(p => p.cat === 'park')) tags.push('含绿地休息');
    if (cond.transport === 'mix') tags.push('步行 + 地铁');
    if (cond.transport === 'bike') tags.push('步行 + 单车');
    return tags.slice(0, 5);
  }

  /* 为每个地点生成「为什么推荐」说明 */
  function explainPlace(place, route, index) {
    const cond = route.conditions;
    const hits = cond.interests.filter(id => place.interests.indexOf(id) >= 0)
      .map(id => { const it = D.interest(id); return it ? it.name : ''; }).filter(Boolean);
    const parts = [];
    if (hits.length) parts.push(`匹配你选择的「${hits.join('、')}」偏好`);
    else parts.push('按整体节奏与顺路程度纳入');
    const seg = route.segments[index];
    if (index > 0 && seg) parts.push(`从上一站步行约 ${seg.walkFromPrev} 分钟（估算）`);
    if (place.cat === 'park' && cond.pace === 'light') parts.push('安排在路线后段，方便随时休息');
    return parts.join(' · ');
  }

  /* =====================================================================
   * 三、对话式修改
   * ===================================================================== */
  const CAT_WORD = [
    { re: /咖啡|甜品/, cat: 'cafe', label: '咖啡馆' },
    { re: /书店|阅读/, cat: 'book', label: '书店' },
    { re: /公园|绿地|湖/, cat: 'park', label: '公园' },
    { re: /拍照|摄影|机位/, cat: 'photo', label: '拍照点' },
    { re: /历史|老街|古建/, cat: 'history', label: '历史街区' },
    { re: /吃饭|小吃|正餐|餐厅/, cat: 'food', label: '本地小馆' }
  ];

  /* 重新计算路线指标（地点顺序变化后调用） */
  function recompute(route) {
    const cond = route.conditions;
    const places = D.places(route.places);
    const segments = []; let walkTotal = 0, stayTotal = 0;
    places.forEach((p, i) => {
      const stay = estimateStay(p, cond); stayTotal += stay;
      let walk = 0;
      if (i > 0) { walk = walkMinutes(places[i - 1], p); walkTotal += walk; }
      segments.push({ placeId: p.id, stay, walkFromPrev: walk });
    });
    route.segments = segments;
    route.stayTotal = stayTotal; route.walkTotal = walkTotal;
    route.actualMin = stayTotal + walkTotal;
    route.distanceKm = D.minutesToKm(walkTotal);
    route.budget = places.reduce((s, p) => s + p.cost[1], 0) === 0 ? [0, 0]
      : [places.reduce((s, p) => s + p.cost[0], 0), places.reduce((s, p) => s + p.cost[1], 0)];
    route.style = styleTags(cond, places);
    return route;
  }

  function changesOf(before, after) {
    const list = [];
    if (before.places.length !== after.places.length)
      list.push({ label: '地点数量', from: before.places.length + ' 个', to: after.places.length + ' 个' });
    if (Math.round(before.distanceKm * 10) !== Math.round(after.distanceKm * 10))
      list.push({ label: '预计步行', from: before.distanceKm + ' km', to: after.distanceKm + ' km' });
    if (before.actualMin !== after.actualMin)
      list.push({ label: '预计总时长', from: CW.ui.fmtDuration(before.actualMin), to: CW.ui.fmtDuration(after.actualMin) });
    const b = before.budget || [0, 0], a = after.budget || [0, 0];
    if (b[1] !== a[1])
      list.push({ label: '预算估算', from: CW.ui.fmtCost(b), to: CW.ui.fmtCost(a) });
    const bset = before.places.join(','), aset = after.places.join(',');
    if (bset !== aset && before.places.length === after.places.length) list.push({ label: '地点组合', from: '已调整', to: '见下方时间线' });
    return list;
  }

  function snapshot(route) {
    return { places: route.places.slice(), distanceKm: route.distanceKm, actualMin: route.actualMin, budget: (route.budget || [0, 0]).slice() };
  }

  /**
   * 应用一条用户指令
   * @returns {{reply:string, bullets:string[], changes:Array, conflict:Object|null, ask:Object|null, route:Object}}
   */
  function applyInstruction(text, route) {
    const cond = route.conditions;
    const before = snapshot(route);
    const t = String(text || '');
    let bullets = [], reply = '', ask = null, conflict = null;
    let changed = false;

    const intent = parseIntent(t, cond.city);

    /* 分句识别「增加 / 去掉某类地点」——支持一句话里同时出现两个动作 */
    let addHit = null, delHit = null;
    t.split(/[，,。；;、！!？?]/).forEach(seg => {
      const hit = CAT_WORD.find(c => c.re.test(seg));
      if (!hit) return;
      if (/去掉|删掉|不要|取消|不想去|别安排|去除/.test(seg)) delHit = hit;
      else if (/增加|加一个|加一家|再来|补一个|换成/.test(seg)) addHit = hit;
    });

    /* ---- 0. 澄清类回答（用户补充城市/时长） ---- */
    if (intent.durationMin && /小时|分钟/.test(t) && !/(缩短|减少)/.test(t)) {
      cond.durationMin = intent.durationMin; changed = true;
      reply = `已把可用时间更新为 ${CW.ui.fmtDuration(intent.durationMin)}，我按新时间重新排了一下。`;
      const rebuilt = planRoute(cond);
      Object.assign(route, rebuilt, { id: route.id, conditions: cond });
    }
    /* ---- 1. 缩短步行 ---- */
    else if (/缩短|少走|太远|走太多|近一点|减少步行/.test(t)) {
      const places = D.places(route.places);
      if (places.length <= 2) {
        reply = '现在只剩 2 个地点了，再减少路线就不成立了。要不要我把节奏调成「轻松」，把每站停留时间拉长？';
        bullets = ['也可以指定去掉某一类地点，例如「去掉书店」'];
      } else {
        // 去掉「与前后两站步行距离之和最大」的一站
        let worst = 1, worstCost = -1;
        for (let i = 1; i < places.length - 1; i++) {
          const c = walkMinutes(places[i - 1], places[i]) + walkMinutes(places[i], places[i + 1]);
          if (c > worstCost) { worstCost = c; worst = i; }
        }
        const removed = places.splice(worst, 1)[0];
        route.places = places.map(p => p.id);
        recompute(route); changed = true;
        reply = `我把「${removed.name}」从路线里拿掉了，它是前后步行距离最长的一站。`;
        bullets = ['如果想保留它，可以改成「步行 + 地铁」减少步行时间'];
      }
    }
    /* ---- 2. 增加 / 去掉某类地点（可同时出现） ---- */
    else if (addHit || delHit) {
      const notes = [];
      if (delHit) {
        const had = D.places(route.places).filter(p => p.cat === delHit.cat);
        const keep = D.places(route.places).filter(p => p.cat !== delHit.cat);
        if (!had.length) notes.push(`这条路线里目前没有「${delHit.label}」，不需要去掉。`);
        else if (keep.length < 2) notes.push(`去掉「${delHit.label}」后路线只剩 ${keep.length} 个地点，会太空，我先保留了。`);
        else {
          route.places = keep.map(p => p.id);
          recompute(route); changed = true;
          notes.push(`已去掉 ${had.map(p => '「' + p.name + '」').join('、')}。`);
        }
      }
      if (addHit) {
        const pool = D.placesOfCity(cond.city).filter(p => p.cat === addHit.cat && route.places.indexOf(p.id) < 0);
        if (!pool.length) notes.push(`示例地点库里暂时没有更多「${addHit.label}」可以加，或者它已经在路线里了。`);
        else {
          const pick = pool.sort((a, b) => sweepKey(a) - sweepKey(b))[0];
          const list = D.places(route.places).concat([pick]).sort((a, b) => sweepKey(a) - sweepKey(b));
          route.places = list.map(p => p.id);
          recompute(route); changed = true;
          notes.push(`加上了「${pick.name}」，并按顺路程度插到了合适的位置。`);
        }
      }
      reply = notes.join(' ');
      if (route.places.length >= 6) bullets.push('地点已经比较多了，如果时间不够可以让我减掉一站');
    }
    /* ---- 3. 节奏调整 ---- */
    else if (/慢一点|节奏慢|轻松|不要太累|悠闲|不要太多景点|少安排|精简/.test(t)) {
      cond.pace = 'light';
      const places = D.places(route.places);
      if (places.length > 3) {
        const removed = places.pop();
        route.places = places.map(p => p.id);
        reply = `已把节奏调成「轻松」，并减少了一站（去掉「${removed.name}」），每站停留时间会相应拉长。`;
      } else {
        reply = '已把节奏调成「轻松」，每站停留时间拉长，步行段不变。';
      }
      recompute(route); changed = true;
    }
    else if (/深度|多逛|多安排|尽量多|走遍/.test(t)) {
      cond.pace = 'deep';
      const rebuilt = planRoute(cond);
      Object.assign(route, rebuilt, { id: route.id, conditions: cond });
      reply = '已切换到「深度探索」节奏，多安排了一些地点，步行量会相应增加。';
      changed = true;
    }
    /* ---- 5. 预算 ---- */
    else if (/预算|元以内|块钱|花费控制|控制在/.test(t) && intent.budgetMax) {
      cond.budgetMax = intent.budgetMax; changed = true;
      const places = D.places(route.places);
      const totalHi = places.reduce((s, p) => s + p.cost[1], 0);
      if (totalHi <= cond.budgetMax) {
        reply = `预算已设为 ¥${cond.budgetMax}，当前安排的消费上限约 ¥${totalHi}，在范围内。`;
      } else {
        // 自动去掉最贵的一站
        const sorted = places.slice().sort((a, b) => b.cost[1] - a.cost[1]);
        const drop = sorted[0];
        const keep = places.filter(p => p.id !== drop.id);
        if (keep.length >= 2) {
          route.places = keep.map(p => p.id);
          recompute(route);
          reply = `预算设为 ¥${cond.budgetMax}。原来预计上限 ¥${totalHi} 偏高，我去掉了消费最高的一站（「${drop.name}」）。`;
        } else {
          reply = `预算设为 ¥${cond.budgetMax}，但当前路线只有 ${places.length} 个地点，再减会太空。建议保留，或自己控制单站消费。`;
          conflict = { title: '预算与路线长度冲突', detail: '减少地点会影响路线完整性。', options: [{ id: 'keep', label: '保留当前安排' }] };
        }
      }
    }
    /* ---- 6. 只提到时长（缩短类除外） ---- */
    else if (intent.durationMin) {
      cond.durationMin = intent.durationMin; changed = true;
      const rebuilt = planRoute(cond);
      Object.assign(route, rebuilt, { id: route.id, conditions: cond });
      reply = `时间改成 ${CW.ui.fmtDuration(intent.durationMin)}了，我重新排了一版。`;
    }
    /* ---- 7. 无法识别 ---- */
    else {
      reply = '我可以帮你调整路线，比如「缩短步行距离」「加一家咖啡馆」「去掉书店」「改成 3 小时」「预算控制在 100 元以内」。';
      bullets = ['也可以直接说「节奏慢一点」'];
    }

    if (changed) {
      // 统一冲突复核
      const places = D.places(route.places);
      route.conflict = null; route.conflicts = []; route.timeNote = null; route.spareNote = null;
      if (route.actualMin > cond.durationMin * 1.10) {
        route.conflict = {
          type: 'time', title: '时间预算不足',
          detail: `当前安排约需 ${CW.ui.fmtDuration(route.actualMin)}，超出你给的 ${CW.ui.fmtDuration(cond.durationMin)}。`,
          options: [{ id: 'drop_last', label: '减少一个地点' }, { id: 'pace_light', label: '调整为轻松节奏' }]
        };
        route.conflicts = [route.conflict];
      } else if (route.actualMin > cond.durationMin) {
        route.timeNote = `实际安排约 ${CW.ui.fmtDuration(route.actualMin)}，比预算多约 ${CW.ui.fmtDuration(route.actualMin - cond.durationMin)}，如需严格卡点可以减少一站。`;
      }
      if (cond.budgetMax && route.budget[1] > cond.budgetMax) {
        const c = {
          type: 'budget', title: '预算可能超出',
          detail: `预计消费上限约 ¥${route.budget[1]}，高于设定的 ¥${cond.budgetMax}。`,
          options: [{ id: 'drop_costly', label: '去掉最贵的一站' }, { id: 'keep', label: '保留，我自己控制' }]
        };
        route.conflicts = (route.conflicts || []).concat([c]);
        route.conflict = route.conflict || c;
      }
      route.orderDirty = false;
      route.name = routeName(cond, places);
    }

    const changes = changed ? changesOf(before, route) : [];
    if (changed && route.conflict) {
      // 冲突时补充提示，要求用户选择优先级
      bullets = bullets.concat([`⚠️ ${route.conflict.title}：${route.conflict.detail}`]);
    }
    return { reply, bullets, changes, conflict: route.conflict, ask, route, changed };
  }

  /* 处理冲突选项 */
  function resolveConflict(optionId, route) {
    const cond = route.conditions;
    const before = snapshot(route);
    let reply = '';
    if (optionId === 'drop_last') {
      const places = D.places(route.places);
      if (places.length > 2) { const r = places.pop(); route.places = places.map(p => p.id); reply = `已去掉最后一站「${r.name}」。`; }
      else reply = '地点已经很少了，建议放宽时间或改成轻松节奏。';
    } else if (optionId === 'pace_light') {
      cond.pace = 'light'; reply = '已把节奏调整为「轻松」，每站停留时间拉长、步行节奏放缓。';
    } else if (optionId === 'drop_costly') {
      const places = D.places(route.places);
      const drop = places.slice().sort((a, b) => b.cost[1] - a.cost[1])[0];
      const keep = places.filter(p => p.id !== drop.id);
      if (keep.length >= 2) { route.places = keep.map(p => p.id); reply = `已去掉消费最高的一站「${drop.name}」。`; }
      else reply = '再减少地点路线会太空，建议保留并自行控制单站消费。';
    } else { reply = '好的，保留当前安排。'; }
    recompute(route);
    const places = D.places(route.places);
    route.name = routeName(cond, places);
    route.conflict = null; route.conflicts = [];
    if (route.actualMin > cond.durationMin) {
      route.conflict = { type: 'time', title: '时间仍然偏紧', detail: `当前约需 ${CW.ui.fmtDuration(route.actualMin)}，预算 ${CW.ui.fmtDuration(cond.durationMin)}。`, options: [{ id: 'drop_last', label: '再减少一个地点' }, { id: 'keep', label: '就这样出发' }] };
    }
    return { reply, changes: changesOf(before, route), route };
  }

  /* =====================================================================
   * 四、统一入口（模拟 / 真实 的分界线）
   * ---------------------------------------------------------------------
   * task:
   *   'plan'   → payload { conditions }            返回 Route
   *   'refine' → payload { text, route }           返回 { reply, bullets,
   *                                                     changes, changed,
   *                                                     conflict, route }
   *
   * 远程协议（请求体 / 返回体字段）见 docs/API-INTEGRATION.md。
   * ===================================================================== */

  /* 带超时的 fetch */
  function fetchWithTimeout(url, options, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('请求超时')), timeoutMs || 20000);
      fetch(url, options).then(res => { clearTimeout(timer); resolve(res); }, err => { clearTimeout(timer); reject(err); });
    });
  }

  /* 调用真实智能体服务 */
  async function callRemote(task, payload) {
    const cfg = getConfig();

    // 1) 允许用自定义 request 函数直接接 SDK（如 Coze Agent SDK）
    if (typeof cfg.request === 'function') {
      return await cfg.request(task, payload);
    }

    // 2) 默认：POST JSON 到 endpoint
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.auth.type === 'bearer' && cfg.auth.token) headers.Authorization = 'Bearer ' + cfg.auth.token;
    if (cfg.auth.type === 'custom' && cfg.auth.token) headers[cfg.auth.headerName] = cfg.auth.token;

    const res = await fetchWithTimeout(cfg.endpoint, {
      method: 'POST', headers, body: JSON.stringify({ task, payload })
    }, cfg.timeoutMs);
    if (!res.ok) throw new Error('服务返回异常：HTTP ' + res.status);
    const json = await res.json();
    return normalizeRemote(task, json);
  }

  /* 校验远程返回是否满足前端所需结构；不满足则报错，避免渲染脏数据 */
  function normalizeRemote(task, json) {
    const data = json && (json.data != null ? json.data : json);
    if (task === 'plan') {
      if (!data || !Array.isArray(data.places) || !data.places.length) {
        throw new Error('服务未返回有效路线');
      }
      return data;
    }
    if (task === 'refine') {
      if (!data || !data.route || !Array.isArray(data.route.places)) {
        throw new Error('服务未返回有效调整结果');
      }
      return data;
    }
    return data;
  }

  /* 本地兜底：远程失败且 fallback==='mock' 时使用 */
  function localRun(task, payload) {
    if (task === 'plan') {
      const route = planRoute(payload.conditions);
      if (payload.note) route.notes.push(payload.note);
      return route;
    }
    if (task === 'refine') return applyInstruction(payload.text, payload.route);
    throw new Error('unknown task: ' + task);
  }

  async function run(task, payload) {
    const cfg = getConfig();
    const remote = cfg.mode === 'remote' && (cfg.endpoint || typeof cfg.request === 'function');
    if (!remote) {
      // —— 本地模拟实现 ——
      await new Promise(r => setTimeout(r, 120 + Math.random() * 160));
      return localRun(task, payload);
    }
    try {
      return await callRemote(task, payload);
    } catch (err) {
      if (cfg.fallback === 'mock') {
        // 降级到本地模拟，并在结果上打标，界面会提示用户
        const local = await localRun(task, payload);
        if (task === 'plan') { local.degraded = true; local.degradeReason = err.message; }
        else { local.route && (local.route.degraded = true); local.degraded = true; local.degradeReason = err.message; }
        local._error = err.message;
        return local;
      }
      throw err;
    }
  }

  /* 供界面查询当前模式与连接信息 */
  function status() {
    const cfg = getConfig();
    return {
      mode: cfg.mode,
      connected: cfg.mode === 'remote' && (!!cfg.endpoint || typeof cfg.request === 'function'),
      endpoint: cfg.endpoint || '',
      fallback: cfg.fallback
    };
  }

  CW.agent = {
    CONFIG, isMock, run, status,
    parseIntent, checkCompleteness, defaultConditions,
    planRoute, buildRoute, recompute, explainPlace,
    applyInstruction, resolveConflict, snapshot, changesOf,
    walkMinutes, localRun
  };
})();
