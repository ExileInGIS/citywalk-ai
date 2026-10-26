/* =====================================================================
 * pages/home.js · 首页：AI 路线规划工作台
 * ---------------------------------------------------------------------
 *  左 42%：自然语言输入 + 核心条件 / 更多偏好 + 澄清卡 + 条件卡 + AI 对话
 *  右 58%：服务状态 + 摘要（评分/约束）+ 冲突 + 差异 + 地图 + 来源 + 时间线
 *
 *  契约（并行工程师实现）：CW.agent.run/status/parseIntent/...、
 *  CW.MapEngine.render/getProviderId、CW.storage、CW.telemetry、
 *  CW.schema.validateRoute/validateRefine。
 *  本文件对旧版 Route（stay / walkFromPrev / budget 数组）与新版 Route v1
 *  （stayMin / walkFromPrevMin / budget 对象 / constraints / scores）都做了
 *  读取兼容，任何契约函数缺失时给出可读提示而不是白屏。
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
  const DEFAULT_CHIPS = [
    '少走一点路',
    '把咖啡馆换成书店',
    '多看历史建筑',
    '预算 100 以内',
    '五点前结束',
    '保留第一站和最后一站',
    '下雨改室内',
    '不要类似景点'
  ];
  const DATE_OPTIONS = ['今天', '明天', '本周末', '下周末'];
  const PARTY_NAMES = { solo: '一个人', friends: '朋友同行', couple: '情侣同行', family: '家庭 / 亲子' };
  const WEATHER_NAMES = { any: '不限', rain: '下雨', sunny: '晴朗', hot: '炎热', cold: '寒冷' };
  const WALK_NAMES = { light: '轻松（≤ 3 km）', mid: '适中（≤ 6 km）', deep: '深度（≤ 10 km）' };
  const BASIS_NAMES = { total: '总价', per_person: '人均' };
  const FOOD_OPTIONS = ['素食', '不吃辣', '本地小吃', '少油少盐'];
  const ACCESS_OPTIONS = ['少台阶', '轮椅通行', '婴儿车通行'];
  const SCORE_LABELS = [
    ['interest', '兴趣匹配'],
    ['timeFit', '时间契合'],
    ['efficiency', '顺路效率'],
    ['budgetFit', '预算契合'],
    ['diversity', '地点多样性']
  ];
  const STATUS_META = {
    met: { label: '已满足', icon: 'check' },
    partial: { label: '部分满足', icon: 'alert' },
    violated: { label: '未满足', icon: 'close' },
    unknown: { label: '无法确认', icon: 'info' }
  };
  const ERROR_TEXT = {
    INVALID_INPUT: '请求内容不完整或格式不正确。',
    INVALID_OUTPUT: '服务返回的路线结构不合法，已拒绝渲染。',
    NOT_FOUND: '请求的接口不存在，请检查服务地址。',
    RATE_LIMITED: '请求太频繁，请稍等一会儿再试。',
    UPSTREAM_TIMEOUT: '服务响应超时，可以重试或切换本地模拟。',
    UPSTREAM_ERROR: '上游服务暂时不可用。',
    REMOTE_NOT_CONFIGURED: '远程服务尚未配置，当前只能使用本地模拟。',
    INTERNAL: '服务内部错误，请稍后重试。',
    NO_CANDIDATES: '当前条件下没有可安排的地点。',
    NETWORK: '网络连接失败，请检查服务是否已启动。'
  };

  let chatQueue = Promise.resolve();   // 串行化对话指令，避免连续点击相互踩踏
  let dragId = null;
  let busy = false;
  let mapApi = null;

  /* =====================================================================
   * 基础工具
   * ===================================================================== */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function imgStyle(path) { return `background-image:url('${path}')`; }
  function track(event, props) {
    try { if (CW.track) CW.track(event, props); } catch (e) { /* 埋点不阻塞 */ }
  }
  function storageEnabled() {
    try {
      if (!CW.storage) return false;
      const en = CW.storage.enabled;
      return typeof en === 'function' ? !!en() : en !== false;
    } catch (e) { return false; }
  }
  function persistDraft() {
    try { if (CW.saveDraftSoon) CW.saveDraftSoon(); } catch (e) { /* 忽略 */ }
  }
  function persistFavorites() {
    try {
      if (CW.persistFavorites) CW.persistFavorites();
      else if (CW.storage && typeof CW.storage.saveFavorites === 'function') {
        CW.storage.saveFavorites(CW.state.favorites);
      }
    } catch (e) { /* 忽略 */ }
  }
  function defaultConditions() {
    try {
      if (A && typeof A.defaultConditions === 'function') return A.defaultConditions();
    } catch (e) { /* 兜底 */ }
    return {
      city: 'nanjing', startLocation: '', durationMin: 240, startTime: '14:00', endTime: '',
      interests: [], budgetMax: null, budgetBasis: 'total', party: 'solo',
      walkingTolerance: 'mid', transport: 'walk', pace: 'mid',
      foodPreferences: [], accessibility: [], weather: 'any', avoid: [], mustVisit: [],
      additionalRequirements: ''
    };
  }
  function num(v, fallback) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : (fallback === undefined ? null : fallback);
  }
  function uniq(arr) {
    const out = [];
    (Array.isArray(arr) ? arr : []).forEach(x => {
      const s = String(x == null ? '' : x).trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }
  function parseList(text) {
    return uniq(String(text == null ? '' : text).split(/[,，、;；\n]/).map(s => s.trim()).filter(Boolean)).slice(0, 20);
  }
  function parseClock(v) {
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^([01]?\d|2[0-3])[:：]([0-5]\d)$/);
    if (m) return String(m[1]).padStart(2, '0') + ':' + m[2];
    m = s.match(/([01]?\d|2[0-3])\s*[点時时]\s*([0-5]?\d)?/);
    if (m) return String(m[1]).padStart(2, '0') + ':' + String(m[2] || '00').padStart(2, '0');
    return null;
  }
  function parseDurationValue(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v > 0 ? Math.round(v) : null;
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (/半\s*[天日]/.test(s)) return 360;
    let m = s.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(小时|h|鐘|钟头)/i);
    if (m) return Math.round(parseFloat(m[1]) * 60);
    m = s.match(/(\d+)\s*分钟/);
    if (m) return parseInt(m[1], 10);
    m = s.match(/^(\d+(?:\.\d+)?)$/);
    if (m) {
      const n = parseFloat(m[1]);
      return n <= 24 ? Math.round(n * 60) : Math.round(n);
    }
    return null;
  }
  function parseMoney(v) {
    const s = String(v == null ? '' : v).replace(/[¥￥,，\s]/g, '');
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
  }
  function cityIdOf(v) {
    const s = String(v == null ? '' : v);
    const hit = (D.CITIES || []).find(c => s === c.id || s.indexOf(c.name) >= 0);
    return hit ? hit.id : null;
  }
  function enumFromInput(value, map, fallback) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return fallback;
    if (map[s]) return s;
    const found = Object.keys(map).find(k => map[k] === s || (map[k] && String(map[k]).indexOf(s) >= 0));
    return found || fallback;
  }
  const PARTY_MAP = { solo: '一个人', friends: '朋友', couple: '情侣', family: '家庭' };
  const PACE_MAP = { light: '轻松', mid: '适中', deep: '深度' };
  const TRANS_MAP = { walk: '全程步行', mix: '步行 + 地铁', bike: '步行 + 单车' };
  const WALK_MAP = { light: '轻松', mid: '适中', deep: '深度' };
  function partyName(id) { return PARTY_NAMES[id] || '未指定'; }
  function paceName(id) { const p = (D.PACES || []).find(x => x.id === id); return p ? p.name : (PACE_MAP[id] || '适中'); }
  function transportName(id) { const t = (D.TRANSPORTS || []).find(x => x.id === id); return t ? t.name : (TRANS_MAP[id] || '全程步行'); }
  function weatherName(id) { return WEATHER_NAMES[id] || '不限'; }
  function catName(id) { return (D.cat && D.cat(id).name) || id; }

  /* =====================================================================
   * 路线读取工具：同时兼容 Route v1 与旧版结构
   * ===================================================================== */
  function isV1(route) { return !!(route && route.schemaVersion === 'route.v1'); }
  function placeIds(route) {
    return U.placeIds ? U.placeIds(route) : (route && Array.isArray(route.places)
      ? route.places.map(x => (typeof x === 'string' ? x : x && x.id)).filter(Boolean) : []);
  }
  function routePlaces(route) {
    return D.places(placeIds(route));
  }
  function segmentsOf(route) {
    return U.segmentsOf ? U.segmentsOf(route) : [];
  }
  function budgetRange(route) {
    return U.budgetRange(route && route.budget);
  }
  function budgetLabel(route) {
    const rg = budgetRange(route);
    if (!rg) return '未指定';
    const [lo, hi] = rg;
    const basis = route && route.budget && !Array.isArray(route.budget) && route.budget.basis === 'per_person' ? '人均 ' : '';
    if (lo === 0 && hi === 0) return '免费';
    if (lo === hi) return `${basis}¥${hi}`;
    if (lo === 0) return `${basis}¥0–${hi}`;
    return `${basis}¥${lo}–${hi}`;
  }
  function overallScore(route) {
    const s = route && route.scores;
    if (s && typeof s.overall === 'number' && Number.isFinite(s.overall)) {
      return Math.max(0, Math.min(100, Math.round(s.overall * 100)));
    }
    return null;
  }
  function explanationMap(route) {
    const out = {};
    (Array.isArray(route && route.explanations) ? route.explanations : []).forEach(e => {
      if (e && e.placeId && e.why) out[e.placeId] = e;
    });
    return out;
  }
  function explainPlace(route, place, index) {
    const ex = explanationMap(route)[place.id];
    if (ex && ex.why) return ex.why;
    try {
      if (A && typeof A.explainPlace === 'function') {
        const why = A.explainPlace(place, route, index);
        if (why) return why;
      }
    } catch (e) { /* 旧核心参数不匹配时忽略 */ }
    return place.reason || '';
  }
  function sourceUrlOf(p) {
    const m = String(p.geoSource || '').match(/(node|way|relation)\/(\d+)/);
    return m ? 'https://www.openstreetmap.org/' + m[1] + '/' + m[2] : 'https://www.openstreetmap.org/';
  }
  function isCoordinateVerified(p) {
    return !!(p && (p.geoVerified || (typeof p.lat === 'number' && typeof p.lng === 'number')));
  }
  function dataQualityOf(route) {
    const dq = route && route.dataQuality;
    if (dq && typeof dq === 'object' &&
      ['placesTotal', 'placesWithCoords', 'placesWithHours', 'placesVerified'].every(k => typeof dq[k] === 'number')) {
      return dq;
    }
    const places = routePlaces(route);
    return {
      placesTotal: places.length,
      placesWithCoords: places.filter(isCoordinateVerified).length,
      placesWithHours: places.filter(p => p.hours != null).length,
      placesVerified: places.filter(p => /^verified/.test(String(p.geoStatus || ''))).length,
      disclaimer: (D.DISCLAIMER && D.DISCLAIMER.estimate) || '时长、距离与费用均为估算值'
    };
  }
  function sourcesOf(route) {
    const list = Array.isArray(route && route.sources) ? route.sources.filter(s => s && s.title) : [];
    if (list.length) return list;
    const verified = routePlaces(route).filter(isCoordinateVerified);
    if (!verified.length) return [];
    return [{
      title: 'OpenStreetMap contributors（ODbL 1.0）',
      url: 'https://www.openstreetmap.org/',
      accessedAt: (D.DATA_VERSION || ''),
      license: 'ODbL 1.0',
      note: verified.length + ' 个地点坐标已核验；部分为区域中心点，非入口坐标。'
    }];
  }
  function sourceBadge(place) {
    if (isCoordinateVerified(place)) {
      return `<span class="src-badge verified" title="坐标来自 OpenStreetMap；营业时间仍需现场确认">${U.icon('pin')}坐标已核验</span>`;
    }
    return `<span class="src-badge generic" title="示例 / 泛化地点，无单一实体，不参与真实地图定位">${U.icon('info')}示例地点</span>`;
  }
  function statusMeta(status) {
    return STATUS_META[status] || STATUS_META.unknown;
  }
  function timeToMin(hhmm) {
    const m = String(hhmm || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }
  function deriveConstraints(route) {
    const cond = (route && route.conditions) || {};
    const places = routePlaces(route);
    const out = [];
    const budget = budgetRange(route);
    const duration = num(cond.durationMin, num(route.durationMin, 0));
    const actual = num(route.actualMin, 0);
    if (duration > 0 && actual > 0) {
      let status = 'met';
      if (actual > duration * 1.15) status = 'violated';
      else if (actual > duration * 1.05) status = 'partial';
      out.push({
        id: 'duration', label: '时间上限', kind: 'hard', status,
        detail: `已安排约 ${U.fmtDuration(actual)}，上限 ${U.fmtDuration(duration)}`
      });
    }
    if (cond.budgetMax != null && budget) {
      let status = 'met';
      if (budget[1] > cond.budgetMax) status = budget[0] <= cond.budgetMax ? 'partial' : 'violated';
      out.push({
        id: 'budget', label: '预算上限', kind: 'hard', status,
        detail: `估算 ${budgetLabel(route)}，上限 ¥${cond.budgetMax}${cond.budgetBasis === 'per_person' ? '（人均）' : '（总价）'}`
      });
    }
    if (Array.isArray(cond.mustVisit) && cond.mustVisit.length) {
      const names = places.map(p => p.name);
      const ids = places.map(p => p.id);
      const missing = cond.mustVisit.filter(x => names.indexOf(x) < 0 && ids.indexOf(x) < 0);
      out.push({
        id: 'must_visit', label: '必去地点', kind: 'hard', status: missing.length ? 'violated' : 'met',
        detail: missing.length ? `无法匹配：${missing.join('、')}` : '全部必去地点已安排进路线'
      });
    }
    if (Array.isArray(cond.avoid) && cond.avoid.length) {
      const hit = places.filter(p => cond.avoid.indexOf(p.id) >= 0 || cond.avoid.indexOf(p.cat) >= 0 || cond.avoid.indexOf(p.name) >= 0);
      out.push({
        id: 'avoid', label: '避开项', kind: 'hard', status: hit.length ? 'violated' : 'met',
        detail: hit.length ? `路线中包含：${hit.map(p => p.name).join('、')}` : '未安排需要避开的类别或地点'
      });
    }
    if (cond.walkingTolerance) {
      const maxKm = { light: 3, mid: 6, deep: 10 }[cond.walkingTolerance] || 6;
      const dist = num(route.distanceKm, 0);
      let status = 'met';
      if (dist > maxKm * 1.2) status = 'violated';
      else if (dist > maxKm) status = 'partial';
      out.push({
        id: 'walking', label: '步行上限', kind: 'hard', status,
        detail: `预计步行 ${dist} km，${WALK_NAMES[cond.walkingTolerance] || '上限 ' + maxKm + ' km'}`
      });
    }
    if (Array.isArray(cond.accessibility) && cond.accessibility.length) {
      out.push({
        id: 'accessibility', label: '无障碍需求', kind: 'hard', status: 'unknown',
        detail: '地点无障碍信息尚未核验，无法确认是否满足：' + cond.accessibility.join('、')
      });
    }
    if (cond.endTime) {
      const start = timeToMin(cond.startTime || cond.startAt || '14:00');
      const end = timeToMin(cond.endTime || cond.mustEnd);
      if (start != null && end != null) {
        let expected = end - start;
        if (expected <= 0) expected += 24 * 60;
        const status = actual <= expected ? 'met' : (actual <= expected * 1.1 ? 'partial' : 'violated');
        out.push({
          id: 'end_time', label: '结束时间', kind: 'hard', status,
          detail: `预计 ${U.fmtDuration(actual)}，要求 ${cond.startTime || cond.startAt || '14:00'}–${cond.endTime || cond.mustEnd}`
        });
      }
    }
    return out;
  }
  function constraintsOf(route) {
    if (route && Array.isArray(route.constraints) && route.constraints.length) return route.constraints;
    return deriveConstraints(route);
  }

  /* =====================================================================
   * 服务状态
   * ===================================================================== */
  function mapProviderId() {
    try {
      if (CW.MapEngine && typeof CW.MapEngine.getProviderId === 'function') return CW.MapEngine.getProviderId();
      if (CW.map && typeof CW.map.getProviderName === 'function') return CW.map.getProviderName();
      if (A && typeof A.status === 'function') {
        const st = A.status();
        if (st && st.mapProvider) return st.mapProvider;
      }
    } catch (e) { /* 忽略 */ }
    return 'mock';
  }
  function isRealMap(id) {
    return !!id && id !== 'mock' && id !== 'svg';
  }
  function currentService(state) {
    const svc = state.service || (state.service = {});
    let st = null;
    try { st = A && typeof A.status === 'function' ? A.status() : null; } catch (e) { st = null; }
    if (st && typeof st === 'object') {
      if (st.mode !== undefined) svc.mode = st.mode;
      if (st.connected !== undefined) svc.connected = !!st.connected;
      if (st.endpoint !== undefined) svc.endpoint = st.endpoint || '';
      if (st.fallback !== undefined) svc.fallback = st.fallback;
      if (Object.prototype.hasOwnProperty.call(st, 'lastLatencyMs')) svc.lastLatencyMs = st.lastLatencyMs;
      if (Object.prototype.hasOwnProperty.call(st, 'lastError')) svc.lastError = st.lastError;
      if (st.provider) svc.provider = st.provider;
    }
    svc.mode = svc.mode || 'mock';
    svc.mapProvider = mapProviderId();
    return svc;
  }
  function serviceText(svc) {
    const mode = svc.connected ? '已连接服务' : '本地模拟';
    const map = svc.mapFailed ? '地图不可用' : (isRealMap(svc.mapProvider) ? '真实地图' : '示意地图');
    return { mode, map };
  }
  function friendlyDegradeReason(reason) {
    const raw = String(reason || '');
    if (/timeout|超时/i.test(raw)) return '请求超时，已改用本地规则规划';
    if (/INVALID_OUTPUT|json|schema|结构|校验/i.test(raw)) return '服务返回内容异常，已改用本地规则规划';
    if (/HTTP\s*5\d\d|UPSTREAM|500|502|504/i.test(raw)) return '上游服务暂时不可用，已改用本地规则规划';
    if (/fetch|network|网络/i.test(raw)) return '网络不稳定，已改用本地规则规划';
    if (raw && raw.length <= 80 && /[\u4e00-\u9fa5]/.test(raw) && !/Error|error|HTTP|JSON/.test(raw)) return raw;
    return '智能体服务暂时不可用，已改用本地规则规划';
  }
  function degradeReasonCode(reason) {
    const raw = String(reason || '');
    if (/timeout|超时/i.test(raw)) return 'timeout';
    if (/INVALID_OUTPUT|json|schema|结构|校验/i.test(raw)) return 'invalid_output';
    if (/HTTP\s*5\d\d|UPSTREAM|500|502|504/i.test(raw)) return 'upstream_error';
    if (/fetch|network|网络/i.test(raw)) return 'network';
    return 'remote_failure';
  }
  function friendlyError(err) {
    const code = String((err && (err.code || err.errorCode)) || 'INTERNAL');
    let message = err && err.userMessage ? err.userMessage : (err && err.message ? String(err.message) : '');
    if (!message || /^(Error|TypeError|NetworkError)/i.test(message)) {
      message = ERROR_TEXT[code] || '请求失败，请稍后重试。';
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
      message = ERROR_TEXT.NETWORK;
    }
    if (/请求超时/.test(message)) message = ERROR_TEXT.UPSTREAM_TIMEOUT;
    if (/INVALID_OUTPUT/.test(code) && !/已拒绝渲染/.test(message)) message = ERROR_TEXT.INVALID_OUTPUT;
    return { code, message };
  }
  function serviceBarHtml(state) {
    const svc = currentService(state);
    const t = serviceText(svc);
    const degraded = !!svc.degraded;
    const mapFail = svc.mapFailed;
    const cls = (degraded || mapFail) ? ' warn' : (svc.connected ? ' ok' : '');
    const expand = !!svc.expanded;
    const storage = storageEnabled() ? '本地存储已启用' : '本地存储已关闭';
    const rows = [
      ['运行模式', svc.mode === 'remote' ? 'Remote · 远程服务' : 'Mock · 本地规则'],
      ['服务连接', svc.connected ? '已连接' : '未连接（使用本地模拟）'],
      ['地图 Provider', mapFail ? '加载失败（' + (svc.mapProvider || 'unknown') + '）' : svc.mapProvider],
      ['降级状态', degraded ? '已降级 · ' + friendlyDegradeReason(svc.degradeReason) : '未降级'],
      ['最近延迟', svc.lastLatencyMs != null ? Math.round(svc.lastLatencyMs) + ' ms' : '未记录'],
      ['最近错误', svc.lastError ? String(svc.lastError).slice(0, 120) : '无'],
      ['本地存储', storage]
    ];
    return `<div class="service-wrap">
      <button class="service-bar${cls}" type="button" data-act="toggleService" aria-expanded="${expand}" aria-controls="serviceDetail">
        <span class="dot ${degraded || mapFail ? 'warn' : (svc.connected ? 'ok' : 'mock')}"></span>
        <span class="sb-text"><b>${U.esc(t.mode)}${degraded ? ' · 已降级' : ''}</b><span>${U.esc(t.map)} · ${storage}</span></span>
        ${U.icon('chevron')}
      </button>
      ${expand ? `<div class="service-detail" id="serviceDetail">
        <div class="sd-rows">${rows.map(r => `<div class="kv"><span>${U.esc(r[0])}</span><b>${U.esc(r[1])}</b></div>`).join('')}</div>
        <div class="sd-actions">
          ${degraded ? `<button class="btn btn-ghost btn-sm" type="button" data-act="retryFromService">${U.icon('refresh')}重试本地/远程生成</button>` : ''}
          ${mapFail ? `<button class="btn btn-ghost btn-sm" type="button" data-act="retryMapFromService">${U.icon('refresh')}重试地图</button>` : ''}
        </div>
        <div class="hint">状态来自当前配置与最近一次响应，不代表对网络的实时探测。</div>
      </div>` : ''}
    </div>`;
  }
  function bindServiceBar(root, state) {
    if (!root) return;
    const toggle = root.querySelector('[data-act="toggleService"]');
    if (toggle) toggle.addEventListener('click', () => {
      state.service.expanded = !state.service.expanded;
      paintServiceBar(state);
    });
    const retry = root.querySelector('[data-act="retryFromService"]');
    if (retry) retry.addEventListener('click', () => {
      track('retry_clicked', { context: 'service' });
      startGenerate(state);
    });
    const retryMap = root.querySelector('[data-act="retryMapFromService"]');
    if (retryMap) retryMap.addEventListener('click', () => {
      track('retry_clicked', { context: 'map' });
      state.service.mapFailed = null;
      mountMap(state);
      paintServiceBar(state);
    });
  }
  function paintServiceBar(state) {
    const slot = document.getElementById('serviceSlot');
    if (!slot) return;
    slot.innerHTML = serviceBarHtml(state);
    bindServiceBar(slot, state);
  }

  /* =====================================================================
   * 渲染入口
   * ===================================================================== */
  function render(host, state) {
    host.innerHTML = `<div class="workspace">
      <div class="ws-left" id="wsLeft"></div>
      <div class="ws-right" id="wsRight"></div>
    </div>`;
    renderLeft(state);
    renderRight(state);
  }

  /* =====================================================================
   * 左栏
   * ===================================================================== */
  function renderLeft(state) {
    const box = document.getElementById('wsLeft');
    if (!box) return;
    const d = state.draft;
    const generating = state.view === 'loading';
    const hasResult = state.view === 'result' && state.route;
    const ctaLabel = generating ? '正在为你规划…' : (hasResult ? '按当前条件重新生成' : '生成我的 CityWalk 路线');
    const svc = currentService(state);
    const t = serviceText(svc);
    const genNote = svc.connected
      ? `已连接智能体服务 · ${t.map}`
      : `演示模式 · 本地模拟规划 · ${t.map}`;

    const interestPills = (targetId) => D.INTERESTS.map(i =>
      `<button class="pill${d.interests.indexOf(i.id) >= 0 ? ' on' : ''}" type="button" data-tag="${i.id}" aria-pressed="${d.interests.indexOf(i.id) >= 0 ? 'true' : 'false'}">${U.esc(i.name)}</button>`).join('');

    const durButtons = [120, 180, 240, 360].map(m =>
      `<button type="button" data-dur="${m}" role="radio" aria-checked="${d.durationMin === m ? 'true' : 'false'}" class="${d.durationMin === m ? 'on' : ''}">${m / 60} 小时</button>`).join('')
      + `<button type="button" data-dur="0" role="radio" aria-checked="${!d.durationMin ? 'true' : 'false'}" class="${!d.durationMin ? 'on' : ''}" title="不指定时长，由 AI 追问或按结束时间推导">未定</button>`;
    const basisButtons = Object.keys(BASIS_NAMES).map(k =>
      `<button type="button" data-basis="${k}" role="radio" aria-checked="${d.budgetBasis === k ? 'true' : 'false'}" class="${d.budgetBasis === k ? 'on' : ''}">${BASIS_NAMES[k]}</button>`).join('');
    const walkButtons = Object.keys(WALK_MAP).map(k =>
      `<button type="button" data-walk="${k}" role="radio" aria-checked="${d.walkingTolerance === k ? 'true' : 'false'}" class="${d.walkingTolerance === k ? 'on' : ''}">${WALK_MAP[k]}</button>`).join('');
    const paceButtons = D.PACES.map(p =>
      `<button type="button" data-pace="${p.id}" role="radio" aria-checked="${d.pace === p.id ? 'true' : 'false'}" class="${d.pace === p.id ? 'on' : ''}" title="${U.esc(p.desc)}">${U.esc(p.name)}</button>`).join('');
    const transButtons = D.TRANSPORTS.map(t2 =>
      `<button type="button" data-trans="${t2.id}" role="radio" aria-checked="${d.transport === t2.id ? 'true' : 'false'}" class="${d.transport === t2.id ? 'on' : ''}">${U.esc(t2.name)}</button>`).join('');
    const foodPills = FOOD_OPTIONS.map(x =>
      `<button class="pill${d.foodPreferences.indexOf(x) >= 0 ? ' on' : ''}" type="button" data-food="${U.esc(x)}" aria-pressed="${d.foodPreferences.indexOf(x) >= 0 ? 'true' : 'false'}">${U.esc(x)}</button>`).join('');
    const accessPills = ACCESS_OPTIONS.map(x =>
      `<button class="pill${d.accessibility.indexOf(x) >= 0 ? ' on' : ''}" type="button" data-access="${U.esc(x)}" aria-pressed="${d.accessibility.indexOf(x) >= 0 ? 'true' : 'false'}">${U.esc(x)}</button>`).join('');
    const avoidPills = Object.keys(D.CATEGORIES).map(cid =>
      `<button class="pill${d.avoid.indexOf(cid) >= 0 ? ' on' : ''}" type="button" data-avoid="${cid}" aria-pressed="${d.avoid.indexOf(cid) >= 0 ? 'true' : 'false'}">${U.esc(D.cat(cid).name)}</button>`).join('');

    box.innerHTML = `
      <div class="hero-card">
        <h1>今天，想怎么<em>逛这座城市</em>？</h1>
        <p class="sub">告诉我你的兴趣、时间和同行人，让 AI 帮你规划一场恰到好处的城市漫步。</p>

        <div class="prompt-box">
          <label class="sr-only" for="promptInput">出行需求描述</label>
          <textarea id="promptInput" rows="4" maxlength="200" aria-label="出行需求描述"
            placeholder="例如：周日下午想在南京老城逛 4 小时，喜欢咖啡馆、历史街区和适合拍照的地方，尽量少走回头路，预算 150 元以内。">${U.esc(d.text)}</textarea>
          <div class="prompt-foot">
            <span class="prompt-count" id="promptCount"><b id="pCount">${String(d.text || '').length}</b>/200</span>
            <button class="link-btn" type="button" data-act="example">${U.icon('sparkle')}填入示例需求</button>
          </div>
        </div>

        <div class="quick-label">快速选择你感兴趣的</div>
        <div class="chips" id="quickTags" role="group" aria-label="兴趣偏好">${interestPills('quick')}</div>

        ${state.recognized && state.recognized.items.length ? `<div class="recognized-box" role="status">
          <span class="rb-ico">${U.icon('sparkle')}</span>
          <div class="rb-body"><b>已从描述中识别：</b>${state.recognized.items.map(U.esc).join(' · ')}
            <span class="hint">已同步到下方表单，可直接修改。</span></div>
          <button class="rb-close" type="button" data-act="clearRecognized" aria-label="收起识别结果">${U.icon('close')}</button>
        </div>` : ''}

        <button class="adv-toggle${state.ui.advOpen ? ' open' : ''}" id="advToggle" type="button"
          aria-expanded="${state.ui.advOpen ? 'true' : 'false'}" aria-controls="advPanel">
          <span class="l">${U.icon('filter')}高级筛选：核心条件 · 更多偏好</span>
          <span class="caret">${U.icon('chevron')}</span>
        </button>
        <div class="adv-panel${state.ui.advOpen ? ' open' : ''}" id="advPanel">
          <div class="adv-inner">
            <div class="adv-group-title">核心条件</div>
            <div class="adv-grid">
              <div class="field"><label for="fFrom">出发位置</label>
                <input class="input" id="fFrom" placeholder="如：新街口地铁站" value="${U.esc(d.startLocation || '')}"></div>
              <div class="field"><label for="fDate">出行日期（仅展示）</label>
                <select class="select" id="fDate">
                  ${DATE_OPTIONS.map(x => `<option${d.date === x ? ' selected' : ''}>${x}</option>`).join('')}
                </select></div>
              <div class="field"><label for="fStart">开始时间</label>
                <input class="input" type="time" id="fStart" value="${U.esc(d.startTime || '')}"></div>
              <div class="field"><label for="fEnd">结束时间（可空）</label>
                <input class="input" type="time" id="fEnd" value="${U.esc(d.endTime || '')}"></div>
              <div class="field full"><label id="lblDur">可用时长</label>
                <div class="seg" id="fDur" role="radiogroup" aria-labelledby="lblDur" aria-required="true">${durButtons}</div></div>
              <div class="field"><label for="fBudget">预算上限（元，留空表示未指定）</label>
                <input class="input" type="number" min="0" max="10000" step="10" id="fBudget" placeholder="留空表示未指定" value="${d.budgetMax == null ? '' : d.budgetMax}"></div>
              <div class="field"><label id="lblBasis">预算口径</label>
                <div class="seg" id="fBasis" role="radiogroup" aria-labelledby="lblBasis">${basisButtons}</div></div>
              <div class="field"><label for="fParty">同行人</label>
                <select class="select" id="fParty">
                  ${Object.keys(PARTY_NAMES).map(k => `<option value="${k}"${d.party === k ? ' selected' : ''}>${PARTY_NAMES[k]}</option>`).join('')}
                </select></div>
              <div class="field"><label id="lblWalk">步行强度</label>
                <div class="seg" id="fWalk" role="radiogroup" aria-labelledby="lblWalk">${walkButtons}</div></div>
            </div>

            <button class="adv-more-toggle${state.ui.moreOpen ? ' open' : ''}" id="moreToggle" type="button"
              aria-expanded="${state.ui.moreOpen ? 'true' : 'false'}" aria-controls="morePanel">
              <span>${U.icon('sliders')}更多偏好（节奏 · 交通 · 餐饮 · 无障碍 · 天气 · 避开 · 必去）</span>
              <span class="caret">${U.icon('chevron')}</span>
            </button>
            <div class="adv-more${state.ui.moreOpen ? ' open' : ''}" id="morePanel">
              <div class="adv-grid">
                <div class="field"><label id="lblPace">节奏</label>
                  <div class="seg" id="fPace" role="radiogroup" aria-labelledby="lblPace">${paceButtons}</div></div>
                <div class="field"><label id="lblTrans">交通方式</label>
                  <div class="seg" id="fTrans" role="radiogroup" aria-labelledby="lblTrans">${transButtons}</div></div>
                <div class="field"><label for="fWeather">天气</label>
                  <select class="select" id="fWeather">
                    ${Object.keys(WEATHER_NAMES).map(k => `<option value="${k}"${d.weather === k ? ' selected' : ''}>${WEATHER_NAMES[k]}</option>`).join('')}
                  </select></div>
                <div class="field full"><label id="lblFood">餐饮偏好（可多选）</label>
                  <div class="chips" id="fFood" role="group" aria-labelledby="lblFood">${foodPills}</div>
                  <input class="input" id="fFoodText" style="margin-top:8px" aria-label="其他餐饮偏好" placeholder="其他餐饮偏好，如：不吃海鲜、需要儿童餐" value="${U.esc(d.foodText || '')}"></div>
                <div class="field full"><label id="lblAccess">无障碍需求（可多选）</label>
                  <div class="chips" id="fAccess" role="group" aria-labelledby="lblAccess">${accessPills}</div></div>
                <div class="field full"><label id="lblAvoid">希望避开（可多选类别）</label>
                  <div class="chips" id="fAvoid" role="group" aria-labelledby="lblAvoid">${avoidPills}</div>
                  <input class="input" id="fAvoidText" style="margin-top:8px" aria-label="其他避开项" placeholder="其他避开项，如：酒吧、人特别多的地方" value="${U.esc(d.avoidText || '')}"></div>
                <div class="field full"><label for="fMust">必去地点</label>
                  <input class="input" id="fMust" placeholder="用逗号分隔，如：先锋书店、玄武湖" value="${U.esc(d.mustVisitText || '')}" aria-describedby="mustHint">
                  <div class="hint" id="mustHint">地点名或地点 id；无法匹配时不会静默删除，会在约束清单与冲突里说明。</div></div>
              </div>
            </div>
            <div class="hint" style="margin-top:12px">留空的项目按默认值处理；预算留空时路线照常生成，但会标注「未指定」。日期仅记录，不参与计算。</div>
          </div>
        </div>

        <div class="gen-area">
          <button class="btn btn-primary btn-lg" id="genBtn" type="button"${generating ? ' disabled' : ''}>
            ${U.icon('sparkle')}${ctaLabel}</button>
          <div class="gen-note"><span class="dot-live"></span>${U.esc(genNote)}</div>
        </div>
      </div>

      ${state.clarify ? clarifyHtml(state) : ''}
      ${hasResult ? condCard(state) + chatCard(state) : ''}
    `;

    bindLeft(state);
  }

  /* ---------------- 已识别条件 ---------------- */
  function recognizedHtml() { return ''; } // 保留占位，识别卡在 renderLeft 内联渲染

  /* ---------------- 条件卡 ---------------- */
  function condValueRows(state) {
    const c = (state.route && state.route.conditions) || state.lastPlanConditions || defaultConditions();
    const d = state.draft;
    const date = (state.planMeta && state.planMeta.date) || d.date || '今天';
    const interests = Array.isArray(c.interests) && c.interests.length
      ? c.interests.map(id => (D.interest(id) ? D.interest(id).name : id)).join('、')
      : '未指定（按均衡偏好）';
    const budget = c.budgetMax == null ? '未指定' : `¥${c.budgetMax} 以内（${BASIS_NAMES[c.budgetBasis] || '总价'}）`;
    const timeWindow = (c.startTime || c.startAt || '') + (c.endTime || c.mustEnd ? '–' + (c.endTime || c.mustEnd) : '');
    const food = uniq((c.foodPreferences || []).concat(parseList(d.foodText)));
    const avoid = uniq((c.avoid || []).concat(parseList(d.avoidText)));
    const must = uniq((c.mustVisit || []).concat(parseList(d.mustVisitText)));
    return {
      core: [
        ['城市', (D.city(c.city) || { name: c.city || '未指定' }).name, !c.city],
        ['出行日期', date, false],
        ['出发位置', c.startLocation || c.from || '未指定', !(c.startLocation || c.from)],
        ['时间窗口', timeWindow || '未指定（默认 14:00 开始）', !timeWindow],
        ['可用时长', c.durationMin ? U.fmtDuration(c.durationMin) : '未定（待追问）', !c.durationMin],
        ['预算范围', budget, c.budgetMax == null],
        ['同行人', partyName(c.party), !c.party || c.party === 'solo'],
        ['步行强度', WALK_NAMES[c.walkingTolerance] || WALK_NAMES.mid, !c.walkingTolerance]
      ],
      more: [
        ['兴趣偏好', interests, !(c.interests && c.interests.length)],
        ['节奏', paceName(c.pace), false],
        ['交通方式', transportName(c.transport), false],
        ['餐饮偏好', food.length ? food.join('、') : '未指定', !food.length],
        ['无障碍需求', (c.accessibility || []).length ? c.accessibility.join('、') : '未指定', !(c.accessibility || []).length],
        ['天气', weatherName(c.weather), !c.weather || c.weather === 'any'],
        ['避开项', avoid.length ? avoid.map(x => D.cat(x).name || x).join('、') : '未指定', !avoid.length],
        ['必去地点', must.length ? must.join('、') : '未指定', !must.length]
      ]
    };
  }
  function condCard(state) {
    const rows = condValueRows(state);
    const row = (r) => `<div class="cond-row"><span class="k">${U.esc(r[0])}</span><span class="v${r[2] ? ' miss' : ''}">${U.esc(r[1])}</span></div>`;
    return `<div class="card card-pad">
      <div class="card-title">
        <h3>本次规划条件</h3>
        <button class="link-btn" type="button" data-act="editCond">${U.icon('edit')}修改条件</button>
      </div>
      <div class="cond-list">${rows.core.map(row).join('')}</div>
      <details class="cond-more">
        <summary>更多偏好（${rows.more.filter(r => !r[2]).length} 项已设置）</summary>
        <div class="cond-list" style="margin-top:6px">${rows.more.map(row).join('')}</div>
      </details>
    </div>`;
  }

  /* ---------------- AI 对话 ---------------- */
  function chatMsg(m, index) {
    const diff = m.changes && m.changes.length ? `
      <div class="diff-box">
        <div class="d-h">本次调整</div>
        ${m.changes.map(c => {
          const from = c.from != null && c.from !== '' ? String(c.from) : '';
          const to = c.to != null && c.to !== '' ? String(c.to) : '';
          return `<div class="diff-row"><span class="d-label">${U.esc(c.label || c.type || '调整')}</span>
            ${from ? `<span class="from">${U.esc(from)}</span>` : ''}
            ${from || to ? U.icon('arrowRight') : ''}
            ${to ? `<span class="to">${U.esc(to)}</span>` : ''}</div>`;
        }).join('')}
      </div>` : '';
    const bullets = m.bullets && m.bullets.length
      ? `<ul>${m.bullets.map(b => `<li>${U.esc(b)}</li>`).join('')}</ul>` : '';
    const opts = m.options && m.options.length
      ? `<div class="chips" style="margin-top:8px">${m.options.map(o => `<button class="pill pill-amber" type="button" data-opt="${U.esc(o.id)}" data-opt-label="${U.esc(o.label)}">${U.esc(o.label)}</button>`).join('')}</div>`
      : '';
    const retry = m.retryText
      ? `<div class="bubble-actions"><button class="btn btn-ghost btn-sm" type="button" data-retry="${index}">${U.icon('refresh')}重试这条指令</button></div>` : '';
    return `<div class="msg ${m.who}">
      <div class="av">${m.who === 'ai' ? 'AI' : '我'}</div>
      <div class="bubble">${m.title ? `<div class="b-title">${U.esc(m.title)}</div>` : ''}${U.nl2br(m.text)}${bullets}${diff}${opts}${retry}</div>
    </div>`;
  }
  function chatCard(state) {
    const msgs = state.chat.length ? state.chat : [{
      who: 'ai',
      text: '路线已经生成。想调整直接告诉我，比如「少走一点路」「把咖啡馆换成书店」「五点前结束」。每次调整都会给出前后差异。'
    }];
    const chips = state.chatChips && state.chatChips.length ? state.chatChips : DEFAULT_CHIPS;
    const svc = currentService(state);
    const status = svc.connected ? '已连接智能体服务' : '演示模式 · 本地规则模拟';
    return `<div class="card chat-card">
      <div class="chat-head">
        <div class="chat-avatar">${U.icon('sparkle')}</div>
        <div class="ch-t"><b>AI 行程助手</b><span>${U.esc(status)}${state.ui.refineBusy ? ' · 正在调整…' : ''}</span></div>
        <button class="link-btn" type="button" data-act="chatReset">清空对话</button>
      </div>
      <div class="chat-body" id="chatBody" role="log" aria-live="polite" aria-relevant="additions">${msgs.map(chatMsg).join('')}</div>
      <div class="chat-chips" id="chatChips">
        ${chips.map(c => `<button type="button" data-chip="${U.esc(c)}">${U.esc(c)}</button>`).join('')}
      </div>
      <div class="chat-input">
        <label class="sr-only" for="chatInput">描述你想怎么调整这条路线</label>
        <input id="chatInput" maxlength="120" aria-label="描述你想怎么调整这条路线" placeholder="描述你想怎么调整这条路线…"${state.ui.refineBusy ? ' disabled' : ''}>
        <button class="btn btn-primary btn-sm" type="button" data-act="chatSend" aria-label="发送调整指令"${state.ui.refineBusy ? ' disabled' : ''}>${U.icon('send')}</button>
      </div>
    </div>`;
  }

  /* =====================================================================
   * 澄清卡
   * ===================================================================== */
  function canonicalField(id) {
    const map = {
      duration: 'durationMin', durationMin: 'durationMin', durationMinutes: 'durationMin',
      startAt: 'startTime', startTime: 'startTime', from: 'startLocation', startLocation: 'startLocation',
      mustEnd: 'endTime', endTime: 'endTime', budget: 'budgetMax', budgetMax: 'budgetMax',
      walking: 'walkingTolerance', walkingTolerance: 'walkingTolerance',
      food: 'foodPreferences', foodPreferences: 'foodPreferences'
    };
    return map[id] || id;
  }
  function missingQuestion(id, index) {    const map = {
      city: { text: '你想在哪座城市漫步？', options: ['南京', '苏州', '杭州'], type: 'text' },
      durationMin: { text: '这次大概有多少时间？', options: ['2 小时', '3 小时', '4 小时', '半天'], type: 'text' },
      duration: { text: '这次大概有多少时间？', options: ['2 小时', '3 小时', '4 小时', '半天'], type: 'text' },
      startLocation: { text: '你打算从哪里出发？', options: ['新街口', '鼓楼', '夫子庙'], type: 'text' },
      startTime: { text: '大概几点开始？', options: ['09:00', '14:00', '16:00'], type: 'time' },
      endTime: { text: '需要在几点前结束？', options: ['17:00', '18:00', '21:00'], type: 'time' },
      budgetMax: { text: '预算大概多少（元）？', options: ['100', '150', '300'], type: 'number' },
      interests: { text: '更想逛哪一类？', options: ['咖啡与甜品', '历史文化', '城市摄影', '独立书店', '公园与绿地', '本地特色'], type: 'text' },
      party: { text: '和谁一起？', options: ['一个人', '朋友同行', '情侣同行', '家庭 / 亲子'], type: 'text' },
      walkingTolerance: { text: '可以接受多少步行？', options: ['轻松（≤ 3 km）', '适中（≤ 6 km）', '深度（≤ 10 km）'], type: 'text' },
      pace: { text: '喜欢什么节奏？', options: ['轻松', '适中', '深度'], type: 'text' },
      transport: { text: '路上怎么移动？', options: ['全程步行', '步行 + 地铁', '步行 + 单车'], type: 'text' },
      weather: { text: '天气怎么样？', options: ['不限', '下雨', '晴朗', '炎热', '寒冷'], type: 'text' },
      when: { text: '什么时候出发？', options: ['今天下午', '明天上午', '本周末'], type: 'text' }
    };
    return Object.assign({ id: id, required: true, type: 'text' }, map[id] || { text: '还需要补充一项信息：' + id });
  }
  function normalizeOptions(options) {
    return (Array.isArray(options) ? options : []).map(o => {
      if (o == null) return null;
      if (typeof o === 'string' || typeof o === 'number') return { value: String(o), label: String(o) };
      if (typeof o === 'object') {
        const value = o.value != null ? o.value : (o.id != null ? o.id : o.label);
        if (value == null) return null;
        return { value: String(value), label: String(o.label != null ? o.label : value) };
      }
      return null;
    }).filter(Boolean);
  }
  function normalizeClarify(raw, prev) {
    const src = raw && raw.clarification ? raw.clarification : (raw || {});
    const missing = uniq((Array.isArray(src.missing) ? src.missing : []).map(String));
    let questions = (Array.isArray(src.questions) ? src.questions : []).map((q, i) => {
      const obj = (q && typeof q === 'object') ? q : { text: String(q) };
      const id = String(obj.id || obj.field || ('q' + (i + 1)));
      let required;
      if (obj.required !== undefined) required = !!obj.required;
      else required = missing.length
        ? missing.some(m => m === id || canonicalField(m) === canonicalField(id))
        : true;
      const opts = normalizeOptions(obj.options);
      const defaults = missingQuestion(id, i);
      return {
        id,
        text: String(obj.text || obj.question || defaults.text || ('请补充 ' + id)),
        options: opts.length ? opts : normalizeOptions(defaults.options),
        type: obj.type || defaults.type || 'text',
        required
      };
    });
    if (!questions.length && missing.length) questions = missing.slice(0, 3).map((id, i) => missingQuestion(id, i));
    const answers = {};
    if (prev && prev.answers) {
      questions.forEach(q => { if (prev.answers[q.id] !== undefined) answers[q.id] = prev.answers[q.id]; });
    }
    const skipped = (prev && Array.isArray(prev.skipped) ? prev.skipped : []).filter(id => questions.some(q => q.id === id));
    return {
      missing,
      questions,
      note: String(src.note || '补齐这些信息后，我才能判断能安排几个地点、走多远。'),
      answers,
      skipped,
      extra: (prev && prev.extra) || '',
      status: 'idle',
      error: null,
      shownAt: new Date().toISOString()
    };
  }
  function isQuestionRequired(state, q) {
    if (q.required === true) return true;
    if (q.required === false) return false;
    const missing = state.clarify && state.clarify.missing || [];
    return missing.length
      ? missing.some(m => m === q.id || canonicalField(m) === canonicalField(q.id))
      : true;
  }
  function questionAnswered(state, q) {
    const c = state.clarify;
    return !!(c && (c.answers[q.id] !== undefined || c.skipped.indexOf(q.id) >= 0));
  }
  function requiredUnanswered(state) {
    const c = state.clarify;
    if (!c) return [];
    return c.questions.filter(q => isQuestionRequired(state, q) && !questionAnswered(state, q));
  }
  function answeredCount(state) {
    const c = state.clarify;
    if (!c) return 0;
    return Object.keys(c.answers).length + c.skipped.length;
  }
  function clarifyHtml(state) {
    const c = state.clarify;
    if (!c) return '';
    const total = c.questions.length;
    const answered = answeredCount(state);
    const pendingRequired = requiredUnanswered(state).length;
    const optionalLeft = c.questions.filter(q => !isQuestionRequired(state, q) && !questionAnswered(state, q)).length;
    const submitting = c.status === 'submitting';
    return `<div class="card clarify-card" id="clarifyCard" aria-labelledby="clarifyTitle">
      <div class="clarify-head">
        <span class="ci">${U.icon('sparkle')}</span>
        <div class="ct"><h3 id="clarifyTitle">还需要 ${Math.max(1, Math.min(3, pendingRequired || total))} 个信息</h3>
          <div class="sub">${U.esc(c.note)}</div></div>
        <span class="tag">已答 ${answered}/${total}</span>
      </div>
      <div class="clarify-body">
        ${c.questions.map((q, i) => {
          const ans = c.answers[q.id];
          const skipped = c.skipped.indexOf(q.id) >= 0;
          const req = isQuestionRequired(state, q);
          const inputId = 'clarify-' + q.id.replace(/[^a-zA-Z0-9_-]/g, '-') + '-' + i;
          const type = q.type === 'time' ? 'time' : (q.type === 'number' ? 'number' : 'text');
          return `<div class="clarify-q${ans || skipped ? ' answered' : ''}" data-qid="${U.esc(q.id)}">
            <div class="cq-top"><span class="cq-n">${i + 1}</span>
              <div class="cq-t">${U.esc(q.text)}
                <span class="tag ${req ? 'tag-amber' : ''}">${req ? '必填' : '可选'}</span></div></div>
            ${q.options.length ? `<div class="chips" role="group" aria-label="${U.esc(q.text)}">
              ${q.options.map(o => `<button class="pill${ans && String(ans.value) === o.value ? ' on' : ''}" type="button"
                data-clarify-opt="${U.esc(o.value)}" aria-pressed="${ans && String(ans.value) === o.value ? 'true' : 'false'}">${U.esc(o.label)}</button>`).join('')}
            </div>` : ''}
            <div class="clarify-input">
              <label class="sr-only" for="${inputId}">${U.esc(q.text)}</label>
              <input class="input" id="${inputId}" type="${type}" value="${ans ? U.esc(String(ans.value)) : ''}"
                placeholder="${q.type === 'time' ? '如：14:00' : (q.id === 'city' ? '如：南京' : q.id === 'durationMin' || q.id === 'duration' ? '如：3 小时' : '输入你的回答')}"
                ${submitting ? 'disabled' : ''}>
              <button class="btn btn-soft btn-sm" type="button" data-clarify-save ${submitting ? 'disabled' : ''}>确认</button>
              ${!req ? `<button class="link-btn" type="button" data-clarify-skip ${submitting ? 'disabled' : ''}>跳过</button>` : ''}
            </div>
            ${ans ? `<div class="clarify-answer">${U.icon('check')}已答：${U.esc(ans.label || ans.value)}</div>` : ''}
            ${skipped ? `<div class="clarify-answer skipped">${U.icon('info')}已跳过，按默认值处理</div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="clarify-foot">
        <div class="clarify-progress" aria-live="polite">${pendingRequired ? `还有 ${pendingRequired} 个必填问题未回答` : (optionalLeft ? `必填已完成 · ${optionalLeft} 个可选项可跳过` : '信息已补齐，正在继续生成')}</div>
        ${c.error ? `<div class="clarify-error" role="alert">${U.icon('alert')}<span>${U.esc(c.error)}</span>
          <button class="btn btn-ghost btn-sm" type="button" data-act="retryClarify">${U.icon('refresh')}重试</button></div>` : ''}
        <div class="chips">
          ${optionalLeft && !submitting ? `<button class="btn btn-ghost btn-sm" type="button" data-act="skipOptional">跳过可选项，用默认值</button>` : ''}
          <button class="btn btn-primary btn-sm" type="button" data-act="submitClarify" ${pendingRequired || submitting ? 'disabled' : ''}>
            ${submitting ? '正在生成…' : '继续生成'}</button>
        </div>
      </div>
    </div>`;
  }

  function applyClarifyValue(state, q, rawValue) {
    const value = String(rawValue == null ? '' : rawValue).trim();
    if (!value) return { ok: false, message: '请先填写或选择一个回答。' };
    const d = state.draft;
    const id = q.id;
    if (id === 'city') {
      const cid = cityIdOf(value);
      if (!cid) return { ok: false, message: '目前支持的示例城市是南京、苏州、杭州、上海、成都，请选择其中一个。' };
      state.city = cid;
      state.conditions.city = cid;
      const c = D.city(cid);
      if (c && !c.ready) return { ok: true, label: c.name + '（示例数据筹备中）', value: c.name };
      return { ok: true, label: c ? c.name : cid, value: c ? c.name : cid };
    }
    if (id === 'durationMin' || id === 'duration') {
      const n = parseDurationValue(value);
      if (!n || n < 30 || n > 720) return { ok: false, message: '请填写 30–720 分钟之间的时长，例如「3 小时」或「90 分钟」。' };
      d.durationMin = n;
      return { ok: true, label: U.fmtDuration(n), value: String(n) };
    }
    if (id === 'startTime' || id === 'startAt') {
      const clock = parseClock(value);
      if (!clock) return { ok: false, message: '请使用 HH:mm 格式，例如 14:00。' };
      d.startTime = clock;
      return { ok: true, label: clock, value: clock };
    }
    if (id === 'endTime' || id === 'mustEnd') {
      const clock = parseClock(value);
      if (!clock) return { ok: false, message: '请使用 HH:mm 格式，例如 17:30。' };
      d.endTime = clock;
      return { ok: true, label: clock, value: clock };
    }
    if (id === 'budgetMax' || id === 'budget') {
      const n = parseMoney(value);
      if (n == null) return { ok: false, message: '请填写数字预算，例如 150。' };
      d.budgetMax = n;
      return { ok: true, label: '¥' + n, value: String(n) };
    }
    if (id === 'startLocation' || id === 'from') {
      d.startLocation = value;
      return { ok: true, label: value, value };
    }
    if (id === 'party') {
      const key = enumFromInput(value, PARTY_MAP, null);
      if (!key) return { ok: false, message: '请选择一个人、朋友、情侣或家庭。' };
      d.party = key;
      return { ok: true, label: PARTY_NAMES[key], value: key };
    }
    if (id === 'walkingTolerance' || id === 'walking') {
      const key = enumFromInput(value, WALK_MAP, null);
      if (!key) return { ok: false, message: '请选择轻松、适中或深度。' };
      d.walkingTolerance = key;
      return { ok: true, label: WALK_NAMES[key], value: key };
    }
    if (id === 'pace') {
      const key = enumFromInput(value, PACE_MAP, null);
      if (!key) return { ok: false, message: '请选择轻松、适中或深度。' };
      d.pace = key;
      return { ok: true, label: paceName(key), value: key };
    }
    if (id === 'transport') {
      const key = enumFromInput(value, TRANS_MAP, null);
      if (!key) return { ok: false, message: '请选择全程步行、步行 + 地铁或步行 + 单车。' };
      d.transport = key;
      return { ok: true, label: transportName(key), value: key };
    }
    if (id === 'weather') {
      const key = enumFromInput(value, WEATHER_NAMES, null);
      if (!key) return { ok: false, message: '请选择不限、下雨、晴朗、炎热或寒冷。' };
      d.weather = key;
      return { ok: true, label: WEATHER_NAMES[key], value: key };
    }
    if (id === 'interests') {
      const names = parseList(value);
      const ids = names.map(n => {
        const hit = (D.INTERESTS || []).find(i => i.id === n || i.name === n || n.indexOf(i.name) >= 0);
        return hit ? hit.id : null;
      }).filter(Boolean);
      if (!ids.length) return { ok: false, message: '没有识别到可用的兴趣，请选择咖啡、历史、摄影、书店、公园或本地特色。' };
      d.interests = uniq(d.interests.concat(ids));
      return { ok: true, label: ids.map(id2 => D.interest(id2).name).join('、'), value: ids.join(',') };
    }
    if (id === 'foodPreferences' || id === 'food') {
      const list = parseList(value);
      d.foodPreferences = uniq(d.foodPreferences.concat(list));
      return { ok: true, label: list.join('、'), value: list.join('、') };
    }
    if (id === 'accessibility') {
      const list = parseList(value);
      d.accessibility = uniq(d.accessibility.concat(list));
      return { ok: true, label: list.join('、'), value: list.join('、') };
    }
    if (id === 'avoid') {
      const list = parseList(value).map(x => {
        const hit = Object.keys(D.CATEGORIES).find(cid => cid === x || D.cat(cid).name === x);
        return hit || x;
      });
      d.avoid = uniq(d.avoid.concat(list));
      return { ok: true, label: list.map(x => D.cat(x).name || x).join('、'), value: list.join(',') };
    }
    if (id === 'mustVisit') {
      const list = parseList(value);
      d.mustVisit = uniq(d.mustVisit.concat(list));
      d.mustVisitText = d.mustVisit.join('、');
      return { ok: true, label: list.join('、'), value: list.join(',') };
    }
    if (id === 'when') {
      const clock = parseClock(value);
      if (clock) { d.startTime = clock; return { ok: true, label: clock, value: clock }; }
      if (/上午/.test(value)) { d.startTime = '09:00'; return { ok: true, label: '上午 09:00', value: '09:00' }; }
      if (/下午/.test(value)) { d.startTime = '14:00'; return { ok: true, label: '下午 14:00', value: '14:00' }; }
      if (/傍晚/.test(value)) { d.startTime = '17:00'; return { ok: true, label: '傍晚 17:00', value: '17:00' }; }
      if (/晚上/.test(value)) { d.startTime = '19:00'; return { ok: true, label: '晚上 19:00', value: '19:00' }; }
      if (/今天|明天|周末/.test(value)) { d.date = value; return { ok: true, label: value + '（日期仅记录）', value }; }
      return { ok: false, message: '请填写开始时间（如 14:00），或选择今天 / 明天 / 本周末。' };
    }
    /* 未知字段：按数据保存为补充要求，避免丢失用户回答，但明确不直接执行 */
    const c = state.clarify;
    c.extra = (c.extra ? c.extra + '；' : '') + q.text + '：' + value;
    c.extra = c.extra.slice(0, 200);
    return { ok: true, label: value + '（已记录为补充要求）', value };
  }

  function setClarifyAnswer(state, q, value) {
    const res = applyClarifyValue(state, q, value);
    if (!res.ok) {
      state.clarify.error = res.message;
      renderLeft(state);
      return false;
    }
    state.clarify.answers[q.id] = { value: res.value, label: res.label, at: new Date().toISOString() };
    state.clarify.skipped = state.clarify.skipped.filter(id => id !== q.id);
    state.clarify.error = null;
    persistDraft();
    renderLeft(state);
    maybeAutoSubmit(state);
    return true;
  }
  function skipQuestion(state, q) {
    if (isQuestionRequired(state, q)) return;
    state.clarify.skipped = uniq(state.clarify.skipped.concat([q.id]));
    state.clarify.error = null;
    renderLeft(state);
    maybeAutoSubmit(state);
  }
  function skipOptional(state) {
    if (!state.clarify) return;
    state.clarify.questions.forEach(q => {
      if (!isQuestionRequired(state, q) && state.clarify.answers[q.id] === undefined) {
        state.clarify.skipped = uniq(state.clarify.skipped.concat([q.id]));
      }
    });
    submitClarify(state);
  }
  function maybeAutoSubmit(state) {
    if (!state.clarify || busy) return;
    if (requiredUnanswered(state).length) return;
    setTimeout(() => {
      if (!state.clarify || busy) return;
      if (requiredUnanswered(state).length) return;
      submitClarify(state);
    }, 280);
  }
  function submitClarify(state) {
    if (!state.clarify || busy) return;
    if (state.clarify.status === 'submitting') return;
    const pending = requiredUnanswered(state);
    if (pending.length) {
      state.clarify.error = '还有必填问题没有回答：' + pending.map(q => q.text).join('；');
      renderLeft(state);
      return;
    }
    state.clarify.questions.forEach(q => {
      if (!isQuestionRequired(state, q) && !questionAnswered(state, q)) {
        state.clarify.skipped = uniq(state.clarify.skipped.concat([q.id]));
      }
    });
    state.clarify.status = 'submitting';
    state.clarify.error = null;
    track('clarify_answered', {
      answeredCount: Object.keys(state.clarify.answers).length,
      skippedCount: state.clarify.skipped.length
    });
    renderLeft(state);
    startGenerate(state, { fromClarify: true });
  }
  function bindClarify(state, root) {
    const card = root.querySelector('#clarifyCard');
    if (!card) return;
    card.addEventListener('click', e => {
      const opt = e.target.closest('[data-clarify-opt]');
      if (opt) {
        const qEl = opt.closest('[data-qid]');
        const q = state.clarify && state.clarify.questions.find(x => x.id === qEl.dataset.qid);
        if (q) setClarifyAnswer(state, q, opt.dataset.clarifyOpt);
        return;
      }
      const save = e.target.closest('[data-clarify-save]');
      if (save) {
        const qEl = save.closest('[data-qid]');
        const q = state.clarify && state.clarify.questions.find(x => x.id === qEl.dataset.qid);
        const input = qEl.querySelector('input');
        if (q && input) setClarifyAnswer(state, q, input.value);
        return;
      }
      const skip = e.target.closest('[data-clarify-skip]');
      if (skip) {
        const qEl = skip.closest('[data-qid]');
        const q = state.clarify && state.clarify.questions.find(x => x.id === qEl.dataset.qid);
        if (q) skipQuestion(state, q);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'submitClarify') submitClarify(state);
      else if (act.dataset.act === 'skipOptional') skipOptional(state);
      else if (act.dataset.act === 'retryClarify') {
        track('retry_clicked', { context: 'clarify' });
        submitClarify(state);
      }
    });
    card.querySelectorAll('input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const qEl = input.closest('[data-qid]');
        const q = state.clarify && state.clarify.questions.find(x => x.id === qEl.dataset.qid);
        if (q) setClarifyAnswer(state, q, input.value);
      });
    });
  }

  /* =====================================================================
   * 左栏事件绑定
   * ===================================================================== */
  function bindLeft(state) {
    const box = document.getElementById('wsLeft');
    if (!box) return;
    const d = state.draft;

    const ta = box.querySelector('#promptInput');
    if (ta) {
      ta.addEventListener('input', () => {
        d.text = ta.value;
        const cnt = box.querySelector('#pCount');
        if (cnt) cnt.textContent = String(ta.value.length);
        persistDraft();
      });
    }

    /* 兴趣标签（两处同步） */
    box.querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.tag;
      const i = d.interests.indexOf(id);
      if (i >= 0) d.interests.splice(i, 1); else d.interests.push(id);
      box.querySelectorAll('[data-tag="' + id + '"]').forEach(x => {
        const on = d.interests.indexOf(id) >= 0;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      persistDraft();
    }));

    /* 高级筛选 */
    const tog = box.querySelector('#advToggle');
    const panel = box.querySelector('#advPanel');
    if (tog && panel) tog.addEventListener('click', () => {
      const open = !panel.classList.contains('open');
      panel.classList.toggle('open', open);
      tog.classList.toggle('open', open);
      tog.setAttribute('aria-expanded', open ? 'true' : 'false');
      state.ui.advOpen = open;
    });
    const moreTog = box.querySelector('#moreToggle');
    const morePanel = box.querySelector('#morePanel');
    if (moreTog && morePanel) moreTog.addEventListener('click', () => {
      const open = !morePanel.classList.contains('open');
      morePanel.classList.toggle('open', open);
      moreTog.classList.toggle('open', open);
      moreTog.setAttribute('aria-expanded', open ? 'true' : 'false');
      state.ui.moreOpen = open;
    });

    const onInput = (sel, handler) => {
      const el = box.querySelector(sel);
      if (el) el.addEventListener('input', e => { handler(e.target.value); persistDraft(); });
    };
    const onChange = (sel, handler) => {
      const el = box.querySelector(sel);
      if (el) el.addEventListener('change', e => { handler(e.target.value); persistDraft(); });
    };
    onInput('#fFrom', v => { d.startLocation = v; });
    onChange('#fDate', v => { d.date = v; });
    onChange('#fStart', v => { d.startTime = v; });
    onChange('#fEnd', v => { d.endTime = v; });
    onInput('#fBudget', v => {
      const s = String(v || '').trim();
      d.budgetMax = s === '' ? null : Math.max(0, parseInt(s, 10) || 0);
    });
    onChange('#fParty', v => { d.party = v; });
    onChange('#fWeather', v => { d.weather = v; });
    onInput('#fFoodText', v => { d.foodText = v; });
    onInput('#fAvoidText', v => { d.avoidText = v; });
    onInput('#fMust', v => { d.mustVisitText = v; d.mustVisit = parseList(v); });

    const segBind = (sel, attr, key, cast) => {
      const seg = box.querySelector(sel);
      if (!seg) return;
      seg.addEventListener('click', e => {
        const b = e.target.closest('[' + attr + ']');
        if (!b) return;
        seg.querySelectorAll('button').forEach(x => {
          x.classList.remove('on');
          x.setAttribute('aria-checked', 'false');
        });
        b.classList.add('on');
        b.setAttribute('aria-checked', 'true');
        d[key] = cast ? cast(b.getAttribute(attr)) : b.getAttribute(attr);
        persistDraft();
      });
    };
    segBind('#fDur', 'data-dur', 'durationMin', v => parseInt(v, 10) || 0);
    segBind('#fBasis', 'data-basis', 'budgetBasis');
    segBind('#fWalk', 'data-walk', 'walkingTolerance');
    segBind('#fPace', 'data-pace', 'pace');
    segBind('#fTrans', 'data-trans', 'transport');

    const multiBind = (sel, arrKey, attr) => {
      box.querySelectorAll(sel).forEach(b => b.addEventListener('click', () => {
        const val = b.dataset[attr];
        const arr = d[arrKey];
        const i = arr.indexOf(val);
        if (i >= 0) arr.splice(i, 1); else arr.push(val);
        const on = arr.indexOf(val) >= 0;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        persistDraft();
      }));
    };
    multiBind('#fFood [data-food]', 'foodPreferences', 'food');
    multiBind('#fAccess [data-access]', 'accessibility', 'access');
    multiBind('#fAvoid [data-avoid]', 'avoid', 'avoid');

    /* 示例 / 清除识别 */
    const exampleBtn = box.querySelector('[data-act="example"]');
    if (exampleBtn) exampleBtn.addEventListener('click', () => {
      d.text = '周日下午想在南京老城逛 4 小时，喜欢咖啡馆、历史街区和适合拍照的地方，尽量少走回头路，预算 150 元以内。';
      d.interests = ['coffee', 'history', 'photo'];
      d.durationMin = 240;
      d.budgetMax = 150;
      d.pace = 'mid';
      d.startTime = '14:00';
      state.recognized = null;
      persistDraft();
      renderLeft(state);
      U.toast('已填入示例需求，可以直接生成');
    });
    const clearRec = box.querySelector('[data-act="clearRecognized"]');
    if (clearRec) clearRec.addEventListener('click', () => {
      state.recognized = null;
      renderLeft(state);
    });

    /* 生成 */
    const gen = box.querySelector('#genBtn');
    if (gen) gen.addEventListener('click', () => startGenerate(state));

    /* 修改条件 */
    const editBtn = box.querySelector('[data-act="editCond"]');
    if (editBtn) editBtn.addEventListener('click', () => openAdvanced(state));

    bindClarify(state, box);

    /* AI 对话 */
    const ci = box.querySelector('#chatInput');
    if (ci) {
      const send = () => {
        const v = ci.value.trim();
        if (!v) return;
        ci.value = '';
        sendChat(state, v);
      };
      const sendBtn = box.querySelector('[data-act="chatSend"]');
      if (sendBtn) sendBtn.addEventListener('click', send);
      ci.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    }
    const chips = box.querySelector('#chatChips');
    if (chips) chips.addEventListener('click', e => {
      const b = e.target.closest('[data-chip]');
      if (!b) return;
      sendChat(state, b.dataset.chip);
    });
    const body = box.querySelector('#chatBody');
    if (body) {
      body.addEventListener('click', e => {
        const opt = e.target.closest('[data-opt]');
        if (opt) { resolveOption(state, opt.dataset.opt, opt.dataset.optLabel); return; }
        const retry = e.target.closest('[data-retry]');
        if (retry) {
          const m = state.chat[Number(retry.dataset.retry)];
          if (m && m.retryText) {
            track('retry_clicked', { context: 'refine' });
            sendChat(state, m.retryText);
          }
        }
      });
    }
    const cr = box.querySelector('[data-act="chatReset"]');
    if (cr) cr.addEventListener('click', () => {
      state.chat = [];
      state.chatChips = DEFAULT_CHIPS;
      renderLeft(state);
      U.toast('对话已清空');
    });
  }

  function openAdvanced(state) {
    state.ui.advOpen = true;
    const p = document.getElementById('advPanel');
    const t = document.getElementById('advToggle');
    if (p) p.classList.add('open');
    if (t) { t.classList.add('open'); t.setAttribute('aria-expanded', 'true'); }
    const target = document.getElementById('fFrom') || p;
    if (target && target.scrollIntoView) {
      try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* 忽略 */ }
    }
    U.toast('已展开高级筛选，修改后点「按当前条件重新生成」');
  }

  /* =====================================================================
   * 需求解析 / 条件组装
   * ===================================================================== */
  function parseIntentSafe(state) {
    try {
      if (!A || typeof A.parseIntent !== 'function') return null;
      return A.parseIntent(state.draft.text || '', state.city);
    } catch (e) { return null; }
  }
  function mergeIntent(state, intent) {
    const d = state.draft;
    const items = [];
    if (!intent || typeof intent !== 'object') return items;
    const cityId = intent.city ? cityIdOf(intent.city) : null;
    if (cityId && cityId !== state.city) {
      state.city = cityId;
      state.conditions.city = cityId;
      items.push('城市 ' + (D.city(cityId) || {}).name);
    }
    if (intent.durationMin) {
      const n = parseDurationValue(intent.durationMin);
      if (n) { d.durationMin = n; items.push('时长 ' + U.fmtDuration(n)); }
    }
    if (intent.budgetMax != null) {
      const n = parseMoney(intent.budgetMax);
      if (n != null) { d.budgetMax = n; items.push('预算 ¥' + n); }
    }
    if (intent.budgetBasis && BASIS_NAMES[intent.budgetBasis]) {
      d.budgetBasis = intent.budgetBasis;
      items.push('预算口径 ' + BASIS_NAMES[intent.budgetBasis]);
    }
    if (Array.isArray(intent.interests) && intent.interests.length) {
      const ids = intent.interests.map(x => {
        if (D.interest(x)) return x;
        const hit = (D.INTERESTS || []).find(i => i.name === x || String(x).indexOf(i.name) >= 0);
        return hit ? hit.id : null;
      }).filter(Boolean);
      if (ids.length) {
        d.interests = uniq(d.interests.concat(ids));
        items.push('兴趣 ' + ids.map(id => (D.interest(id) || {}).name).filter(Boolean).join('、'));
      }
    }
    if (intent.pace) {
      const key = enumFromInput(intent.pace, PACE_MAP, null);
      if (key) { d.pace = key; items.push('节奏 ' + paceName(key)); }
    }
    if (intent.party) {
      const key = enumFromInput(intent.party, PARTY_MAP, null);
      if (key) { d.party = key; items.push('同行人 ' + PARTY_NAMES[key]); }
    }
    if (intent.walkingTolerance || intent.walkTolerance) {
      const key = enumFromInput(intent.walkingTolerance || intent.walkTolerance, WALK_MAP, null);
      if (key) { d.walkingTolerance = key; items.push('步行强度 ' + WALK_MAP[key]); }
    }
    if (intent.transport) {
      const key = enumFromInput(intent.transport, TRANS_MAP, null);
      if (key) { d.transport = key; items.push('交通 ' + transportName(key)); }
    }
    if (intent.weather) {
      const key = enumFromInput(intent.weather, WEATHER_NAMES, null);
      if (key) { d.weather = key; items.push('天气 ' + WEATHER_NAMES[key]); }
    }
    if (Array.isArray(intent.foodPreferences) && intent.foodPreferences.length) {
      d.foodPreferences = uniq(d.foodPreferences.concat(intent.foodPreferences.map(String)));
      items.push('餐饮 ' + d.foodPreferences.join('、'));
    }
    if (Array.isArray(intent.accessibility) && intent.accessibility.length) {
      d.accessibility = uniq(d.accessibility.concat(intent.accessibility.map(String)));
      items.push('无障碍 ' + d.accessibility.join('、'));
    }
    if (Array.isArray(intent.avoid) && intent.avoid.length) {
      d.avoid = uniq(d.avoid.concat(intent.avoid.map(String)));
      items.push('避开 ' + d.avoid.map(x => D.cat(x).name || x).join('、'));
    }
    if (Array.isArray(intent.mustVisit) && intent.mustVisit.length) {
      d.mustVisit = uniq(d.mustVisit.concat(intent.mustVisit.map(String)));
      d.mustVisitText = d.mustVisit.join('、');
      items.push('必去 ' + d.mustVisit.join('、'));
    }
    const signals = intent.signals || {};
    if (intent.startLocation || signals.from) {
      d.startLocation = String(intent.startLocation || signals.from);
      items.push('出发地 ' + d.startLocation);
    }
    if (intent.startTime || signals.startAt) {
      const clock = parseClock(intent.startTime || signals.startAt);
      if (clock) { d.startTime = clock; items.push('开始 ' + clock); }
    }
    if (intent.endTime || signals.endAt || signals.mustEnd) {
      const clock = parseClock(intent.endTime || signals.endAt || signals.mustEnd);
      if (clock) { d.endTime = clock; items.push('结束 ' + clock); }
    }
    return uniq(items);
  }
  function conditionsFromDraft(state) {
    const d = state.draft;
    const cond = defaultConditions();
    const startTime = d.startTime || d.startAt || '14:00';
    const endTime = d.endTime || d.mustEnd || '';
    let durationMin = d.durationMin > 0 ? Math.round(d.durationMin) : null;
    if (!durationMin && startTime && endTime) {
      const s = timeToMin(startTime), e = timeToMin(endTime);
      let diff = s != null && e != null ? e - s : null;
      if (diff != null && diff <= 0) diff += 24 * 60;
      if (diff && diff >= 30) durationMin = diff;
    }
    const food = uniq((d.foodPreferences || []).concat(parseList(d.foodText)));
    const avoid = uniq((d.avoid || []).concat(parseList(d.avoidText)));
    const mustVisit = uniq((d.mustVisit || []).concat(parseList(d.mustVisitText)));
    const extra = state.clarify && state.clarify.extra ? state.clarify.extra : '';
    Object.assign(cond, {
      city: state.city,
      startLocation: d.startLocation || d.from || '',
      startTime: startTime || '14:00',
      endTime: endTime,
      durationMin: durationMin,
      interests: (d.interests || []).filter(id => D.interest(id)),
      budgetMax: d.budgetMax == null ? null : Number(d.budgetMax),
      budgetBasis: BASIS_NAMES[d.budgetBasis] ? d.budgetBasis : 'total',
      party: PARTY_NAMES[d.party] ? d.party : 'solo',
      walkingTolerance: WALK_MAP[d.walkingTolerance] ? d.walkingTolerance : 'mid',
      transport: TRANS_MAP[d.transport] ? d.transport : 'walk',
      pace: PACE_MAP[d.pace] ? d.pace : 'mid',
      foodPreferences: food,
      accessibility: uniq(d.accessibility || []),
      weather: WEATHER_NAMES[d.weather] ? d.weather : 'any',
      avoid: avoid,
      mustVisit: mustVisit,
      additionalRequirements: (String(d.additionalRequirements || '') + (extra ? '；' + extra : '')).slice(0, 200)
    });
    /* 旧版 agent/core 的字段别名；新契约会忽略未知字段 */
    cond.from = cond.startLocation;
    cond.startAt = cond.startTime;
    cond.mustEnd = cond.endTime;
    return cond;
  }
  function syncDraftFromConditions(state, c) {
    if (!c) return;
    const d = state.draft;
    if (Array.isArray(c.interests)) d.interests = c.interests.filter(id => D.interest(id));
    if (c.durationMin != null) d.durationMin = Number(c.durationMin) || 0;
    d.budgetMax = c.budgetMax == null ? null : Number(c.budgetMax);
    d.budgetBasis = BASIS_NAMES[c.budgetBasis] ? c.budgetBasis : d.budgetBasis;
    d.startTime = c.startTime || c.startAt || d.startTime;
    d.endTime = c.endTime || c.mustEnd || '';
    d.startLocation = c.startLocation || c.from || '';
    d.party = PARTY_NAMES[c.party] ? c.party : d.party;
    d.walkingTolerance = WALK_MAP[c.walkingTolerance] ? c.walkingTolerance : d.walkingTolerance;
    d.transport = TRANS_MAP[c.transport] ? c.transport : d.transport;
    d.pace = PACE_MAP[c.pace] ? c.pace : d.pace;
    d.weather = WEATHER_NAMES[c.weather] ? c.weather : d.weather;
    if (Array.isArray(c.foodPreferences)) d.foodPreferences = c.foodPreferences.slice();
    if (Array.isArray(c.accessibility)) d.accessibility = c.accessibility.slice();
    if (Array.isArray(c.avoid)) d.avoid = c.avoid.slice();
    if (Array.isArray(c.mustVisit)) { d.mustVisit = c.mustVisit.slice(); d.mustVisitText = d.mustVisit.join('、'); }
    if (c.city && D.city(c.city)) state.city = c.city;
    if (c.additionalRequirements) d.additionalRequirements = c.additionalRequirements;
  }

  /* =====================================================================
   * 生成流程
   * ===================================================================== */
  async function startGenerate(state, opts) {
    if (busy) return;
    busy = true;
    const fromClarify = !!(opts && opts.fromClarify);
    try {
      if (!fromClarify) {
        let intent = parseIntentSafe(state);
        if (intent && typeof intent.then === 'function') intent = await intent;
        const items = mergeIntent(state, intent);
        state.recognized = items.length ? { items: items, text: state.draft.text, at: new Date().toISOString() } : null;
        state.planMeta = { date: state.draft.date, requestedAt: new Date().toISOString() };
        if (items.length) {
          persistDraft();
          renderLeft(state);
        }
      } else {
        state.planMeta = state.planMeta || { date: state.draft.date, requestedAt: new Date().toISOString() };
      }

      const cond = conditionsFromDraft(state);
      const svc = currentService(state);
      track('plan_started', { task: 'plan', mode: svc.mode });
      state.error = null;
      state.empty = null;
      if (state.clarify && fromClarify) state.clarify.status = 'submitting';
      state.view = 'loading';
      state.loadStep = 0;
      renderLeft(state);
      renderRight(state);

      const startedAt = Date.now();
      const request = (async () => {
        try { return { res: await A.run('plan', { conditions: cond }) }; }
        catch (err) { return { error: err }; }
      })();
      await animateLoading(state);
      const out = await request;
      const durationMs = Date.now() - startedAt;

      if (out.error) {
        handlePlanError(state, out.error, durationMs);
        return;
      }
      const res = out.res;
      if (!res || typeof res !== 'object') {
        handlePlanError(state, { code: 'INVALID_OUTPUT', message: '服务没有返回有效结果。' }, durationMs);
        return;
      }
      const clarification = res.clarification || (res.data && res.data.clarification);
      if (clarification) {
        showClarification(state, clarification, durationMs);
        return;
      }
      const route = res.route || (res.data && Array.isArray(res.data.places) ? res.data : (Array.isArray(res.places) ? res : null));
      if (!route) {
        handlePlanError(state, { code: 'INVALID_OUTPUT', message: '服务返回结果缺少路线数据。' }, durationMs);
        return;
      }
      if (Array.isArray(route.places) && route.places.length === 0) {
        state.view = 'empty';
        state.empty = { code: 'NO_CANDIDATES', message: '当前条件下没有可安排的地点。', city: state.city, at: new Date().toISOString() };
        state.error = null;
        track('plan_failed', { task: 'plan', mode: svc.mode, errorCode: 'NO_CANDIDATES', durationMs });
        renderLeft(state);
        renderRight(state);
        U.toast('没有找到可安排的地点', 'warn');
        return;
      }
      const validation = validateIncomingRoute(route);
      if (!validation.ok) {
        handlePlanError(state, { code: 'INVALID_OUTPUT', message: validation.message }, durationMs, validation.legacy);
        return;
      }
      const hydrated = hydrateRoute(route);
      state.route = hydrated;
      state.routeStore[hydrated.id] = hydrated;
      state.view = 'result';
      state.selectedPlace = null;
      state.lastDiff = null;
      state.clarify = null;
      state.error = null;
      state.lastPlanConditions = hydrated.conditions ? JSON.parse(JSON.stringify(hydrated.conditions)) : cond;
      state.conditions = hydrated.conditions || cond;
      syncDraftFromConditions(state, state.conditions);
      persistDraft();
      applyResponseFlags(state, hydrated);
      state.chat = state.chat.concat([
        fromClarify
          ? { who: 'ai', title: '已按你补充的信息重新生成', text: '信息已经补齐，下面的路线已按新的条件重新计算。' }
          : { who: 'me', text: state.draft.text || '（使用筛选条件）' },
        {
          who: 'ai', title: '路线已生成',
          text: `按你给的条件排了一条 ${placeIds(hydrated).length} 个地点的路线，全程约 ${U.fmtDuration(hydrated.actualMin)}，步行约 ${hydrated.distanceKm || 0} km。所有时长与距离均为估算值。`,
          bullets: ['地图标记与下方卡片一一对应，点卡片会高亮地图上的点', '想调整直接说，例如「少走一点路」「预算 100 以内」']
        }
      ]);
      state.chatChips = DEFAULT_CHIPS;
      if (hydrated.conflict) {
        state.chat.push({ who: 'ai', title: '⚠️ ' + hydrated.conflict.title, text: hydrated.conflict.detail, options: hydrated.conflict.options });
        track('conflict_shown', { conflictType: hydrated.conflict.type });
      }
      if (hydrated.notes && hydrated.notes.length) {
        state.chat.push({ who: 'ai', title: '数据说明', text: hydrated.notes.join(' ') });
      }
      track('plan_succeeded', {
        task: 'plan', mode: svc.mode, routeId: hydrated.id,
        placeCount: placeIds(hydrated).length, durationMs, degraded: !!hydrated.degraded
      });
      renderLeft(state);
      renderRight(state);
      U.toast(fromClarify ? '补充信息后已重新生成路线' : '路线已生成');
    } catch (err) {
      handlePlanError(state, err, 0);
    } finally {
      busy = false;
      if (state.view === 'loading') {
        state.view = state.route ? 'result' : 'idle';
        renderLeft(state);
        renderRight(state);
      }
    }
  }

  async function animateLoading(state) {
    for (let i = 0; i < LOAD_STEPS.length; i++) {
      state.loadStep = i;
      paintSteps(i);
      await sleep(400 + Math.random() * 200);
    }
    state.loadStep = LOAD_STEPS.length;
    paintSteps(state.loadStep);
  }
  function paintSteps(done) {
    const wrap = document.getElementById('loadSteps');
    if (!wrap) return;
    wrap.querySelectorAll('.lstep').forEach((el, i) => {
      el.classList.toggle('done', i < done);
      el.classList.toggle('doing', i === done);
      if (i === done) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
      const ic = el.querySelector('.ls-ico');
      if (ic) ic.innerHTML = i < done ? U.icon('check') : '';
    });
    wrap.setAttribute('aria-busy', done < LOAD_STEPS.length ? 'true' : 'false');
  }

  function validateIncomingRoute(route) {
    if (!CW.schema || typeof CW.schema.validateRoute !== 'function') return { ok: true };
    if (!isV1(route)) return { ok: true, legacy: true }; // 旧会话/旧核心结果：降级读取
    let res;
    try { res = CW.schema.validateRoute(route); } catch (e) { return { ok: false, message: '路线结构校验失败。' }; }
    if (res && res.ok) return { ok: true };
    const message = CW.schema.formatErrors ? CW.schema.formatErrors(res && res.errors) : '路线结构不合法。';
    return { ok: false, message: '服务返回的路线结构不合法：' + message };
  }
  function hydrateRoute(route) {
    if (!route || typeof route !== 'object') return route;
    if (isV1(route)) return route;
    route._legacy = true;
    try {
      if (CW.core && typeof CW.core.recompute === 'function') {
        const next = CW.core.recompute(route);
        if (next && typeof next === 'object' && Array.isArray(next.places)) route = next;
      }
    } catch (e) { /* 继续尝试旧版 agent.recompute */ }
    if (!isV1(route)) {
      try {
        if (A && typeof A.recompute === 'function') A.recompute(route);
      } catch (e) { /* 旧结构无法重算时，至少保证展示字段可用 */ }
    }
    if (!Array.isArray(route.places)) route.places = [];
    route.conditions = route.conditions || defaultConditions();
    route.segments = segmentsOf(route);
    route.notes = Array.isArray(route.notes) ? route.notes.filter(x => typeof x === 'string') : [];
    route.explanations = Array.isArray(route.explanations) ? route.explanations : [];
    route.sources = Array.isArray(route.sources) ? route.sources : [];
    route.constraints = Array.isArray(route.constraints) && route.constraints.length ? route.constraints : deriveConstraints(route);
    route.dataQuality = route.dataQuality && typeof route.dataQuality === 'object' ? route.dataQuality : dataQualityOf(route);
    route.name = route.name || '本次 CityWalk 路线';
    route.style = Array.isArray(route.style) ? route.style : [];
    route.id = route.id || ('r_' + Date.now());
    return route;
  }
  function applyResponseFlags(state, route) {
    const svc = currentService(state);
    if (route && route.degraded) {
      svc.degraded = true;
      svc.degradeReason = route.degradeReason || '';
      svc.degradeCode = degradeReasonCode(route.degradeReason);
      track('agent_degraded', { reasonCode: svc.degradeCode, mode: svc.mode });
    } else if (route && route.source === 'mock' && svc.connected) {
      /* 远程模式下返回 mock 却没标记：不把它说成远程结果 */
      svc.degraded = false;
    } else if (route && route.source !== 'curated') {
      svc.degraded = false;
      svc.degradeReason = '';
      svc.degradeCode = null;
    }
  }
  function handlePlanError(state, err, durationMs, legacy) {
    const info = friendlyError(err);
    const code = info.code === 'INTERNAL' && /NO_CANDIDATES/i.test(String(err && err.message)) ? 'NO_CANDIDATES' : info.code;
    if (code === 'NO_CANDIDATES' || /无候选|没有可安排/i.test(info.message)) {
      state.view = 'empty';
      state.empty = { code: 'NO_CANDIDATES', message: info.message, city: state.city, at: new Date().toISOString() };
      state.error = null;
      if (state.clarify) { state.clarify.status = 'error'; state.clarify.error = info.message; }
      track('plan_failed', { task: 'plan', mode: currentService(state).mode, errorCode: 'NO_CANDIDATES', durationMs, degraded: false });
      renderLeft(state);
      renderRight(state);
      U.toast('没有找到可安排的地点', 'warn');
      return;
    }
    state.view = 'error';
    state.error = { code: code, message: info.message, legacy: !!legacy, at: new Date().toISOString() };
    if (state.clarify) { state.clarify.status = 'error'; state.clarify.error = info.message; }
    track('plan_failed', { task: 'plan', mode: currentService(state).mode, errorCode: code, durationMs, degraded: false });
    renderLeft(state);
    renderRight(state);
    U.toast('规划失败：' + info.message, 'err');
  }
  function showClarification(state, raw, durationMs) {
    const prev = state.clarify;
    state.clarify = normalizeClarify(raw, prev);
    state.error = null;
    state.view = state.route ? 'result' : 'idle';
    track('clarify_shown', {
      missingCount: state.clarify.questions.length,
      task: 'plan', mode: currentService(state).mode,
      durationMs
    });
    renderLeft(state);
    renderRight(state);
    const card = document.getElementById('clarifyCard');
    if (card && card.scrollIntoView) {
      try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* 忽略 */ }
    }
    U.toast('还需要补充 ' + state.clarify.questions.length + ' 个信息', 'warn');
  }

  /* =====================================================================
   * 自然语言调整（串行队列）
   * ===================================================================== */
  function sendChat(state, text) {
    const prev = chatQueue;
    chatQueue = prev.then(() => _sendChatImpl(state, text), () => _sendChatImpl(state, text));
    return chatQueue;
  }
  async function _sendChatImpl(state, text) {
    if (!state.route) return;
    if (busy) { U.toast('正在生成路线，请稍后再调整', 'warn'); return; }
    if (state.ui.orderBusy) { U.toast('正在重新计算顺序，请稍候', 'warn'); return; }
    if (!text || !String(text).trim()) return;
    const clean = String(text).trim().slice(0, 120);
    state.chat.push({ who: 'me', text: clean });
    state.ui.refineBusy = true;
    const startedAt = Date.now();
    const svc = currentService(state);
    track('refine_started', { task: 'refine', mode: svc.mode });
    renderLeft(state); // 显示「正在调整」
    try {
      const res = await A.run('refine', { text: clean, route: state.route });
      const durationMs = Date.now() - startedAt;
      if (!res || typeof res !== 'object') throw { code: 'INVALID_OUTPUT', message: '服务没有返回有效调整结果。' };
      if (CW.schema && typeof CW.schema.validateRefine === 'function' && res.schemaVersion === 'refine.v1') {
        const vr = CW.schema.validateRefine(res);
        if (!vr || !vr.ok) {
          const detail = CW.schema.formatErrors ? CW.schema.formatErrors(vr && vr.errors) : '调整结果结构不合法。';
          throw { code: 'INVALID_OUTPUT', message: '服务返回的调整结果结构不合法：' + detail };
        }
      }
      let nextRoute = state.route;
      if (res.route) {
        const validation = validateIncomingRoute(res.route);
        if (!validation.ok) throw { code: 'INVALID_OUTPUT', message: validation.message };
        nextRoute = hydrateRoute(res.route);
      }
      state.route = nextRoute;
      state.routeStore[nextRoute.id] = nextRoute;
      if (nextRoute.conditions) {
        state.conditions = nextRoute.conditions;
        state.lastPlanConditions = JSON.parse(JSON.stringify(nextRoute.conditions));
        syncDraftFromConditions(state, nextRoute.conditions);
      }
      state.lastDiff = {
        changes: Array.isArray(res.changes) ? res.changes : [],
        constraintsAfter: Array.isArray(res.constraintsAfter) && res.constraintsAfter.length
          ? res.constraintsAfter : constraintsOf(nextRoute),
        unresolved: Array.isArray(res.unresolved) ? res.unresolved : [],
        changed: !!res.changed,
        at: new Date().toISOString(),
        text: clean
      };
      applyResponseFlags(state, nextRoute);
      state.chat.push({
        who: 'ai',
        text: res.reply || (res.changed ? '已按你的要求调整路线。' : '这条指令没有产生修改。'),
        bullets: Array.isArray(res.bullets) ? res.bullets : [],
        changes: Array.isArray(res.changes) ? res.changes : [],
        options: res.conflict && Array.isArray(res.conflict.options) ? res.conflict.options : null
      });
      if (res.conflict) track('conflict_shown', { conflictType: res.conflict.type });
      if (res.degraded && !(nextRoute && nextRoute.degraded)) {
        applyResponseFlags(state, { degraded: true, degradeReason: res.degradeReason, source: 'mock' });
      }
      state.chatChips = res.ask && Array.isArray(res.ask.chips) ? res.ask.chips : DEFAULT_CHIPS;
      track('refine_succeeded', {
        task: 'refine', mode: svc.mode, routeId: nextRoute.id,
        changed: !!res.changed,
        changesCount: Array.isArray(res.changes) ? res.changes.length : 0,
        durationMs, degraded: !!res.degraded
      });
      refreshResult(state);
      U.toast(res.changed ? '路线已更新' : '本次未修改');
    } catch (err) {
      const info = friendlyError(err);
      state.chat.push({
        who: 'ai', title: '调整失败', text: info.message,
        retryText: clean, errorCode: info.code
      });
      state.chatChips = DEFAULT_CHIPS;
      track('refine_failed', { task: 'refine', mode: svc.mode, errorCode: info.code, durationMs: Date.now() - startedAt });
      refreshResult(state);
      U.toast('调整失败：' + info.message, 'err');
    } finally {
      state.ui.refineBusy = false;
      /* 整块重绘左栏：恢复输入框可用状态、清除「正在调整…」并刷新对话 */
      renderLeft(state);
      renderLeftStatusOnly(state);
    }
  }
  function findConflictOption(route, optionId) {
    const list = [];
    if (route && route.conflict && Array.isArray(route.conflict.options)) list.push(...route.conflict.options);
    if (route && Array.isArray(route.conflicts)) route.conflicts.forEach(c => { if (c && Array.isArray(c.options)) list.push(...c.options); });
    return list.find(o => o && String(o.id) === String(optionId)) || null;
  }
  async function resolveOption(state, optionId, fallbackLabel) {
    if (!state.route || !optionId) return;
    let option = findConflictOption(state.route, optionId);
    if (!option && fallbackLabel) option = { id: optionId, label: fallbackLabel };
    const conflictType = (state.route.conflict && state.route.conflict.type) || 'unknown';
    track('conflict_option_clicked', { conflictType, optionId: String(optionId) });
    const startedAt = Date.now();
    try {
      let res = null;
      if (A && typeof A.resolveConflict === 'function') {
        res = await Promise.resolve(A.resolveConflict(optionId, state.route));
      }
      if (!res || (!res.route && !res.reply && !res.changes && !res.places)) {
        /* 没有 resolveConflict 或返回空：退化为一条 refine 指令 */
        if (option && option.label) { sendChat(state, option.label); return; }
        throw { code: 'INVALID_INPUT', message: '这个选项暂时无法执行。' };
      }
      let next = state.route;
      if (res.route) {
        const validation = validateIncomingRoute(res.route);
        if (!validation.ok) throw { code: 'INVALID_OUTPUT', message: validation.message };
        next = hydrateRoute(res.route);
      } else if (res.places) {
        next = hydrateRoute(res);
      }
      if (next) {
        state.route = next;
        state.routeStore[next.id] = next;
        if (next.conditions) {
          state.conditions = next.conditions;
          state.lastPlanConditions = JSON.parse(JSON.stringify(next.conditions));
          syncDraftFromConditions(state, next.conditions);
        }
      }
      state.lastDiff = {
        changes: Array.isArray(res.changes) ? res.changes : [],
        constraintsAfter: Array.isArray(res.constraintsAfter) && res.constraintsAfter.length
          ? res.constraintsAfter : constraintsOf(state.route),
        unresolved: Array.isArray(res.unresolved) ? res.unresolved : [],
        changed: true,
        at: new Date().toISOString(),
        text: option ? option.label : '冲突选项'
      };
      if (res.degraded) applyResponseFlags(state, { degraded: true, degradeReason: res.degradeReason, source: 'mock' });
      state.chat.push({
        who: 'ai',
        text: res.reply || '已按你的选择更新路线。',
        bullets: Array.isArray(res.bullets) ? res.bullets : [],
        changes: Array.isArray(res.changes) ? res.changes : []
      });
      track('refine_succeeded', {
        task: 'refine', mode: currentService(state).mode, routeId: state.route.id,
        changed: true, changesCount: Array.isArray(res.changes) ? res.changes.length : 0,
        durationMs: Date.now() - startedAt
      });
      refreshResult(state);
      U.toast('已按你的选择更新路线');
    } catch (err) {
      const info = friendlyError(err);
      track('refine_failed', { task: 'refine', mode: currentService(state).mode, errorCode: info.code, durationMs: Date.now() - startedAt });
      U.toast('执行失败：' + info.message, 'err');
    }
  }

  /* =====================================================================
   * 右栏
   * ===================================================================== */
  function destroyMap() {
    if (mapApi && typeof mapApi.destroy === 'function') {
      try { mapApi.destroy(); } catch (e) { /* 忽略 */ }
    }
    mapApi = null;
  }

  function renderRight(state) {
    const box = document.getElementById('wsRight');
    if (!box) return;

    if (state.view === 'loading') {
      destroyMap();
      box.innerHTML = `<div id="serviceSlot"></div>
        <div class="card">
          <div class="loading-wrap">
            <div class="loading-ring">${U.icon('sparkle')}</div>
            <h3>正在为你规划路线</h3>
            <div class="lw-sub">预计几秒内完成，你可以继续修改左侧的条件</div>
            <div class="loading-steps" id="loadSteps" role="status" aria-live="polite" aria-busy="true">
              ${LOAD_STEPS.map((s, i) => `<div class="lstep${i === 0 ? ' doing' : ''}"${i === 0 ? ' aria-current="step"' : ''}>
                <span class="ls-ico"></span><span>${i + 1}. ${s}</span></div>`).join('')}
            </div>
          </div>
        </div>`;
      paintServiceBar(state);
      paintSteps(state.loadStep);
      return;
    }

    if (state.view === 'error') {
      destroyMap();
      box.innerHTML = `<div id="serviceSlot"></div>${errorCardHtml(state)}`;
      paintServiceBar(state);
      bindErrorCard(state, box);
      return;
    }

    if (state.view === 'empty') {
      destroyMap();
      box.innerHTML = `<div id="serviceSlot"></div>${emptyCardHtml(state)}`;
      paintServiceBar(state);
      bindEmptyCard(state, box);
      return;
    }

    if (state.view === 'result' && state.route) {
      renderResult(state);
      return;
    }

    destroyMap();
    box.innerHTML = `<div id="serviceSlot"></div>${idleHtml(state)}`;
    paintServiceBar(state);
    bindIdle(state, box);
  }

  function errorCardHtml(state) {
    const e = state.error || { code: 'INTERNAL', message: '请求失败。' };
    return `<div class="card error-card">
      <div class="error-ico">${U.icon('alert')}</div>
      <h3>规划失败</h3>
      <div class="error-code">错误码：${U.esc(e.code || 'INTERNAL')}</div>
      <p>${U.esc(e.message || '请稍后重试。')}</p>
      ${e.legacy ? `<div class="note-box amber">${U.icon('alert')}<span>这条路线来自旧版数据，部分评分、来源与约束信息可能缺失。</span></div>` : ''}
      <div class="chips" style="margin-top:14px">
        <button class="btn btn-primary" type="button" data-act="retryPlan">${U.icon('refresh')}重试</button>
        <button class="btn btn-ghost" type="button" data-act="backForm">返回修改条件</button>
        ${state.route ? `<button class="btn btn-soft" type="button" data-act="showOld">查看上一条路线</button>` : ''}
      </div>
      <div class="hint">如果问题持续：确认本地服务已启动；或在服务状态条里查看最近错误。</div>
    </div>`;
  }
  function bindErrorCard(state, box) {
    const retry = box.querySelector('[data-act="retryPlan"]');
    if (retry) retry.addEventListener('click', () => {
      track('retry_clicked', { context: 'plan' });
      startGenerate(state);
    });
    const back = box.querySelector('[data-act="backForm"]');
    if (back) back.addEventListener('click', () => {
      state.view = state.route ? 'result' : 'idle';
      state.error = null;
      if (state.route) renderRight(state); else { renderLeft(state); renderRight(state); }
      openAdvanced(state);
    });
    const old = box.querySelector('[data-act="showOld"]');
    if (old) old.addEventListener('click', () => {
      state.view = 'result';
      state.error = null;
      renderLeft(state);
      renderRight(state);
    });
  }
  function emptyCardHtml(state) {
    const e = state.empty || {};
    return `<div class="card"><div class="empty empty-canvas">
      <div class="empty-ico">${U.icon('compass')}</div>
      <h4>没有找到可安排的地点</h4>
      <p>${U.esc(e.message || '当前条件可能过于严格。可以换城市、减少避开项，或放宽预算与时长。')}</p>
      <div class="chips" style="justify-content:center">
        <button class="btn btn-ghost" type="button" data-suggest="city">换一个城市</button>
        <button class="btn btn-ghost" type="button" data-suggest="avoid">减少避开项</button>
        <button class="btn btn-ghost" type="button" data-suggest="budget">放宽预算</button>
        <button class="btn btn-primary" type="button" data-suggest="form">回到表单修改</button>
      </div>
    </div></div>`;
  }
  function bindEmptyCard(state, box) {
    box.querySelectorAll('[data-suggest]').forEach(b => b.addEventListener('click', () => {
      const action = b.dataset.suggest;
      if (action === 'avoid') {
        state.draft.avoid = [];
        state.draft.avoidText = '';
        U.toast('已清空避开项，请重新生成');
      } else if (action === 'budget') {
        const cur = state.draft.budgetMax;
        state.draft.budgetMax = cur == null ? null : Math.round(cur * 1.5 / 10) * 10;
        U.toast(cur == null ? '预算保持未指定，请调整其他条件' : '预算已放宽到 ¥' + state.draft.budgetMax);
      } else if (action === 'city') {
        const btn = document.getElementById('cityBtn');
        if (btn && btn.click) btn.click();
        U.toast('请在顶部选择城市；其他城市目前是空态示例');
        return;
      }
      state.view = 'idle';
      state.empty = null;
      persistDraft();
      renderLeft(state);
      renderRight(state);
      openAdvanced(state);
    }));
  }

  function idleHtml(state) {
    const cur = D.route('r_old_town');
    if (!cur) return '<div class="card"><div class="empty"><h4>路线数据尚未加载</h4></div></div>';
    return `<div class="preview-card">
        <div class="preview-head">
          <div><h3>先看看别人怎么逛</h3><div class="sub">精选路线 · 可直接体验，也可作为规划参考</div></div>
          <button class="btn btn-ghost btn-sm" type="button" data-act="gotoDiscover">更多路线${U.icon('arrowRight')}</button>
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
                <span class="tag tag-amber">¥${cur.budget[0]}–${cur.budget[1]}</span>
              </div>
            </div>
            <button class="btn btn-amber btn-sm" type="button" data-curated="${cur.id}">一键体验</button>
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
            <button class="place-mini" type="button" data-place="${p.id}" aria-label="查看 ${U.esc(p.name)} 详情">
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
  }
  function bindIdle(state, box) {
    const more = box.querySelector('[data-act="gotoDiscover"]');
    if (more) more.addEventListener('click', () => CW.navigate('discover'));
    const curated = box.querySelector('[data-curated]');
    if (curated) curated.addEventListener('click', e => useCurated(e.currentTarget.dataset.curated, state));
    box.querySelectorAll('[data-place]').forEach(b => b.addEventListener('click', () => openPlace(b.dataset.place)));
  }

  /* ---------------- 结果区 ---------------- */
  function renderResult(state) {
    destroyMap();
    const box = document.getElementById('wsRight');
    if (!box) return;
    const provider = mapProviderId();
    const real = isRealMap(provider);
    const failed = state.service && state.service.mapFailed;
    box.innerHTML = `
      <div id="serviceSlot"></div>
      <div id="degradedSlot"></div>
      <div id="summarySlot"></div>
      <div id="conflictSlot"></div>
      <div id="diffSlot"></div>
      <div class="map-card">
        <div class="map-head">
          <div class="mh-l">${U.icon('route')}
            <div><h3 id="mapTitle">${failed ? '地图加载失败' : (real ? '真实地图' : '示意地图')}</h3>
              <span>编号与下方卡片顺序一致 · 距离/时间为估算，非导航</span></div></div>
          <div class="chips">
            <span class="tag">${placeIds(state.route).length} 个地点</span>
            <span class="tag-green tag">${state.route.distanceKm || 0} km</span>
          </div>
        </div>
        <div id="mapSlot"></div>
      </div>
      <div id="qualitySlot"></div>
      <div id="timelineSlot"></div>`;
    paintServiceBar(state);
    paintDegraded(state);
    paintSummary(state);
    paintConflict(state);
    paintDiff(state);
    mountMap(state);
    paintQuality(state);
    paintTimeline(state);
  }

  function sourceEyebrow(route) {
    if (route.source === 'curated') return 'Curated Route · 精选路线';
    if (route.degraded) return 'AI Planned · 已降级为本地模拟';
    if (route.source === 'remote') return 'AI Planned · 智能体服务';
    return 'AI Planned · 本地模拟结果';
  }
  function constraintsSummary(list) {
    const counts = { met: 0, partial: 0, violated: 0, unknown: 0 };
    list.forEach(c => { if (counts[c.status] === undefined) counts.unknown++; else counts[c.status]++; });
    return counts;
  }
  function constraintRows(list) {
    return list.map(c => {
      const meta = statusMeta(c.status);
      return `<div class="constraint-item st-${U.esc(c.status || 'unknown')}">
        <span class="ci-ico">${U.icon(meta.icon)}</span>
        <div class="ci-body">
          <div class="ci-top"><b>${U.esc(c.label || c.id || '约束')}</b>
            <span class="ci-status">${meta.label}</span>
            <span class="ci-kind">${c.kind === 'hard' ? '硬约束' : '偏好'}</span></div>
          <div class="ci-detail">${U.esc(c.detail || '')}</div>
        </div>
      </div>`;
    }).join('');
  }
  function scoreBars(route) {
    const s = route.scores;
    if (!s) return '';
    const rows = SCORE_LABELS.map(([key, label]) => {
      const v = typeof s[key] === 'number' ? Math.max(0, Math.min(1, s[key])) : 0;
      return `<div class="score-row"><span class="sr-label">${label}</span>
        <span class="sr-bar"><i style="width:${Math.round(v * 100)}%"></i></span>
        <span class="sr-val">${Math.round(v * 100)}</span></div>`;
    }).join('');
    return `<div class="score-bars" aria-label="评分构成">${rows}</div>
      <div class="hint">评分权重为启发式初始假设，无用户研究依据，只用于排序与解释。</div>`;
  }
  function paintSummary(state) {
    const slot = document.getElementById('summarySlot');
    if (!slot) return;
    const r = state.route;
    const list = constraintsOf(r);
    const counts = constraintsSummary(list);
    const score = overallScore(r);
    const style = Array.isArray(r.style) ? r.style : [];
    const dirty = '';
    const budget = budgetLabel(r);
    const cond = r.conditions || {};
    const budgetNote = cond.budgetMax == null ? ' · 未指定预算' : ` · 上限 ¥${cond.budgetMax}（${BASIS_NAMES[cond.budgetBasis] || '总价'}）`;
    const constraintSummary = `约束清单：${list.length} 项 · ${counts.met} 满足${counts.partial ? ` · ${counts.partial} 部分` : ''}${counts.violated ? ` · ${counts.violated} 未满足` : ''}${counts.unknown ? ` · ${counts.unknown} 无法确认` : ''}`;
    const fav = isFavRoute(r.id);
    slot.innerHTML = `
      <div class="summary-card">
        <div class="sc-eyebrow">${U.esc(sourceEyebrow(r))}${r._legacy ? ' · 旧版数据' : ''}</div>
        <h2>${U.esc(r.name || '未命名路线')}</h2>
        <div class="sc-style">${style.slice(0, 6).map(s => `<span>${U.esc(s)}</span>`).join('')}</div>
        <div class="sc-metrics">
          <div class="m"><b>${U.fmtDuration(r.actualMin)}</b><span>预计总时长（含停留与步行）</span></div>
          <div class="m"><b>${placeIds(r).length} <small>个</small></b><span>地点数量</span></div>
          <div class="m"><b>${r.distanceKm != null ? r.distanceKm : '—'} <small>km</small></b><span>预计步行距离（估算）</span></div>
          <div class="m"><b>${U.esc(budget)}</b><span>预算估算${U.esc(budgetNote)}</span></div>
          <div class="m wide"><b>${score == null ? '—' : score + ' <small>分</small>'}</b><span>综合评分（满分 100）${score == null ? ' · 该路线暂无评分' : ''}</span></div>
        </div>
        <div class="sc-actions">
          <button class="btn btn-amber-on-dark" type="button" data-act="favRoute" aria-pressed="${fav ? 'true' : 'false'}">${U.icon(fav ? 'check' : 'bookmark')}${fav ? '已收藏' : '收藏路线'}</button>
          <button class="btn btn-on-dark" type="button" data-act="replan">${U.icon('refresh')}重新规划</button>
          <button class="btn btn-on-dark" type="button" data-act="editCond2">${U.icon('edit')}编辑条件</button>
          <button class="btn btn-on-dark" type="button" data-act="share">${U.icon('share')}分享</button>
          <button class="btn btn-on-dark" type="button" data-act="export">${U.icon('download')}导出</button>
        </div>
        <details class="sc-more"${counts.violated ? ' open' : ''}>
          <summary>${constraintSummary}</summary>
          <div class="constraint-list">${constraintRows(list)}</div>
        </details>
        <details class="sc-more sc-scorebox">
          <summary>评分构成与口径${score == null ? '（暂无评分）' : ''}</summary>
          ${score == null ? '<div class="hint">该路线来自精选/旧版数据，没有评分字段；不伪造分数。</div>' : scoreBars(r)}
        </details>
        ${r.timeNote ? `<div class="note-box blue sc-note">${U.icon('clock')}<span>${U.esc(r.timeNote)}</span></div>` : ''}
        ${r.spareNote ? `<div class="note-box blue sc-note">${U.icon('info')}<span>${U.esc(r.spareNote)}</span></div>` : ''}
        ${dirty}
      </div>`;
    bindSummary(state, slot);
  }
  function bindSummary(state, slot) {
    const on = (act, fn) => {
      const b = slot.querySelector('[data-act="' + act + '"]');
      if (b) b.addEventListener('click', fn);
    };
    on('favRoute', () => toggleFavRoute(state));
    on('replan', () => startGenerate(state));
    on('editCond2', () => openAdvanced(state));
    on('share', () => openShare(state));
    on('export', () => openExport(state, state.route));
  }
  function isFavRoute(id) {
    return !!(CW.state && CW.state.favorites && CW.state.favorites.routes.indexOf(id) >= 0);
  }
  function toggleFavRoute(state) {
    const id = state.route && state.route.id;
    if (!id) return;
    const arr = state.favorites.routes;
    const i = arr.indexOf(id);
    if (i >= 0) {
      arr.splice(i, 1);
      if (CW.forgetRouteData) CW.forgetRouteData(id);
      else persistFavorites();
      U.toast('已取消收藏');
    } else {
      arr.push(id);
      if (CW.saveFavoriteRoute) CW.saveFavoriteRoute(state.route);
      else {
        state.favorites.routeData[id] = state.route;
        persistFavorites();
      }
      track('route_saved', { source: 'result', routeId: id });
      U.toast('已收藏到「我的收藏」');
    }
    paintSummary(state);
    persistFavorites();
  }
  function paintConflict(state) {
    const slot = document.getElementById('conflictSlot');
    if (!slot) return;
    const r = state.route;
    if (!r || !r.conflict) { slot.innerHTML = ''; return; }
    const c = r.conflict;
    slot.innerHTML = `<div class="note-box amber conflict-card" role="alert">
      <span class="cf-ico">${U.icon('alert')}</span>
      <div class="cf-body"><b>${U.esc(c.title || '约束冲突')}</b>
        <p>${U.esc(c.detail || '')}</p>
        <div class="chips">${(Array.isArray(c.options) ? c.options : []).map(o => `<button class="pill pill-amber" type="button" data-opt="${U.esc(o.id)}" data-conflict-opt="${U.esc(o.id)}" data-opt-label="${U.esc(o.label)}">${U.esc(o.label)}</button>`).join('')}</div>
      </div>
    </div>`;
    slot.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => resolveOption(state, b.dataset.opt, b.dataset.optLabel)));
  }
  function paintDegraded(state) {
    const slot = document.getElementById('degradedSlot');
    if (!slot) return;
    const svc = currentService(state);
    if (!svc.degraded) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<div class="degraded-bar" role="alert">
      <span class="db-ico">${U.icon('alert')}</span>
      <div class="db-body"><b>已切换为本地模拟</b>
        <span>${U.esc(friendlyDegradeReason(svc.degradeReason))}。本次结果保留 degraded 标记，不代表真实服务返回。</span></div>
      <button class="btn btn-ghost btn-sm" type="button" data-act="retryDegraded">${U.icon('refresh')}重试远程</button>
    </div>`;
    const retry = slot.querySelector('[data-act="retryDegraded"]');
    if (retry) retry.addEventListener('click', () => {
      track('retry_clicked', { context: 'degraded' });
      startGenerate(state);
    });
  }
  function paintDiff(state) {
    const slot = document.getElementById('diffSlot');
    if (!slot) return;
    const d = state.lastDiff;
    if (!d) { slot.innerHTML = ''; return; }
    const changes = Array.isArray(d.changes) ? d.changes : [];
    const after = Array.isArray(d.constraintsAfter) ? d.constraintsAfter : [];
    const issues = after.filter(c => c && (c.status === 'violated' || c.status === 'unknown'));
    const unresolved = Array.isArray(d.unresolved) ? d.unresolved : [];
    const empty = !changes.length;
    slot.innerHTML = `<details class="diff-panel card" open aria-label="本次调整差异">
      <summary><span class="dp-title">${empty ? '本次未修改' : '本次调整前后差异'}</span>
        <span class="dp-sub">${empty ? '指令没有产生可展示的改动' : `${changes.length} 项变化`}${d.at ? ' · ' + U.fmtDateTime(d.at) : ''}</span></summary>
      <div class="dp-body">
        ${changes.length ? `<div class="diff-rows">${changes.map(c => {
          const from = c.from != null && c.from !== '' ? String(c.from) : '';
          const to = c.to != null && c.to !== '' ? String(c.to) : '';
          return `<div class="diff-row"><span class="d-label">${U.esc(c.label || c.type || '调整')}</span>
            ${from ? `<span class="from">${U.esc(from)}</span>` : ''}
            ${from || to ? U.icon('arrowRight') : ''}
            ${to ? `<span class="to">${U.esc(to)}</span>` : ''}</div>`;
        }).join('')}</div>` : '<div class="hint">本次未修改：路线、条件与约束状态都没有变化。</div>'}
        ${issues.length ? `<div class="dp-section"><div class="dp-h">调整后仍需注意</div>${constraintRows(issues)}</div>` : ''}
        ${unresolved.length ? `<div class="dp-section"><div class="dp-h">仍未解决</div>
          <ul class="unresolved-list">${unresolved.map(x => `<li>${U.esc(String(x))}</li>`).join('')}</ul></div>` : ''}
      </div>
    </details>`;
  }
  function paintQuality(state) {
    const slot = document.getElementById('qualitySlot');
    if (!slot) return;
    const r = state.route;
    const dq = dataQualityOf(r);
    const sources = sourcesOf(r);
    const notes = Array.isArray(r.notes) ? r.notes : [];
    const svc = currentService(state);
    const fallback = r._legacy ? '<div class="note-box amber">' + U.icon('alert') + '<span>这条路线来自旧版数据，评分、来源与部分约束信息可能缺失；再次调整前建议重新生成。</span></div>' : '';
    const mapFallback = svc.mapFallback
      ? '<div class="note-box amber">' + U.icon('alert') + '<span>配置的真实地图不可用，已回退到示意地图；路线与时间线不受影响。</span></div>' : '';
    slot.innerHTML = `<div class="card card-pad quality-card">
      <div class="card-title"><h3>数据与来源</h3><span class="sub">生成于 ${U.esc(U.fmtDateTime(r.createdAt))}</span></div>
      <div class="dq-grid">
        <div class="dq-item"><b>${dq.placesTotal}</b><span>地点</span></div>
        <div class="dq-item"><b>${dq.placesWithCoords}</b><span>坐标已核验</span></div>
        <div class="dq-item"><b>${dq.placesWithHours}</b><span>营业时间已知</span></div>
        <div class="dq-item"><b>${sources.length}</b><span>可追溯来源</span></div>
      </div>
      ${mapFallback}
      ${fallback}
      <div class="dp-h" style="margin-top:14px">数据来源</div>
      ${sources.length ? `<ul class="sources-list">${sources.map(s => {
        const url = typeof s.url === 'string' && /^https?:\/\//.test(s.url) ? s.url : '';
        return `<li><span class="src-title">${U.esc(s.title)}</span>
          ${url ? `<a href="${U.esc(url)}" target="_blank" rel="noopener noreferrer">${U.esc(url)}${U.icon('external')}</a>` : '<span class="hint">未提供可点击链接</span>'}
          ${s.license ? `<span class="tag">${U.esc(s.license)}</span>` : ''}
          ${s.accessedAt ? `<span class="tag">访问 ${U.esc(s.accessedAt)}</span>` : ''}
          ${s.note ? `<div class="hint">${U.esc(s.note)}</div>` : ''}</li>`;
      }).join('')}</ul>` : '<div class="hint">没有可追溯来源的地点；坐标与营业信息均未核验，请以现场为准。</div>'}
      ${notes.length ? `<div class="dp-h" style="margin-top:14px">路线说明</div><ul class="unresolved-list">${notes.map(n => `<li>${U.esc(n)}</li>`).join('')}</ul>` : ''}
      <div class="note-box" style="margin-top:14px">${U.icon('info')}
        <span>${U.esc(dq.disclaimer || (D.DISCLAIMER && D.DISCLAIMER.estimate) || '')} · ${U.esc((D.DISCLAIMER && D.DISCLAIMER.estimate) || '')} · 距离/时间为估算，非导航结果；营业时间未核实一律显示「信息待确认」。</span></div>
    </div>`;
  }

  /* ---------------- 地图 ---------------- */
  function mountMap(state) {
    const slot = document.getElementById('mapSlot');
    if (!slot || !state.route) return;
    const provider = mapProviderId();
    const engine = CW.MapEngine || CW.map;
    if (!engine || typeof engine.render !== 'function') {
      mapFailed(state, { code: 'MAP_ENGINE_MISSING', message: '地图引擎未加载。' });
      return;
    }
    try {
      const out = engine.render(slot, state.route, { onSelect: id => selectPlace(state, id, true) });
      if (out && typeof out.then === 'function') {
        out.then(api => afterMap(state, api, provider)).catch(err => mapFailed(state, err));
      } else {
        afterMap(state, out, provider);
      }
    } catch (err) {
      mapFailed(state, err);
    }
  }
  function afterMap(state, api, requestedProvider) {
    mapApi = api || null;
    const slot = document.getElementById('mapSlot');
    if (slot && api) enhanceMapA11y(slot);
    const actual = (api && api.provider) || requestedProvider || 'mock';
    if (isRealMap(requestedProvider) && !isRealMap(actual)) {
      state.service.mapFallback = { from: requestedProvider, to: actual };
      track('map_failed', { provider: requestedProvider, reasonCode: 'fallback_to_mock' });
    } else {
      state.service.mapFallback = null;
    }
    state.service.mapFailed = null;
    const title = document.getElementById('mapTitle');
    if (title) title.textContent = isRealMap(actual) ? '真实地图' : '示意地图';
    paintServiceBar(state);
    paintQuality(state);
  }
  function mapFailed(state, err) {
    const info = friendlyError(err);
    const provider = mapProviderId();
    state.service.mapFailed = {
      provider: provider,
      code: info.code || 'MAP_FAILED',
      message: info.message || '地图加载失败。',
      at: new Date().toISOString()
    };
    state.service.mapFallback = null;
    mapApi = null;
    const slot = document.getElementById('mapSlot');
    if (slot) {
      slot.innerHTML = `<div class="map-fail" role="alert">
        <span class="mf-ico">${U.icon('alert')}</span>
        <div><b>地图加载失败</b><p>${U.esc(info.message || '地图服务暂时不可用。')}路线列表、时间线与调整功能仍可正常使用。</p></div>
        <button class="btn btn-ghost btn-sm" type="button" data-act="retryMap">${U.icon('refresh')}重试地图</button>
      </div>`;
      const retry = slot.querySelector('[data-act="retryMap"]');
      if (retry) retry.addEventListener('click', () => {
        track('retry_clicked', { context: 'map' });
        state.service.mapFailed = null;
        mountMap(state);
        paintServiceBar(state);
      });
    }
    const title = document.getElementById('mapTitle');
    if (title) title.textContent = '地图加载失败';
    track('map_failed', { provider: provider, reasonCode: info.code || 'MAP_FAILED' });
    paintServiceBar(state);
    paintQuality(state);
  }
  function enhanceMapA11y(slot) {
    const svg = slot.querySelector('svg');
    if (svg) {
      svg.setAttribute('role', 'img');
      if (!svg.getAttribute('aria-label')) svg.setAttribute('aria-label', '路线示意图，编号与下方时间线一致；列表提供等价内容');
      svg.querySelectorAll('.mk').forEach(g => g.setAttribute('aria-hidden', 'true'));
    }
    slot.querySelectorAll('[data-layer]').forEach(b => {
      b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
    });
  }

  /* ---------------- 时间线 ---------------- */
  function paintTimeline(state) {
    const slot = document.getElementById('timelineSlot');
    if (!slot) return;
    const r = state.route;
    const places = routePlaces(r);
    const segs = segmentsOf(r);
    slot.innerHTML = `<div class="card card-pad">
      <div class="card-title">
        <h3>行程时间线</h3>
        <span class="sub">拖动卡片或使用上下按钮调整顺序，调整后会重新估算</span>
      </div>
      <div class="timeline" id="timeline">
        ${places.map((p, i) => timelineItem(p, i, r, segs)).join('')}
      </div>
      <div class="note-box" style="margin-top:16px">${U.icon('info')}
        <span>停留时长、消费区间与步行耗时均为<b>估算值</b>；营业时间未核实，一律显示「信息待确认」。排序会重新计算距离与时间，不再显示「未重算」。</span></div>
    </div>`;
    const tl = slot.querySelector('#timeline');
    if (!tl) return;
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
    tl.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      if (e.target.closest('button')) return;
      const card = e.target.closest('.place-card');
      if (!card) return;
      e.preventDefault();
      selectPlace(state, card.dataset.id, false);
    });
    tl.addEventListener('dragstart', e => {
      if (state.ui.refineBusy || state.ui.orderBusy) { e.preventDefault(); return; }
      const c = e.target.closest('.place-card');
      if (!c) return;
      dragId = c.dataset.id;
      c.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* 忽略 */ }
    });
    tl.addEventListener('dragover', e => {
      const c = e.target.closest('.place-card');
      if (!c || !dragId) return;
      e.preventDefault();
      tl.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
      if (c.dataset.id !== dragId) c.classList.add('drop-target');
    });
    tl.addEventListener('drop', e => {
      const c = e.target.closest('.place-card');
      if (!c || !dragId) return;
      e.preventDefault();
      const ids = placeIds(state.route).slice();
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
  function timelineItem(p, i, r, segs) {
    const seg = segs[i] || {};
    const last = i === placeIds(r).length - 1;
    const prevWalk = i > 0 && seg.walkFromPrevMin > 0
      ? `从上一站步行约 ${seg.walkFromPrevMin} 分钟（估算）`
      : (i === 0 ? '路线起点' : '上一站就在附近');
    const nextWalk = !last && segs[i + 1] && segs[i + 1].walkFromPrevMin > 0
      ? `到下一站约 ${segs[i + 1].walkFromPrevMin} 分钟` : (last ? '路线终点' : '');
    const on = favPlace(p.id);
    const why = explainPlace(r, p, i);
    const timeText = seg.arriveAt || seg.departAt
      ? `${seg.arriveAt ? '预计 ' + seg.arriveAt + ' 到达' : ''}${seg.departAt ? ' · ' + seg.departAt + ' 离开' : ''}`
      : '';
    return `<div class="tl-item${CW.state && CW.state.selectedPlace === p.id ? ' sel' : ''}">
      <div class="tl-rail"><div class="tl-num">${i + 1}</div><div class="tl-line"></div></div>
      <div class="place-card${CW.state && CW.state.selectedPlace === p.id ? ' sel' : ''}" data-id="${U.esc(p.id)}" draggable="true"
        role="button" tabindex="0" aria-label="第 ${i + 1} 站，${U.esc(p.name)}，按回车选中并在地图上高亮">
        <div class="pc-img" style="${imgStyle(p.img)}"><span class="pc-order">${String(i + 1).padStart(2, '0')}</span></div>
        <div class="pc-body">
          <div class="pc-top">
            <div>
              <h4>${U.esc(p.name)}</h4>
              <div class="pc-cat">
                <span class="cat-dot" style="background:${U.esc(D.cat(p.cat).color)}"></span>
                <span>${U.esc(D.cat(p.cat).name)}</span>
                <span class="pc-area">${U.esc(p.area)}</span>
              </div>
            </div>
            <div class="pc-acts">
              <button class="fav-btn${on ? ' on' : ''}" type="button" data-fav="${U.esc(p.id)}" title="${on ? '取消收藏' : '收藏地点'}" aria-label="${on ? '取消收藏' : '收藏'}${U.esc(p.name)}" aria-pressed="${on ? 'true' : 'false'}">${U.icon('heart')}</button>
              <button class="sort-btn" type="button" data-up="${U.esc(p.id)}" ${i === 0 ? 'disabled' : ''} title="上移" aria-label="将 ${U.esc(p.name)} 上移">${U.icon('arrowUp')}</button>
              <button class="sort-btn" type="button" data-down="${U.esc(p.id)}" ${last ? 'disabled' : ''} title="下移" aria-label="将 ${U.esc(p.name)} 下移">${U.icon('arrowDown')}</button>
            </div>
          </div>
          <div class="pc-reason">${U.esc(p.reason || '')}${why && why !== p.reason ? `<br><span class="hint">为什么是这一站：${U.esc(why)}</span>` : ''}</div>
          <div class="pc-meta">
            <span class="mm">${U.icon('clock')}建议停留 ${seg.stayMin || p.stay} 分钟</span>
            <span class="mm">${U.icon('wallet')}${U.fmtCost(p.cost)}${p.costNote ? ' · ' + U.esc(p.costNote) : ''}</span>
            <span class="mm">${U.icon('info')}营业时间：信息待确认</span>
          </div>
          ${timeText ? `<div class="pc-time">${U.icon('calendar')}${U.esc(timeText)}</div>` : ''}
          <div class="pc-source">${sourceBadge(p)}
            <span class="src-badge hours">${U.icon('clock')}营业时间：信息待确认</span>
            ${p.geoLicense ? `<span class="src-license">${U.esc(p.geoLicense)}</span>` : ''}
          </div>
          <div class="pc-foot">
            <span class="pc-walk">${U.icon('walk')}${U.esc(prevWalk)}${nextWalk ? ' · ' + U.esc(nextWalk) : ''}</span>
            <button class="btn btn-ghost btn-sm" type="button" data-detail="${U.esc(p.id)}">查看详情</button>
          </div>
        </div>
      </div>
    </div>`;
  }
  function favPlace(id) {
    return !!(CW.state && CW.state.favorites && CW.state.favorites.places.indexOf(id) >= 0);
  }
  function toggleFavPlace(id, state) {
    const arr = state.favorites.places;
    const i = arr.indexOf(id);
    if (i >= 0) { arr.splice(i, 1); U.toast('已取消收藏地点'); }
    else { arr.push(id); U.toast('已收藏地点，可在「我的收藏」查看'); }
    persistFavorites();
    const tl = document.getElementById('timeline');
    if (tl) {
      const b = tl.querySelector('[data-fav="' + id + '"]');
      if (b) {
        const on = i < 0;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
  }

  /* ---------------- 手动排序：必须重算成功才更新 ---------------- */
  async function applyOrder(state, ids) {
    if (!state.route || !Array.isArray(ids) || state.ui.orderBusy) return;
    if (state.ui.refineBusy) { U.toast('正在执行调整，请稍候再排序', 'warn'); return; }
    const before = placeIds(state.route).slice();
    if (before.join(',') === ids.join(',')) return;
    let backup = state.route;
    try { backup = JSON.parse(JSON.stringify(state.route)); } catch (e) { backup = state.route; }
    state.ui.orderBusy = true;
    renderLeftStatusOnly(state);
    try {
      let next = null;
      if (A && typeof A.applyOrder === 'function') {
        const out = await Promise.resolve(A.applyOrder(state.route, ids));
        if (out && out.route) next = out.route;
        else if (out && Array.isArray(out.places)) next = out;
        else if (state.route && Array.isArray(state.route.places) && state.route.places.join(',') === ids.join(',')) next = state.route;
      }
      if (!next && CW.core && typeof CW.core.recompute === 'function') {
        const copy = JSON.parse(JSON.stringify(state.route));
        copy.places = ids.slice();
        const out = await Promise.resolve(CW.core.recompute(copy));
        next = out && Array.isArray(out.places) ? out : null;
      }
      if (!next && A && typeof A.recompute === 'function') {
        state.route.places = ids.slice();
        A.recompute(state.route);
        next = state.route;
      }
      if (!next) throw { code: 'ORDER_FAILED', message: '当前智能体不支持重新计算顺序。' };
      const validation = validateIncomingRoute(next);
      if (!validation.ok) throw { code: 'INVALID_OUTPUT', message: validation.message };
      const hydrated = hydrateRoute(next);
      hydrated.orderDirty = false;
      state.route = hydrated;
      state.routeStore[hydrated.id] = hydrated;
      state.selectedPlace = null;
      const names = ids.map(id => (D.place(id) || {}).name || id);
      state.lastDiff = {
        changes: [{ type: 'reorder', label: '站点顺序', from: names.length + ' 站重新排序', to: '已按新顺序重算' }],
        constraintsAfter: constraintsOf(hydrated),
        unresolved: [],
        changed: true,
        at: new Date().toISOString(),
        text: '手动排序'
      };
      if (hydrated.conditions) state.conditions = hydrated.conditions;
      refreshResult(state);
      U.toast('顺序与时间已重新计算');
    } catch (err) {
      /* 重算失败：恢复排序前的完整路线，不能留下半更新状态 */
      state.route = backup;
      if (backup && backup.id) state.routeStore[backup.id] = backup;
      state.selectedPlace = null;
      const info = friendlyError(err);
      U.toast('排序失败，已保留原顺序：' + info.message, 'err');
      renderRight(state);
    } finally {
      state.ui.orderBusy = false;
      renderLeftStatusOnly(state);
      refreshChat(state);
    }
  }
  function movePlace(state, id, dir) {
    const ids = placeIds(state.route).slice();
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    applyOrder(state, ids);
  }
  function renderLeftStatusOnly(state) {
    /* 不整块重绘左栏，避免输入焦点丢失；只更新生成按钮态与聊天状态 */
    const gen = document.getElementById('genBtn');
    if (gen) {
      const generating = state.view === 'loading';
      gen.disabled = generating;
    }
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
        if (card) card.classList.toggle('sel', on);
      });
    }
    if (mapApi && typeof mapApi.select === 'function') mapApi.select(sel);
    if (sel && fromMap) {
      const card = tl && tl.querySelector('.place-card[data-id="' + sel + '"]');
      if (card && card.scrollIntoView) {
        try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* 忽略 */ }
      }
    }
  }

  /* ---------------- 局部刷新（保持地图实例与缩放） ---------------- */
  function refreshChat(state) {
    const body = document.getElementById('chatBody');
    if (body) {
      body.innerHTML = state.chat.map(chatMsg).join('');
      body.scrollTop = body.scrollHeight;
    }
    const chips = document.getElementById('chatChips');
    if (chips) {
      const list = state.chatChips && state.chatChips.length ? state.chatChips : DEFAULT_CHIPS;
      chips.innerHTML = list.map(c => `<button type="button" data-chip="${U.esc(c)}">${U.esc(c)}</button>`).join('');
    }
    const ci = document.getElementById('chatInput');
    if (ci && state.ui.refineBusy) {
      ci.disabled = true;
      const b = document.querySelector('[data-act="chatSend"]');
      if (b) b.disabled = true;
    }
  }
  function refreshResult(state) {
    if (state.view !== 'result' || !state.route) { renderRight(state); return; }
    paintServiceBar(state);
    paintDegraded(state);
    paintSummary(state);
    paintConflict(state);
    paintDiff(state);
    if (mapApi && typeof mapApi.update === 'function') {
      try { mapApi.update(state.route); } catch (e) { /* 地图更新失败不影响列表 */ }
    } else if (!state.service.mapFailed) {
      mountMap(state);
    }
    paintQuality(state);
    paintTimeline(state);
    refreshChat(state);
    renderLeftStatusOnly(state);
  }

  /* ---------------- 导出 / 分享 ---------------- */
  function conditionLines(c) {
    const out = [];
    if (!c) return out;
    out.push(['城市', (D.city(c.city) || { name: c.city || '未指定' }).name]);
    out.push(['出发位置', c.startLocation || c.from || '未指定']);
    out.push(['时间窗口', (c.startTime || c.startAt || '') + (c.endTime || c.mustEnd ? '–' + (c.endTime || c.mustEnd) : '')]);
    out.push(['可用时长', c.durationMin ? U.fmtDuration(c.durationMin) : '未定']);
    out.push(['预算', c.budgetMax == null ? '未指定' : `¥${c.budgetMax} 以内（${BASIS_NAMES[c.budgetBasis] || '总价'}）`]);
    out.push(['同行人', partyName(c.party)]);
    out.push(['步行强度', WALK_NAMES[c.walkingTolerance] || '未指定']);
    out.push(['兴趣', (c.interests || []).length ? c.interests.map(id => (D.interest(id) || {}).name).filter(Boolean).join('、') : '未指定']);
    out.push(['节奏 / 交通', paceName(c.pace) + ' / ' + transportName(c.transport)]);
    if ((c.foodPreferences || []).length) out.push(['餐饮', c.foodPreferences.join('、')]);
    if ((c.accessibility || []).length) out.push(['无障碍', c.accessibility.join('、')]);
    if (c.weather && c.weather !== 'any') out.push(['天气', weatherName(c.weather)]);
    if ((c.avoid || []).length) out.push(['避开', c.avoid.map(x => D.cat(x).name || x).join('、')]);
    if ((c.mustVisit || []).length) out.push(['必去', c.mustVisit.join('、')]);
    if (c.additionalRequirements) out.push(['补充要求', c.additionalRequirements]);
    return out;
  }
  function buildMarkdown(route) {
    const places = routePlaces(route);
    const segs = segmentsOf(route);
    const constraints = constraintsOf(route);
    const sources = sourcesOf(route);
    const lines = [];
    lines.push('# ' + (route.name || 'CityWalk 路线'));
    lines.push('');
    lines.push('> 生成时间：' + U.fmtDateTime(route.createdAt));
    lines.push('> 来源：' + (sourceEyebrow(route)));
    lines.push('');
    lines.push('## 规划条件');
    conditionLines(route.conditions).forEach(r => lines.push('- ' + r[0] + '：' + r[1]));
    lines.push('');
    lines.push('## 行程');
    places.forEach((p, i) => {
      const seg = segs[i] || {};
      const walk = i === 0 ? '起点' : (seg.walkFromPrevMin ? `从上一站步行约 ${seg.walkFromPrevMin} 分钟（估算）` : '与上一站步行时间未知');
      lines.push(`${i + 1}. **${p.name}**（${D.cat(p.cat).name}）`);
      lines.push(`   - 建议停留：${seg.stayMin || p.stay} 分钟（估算）`);
      lines.push(`   - 步行：${walk}`);
      lines.push(`   - 消费：${U.fmtCost(p.cost)}${p.costNote ? '（' + p.costNote + '）' : ''}`);
      lines.push(`   - 推荐理由：${explainPlace(route, p, i)}`);
      lines.push(`   - 数据来源：${isCoordinateVerified(p) ? '坐标已核验（' + (p.geoSource || 'OpenStreetMap') + '）' : '示例地点，无单一实体'}；营业时间：信息待确认`);
    });
    lines.push('');
    lines.push('## 汇总');
    lines.push('- 预计总时长：' + U.fmtDuration(route.actualMin));
    lines.push('- 地点数量：' + places.length + ' 个');
    lines.push('- 预计步行：' + (route.distanceKm != null ? route.distanceKm : '—') + ' km（估算）');
    lines.push('- 预算估算：' + budgetLabel(route) + (route.conditions && route.conditions.budgetMax != null ? `（上限 ¥${route.conditions.budgetMax}）` : '（未指定预算）'));
    lines.push('');
    lines.push('## 约束清单');
    if (constraints.length) {
      constraints.forEach(c => lines.push(`- [${statusMeta(c.status).label}] ${c.label || c.id}：${c.detail || ''}`));
    } else {
      lines.push('- 未返回约束清单');
    }
    lines.push('');
    lines.push('## 数据来源');
    if (sources.length) {
      sources.forEach(s => lines.push(`- ${s.title}${s.url ? ' — ' + s.url : ''}${s.license ? '（' + s.license + '）' : ''}`));
    } else {
      lines.push('- 无可追溯来源');
    }
    if (route.notes && route.notes.length) {
      lines.push('');
      lines.push('## 说明');
      route.notes.forEach(n => lines.push('- ' + n));
    }
    lines.push('');
    lines.push('---');
    lines.push('本路线由 CityWalk AI 演示原型生成；时长、距离与费用均为估算值，营业时间未核实，不构成导航建议。');
    return lines.join('\n');
  }
  function buildShareText(route) {
    const places = routePlaces(route);
    const lines = [
      `${route.name || 'CityWalk 路线'}｜${U.fmtDuration(route.actualMin)} · ${places.length} 个地点 · ${route.distanceKm || 0} km · ${budgetLabel(route)}`
    ];
    places.forEach((p, i) => lines.push(`${i + 1}. ${p.name}（${D.cat(p.cat).name}）`));
    lines.push('—— 由 CityWalk AI 演示原型生成，数据为示例估算值');
    return lines.join('\n');
  }
  function safeFileBase(name) {
    return String(name || 'citywalk-route').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60) || 'citywalk-route';
  }
  function openExport(state, route) {
    if (!route) { U.toast('还没有可导出的路线', 'warn'); return; }
    const m = U.modal({
      title: '导出与分享路线',
      sub: '文件在浏览器本地生成，不会上传服务器',
      width: 560,
      body: `<div class="export-list">
        <button class="export-item" type="button" data-export="md">
          <span class="ex-ico">${U.icon('download')}</span>
          <span class="ex-body"><b>导出 Markdown</b><span>包含条件、逐站行程、时长/距离/预算、约束、来源与免责声明。</span></span>
        </button>
        <button class="export-item" type="button" data-export="json">
          <span class="ex-ico">${U.icon('database')}</span>
          <span class="ex-body"><b>导出 JSON</b><span>完整路线对象，便于再次导入或做程序处理。</span></span>
        </button>
        <button class="export-item" type="button" data-export="copy">
          <span class="ex-ico">${U.icon('copy')}</span>
          <span class="ex-body"><b>复制分享文本</b><span>适合直接发给朋友的短版本。</span></span>
        </button>
      </div>
      <div class="note-box" style="margin-top:14px">${U.icon('info')}
        <span>导出的文件会包含你的规划条件（如预算、同行人）。分享前请确认是否愿意公开这些信息。</span></div>`,
      footer: `<button class="btn btn-ghost" type="button" data-mclose>关闭</button>`
    });
    if (!m.el) return;
    m.el.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', async () => {
      const kind = b.dataset.export;
      if (kind === 'copy') {
        const ok = await U.copy(buildShareText(route));
        if (ok) { track('route_copied', { routeId: route.id }); U.toast('分享文本已复制'); }
        else U.toast('复制失败，请手动选择文本复制', 'warn');
        return;
      }
      if (kind === 'md') {
        const ok = U.download(safeFileBase(route.name) + '.md', buildMarkdown(route), 'text/markdown;charset=utf-8');
        if (ok) { track('route_exported', { format: 'md', routeId: route.id }); U.toast('Markdown 已开始下载'); }
        else U.toast('导出失败，请检查浏览器下载权限', 'warn');
      } else if (kind === 'json') {
        let text = '';
        try { text = JSON.stringify(route, null, 2); } catch (e) { text = ''; }
        if (!text) { U.toast('导出失败：路线数据无法序列化', 'warn'); return; }
        const ok = U.download(safeFileBase(route.name) + '.json', text, 'application/json;charset=utf-8');
        if (ok) { track('route_exported', { format: 'json', routeId: route.id }); U.toast('JSON 已开始下载'); }
        else U.toast('导出失败，请检查浏览器下载权限', 'warn');
      }
    }));
  }
  function openShare(state) {
    const r = state.route;
    if (!r) return;
    const text = buildShareText(r);
    const m = U.modal({
      title: '分享路线',
      sub: '复制下面这段文字即可发给朋友',
      body: `<label class="sr-only" for="shareText">分享文本</label>
        <textarea class="textarea" id="shareText" rows="9" readonly>${U.esc(text)}</textarea>
        <div class="note-box" style="margin-top:12px">${U.icon('info')}
          <span>演示原型未接入真实分享服务，这里仅提供可复制的文本内容。</span></div>`,
      footer: `<button class="btn btn-ghost" type="button" data-mclose>关闭</button>
               <button class="btn btn-primary" type="button" data-act="copy">${U.icon('copy')}复制内容</button>`
    });
    if (!m.el) return;
    const cbtn = m.el.querySelector('[data-act="copy"]');
    if (cbtn) cbtn.addEventListener('click', async () => {
      const ta = m.el.querySelector('#shareText');
      const ok = await U.copy(ta ? ta.value : text);
      if (ok) { track('route_copied', { routeId: r.id }); U.toast('已复制到剪贴板'); }
      else U.toast('复制失败，请手动选中复制', 'warn');
    });
  }

  /* ---------------- 地点详情 ---------------- */
  function openPlace(id) {
    const p = D.place(id);
    if (!p) return;
    const on = favPlace(id);
    const inRoute = CW.state.route && placeIds(CW.state.route).indexOf(id) >= 0;
    const idx = inRoute ? placeIds(CW.state.route).indexOf(id) + 1 : null;
    const geoText = isCoordinateVerified(p)
      ? `真实坐标：${p.lat}, ${p.lng}（${p.geoSource || 'OpenStreetMap'}，置信度 ${p.geoConfidence || '未知'}）`
      : (p.geoStatus === 'generic-no-entity' ? '示例 / 泛化地点：无单一实体，不参与真实地图定位' : '坐标未核验');
    const geoUrl = isCoordinateVerified(p) ? sourceUrlOf(p) : '';
    const m = U.modal({
      title: p.name,
      sub: `${D.cat(p.cat).name} · ${p.area}`,
      width: 640,
      body: `
        <div class="detail-hero" style="${imgStyle(p.img)}"><span class="dh-cat">${U.esc(D.cat(p.cat).name)}</span></div>
        <div class="detail-rows">
          <div class="kv"><span>为什么推荐</span><b style="text-align:right;max-width:62%">${U.esc(p.reason)}</b></div>
          <div class="kv"><span>建议停留</span><b>${p.stay} 分钟（估算）</b></div>
          <div class="kv"><span>预计消费</span><b>${U.fmtCost(p.cost)}${p.costNote ? ' · ' + U.esc(p.costNote) : ''}</b></div>
          <div class="kv"><span>营业时间</span><b>信息待确认</b></div>
          <div class="kv"><span>室内 / 室外</span><b>${p.indoor === true ? '室内' : (p.indoor === false ? '室外 / 街区' : '未标注（未知）')}</b></div>
          <div class="kv"><span>无障碍信息</span><b>未核验</b></div>
          <div class="kv"><span>适合偏好</span><b>${p.interests.map(i => U.esc((D.interest(i) || {}).name || i)).join('、')}</b></div>
          <div class="kv"><span>位置</span><b>${U.esc(geoText)}${geoUrl ? ` <a class="link-btn" href="${U.esc(geoUrl)}" target="_blank" rel="noopener noreferrer">查看来源</a>` : ''}</b></div>
          ${idx ? `<div class="kv"><span>在路线中</span><b>第 ${idx} 站</b></div>` : ''}
        </div>
        <div class="note-box" style="margin-top:14px">${U.icon('alert')}
          <span>${U.esc(p.tip)}<br>本页信息为演示数据；坐标只有可追溯来源时才标「已核验」，营业时间未核实一律「信息待确认」，出行前请以现场或官方渠道为准。</span></div>`,
      footer: `<button class="btn btn-ghost" type="button" data-mclose>关闭</button>
               <button class="btn ${on ? 'btn-soft' : 'btn-primary'}" type="button" data-act="fav">${U.icon('heart')}${on ? '取消收藏' : '收藏这个地点'}</button>`
    });
    if (!m.el) return;
    const fb = m.el.querySelector('[data-act="fav"]');
    if (fb) fb.addEventListener('click', () => {
      toggleFavPlace(id, CW.state);
      const now = favPlace(id);
      fb.className = 'btn ' + (now ? 'btn-soft' : 'btn-primary');
      fb.innerHTML = U.icon('heart') + (now ? '取消收藏' : '收藏这个地点');
    });
  }

  /* ---------------- 精选路线 ---------------- */
  function curatedToConditions(cur) {
    const cond = defaultConditions();
    cond.city = cur.city;
    cond.durationMin = cur.duration;
    cond.interests = [];
    cur.themes.forEach(t => {
      const th = D.theme(t);
      if (!th) return;
      th.interests.forEach(n => {
        const it = D.INTERESTS.find(x => x.name === n);
        if (it && cond.interests.indexOf(it.id) < 0) cond.interests.push(it.id);
      });
    });
    if (cur.duration >= 240) cond.pace = 'light';
    cond.budgetMax = cur.budget[1];
    cond.budgetBasis = 'total';
    cond.startLocation = '';
    cond.startTime = '14:00';
    cond.endTime = '';
    cond.party = 'solo';
    cond.walkingTolerance = 'mid';
    cond.transport = 'walk';
    cond.weather = 'any';
    cond.avoid = [];
    cond.mustVisit = [];
    cond.foodPreferences = [];
    cond.accessibility = [];
    cond.from = '';
    cond.startAt = '14:00';
    cond.mustEnd = '';
    return cond;
  }
  function curatedFallbackRoute(cur, cond) {
    const places = D.places(cur.places);
    let walkTotal = 0;
    const segments = places.map((p, i) => {
      let walk = 0;
      if (i > 0) {
        const prev = places[i - 1];
        if (A && typeof A.walkMinutes === 'function') {
          try { walk = A.walkMinutes(prev, p); } catch (e) { walk = 0; }
        } else {
          const d = Math.sqrt(Math.pow(prev.mapX - p.mapX, 2) + Math.pow(prev.mapY - p.mapY, 2));
          walk = Math.max(3, Math.round(d * 8 / 75));
        }
        walkTotal += walk;
      }
      return {
        placeId: p.id, stayMin: p.stay, walkFromPrevMin: walk,
        distanceFromPrevKm: i ? Math.round(walk / 60 * 4.5 * 10) / 10 : 0
      };
    });
    const stayTotal = places.reduce((s, p) => s + p.stay, 0);
    const budgetLo = places.reduce((s, p) => s + p.cost[0], 0);
    const budgetHi = places.reduce((s, p) => s + p.cost[1], 0);
    return {
      id: 'cur_' + cur.id,
      city: cur.city,
      name: cur.name,
      source: 'curated',
      createdAt: new Date().toISOString(),
      conditions: cond,
      places: cur.places.slice(),
      segments,
      durationMin: cur.duration,
      actualMin: stayTotal + walkTotal,
      stayTotalMin: stayTotal,
      walkTotalMin: walkTotal,
      distanceKm: cur.distanceKm,
      budget: { min: budgetLo, max: budgetHi, currency: 'CNY', basis: 'total' },
      style: cur.style.slice(),
      constraints: [],
      conflict: null,
      explanations: places.map(p => ({ placeId: p.id, why: p.reason, evidence: [] })),
      sources: [],
      notes: [D.DISCLAIMER.sample + ' · 地点顺序为预设内容，时长与距离为估算值。'],
      dataQuality: {
        placesTotal: places.length,
        placesWithCoords: places.filter(isCoordinateVerified).length,
        placesWithHours: places.filter(p => p.hours != null).length,
        placesVerified: places.filter(p => /^verified/.test(String(p.geoStatus || ''))).length,
        disclaimer: D.DISCLAIMER.estimate
      },
      orderDirty: false,
      curatedId: cur.id
    };
  }
  function routeFromCurated(cur) {
    const cond = curatedToConditions(cur);
    let route = null;
    try {
      if (A && typeof A.buildRoute === 'function') {
        const out = A.buildRoute(cond, cur.places.slice(), { note: `来自精选路线「${cur.name}」，地点顺序为预设，非实时计算` });
        route = out && out.route ? out.route : out;
      }
    } catch (e) { route = null; }
    if (!route || !Array.isArray(route.places) || !route.places.length) route = curatedFallbackRoute(cur, cond);
    route.id = 'cur_' + cur.id;
    route.name = cur.name;
    route.source = 'curated';
    route.curatedId = cur.id;
    route.durationMin = cur.duration;
    route.conditions = cond;
    if (!Array.isArray(route.places) || !route.places.length) route.places = cur.places.slice();
    route = hydrateRoute(route);
    if (CW.state) CW.state.routeStore[route.id] = route;
    return route;
  }
  function useCurated(id, state) {
    const cur = D.route(id);
    if (!cur) return;
    state.city = cur.city;
    const route = routeFromCurated(cur);
    state.route = route;
    state.conditions = route.conditions;
    state.lastPlanConditions = JSON.parse(JSON.stringify(route.conditions));
    state.view = 'result';
    state.selectedPlace = null;
    state.lastDiff = null;
    state.clarify = null;
    state.error = null;
    state.empty = null;
    state.planMeta = { date: state.draft.date, requestedAt: new Date().toISOString(), curated: cur.id };
    syncDraftFromConditions(state, route.conditions);
    persistDraft();
    state.chat = [
      { who: 'me', text: '我想按「' + cur.name + '」这条路线走' },
      { who: 'ai', title: '已载入精选路线', text: '地点顺序为预设内容，时长与距离为估算值。你可以直接改，比如「少走一点路」「去掉书店」。' }
    ];
    state.chatChips = DEFAULT_CHIPS;
    CW.navigate('home');
    U.toast('已载入精选路线，可直接调整');
  }

  CW.pages = CW.pages || {};
  CW.pages.home = {
    render, useCurated, openPlace, routeFromCurated, hydrateRoute, openExport, openShare,
    destroyMap,
    get chatQueue() { return chatQueue; },
    helpers: {
      budgetLabel, constraintsOf, sourceBadge, overallScore, parseDurationValue, conditionsFromDraft
    }
  };
})();
