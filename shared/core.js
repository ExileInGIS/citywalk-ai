/* =====================================================================
 * core.js · CityWalk AI 确定性核心（UMD）
 * ---------------------------------------------------------------------
 * 目标：浏览器 Mock 与 Node 服务端复用同一份规划 / 调整 / 约束 / 评分逻辑。
 * 原则：LLM 负责理解与表达，代码负责事实与约束（见 docs/AGENT-WORKFLOW.md）。
 *
 * 数据与契约：
 *   - 地点目录：js/data.js（UMD，含示意坐标 mapX/mapY 与 OSM 真实坐标 lat/lng）
 *   - 校验器：js/schema.js（UMD，Conditions / Route / RefineResult）
 *   - 评分权重：server/config/scoring.json（浏览器缺省时使用内置默认权重）
 *
 * 本文件实现的确定性规则（摘要）：
 *   · 时间：停留按 pace（light ×1.25 / mid ×1.0 / deep ×0.85）；
 *     步行速度 4.5 km/h；真实坐标距离 = haversine × 1.25，示意坐标 = mapX/mapY × 8m。
 *   · 预算：各地点 cost 区间求和后乘以同行人数系数
 *     solo 1 / couple 2 / friends 3 / family 3；
 *     budgetBasis=per_person 时 budgetMax 是人均值，比较时同样乘以人数。
 *   · 步行上限：light 3km / mid 6km / deep 10km。
 *   · 时长：actualMin <= durationMin × 1.05 视为满足；超出返回 conflict(type=time)。
 *   · 无真实坐标的泛化地点仍可参与 Mock 路线，但 explanations/notes 会注明
 *     “示例地点，无真实坐标”，且不伪造 OSM 来源。
 *   · 所有数字确定：同一输入两次 plan 除 id/createdAt 外完全一致；
 *     opts.now / opts.id 可注入，便于测试。
 *
 * 错误契约（不抛出未捕获的运行时异常，只抛可识别的业务错误）：
 *   - INCOMPLETE_CONDITIONS：缺 city 或 durationMin（且 endTime 无法推导），
 *     由调用方转成澄清问题；code='INCOMPLETE_CONDITIONS'，details=missing[]。
 *   - NO_CANDIDATES：城市无数据或候选被 avoid 全部排除，无法构造合法 Route
 *     （schema 要求 places 1–8），由服务端转成空状态；code='NO_CANDIDATES'。
 *   - INVALID_ROUTE：refine/recompute 收到的路线非法；code='INVALID_ROUTE'。
 *   - CORE_INVALID_ROUTE / CORE_INVALID_REFINE：内部自检失败（不应发生），
 *     用于让服务端按 INVALID_OUTPUT 处理而不是渲染脏数据。
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../js/data.js'),
      require('../js/schema.js'),
      require('../server/config/scoring.json')
    );
  } else {
    root.CW = root.CW || {};
    root.CW.core = factory(root.CW.data, root.CW.schema, root.CW.scoring || null);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D, S, SCORING) {
  'use strict';

  if (!D || !S) {
    throw new Error('core.js 依赖缺失：请先加载 js/data.js 与 js/schema.js');
  }

  /* =====================================================================
   * 0. 常量与基础工具
   * ===================================================================== */

  const VERSION = 'core.v1';
  const METHOD = 'heuristic-v1';
  const WALK_KMH = 4.5;           // 步行速度
  const MAP_UNIT_M = 8;           // 示意地图 1 单位 ≈ 8 米
  const REAL_ROUTE_FACTOR = 1.25; // 真实坐标距离放大系数（路线估算，非导航）
  const MAX_PLACES = 8;           // schema：places 1–8
  const MIN_STAY_MIN = 10;        // 缩短停留时的下限，避免出现 0 分钟站
  const ACCESSED_AT = '2026-10-26';
  const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';
  const SAMPLE_DATA_URL = 'https://github.com/ExileInGIS/citywalk-ai';

  /* 步行上限（km）与节奏停留系数：硬约束与软偏好各用到一半 */
  const WALKING_LIMITS = Object.freeze({ light: 3, mid: 6, deep: 10 });
  const STAY_FACTORS = Object.freeze({ light: 1.25, mid: 1.0, deep: 0.85 });

  /* 同行人数系数：budgetBasis=per_person 时用于把“人均”换算成“合计”。
     这是产品假设（写进注释与 docs），不是用户研究结论。 */
  const PARTY_MULTIPLIER = Object.freeze({ solo: 1, couple: 2, friends: 3, family: 3 });

  const DEFAULT_WEIGHTS = Object.freeze({
    interest: 0.35,
    timeFit: 0.20,
    efficiency: 0.15,
    budgetFit: 0.15,
    diversity: 0.15
  });

  /* 地理扫掠的候选方向（度）。选总步行最短的那个投影方向排序，
     避免只用单一斜向扫掠导致绕路；仍然按 mapX/mapY 投影，确定性不变。 */
  const SWEEP_ANGLES = [0, 30, 45, 60, 90, 120, 135, 150];

  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const round = (v, digits) => {
    const p = Math.pow(10, digits == null ? 2 : digits);
    return Math.round(v * p) / p;
  };
  const isRealCoord = p => !!p && isNum(p.lat) && isNum(p.lng);

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function hashString(text) {
    let h = 2166136261;
    const s = String(text || '');
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function typedError(code, message, extra) {
    const err = new Error(message);
    err.code = code;
    if (extra && typeof extra === 'object') Object.assign(err, extra);
    return err;
  }

  function normalizeWeights(raw) {
    const out = {
      interest: DEFAULT_WEIGHTS.interest,
      timeFit: DEFAULT_WEIGHTS.timeFit,
      efficiency: DEFAULT_WEIGHTS.efficiency,
      budgetFit: DEFAULT_WEIGHTS.budgetFit,
      diversity: DEFAULT_WEIGHTS.diversity
    };
    const src = raw && typeof raw === 'object' ? (raw.weights || raw) : null;
    if (!src || typeof src !== 'object') return out;
    const keys = Object.keys(DEFAULT_WEIGHTS);
    const candidate = {};
    for (let i = 0; i < keys.length; i += 1) {
      const v = Number(src[keys[i]]);
      if (Number.isFinite(v) && v >= 0) candidate[keys[i]] = v;
      else return out;
    }
    const sum = keys.reduce((s, k) => s + candidate[k], 0);
    if (!(sum > 0)) return out;
    if (Math.abs(sum - 1) <= 1e-9) {
      keys.forEach(k => { out[k] = candidate[k]; });
      return out;
    }
    keys.forEach(k => { out[k] = candidate[k] / sum; });
    return out;
  }

  const SCORING_WEIGHTS = Object.freeze(normalizeWeights(SCORING));

  function partyMultiplier(party) {
    return PARTY_MULTIPLIER[party] || PARTY_MULTIPLIER.solo;
  }

  function stayFactor(pace) {
    return STAY_FACTORS[pace] || STAY_FACTORS.mid;
  }

  function walkingLimit(cond) {
    return WALKING_LIMITS[cond.walkingTolerance] || WALKING_LIMITS.mid;
  }

  function formatDuration(min) {
    const n = Math.max(0, Math.round(min || 0));
    if (n < 60) return n + ' 分钟';
    const h = Math.floor(n / 60);
    const m = n % 60;
    return m ? h + ' 小时 ' + m + ' 分钟' : h + ' 小时';
  }

  function formatMoney(v) {
    return '¥' + Math.round(v || 0);
  }

  function minutesToHHMM(min) {
    const total = ((Math.round(min) % 1440) + 1440) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /* =====================================================================
   * 1. 条件归一化与完整度
   * ===================================================================== */

  /**
   * 在 S.normalizeConditions 之上补两件事：
   * 1) endTime 可推导 durationMin（schema 的 normalize 只在 durationMin 缺省时才推导，
   *    若传入的是 durationMin:0 的已归一化对象，这里补一次）；
   * 2) recompute 时允许用 route.durationMin 兜底。
   */
  function prepareConditions(input, fallbackDuration) {
    const raw = (input && typeof input === 'object') ? input : {};
    const cond = S.normalizeConditions(input);
    const rawDurationUsable = isNum(raw.durationMin) && raw.durationMin > 0;
    if (!rawDurationUsable) {
      // 注意：S.normalizeConditions 会把显式 durationMin=0 clamp 成 30；
      // 这里必须还原“缺失”语义，否则 checkCompleteness 会把缺时长误判为完整。
      const endTime = raw.endTime || cond.endTime;
      const startTime = raw.startTime || cond.startTime;
      const derived = endTime ? S.durationFromTimes(startTime, endTime) : null;
      if (derived != null && derived > 0) {
        cond.durationMin = clamp(Math.round(derived), S.LIMITS.durationMin[0], S.LIMITS.durationMin[1]);
      } else {
        cond.durationMin = 0;
      }
    }
    if (!(cond.durationMin > 0) && isNum(fallbackDuration) && fallbackDuration > 0) {
      cond.durationMin = clamp(Math.round(fallbackDuration), S.LIMITS.durationMin[0], S.LIMITS.durationMin[1]);
    }
    return cond;
  }

  function defaultConditions() {
    return S.normalizeConditions({ city: 'nanjing', durationMin: 240, startTime: '14:00' });
  }

  /**
   * 只追问两个必填项：city 与 durationMin（可由 endTime 推导）。
   * 其他字段用默认值，并在 note 里说明。
   */
  function checkCompleteness(conditions) {
    const cond = prepareConditions(conditions);
    const missing = [];
    const questions = [];

    if (!cond.city) {
      missing.push({ id: 'city', label: '城市' });
      questions.push({
        id: 'city',
        text: '你想在哪座城市漫步？',
        options: [
          { value: 'nanjing', label: '南京（示例数据完整）' },
          { value: 'suzhou', label: '苏州（数据筹备中）' },
          { value: 'hangzhou', label: '杭州（数据筹备中）' },
          { value: 'shanghai', label: '上海（数据筹备中）' }
        ]
      });
    }

    if (!(cond.durationMin > 0)) {
      missing.push({ id: 'durationMin', label: '可用时长' });
      questions.push({
        id: 'durationMin',
        text: '这次大概有多少时间？',
        options: [
          { value: 120, label: '2 小时' },
          { value: 180, label: '3 小时' },
          { value: 240, label: '4 小时' },
          { value: 360, label: '半天（6 小时）' }
        ]
      });
    }

    const ok = missing.length === 0;
    const note = ok
      ? '其余偏好未指定时按默认值处理：节奏适中、全程步行、不限预算、无必去点；可随时在对话里补充。'
      : '城市与时长是生成路线的必填项；其余偏好（兴趣、预算、步行强度等）可稍后补充，未填时按默认值处理。';

    return { ok, missing, questions, note };
  }

  /* =====================================================================
   * 2. 中文意图解析（Mock 规则；不声称是大模型语义理解）
   * ===================================================================== */

  const CITY_ALIAS = {
    南京: 'nanjing', 苏州: 'suzhou', 杭州: 'hangzhou', 上海: 'shanghai', 成都: 'chengdu',
    南京城: 'nanjing', 苏州市: 'suzhou', 杭州市: 'hangzhou', 上海市: 'shanghai', 成都市: 'chengdu'
  };
  const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

  const INTEREST_RULES = [
    { id: 'coffee', re: /咖啡|甜品|下午茶|喝杯|喝点/ },
    { id: 'history', re: /历史|老街|老城|古建|文化|人文|秦淮/ },
    { id: 'photo', re: /拍照|摄影|出片|打卡|机位|建筑/ },
    { id: 'book', re: /书店|看书|阅读|读书/ },
    { id: 'park', re: /公园|绿地|湖边|绿道|自然|散步/ },
    { id: 'local', re: /本地|特色|小吃|市集|烟火|在地/ }
  ];

  /* 地点类别词 → 类别 id / 兴趣 id；refine 的“把 X 换成 Y”与“多看历史”共用。 */
  const CATEGORY_PATTERNS = [
    { cat: 'cafe', interest: 'coffee', label: '咖啡馆', re: /咖啡|甜品|下午茶/ },
    { cat: 'book', interest: 'book', label: '书店', re: /书店|阅读|看书/ },
    { cat: 'history', interest: 'history', label: '历史街区', re: /历史|老街|老城|古建|人文|文化/ },
    { cat: 'park', interest: 'park', label: '公园绿地', re: /公园|绿地|湖|绿道/ },
    { cat: 'photo', interest: 'photo', label: '拍照点', re: /拍照|摄影|机位|出片|打卡/ },
    { cat: 'local', interest: 'local', label: '本地特色', re: /本地|小吃|市井|烟火/ },
    { cat: 'food', interest: null, label: '本地小馆', re: /吃饭|正餐|餐厅|饭馆|小馆/ },
    { cat: 'arch', interest: null, label: '建筑街区', re: /建筑|公馆|洋楼/ },
    { cat: 'street', interest: null, label: '街区商圈', re: /商圈|商业街|街区/ }
  ];

  const NEGATION_RE = /不要|不去|不想|别去|避开|除了|去掉|删掉|取消|不安排|不想去|没必要/;

  function cnNumber(text) {
    if (/^\d+(?:\.\d+)?$/.test(text)) return parseFloat(text);
    if (text === '十') return 10;
    if (/^十[一二三四五六七八九]$/.test(text)) return 10 + CN_NUM[text.charAt(1)];
    if (/^[一二两三四五六七八九]十$/.test(text)) return CN_NUM[text.charAt(0)] * 10;
    if (/^[一二两三四五六七八九]十[一二三四五六七八九]$/.test(text)) {
      return CN_NUM[text.charAt(0)] * 10 + CN_NUM[text.charAt(2)];
    }
    if (CN_NUM[text] != null) return CN_NUM[text];
    return null;
  }

  function parseDurationText(text) {
    const t = String(text || '');
    let m = t.match(/(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*个?\s*半\s*(?:小时|钟头|h|H)/);
    if (m) {
      const n = cnNumber(m[1]);
      if (n != null) return { minutes: Math.round((n + 0.5) * 60), raw: m[0] };
    }
    m = t.match(/(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*个?\s*(?:小时|钟头|h|H)/);
    if (m) {
      const n = cnNumber(m[1]);
      if (n != null) return { minutes: Math.round(n * 60), raw: m[0] };
    }
    m = t.match(/(\d+)\s*分钟/);
    if (m) return { minutes: parseInt(m[1], 10), raw: m[0] };
    if (/半天|一下午/.test(t)) return { minutes: 240, raw: '半天/一下午（假设 240 分钟）' };
    if (/一上午/.test(t)) return { minutes: 180, raw: '一上午（假设 180 分钟）' };
    if (/一整天|一天/.test(t)) return { minutes: 480, raw: '一天（假设 480 分钟）' };
    return null;
  }

  /**
   * 解析 HH:mm 或“下午三点/17:00/五点半”。
   * @param {string} text
   * @param {boolean} bareHourAllowed 无“上午/下午”前缀时是否允许只写“5 点”
   * @returns {{value:string, minutes:number, raw:string}|null}
   */
  function parseClockText(text, bareHourAllowed) {
    if (!text) return null;
    const t = String(text);

    let m = t.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (m) {
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      if (h <= 23 && min <= 59) {
        return { value: (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min, minutes: h * 60 + min, raw: m[0] };
      }
    }

    m = t.match(/(上午|早上|下午|傍晚|晚上)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*[点時时]\s*(半|\d{1,2}\s*分?)?/);
    if (m) {
      const prefix = m[1] || '';
      if (!prefix && !bareHourAllowed) return null;
      let h = cnNumber(m[2]);
      if (h == null) return null;
      let min = 0;
      if (m[3] === '半') min = 30;
      else if (m[3]) min = parseInt(String(m[3]).replace(/[^\d]/g, ''), 10) || 0;
      if (min > 59) min = 0;
      if (prefix === '下午' || prefix === '傍晚' || prefix === '晚上') {
        if (h < 12) h += 12;
      }
      if (h === 12 && (prefix === '上午' || prefix === '早上')) h = 0;
      if (h > 23) h = h % 24;
      const value = (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
      return { value, minutes: h * 60 + min, raw: m[0] };
    }
    return null;
  }

  function findCategoryInText(text) {
    const t = String(text || '');
    for (let i = 0; i < CATEGORY_PATTERNS.length; i += 1) {
      if (CATEGORY_PATTERNS[i].re.test(t)) return CATEGORY_PATTERNS[i];
    }
    return null;
  }

  function findPlaceByText(text, cityId) {
    const t = String(text || '').trim();
    if (!t) return null;
    const pool = cityId ? D.placesOfCity(cityId) : D.PLACES;
    let best = null;
    for (let i = 0; i < pool.length; i += 1) {
      const p = pool[i];
      if (p.id === t || p.name === t) return p;
      if (p.name.indexOf(t) >= 0 || t.indexOf(p.name) >= 0) {
        if (!best || p.name.length < best.name.length) best = p;
      }
    }
    return best;
  }

  function parseBudgetText(text) {
    const t = String(text || '');
    let m = t.match(/(?:人均|每人)\s*(\d+)\s*(?:元|块|块钱)?/);
    if (m) return { budgetMax: parseInt(m[1], 10), budgetBasis: 'per_person', raw: m[0] };
    m = t.match(/(?:预算|花费|控制在|不超过|最多|顶多)\s*(\d+)\s*(?:元|块|块钱)?/);
    if (m) return { budgetMax: parseInt(m[1], 10), budgetBasis: 'total', raw: m[0] };
    m = t.match(/(\d+)\s*(?:元|块|块钱)\s*(?:以内|以下|左右|之内)?/);
    if (m) return { budgetMax: parseInt(m[1], 10), budgetBasis: 'total', raw: m[0] };
    return null;
  }

  function parseEndTimeText(text) {
    const t = String(text || '');
    const before = /(?:之前|以前|前)/;
    if (!before.test(t)) return null;
    const clock = parseClockText(t, true);
    if (clock) {
      // “五点前结束”没有上午/下午前缀，产品语境默认指下午；带冒号的 “05:00” 不猜测。
      const hasPrefix = /(上午|早上|下午|傍晚|晚上)/.test(t);
      const isBareHour = clock.raw.indexOf(':') < 0;
      if (!hasPrefix && isBareHour && clock.minutes <= 6 * 60) {
        const minutes = clock.minutes + 12 * 60;
        const h = Math.floor(minutes / 60);
        const min = minutes % 60;
        const value = (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
        return { value, minutes, raw: clock.raw };
      }
      return clock;
    }
    const m = t.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*点\s*(半)?\s*(?:之前|以前|前)/);
    if (m) {
      let h = cnNumber(m[1]);
      if (h == null) return null;
      if (h <= 6) h += 12; // “五点前”在产品语境里默认指下午
      const min = m[2] ? 30 : 0;
      const value = (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
      return { value, minutes: h * 60 + min, raw: m[0] };
    }
    return null;
  }

  function parseIntent(text, fallbackCity) {
    const t = String(text == null ? '' : text);
    const out = {
      city: fallbackCity || '',
      interests: [],
      mustVisit: [],
      avoid: [],
      accessibility: [],
      foodPreferences: [],
      signals: {}
    };
    const signals = out.signals;

    // ---- 城市 ----
    Object.keys(CITY_ALIAS).forEach(name => {
      if (t.indexOf(name) >= 0) {
        out.city = CITY_ALIAS[name];
        signals.city = name;
      }
    });

    // ---- 时长 / 时间窗 ----
    const duration = parseDurationText(t);
    if (duration) {
      out.durationMin = duration.minutes;
      signals.duration = duration.raw;
    }

    const windowMatch = t.match(/(?:(\d{1,2})\s*[:：]\s*(\d{2})|(上午|早上|下午|傍晚|晚上)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*[点時时])\s*(?:到|至|-|–|~|—)\s*(?:(\d{1,2})\s*[:：]\s*(\d{2})|(上午|早上|下午|傍晚|晚上)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*[点時时])/);
    if (windowMatch) {
      const startRaw = windowMatch[0].split(/\s*(?:到|至|-|–|~|—)\s*/)[0];
      const endRaw = windowMatch[0].split(/\s*(?:到|至|-|–|~|—)\s*/).slice(1).join('');
      const s = parseClockText(startRaw, true);
      const e = parseClockText(endRaw, true);
      if (s) {
        out.startTime = s.value;
        signals.startTime = s.raw;
      }
      if (e) {
        let endClock = e;
        // “下午两点到五点”：结束时间没写前缀，按同一时间窗的下午理解。
        if (s && endClock.minutes <= s.minutes && !/(上午|早上|下午|傍晚|晚上)/.test(endRaw) &&
          endClock.raw.indexOf(':') < 0 && endClock.minutes + 12 * 60 <= 24 * 60) {
          const minutes = endClock.minutes + 12 * 60;
          const h = Math.floor(minutes / 60);
          const min = minutes % 60;
          endClock = {
            value: (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min,
            minutes,
            raw: endClock.raw
          };
        }
        out.endTime = endClock.value;
        signals.endTime = endClock.raw;
      }
      if (s && out.endTime) {
        const d = S.durationFromTimes(s.value, out.endTime);
        if (d != null) {
          out.durationMin = d;
          signals.duration = s.value + '–' + out.endTime;
        }
      }
    }

    if (!out.endTime) {
      const end = parseEndTimeText(t);
      if (end) {
        out.endTime = end.value;
        signals.endTime = end.raw;
      }
    }

    if (!out.startTime) {
      const clock = parseClockText(t, false);
      if (clock) {
        out.startTime = clock.value;
        signals.startTime = clock.raw;
      }
    }

    // ---- 预算 ----
    const budget = parseBudgetText(t);
    if (budget) {
      out.budgetMax = budget.budgetMax;
      out.budgetBasis = budget.budgetBasis;
      signals.budget = budget.raw;
    }

    // ---- 兴趣（否定句不能算兴趣，转 avoid）----
    const clauses = t.split(/[，,。；;！!？?、\n]/).filter(Boolean);
    clauses.forEach(clause => {
      const negative = NEGATION_RE.test(clause);
      INTEREST_RULES.forEach(rule => {
        if (!rule.re.test(clause)) return;
        if (negative) {
          if (out.avoid.indexOf(rule.id) < 0) out.avoid.push(rule.id);
          signals.avoid = clause;
        } else {
          if (out.interests.indexOf(rule.id) < 0) out.interests.push(rule.id);
          signals.interests = (signals.interests ? signals.interests + '、' : '') + clause;
        }
      });
    });

    // ---- 必去 ----
    const mustRe = /(?:一定要去|一定要逛|必去|必须去|不能错过|想去)\s*([^，,。；;！!？?\n]{1,20})/g;
    let mm;
    while ((mm = mustRe.exec(t)) !== null) {
      const raw = mm[1]
        .replace(/^(?:看看|逛逛|去|到|一趟|一下)\s*/g, '')
        .replace(/(?:吧|呀|呢|哦|一趟|一下|看看)$/g, '')
        .trim();
      if (!raw) continue;
      raw.split(/[和与及、]/).forEach(name => {
        const s = name.trim();
        if (s && out.mustVisit.indexOf(s) < 0) out.mustVisit.push(s);
      });
      signals.mustVisit = mm[0];
    }

    // ---- 避开：具体地点名优先，其次类别 ----
    clauses.forEach(clause => {
      if (!NEGATION_RE.test(clause)) return;
      const cleaned = clause.replace(NEGATION_RE, '').replace(/[吧呀呢哦]+$/g, '').trim();
      const place = cleaned.length >= 3 ? findPlaceByText(cleaned, out.city || fallbackCity || null) : null;
      if (place && cleaned.indexOf(place.name) >= 0) {
        if (out.avoid.indexOf(place.id) < 0) out.avoid.push(place.id);
        signals.avoid = clause;
        return;
      }
      if (place && cleaned.length >= 3 && place.name.indexOf(cleaned) >= 0) {
        if (out.avoid.indexOf(place.id) < 0) out.avoid.push(place.id);
        signals.avoid = clause;
        return;
      }
      const category = findCategoryInText(cleaned);
      if (category) {
        if (out.avoid.indexOf(category.cat) < 0) out.avoid.push(category.cat);
        signals.avoid = clause;
        return;
      }
      if (/人多|拥挤|排队/.test(clause) && out.avoid.indexOf('crowded') < 0) out.avoid.push('crowded');
    });

    // ---- 节奏 / 步行强度 ----
    if (/轻松|慢一点|慢逛|悠闲|不赶时间|松弛|慢慢走/.test(t)) {
      out.pace = 'light';
      signals.pace = 'light';
    }
    if (/深度|暴走|多逛|多安排|走遍|尽量多/.test(t)) {
      out.pace = 'deep';
      signals.pace = 'deep';
    }
    if (/少走|走不动|腿疼|腿脚|不想走|别走太远|步行少|近一点/.test(t)) {
      out.walkingTolerance = 'light';
      signals.walkingTolerance = 'light';
    } else if (/能走|多走|走得多|不怕走/.test(t)) {
      out.walkingTolerance = 'deep';
      signals.walkingTolerance = 'deep';
    }

    // ---- 同行人 ----
    if (/孩子|亲子|带娃|宝宝|父母|老人|一家/.test(t)) {
      out.party = 'family';
      signals.party = 'family';
    } else if (/情侣|对象|约会|二人世界|两个人|两人|二人/.test(t)) {
      out.party = 'couple';
      signals.party = 'couple';
    } else if (/朋友|同学|同事|结伴|一群人/.test(t)) {
      out.party = 'friends';
      signals.party = 'friends';
    } else if (/一个人|独自|自己|单人/.test(t)) {
      out.party = 'solo';
      signals.party = 'solo';
    }

    // ---- 天气 ----
    if (/下雨|雨天|下着雨|阴雨/.test(t)) {
      out.weather = 'rain';
      signals.weather = 'rain';
    } else if (/太热|很热|晒|防晒/.test(t)) {
      out.weather = 'hot';
      signals.weather = 'hot';
    } else if (/怕冷|太冷|降温/.test(t)) {
      out.weather = 'cold';
      signals.weather = 'cold';
    } else if (/晴天|天气好/.test(t)) {
      out.weather = 'sunny';
      signals.weather = 'sunny';
    }

    // ---- 无障碍 ----
    const accessMap = [
      { re: /轮椅/, value: 'wheelchair' },
      { re: /婴儿车|推车/, value: 'stroller' },
      { re: /无障碍|少台阶|不要台阶/, value: 'step_free' },
      { re: /电梯/, value: 'elevator' }
    ];
    accessMap.forEach(item => {
      if (item.re.test(t) && out.accessibility.indexOf(item.value) < 0) {
        out.accessibility.push(item.value);
        signals.accessibility = item.value;
      }
    });

    // ---- 餐饮偏好（只作记录与提示，不伪造菜单）----
    const foodMap = [
      { re: /素食|吃素/, value: '素食' },
      { re: /不吃辣|不要辣|微辣/, value: '不吃辣' },
      { re: /清真/, value: '清真' },
      { re: /本地菜|本地小吃/, value: '本地菜' }
    ];
    foodMap.forEach(item => {
      if (item.re.test(t) && out.foodPreferences.indexOf(item.value) < 0) {
        out.foodPreferences.push(item.value);
        signals.food = item.value;
      }
    });

    // ---- 起点 ----
    const fromMatch = t.match(/从\s*([^\s，,。；;]{2,12}?)\s*(?:出发|开始)/);
    if (fromMatch) {
      out.startLocation = fromMatch[1];
      signals.startLocation = fromMatch[0];
    }

    if (!signals.raw) signals.raw = t.slice(0, 200);
    return out;
  }

  /* =====================================================================
   * 3. 地理与时间计算
   * ===================================================================== */

  function haversineKm(a, b) {
    if (isRealCoord(a) && isRealCoord(b)) {
      const R = 6371;
      const toRad = deg => (deg * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    const ax = isNum(a && a.mapX) ? a.mapX : null;
    const ay = isNum(a && a.mapY) ? a.mapY : null;
    const bx = isNum(b && b.mapX) ? b.mapX : null;
    const by = isNum(b && b.mapY) ? b.mapY : null;
    if (ax == null || ay == null || bx == null || by == null) return 0;
    const dx = (bx - ax) * MAP_UNIT_M;
    const dy = (by - ay) * MAP_UNIT_M;
    return Math.sqrt(dx * dx + dy * dy) / 1000;
  }

  function walkMinutesFromKm(km) {
    if (!isNum(km) || km <= 0) return 0;
    return Math.max(1, Math.round((km / WALK_KMH) * 60));
  }

  /**
   * 路线相邻两点的估算距离（km）。
   * 有真实坐标：haversine × 1.25；否则用示意坐标 × 8m（不乘 1.25，因为示意坐标本身即估算）。
   */
  function legDistanceKm(a, b) {
    if (isRealCoord(a) && isRealCoord(b)) return haversineKm(a, b) * REAL_ROUTE_FACTOR;
    return haversineKm(a, b);
  }

  function pathDistanceKm(places) {
    let total = 0;
    for (let i = 1; i < places.length; i += 1) total += legDistanceKm(places[i - 1], places[i]);
    return total;
  }

  function estimateStayMin(place, cond, stayDeltaMin) {
    const base = isNum(place.stay) ? place.stay : 30;
    let stay = Math.round(base * stayFactor(cond.pace)) + (isNum(stayDeltaMin) ? stayDeltaMin : 0);
    stay = clamp(stay, MIN_STAY_MIN, 240);
    return stay;
  }

  function computeSegments(cond, places, stayDeltaMin) {
    const start = S.timeToMin(cond.startTime);
    let cursor = start == null ? 14 * 60 : start;
    const segments = [];
    let stayTotal = 0;
    let walkTotal = 0;
    let distanceTotal = 0;
    places.forEach((p, i) => {
      const stay = estimateStayMin(p, cond, stayDeltaMin);
      let walk = 0;
      let distance = 0;
      if (i > 0) {
        distance = legDistanceKm(places[i - 1], p);
        walk = walkMinutesFromKm(distance);
      }
      const arrive = cursor + walk;
      const depart = arrive + stay;
      segments.push({
        placeId: p.id,
        stayMin: stay,
        walkFromPrevMin: walk,
        distanceFromPrevKm: round(distance, 2),
        arriveAt: minutesToHHMM(arrive),
        departAt: minutesToHHMM(depart),
        indoor: p.indoor == null ? null : !!p.indoor
      });
      stayTotal += stay;
      walkTotal += walk;
      distanceTotal += distance;
      cursor = depart;
    });
    return {
      segments,
      stayTotalMin: stayTotal,
      walkTotalMin: walkTotal,
      actualMin: stayTotal + walkTotal,
      distanceKm: round(distanceTotal, 2)
    };
  }

  function computeBudget(cond, places) {
    const m = partyMultiplier(cond.party);
    const lo = places.reduce((s, p) => s + (isNum(p.cost && p.cost[0]) ? p.cost[0] : 0), 0);
    const hi = places.reduce((s, p) => s + (isNum(p.cost && p.cost[1]) ? p.cost[1] : 0), 0);
    return {
      min: Math.round(lo * m),
      max: Math.round(hi * m),
      currency: 'CNY',
      basis: cond.budgetBasis,
      partyMultiplier: m
    };
  }

  /** 预算上限的“合计”口径：per_person 时乘以同行人数。 */
  function effectiveBudgetCap(cond) {
    if (cond.budgetMax == null) return null;
    const m = partyMultiplier(cond.party);
    return cond.budgetBasis === 'per_person' ? cond.budgetMax * m : cond.budgetMax;
  }

  /* =====================================================================
   * 4. 候选与排序
   * ===================================================================== */

  function isAvoided(place, cond) {
    const avoid = cond.avoid || [];
    for (let i = 0; i < avoid.length; i += 1) {
      const token = String(avoid[i] || '').trim();
      if (!token) continue;
      if (token === place.id || token === place.cat) return true;
      if (place.name === token || place.name.indexOf(token) >= 0) return true;
    }
    return false;
  }

  function findPlaceByToken(token, pool) {
    const t = String(token || '').trim();
    if (!t) return null;
    for (let i = 0; i < pool.length; i += 1) if (pool[i].id === t) return pool[i];
    for (let i = 0; i < pool.length; i += 1) if (pool[i].name === t) return pool[i];
    let best = null;
    for (let i = 0; i < pool.length; i += 1) {
      const p = pool[i];
      if (p.name.indexOf(t) >= 0 || t.indexOf(p.name) >= 0) {
        if (!best || p.name.length < best.name.length) best = p;
      }
    }
    return best;
  }

  function avoidTokenMatchesCategory(token) {
    for (let i = 0; i < CATEGORY_PATTERNS.length; i += 1) {
      if (CATEGORY_PATTERNS[i].cat === token || CATEGORY_PATTERNS[i].interest === token) return true;
    }
    return false;
  }

  /** 必去 token → 地点；返回 {resolved:[Place], entries:[{token,placeId,state}]}。
   *  state: included 由调用方在 analyzeMustVisit 里结合 places 再判定；
   *  这里只标注 unmatched / avoided / resolved。 */
  function resolveMustVisit(cond) {
    const pool = D.placesOfCity(cond.city);
    const tokens = cond.mustVisit || [];
    const resolved = [];
    const seen = {};
    const entries = [];
    tokens.forEach(token => {
      const place = findPlaceByToken(token, pool);
      if (!place) {
        entries.push({ token, placeId: null, state: 'unmatched' });
        return;
      }
      if (isAvoided(place, cond)) {
        entries.push({ token, placeId: place.id, state: 'avoided' });
        return;
      }
      entries.push({ token, placeId: place.id, state: 'resolved' });
      if (!seen[place.id]) {
        seen[place.id] = true;
        resolved.push(place);
      }
    });
    return { resolved, entries };
  }

  function analyzeMustVisit(cond, places) {
    const base = resolveMustVisit(cond);
    const used = {};
    (places || []).forEach(p => { used[p.id] = true; });
    const entries = base.entries.map(e => {
      if (e.state !== 'resolved') return e;
      return { token: e.token, placeId: e.placeId, state: used[e.placeId] ? 'included' : 'missing' };
    });
    return { entries, resolved: base.resolved };
  }

  function scorePlace(p, cond) {
    let score = 0;
    const interests = cond.interests || [];
    interests.forEach(id => {
      if ((p.interests || []).indexOf(id) >= 0) score += 5;
      const it = D.interest(id);
      if (it && (it.cats || []).indexOf(p.cat) >= 0) score += 1;
    });
    if (!interests.length) score += 1;
    if (cond.pace === 'light' && p.cat === 'park') score += 1;
    if (cond.pace === 'deep' && p.cat !== 'park') score += 1;
    if (cond.weather === 'rain') {
      if (p.indoor === true) score += 2;
      else if (p.indoor === false) score -= 1;
    }
    if (cond.party === 'family' && p.indoor === true) score += 1;
    if (cond.party === 'couple' && (p.cat === 'cafe' || p.cat === 'photo' || p.cat === 'park')) score += 1;
    if (cond.party === 'solo' && (p.cat === 'cafe' || p.cat === 'book')) score += 1;
    if (cond.party === 'friends' && (p.cat === 'food' || p.cat === 'street')) score += 1;
    const cap = effectiveBudgetCap(cond);
    if (cap != null && p.cost && p.cost[1] > 0 && p.cost[1] * partyMultiplier(cond.party) > cap * 0.5) score -= 1;
    return score;
  }

  function sweepKey(p) {
    return (p.mapY || 0) + (p.mapX || 0) * 0.35;
  }

  function compareCandidates(a, b, cond) {
    const sa = scorePlace(a, cond);
    const sb = scorePlace(b, cond);
    if (sa !== sb) return sb - sa;
    const ka = sweepKey(a);
    const kb = sweepKey(b);
    if (ka !== kb) return ka - kb;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  /**
   * 按地理走向扫掠：在若干固定方向上投影排序，取总距离最短的一种。
   * 仍是 mapX/mapY 的扫掠，不引入随机。
   */
  function optimizeOrder(places) {
    if (!places || places.length <= 2) return (places || []).slice();
    let best = null;
    let bestLen = Infinity;
    SWEEP_ANGLES.forEach(deg => {
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const ordered = places.slice().sort((a, b) => {
        const pa = (a.mapX || 0) * cos + (a.mapY || 0) * sin;
        const pb = (b.mapX || 0) * cos + (b.mapY || 0) * sin;
        if (pa !== pb) return pa - pb;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
      const len = pathDistanceKm(ordered);
      if (len < bestLen - 1e-9) {
        best = ordered;
        bestLen = len;
      }
    });
    return best || places.slice();
  }

  function targetPlaceCount(cond) {
    const pace = D.PACES.find(p => p.id === cond.pace) || D.PACES[1];
    const factor = pace && isNum(pace.placeBudget) ? pace.placeBudget : 1;
    const n = Math.round((cond.durationMin / 60) * 1.4 * factor);
    return clamp(n, 1, MAX_PLACES);
  }

  /** 最近邻重排，首尾锁定（keep_ends / walk_less 使用）。 */
  function reorderMiddleNearest(places) {
    if (!places || places.length <= 2) return (places || []).slice();
    const first = places[0];
    const last = places[places.length - 1];
    const remaining = places.slice(1, -1);
    const result = [first];
    let cursor = first;
    while (remaining.length) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i += 1) {
        const d = legDistanceKm(cursor, remaining[i]);
        if (d < bestDist - 1e-9 || (Math.abs(d - bestDist) <= 1e-9 && remaining[i].id < remaining[bestIdx].id)) {
          bestDist = d;
          bestIdx = i;
        }
      }
      cursor = remaining[bestIdx];
      result.push(cursor);
      remaining.splice(bestIdx, 1);
    }
    result.push(last);
    return result;
  }

  /* =====================================================================
   * 5. 约束与冲突
   * ===================================================================== */

  function makeMustConflict(cond, places, entries) {
    const bad = entries.filter(e => e.state !== 'included');
    if (!bad.length) return null;
    const tokens = [];
    bad.forEach(e => { if (tokens.indexOf(e.token) < 0) tokens.push(e.token); });
    const reasons = bad.map(e => {
      const label = e.token;
      if (e.state === 'unmatched') return '「' + label + '」在示例地点库里找不到';
      if (e.state === 'avoided') return '「' + label + '」与避开条件冲突';
      return '「' + label + '」未能纳入路线（可能超出时间、步行或 8 个地点上限）';
    });
    const options = [{
      id: 'remove_must_visit',
      label: '不安排这些必去点：' + tokens.join('、'),
      action: { op: 'remove_must_visit', tokens }
    }];

    // 给第一个未满足项一个替代点：优先同城市、未被避开、尚未在路线里、分数最高者。
    const used = {};
    places.forEach(p => { used[p.id] = true; });
    const pool = D.placesOfCity(cond.city);
    let replacement = null;
    for (let i = 0; i < pool.length; i += 1) {
      const p = pool[i];
      if (used[p.id] || isAvoided(p, cond)) continue;
      if (!replacement || scorePlace(p, cond) > scorePlace(replacement, cond) ||
        (scorePlace(p, cond) === scorePlace(replacement, cond) && p.id < replacement.id)) {
        replacement = p;
      }
    }
    if (replacement) {
      options.push({
        id: 'replace_must_visit',
        label: '用「' + replacement.name + '」替代「' + bad[0].token + '」',
        action: { op: 'replace_must_visit', token: bad[0].token, toPlaceId: replacement.id }
      });
    }

    return {
      type: 'must_visit',
      title: '必去地点无法全部满足',
      detail: reasons.join('；') + '。未静默丢弃，请选择处理方式。',
      options
    };
  }

  function pickWorstSavedIndex(places, cond, exclude) {
    let worst = -1;
    let worstSaving = -Infinity;
    for (let i = 0; i < places.length; i += 1) {
      if (places.length <= 1) break;
      if (exclude && exclude[i]) continue;
      if (isAvoided(places[i], cond)) continue;
      const prev = i > 0 ? places[i - 1] : null;
      const next = i < places.length - 1 ? places[i + 1] : null;
      const before = (prev ? legDistanceKm(prev, places[i]) : 0) + (next ? legDistanceKm(places[i], next) : 0);
      const after = prev && next ? legDistanceKm(prev, next) : 0;
      const saving = before - after;
      if (saving > worstSaving + 1e-9 || (Math.abs(saving - worstSaving) <= 1e-9 && i > worst)) {
        worst = i;
        worstSaving = saving;
      }
    }
    return worst;
  }

  /** 只在中段（不含首尾）寻找绕路最大的一站；walk_less 保留首尾使用。 */
  function pickWorstMiddleIndex(places, cond, exclude) {
    let worst = -1;
    let worstSaving = -Infinity;
    for (let i = 1; i < places.length - 1; i += 1) {
      if (exclude && exclude[i]) continue;
      if (isAvoided(places[i], cond)) continue;
      const before = legDistanceKm(places[i - 1], places[i]) + legDistanceKm(places[i], places[i + 1]);
      const after = legDistanceKm(places[i - 1], places[i + 1]);
      const saving = before - after;
      if (saving > worstSaving + 1e-9 || (Math.abs(saving - worstSaving) <= 1e-9 && i > worst)) {
        worst = i;
        worstSaving = saving;
      }
    }
    return worst;
  }

  function removableMask(cond, places) {
    const { resolved } = resolveMustVisit(cond);
    const must = {};
    resolved.forEach(p => { must[p.id] = true; });
    return places.map(p => !!must[p.id]);
  }

  function makeTimeConflict(cond, route) {
    const extendedRaw = Math.max(cond.durationMin + 15, Math.ceil(route.actualMin / 5) * 5);
    const extended = clamp(extendedRaw, S.LIMITS.durationMin[0], S.LIMITS.durationMin[1]);
    const last = route.places.length ? D.place(route.places[route.places.length - 1]) : null;
    return {
      type: 'time',
      title: '时间预算不足',
      detail: '按当前安排约需 ' + formatDuration(route.actualMin) + '，超出你给的 ' +
        formatDuration(cond.durationMin) + '（含 5% 缓冲的上限为 ' +
        formatDuration(Math.round(cond.durationMin * 1.05)) + '）。',
      options: [
        {
          id: 'extend_time',
          label: '把可用时间延长到 ' + formatDuration(extended),
          action: { op: 'extend_time', value: extended }
        },
        {
          id: 'drop_last',
          label: last ? '去掉最后一站「' + last.name + '」' : '去掉最后一站',
          action: { op: 'drop_last' }
        },
        {
          id: 'shorten_stay',
          label: '每站停留缩短 15 分钟',
          action: { op: 'shorten_stay', minutes: 15 }
        }
      ]
    };
  }

  function makeBudgetConflict(cond, route, places) {
    const m = partyMultiplier(cond.party);
    const reqCond = cond.budgetBasis === 'per_person'
      ? Math.ceil(route.budget.max / m)
      : route.budget.max;
    const raise = clamp(reqCond, 0, S.LIMITS.budgetMax[1]);
    const mask = removableMask(cond, places);
    let dropIdx = -1;
    let dropCost = -1;
    places.forEach((p, i) => {
      if (mask[i]) return;
      const cost = isNum(p.cost && p.cost[1]) ? p.cost[1] : 0;
      if (cost > dropCost + 1e-9 || (Math.abs(cost - dropCost) <= 1e-9 && i > dropIdx)) {
        dropIdx = i;
        dropCost = cost;
      }
    });
    const options = [{
      id: 'raise_budget',
      label: '把预算上限提高到 ' + formatMoney(cond.budgetBasis === 'per_person' ? raise : raise) +
        (cond.budgetBasis === 'per_person' ? '/人' : ''),
      action: { op: 'raise_budget', value: raise }
    }];
    if (dropIdx >= 0) {
      options.push({
        id: 'drop_expensive',
        label: '去掉花费最高的一站「' + places[dropIdx].name + '」',
        action: { op: 'drop_expensive' }
      });
    } else if ((cond.mustVisit || []).length) {
      options.push({
        id: 'remove_must_visit',
        label: '取消必去点限制，优先控制预算',
        action: { op: 'remove_must_visit', tokens: (cond.mustVisit || []).slice() }
      });
    }
    return {
      type: 'budget',
      title: '预算可能超出',
      detail: '按示例消费区间估算，全程约 ' + formatMoney(route.budget.min) + '–' +
        formatMoney(route.budget.max) +
        (cond.budgetBasis === 'per_person' ? '（' + m + ' 人合计，预算是人均 ' + formatMoney(cond.budgetMax) + '）' : '') +
        '，高于设定上限 ' + formatMoney(effectiveBudgetCap(cond)) + '（合计）。',
      options
    };
  }

  function findRelaxTolerance(distanceKm, current) {
    const order = ['light', 'mid', 'deep'];
    const start = order.indexOf(current) >= 0 ? order.indexOf(current) : 1;
    for (let i = Math.max(0, start); i < order.length; i += 1) {
      if (distanceKm <= WALKING_LIMITS[order[i]] + 1e-9) return order[i];
    }
    return null;
  }

  function makeWalkingConflict(cond, route, places) {
    const limit = walkingLimit(cond);
    const options = [];
    const relaxed = findRelaxTolerance(route.distanceKm, cond.walkingTolerance);
    if (relaxed && relaxed !== cond.walkingTolerance) {
      options.push({
        id: 'relax_walking',
        label: '把步行上限放宽到 ' + WALKING_LIMITS[relaxed] + ' km（' +
          ({ light: '轻松', mid: '适中', deep: '深度' }[relaxed] || relaxed) + '）',
        action: { op: 'relax_walking', value: relaxed }
      });
    }
    const mask = removableMask(cond, places);
    const dropIdx = pickWorstSavedIndex(places, cond, mask);
    if (dropIdx >= 0) {
      options.push({
        id: 'drop_farthest',
        label: '去掉绕路最多的一站「' + places[dropIdx].name + '」',
        action: { op: 'drop_farthest' }
      });
    }
    if (!options.length) {
      options.push({
        id: 'remove_must_visit',
        label: '取消必去点限制，优先减少步行',
        action: { op: 'remove_must_visit', tokens: (cond.mustVisit || []).slice() }
      });
    }
    return {
      type: 'walking',
      title: '步行距离超出上限',
      detail: '当前路线约 ' + route.distanceKm + ' km，步行上限为 ' + limit +
        ' km（' + cond.walkingTolerance + '）。已先尝试移除绕路最大的非必去点。',
      options
    };
  }

  function evaluateConstraints(cond, places, metrics, budget, mustEntries) {
    const constraints = [];
    const timeLimit = cond.durationMin * 1.05;
    const timeStatus = metrics.actualMin <= timeLimit + 1e-9 ? 'met' : 'violated';
    constraints.push({
      id: 'time',
      label: '时长上限',
      kind: 'hard',
      status: timeStatus,
      detail: timeStatus === 'met'
        ? '实际安排约 ' + formatDuration(metrics.actualMin) + '，在 ' + formatDuration(cond.durationMin) + ' 预算内（含 5% 缓冲）。'
        : '实际安排约 ' + formatDuration(metrics.actualMin) + '，超过 ' + formatDuration(cond.durationMin) +
          ' 的 5% 缓冲（上限 ' + formatDuration(Math.round(timeLimit)) + '）。',
      actual: metrics.actualMin,
      expected: cond.durationMin
    });

    const limit = walkingLimit(cond);
    const walkStatus = metrics.distanceKm <= limit + 1e-9 ? 'met' : 'violated';
    constraints.push({
      id: 'walking',
      label: '步行上限',
      kind: 'hard',
      status: walkStatus,
      detail: walkStatus === 'met'
        ? '路线约 ' + metrics.distanceKm + ' km，在你选择的 ' + cond.walkingTolerance + ' 强度上限 ' + limit + ' km 内。'
        : '路线约 ' + metrics.distanceKm + ' km，超过 ' + cond.walkingTolerance + ' 强度上限 ' + limit + ' km。',
      actual: metrics.distanceKm,
      expected: limit
    });

    let budgetStatus = null;
    if (cond.budgetMax != null) {
      const cap = effectiveBudgetCap(cond);
      budgetStatus = budget.max <= cap + 1e-9 ? 'met' : 'violated';
      constraints.push({
        id: 'budget',
        label: '预算上限',
        kind: 'hard',
        status: budgetStatus,
        detail: budgetStatus === 'met'
          ? '预计 ' + formatMoney(budget.min) + '–' + formatMoney(budget.max) + '，在预算上限 ' + formatMoney(cap) + '（合计）内。'
          : '预计 ' + formatMoney(budget.min) + '–' + formatMoney(budget.max) + '，超过预算上限 ' + formatMoney(cap) + '（合计）。',
        actual: budget.max,
        expected: cap
      });
    }

    let mustStatus = null;
    if ((cond.mustVisit || []).length) {
      mustStatus = mustEntries.every(e => e.state === 'included') ? 'met' : 'violated';
      constraints.push({
        id: 'must_visit',
        label: '必去地点',
        kind: 'hard',
        status: mustStatus,
        detail: mustStatus === 'met'
          ? '要求的必去地点均已纳入路线。'
          : '存在无法满足的必去地点：' + mustEntries.filter(e => e.state !== 'included').map(e => '「' + e.token + '」').join('、') + '。',
        actual: mustEntries.filter(e => e.state === 'included').length,
        expected: mustEntries.length
      });
    }

    if ((cond.avoid || []).length) {
      const hit = places.filter(p => isAvoided(p, cond));
      constraints.push({
        id: 'avoid',
        label: '避开条件',
        kind: 'hard',
        status: hit.length ? 'violated' : 'met',
        detail: hit.length ? '路线仍包含被避开的地点：' + hit.map(p => p.name).join('、') + '。' : '路线未包含避开的地点或类别。',
        actual: hit.length,
        expected: 0
      });
    }

    if ((cond.accessibility || []).length) {
      const unknownNames = [];
      const unmetNames = [];
      places.forEach(p => {
        const features = Array.isArray(p.accessibility) ? p.accessibility : null;
        if (!features) { unknownNames.push(p.name); return; }
        const all = cond.accessibility.every(f => features.indexOf(f) >= 0);
        if (!all) unmetNames.push(p.name);
      });
      let accessStatus = 'met';
      if (unknownNames.length) accessStatus = 'unknown';
      else if (unmetNames.length) accessStatus = 'partial';
      const detail = accessStatus === 'unknown'
        ? '已记录无障碍需求（' + cond.accessibility.join('、') + '）。' + unknownNames.join('、') +
          ' 的无障碍信息未验证，不能保证满足。'
        : accessStatus === 'partial'
          ? '部分地点未确认满足无障碍需求：' + unmetNames.join('、') + '。'
          : '所选地点的无障碍信息已记录满足需求。';
      constraints.push({
        id: 'accessibility',
        label: '无障碍需求',
        kind: 'hard',
        status: accessStatus,
        detail,
        actual: accessStatus,
        expected: 'met'
      });
    }

    let weatherStatus = null;
    if (cond.weather === 'rain') {
      const indoor = places.filter(p => p.indoor === true).length;
      weatherStatus = places.length && indoor === places.length ? 'met' : 'partial';
      constraints.push({
        id: 'weather',
        label: '雨天室内偏好',
        kind: 'soft',
        status: weatherStatus,
        detail: weatherStatus === 'met'
          ? '所选地点均为室内或半室内，下雨时更从容。'
          : '路线中有 ' + (places.length - indoor) + ' 个室外/室内未知地点；下雨时建议自备雨具或替换室内点。',
        actual: indoor,
        expected: places.length
      });
    }

    // 多样性：软约束，只允许 met/partial（不得标 violated）。
    const counts = {};
    places.forEach(p => { counts[p.cat] = (counts[p.cat] || 0) + 1; });
    let dominant = 0;
    Object.keys(counts).forEach(k => { if (counts[k] > dominant) dominant = counts[k]; });
    const share = places.length ? dominant / places.length : 0;
    const diversityStatus = places.length <= 1 || share < 0.5 ? 'met' : 'partial';
    constraints.push({
      id: 'diversity',
      label: '地点多样性',
      kind: 'soft',
      status: diversityStatus,
      detail: diversityStatus === 'met'
        ? '地点类别分布较均衡。'
        : '同类地点占比约 ' + Math.round(share * 100) + '%，已尽量保留多样性。',
      actual: round(share, 2),
      expected: 0.5
    });

    let conflict = null;
    if (mustStatus === 'violated') conflict = makeMustConflict(cond, places, mustEntries);
    else if (timeStatus === 'violated') {
      conflict = makeTimeConflict(cond, { actualMin: metrics.actualMin, places: places.map(p => p.id) });
    } else if (budgetStatus === 'violated') {
      conflict = makeBudgetConflict(cond, { budget: budget }, places);
    } else if (walkStatus === 'violated') conflict = makeWalkingConflict(cond, {
      distanceKm: metrics.distanceKm,
      actualMin: metrics.actualMin,
      places: places.map(p => p.id)
    }, places);

    return { constraints, conflict };
  }

  /* =====================================================================
   * 6. 评分、解释、来源、数据质量
   * ===================================================================== */

  function computeScores(cond, places, metrics, budget) {
    let interest;
    if (!places.length) interest = 0;
    else if (!(cond.interests || []).length) interest = 0.6;
    else {
      let sum = 0;
      places.forEach(p => {
        const hits = cond.interests.filter(id => (p.interests || []).indexOf(id) >= 0).length;
        sum += Math.min(1, hits / cond.interests.length);
      });
      interest = sum / places.length;
    }

    const duration = cond.durationMin > 0 ? cond.durationMin : 1;
    const ratio = metrics.actualMin / duration;
    let timeFit;
    if (ratio <= 1) timeFit = 0.7 + 0.3 * ratio;
    else if (ratio <= 1.05) timeFit = 0.75;
    else timeFit = Math.max(0, 0.75 - (ratio - 1.05) * 2);

    const efficiency = metrics.actualMin > 0
      ? clamp(1 - metrics.walkTotalMin / metrics.actualMin, 0, 1)
      : 1;

    let budgetFit = 0.6;
    const cap = effectiveBudgetCap(cond);
    if (cap != null) {
      if (cap <= 0) budgetFit = budget.max <= 0 ? 1 : 0;
      else {
        const r = budget.max / cap;
        budgetFit = r <= 1 ? 0.8 + 0.2 * (1 - r) : Math.max(0, 0.8 - (r - 1) * 1.5);
      }
    }

    let diversity = 1;
    if (places.length > 1) {
      const counts = {};
      places.forEach(p => { counts[p.cat] = (counts[p.cat] || 0) + 1; });
      let dominant = 0;
      Object.keys(counts).forEach(k => { if (counts[k] > dominant) dominant = counts[k]; });
      diversity = clamp(1 - (dominant - 1) / places.length, 0, 1);
    }

    const parts = {
      interest: round(interest, 3),
      timeFit: round(timeFit, 3),
      efficiency: round(efficiency, 3),
      budgetFit: round(budgetFit, 3),
      diversity: round(diversity, 3)
    };
    const overall = round(
      parts.interest * SCORING_WEIGHTS.interest +
      parts.timeFit * SCORING_WEIGHTS.timeFit +
      parts.efficiency * SCORING_WEIGHTS.efficiency +
      parts.budgetFit * SCORING_WEIGHTS.budgetFit +
      parts.diversity * SCORING_WEIGHTS.diversity,
      3
    );
    return {
      overall,
      interest: parts.interest,
      timeFit: parts.timeFit,
      efficiency: parts.efficiency,
      budgetFit: parts.budgetFit,
      diversity: parts.diversity,
      weights: {
        interest: SCORING_WEIGHTS.interest,
        timeFit: SCORING_WEIGHTS.timeFit,
        efficiency: SCORING_WEIGHTS.efficiency,
        budgetFit: SCORING_WEIGHTS.budgetFit,
        diversity: SCORING_WEIGHTS.diversity
      },
      method: METHOD
    };
  }

  function interestNames(place, cond) {
    return (cond.interests || [])
      .filter(id => (place.interests || []).indexOf(id) >= 0)
      .map(id => {
        const it = D.interest(id);
        return it ? it.name : id;
      });
  }

  function explainPlace(placeInput, route, index) {
    const place = typeof placeInput === 'string' ? D.place(placeInput) : placeInput;
    if (!place) return '地点信息缺失。';
    const cond = (route && route.conditions) || defaultConditions();
    const parts = [];
    const hits = interestNames(place, cond);
    if (hits.length) parts.push('匹配你选择的「' + hits.join('、') + '」偏好');
    else parts.push('按整体节奏与顺路程度纳入');

    const i = typeof index === 'number' ? index : -1;
    if (i === 0) parts.push('作为路线起点');
    else if (i > 0 && route && route.segments && route.segments[i]) {
      parts.push('从上一站步行约 ' + route.segments[i].walkFromPrevMin + ' 分钟（估算）');
    }

    if (place.indoor === true) parts.push('属于室内场所，下雨或休息时更从容');
    else if (place.indoor === false) parts.push('是室外点位，适合天气好时前往');
    else parts.push('室内外信息未标注');

    parts.push('建议停留约 ' + estimateStayMin(place, cond, route && route.stayDeltaMin) + ' 分钟');
    return parts.join('，') + '。';
  }

  function evidenceFor(place) {
    if (!place || !place.geoVerified || !place.geoSource) return [];
    const m = String(place.geoSource).match(/^OpenStreetMap\s+(node|way|relation)\/(\d+)$/);
    if (!m) return [];
    return [{
      title: 'OpenStreetMap 坐标',
      url: 'https://www.openstreetmap.org/' + m[1] + '/' + m[2],
      accessedAt: ACCESSED_AT,
      license: 'ODbL 1.0'
    }];
  }

  function makeExplanations(route) {
    return route.places.map((id, i) => {
      const place = D.place(id);
      return {
        placeId: id,
        why: explainPlace(place, route, i),
        evidence: evidenceFor(place)
      };
    });
  }

  function makeSources() {
    return [
      {
        title: 'OpenStreetMap 版权与许可说明',
        url: OSM_COPYRIGHT,
        accessedAt: ACCESSED_AT,
        license: 'ODbL 1.0',
        note: '坐标数据来源与使用条款'
      },
      {
        title: 'CityWalk AI 示例数据说明',
        url: SAMPLE_DATA_URL,
        accessedAt: ACCESSED_AT,
        note: '示例地点、估算时长与费用，非实时 POI 数据'
      }
    ];
  }

  function makeDataQuality(cond, places) {
    const pool = D.placesOfCity(cond.city);
    const hasGeneric = places.some(p => !isRealCoord(p));
    const disclaimer = [
      D.DISCLAIMER.sample,
      D.DISCLAIMER.estimate,
      D.DISCLAIMER.hours,
      D.DISCLAIMER.realMap
    ].concat(hasGeneric ? [D.DISCLAIMER.genericPlace] : []).join(' · ');
    return {
      placesTotal: pool.length,
      placesWithCoords: pool.filter(p => isRealCoord(p)).length,
      placesWithHours: pool.filter(p => p.hours != null).length,
      placesVerified: pool.filter(p => p.geoVerified === true).length,
      disclaimer
    };
  }

  function makeNotes(cond, places, metrics, budget) {
    const notes = [];
    notes.push(D.DISCLAIMER.sample + ' · ' + D.DISCLAIMER.estimate + ' · ' + D.DISCLAIMER.hours);
    const generic = places.filter(p => !isRealCoord(p));
    if (generic.length) {
      notes.push('示例地点，无真实坐标：' + generic.map(p => '「' + p.name + '」').join('、') +
        '；仅参与示意路线，不参与真实地图定位。');
    }
    if (places.some(p => isRealCoord(p))) notes.push(D.GEO_ATTRIBUTION);
    if (partyMultiplier(cond.party) > 1) {
      notes.push('预算按同行 ' + partyMultiplier(cond.party) + ' 人合计估算（' + cond.party +
        ' 人数系数 ' + partyMultiplier(cond.party) + '）；budgetBasis=' + cond.budgetBasis + '。');
    }
    if (cond.weather === 'rain') notes.push('天气偏好为下雨：优先安排室内点，但不做硬过滤，未替换的点位请自备雨具。');
    if (metrics.actualMin > cond.durationMin && metrics.actualMin <= cond.durationMin * 1.05 + 1e-9) {
      notes.push('实际安排约 ' + formatDuration(metrics.actualMin) + '，比预算多 ' +
        formatDuration(metrics.actualMin - cond.durationMin) + '，仍在 5% 缓冲内。');
    }
    if (metrics.actualMin < cond.durationMin * 0.75) {
      notes.push('示例地点库中符合条件的地点有限，实际安排约 ' + formatDuration(metrics.actualMin) +
        '，比预算少 ' + formatDuration(cond.durationMin - metrics.actualMin) + '。');
    }
    return notes;
  }

  function routeStyle(cond, places) {
    const tags = [];
    (cond.interests || []).forEach(id => {
      const it = D.interest(id);
      if (it) tags.push(it.name);
    });
    const pace = D.PACES.find(p => p.id === cond.pace);
    if (pace) tags.push(pace.name);
    if (cond.weather === 'rain') tags.push('雨天室内优先');
    if (cond.party === 'family') tags.push('亲子友好');
    if (places.some(p => p.cat === 'park')) tags.push('含绿地休息');
    if (cond.budgetBasis === 'per_person') tags.push('人均预算');
    if (!tags.length) tags.push('均衡漫步');
    return tags.slice(0, 5);
  }

  function routeName(cond, places) {
    const city = D.city(cond.city);
    const wordMap = { coffee: '咖啡', history: '老城', photo: '建筑', book: '书店', park: '绿道', local: '市井' };
    const key = (cond.interests || [])[0];
    const area = key && wordMap[key] ? wordMap[key] : '城市';
    const paceName = ({ light: '慢节奏漫游', mid: '均衡漫步', deep: '深度探索' })[cond.pace] || '漫步';
    const cityName = city ? city.name : (cond.city || '城市');
    let name = cityName + area + ' · ' + paceName;
    if (name.length > S.LIMITS.routeNameLen) name = name.slice(0, S.LIMITS.routeNameLen);
    return name;
  }

  /* =====================================================================
   * 7. 构建、重算与规划
   * ===================================================================== */

  function timestampValue(opts) {
    if (opts && opts.now != null) {
      const d = new Date(opts.now);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    return new Date().toISOString();
  }

  function makeRouteId(cond, placeIds) {
    return 'r_' + hashString(JSON.stringify({
      city: cond.city,
      durationMin: cond.durationMin,
      startTime: cond.startTime,
      interests: cond.interests,
      pace: cond.pace,
      walkingTolerance: cond.walkingTolerance,
      party: cond.party,
      weather: cond.weather,
      budgetMax: cond.budgetMax,
      budgetBasis: cond.budgetBasis,
      mustVisit: cond.mustVisit,
      avoid: cond.avoid,
      places: placeIds
    }));
  }

  function assembleRoute(cond, places, meta) {
    const m = meta || {};
    const stayDeltaMin = isNum(m.stayDeltaMin) ? m.stayDeltaMin : 0;
    const seg = computeSegments(cond, places, stayDeltaMin);
    const budget = computeBudget(cond, places);
    const metrics = {
      segments: seg.segments,
      stayTotalMin: seg.stayTotalMin,
      walkTotalMin: seg.walkTotalMin,
      actualMin: seg.actualMin,
      distanceKm: seg.distanceKm
    };
    const mustEntries = analyzeMustVisit(cond, places);
    const evaluated = evaluateConstraints(cond, places, metrics, budget, mustEntries.entries);
    const scores = computeScores(cond, places, metrics, budget);
    const placeIds = places.map(p => p.id);
    const route = {
      schemaVersion: S.SCHEMA_VERSION,
      id: m.id || makeRouteId(cond, placeIds),
      city: cond.city,
      name: m.name || routeName(cond, places),
      source: m.source || 'mock',
      createdAt: m.createdAt || timestampValue(m),
      conditions: clone(cond),
      places: placeIds,
      segments: metrics.segments,
      durationMin: cond.durationMin,
      actualMin: metrics.actualMin,
      stayTotalMin: metrics.stayTotalMin,
      walkTotalMin: metrics.walkTotalMin,
      distanceKm: metrics.distanceKm,
      budget,
      style: routeStyle(cond, places),
      scores,
      constraints: evaluated.constraints,
      conflict: evaluated.conflict,
      explanations: [],
      sources: makeSources(),
      notes: makeNotes(cond, places, metrics, budget),
      dataQuality: makeDataQuality(cond, places),
      orderDirty: false,
      stayDeltaMin
    };
    route.explanations = makeExplanations(route);
    if (m.degraded != null) route.degraded = !!m.degraded;
    if (m.degradeReason) route.degradeReason = String(m.degradeReason);
    return route;
  }

  function ensureValidRoute(route, code) {
    const result = S.validateRoute(route);
    if (!result.ok) {
      throw typedError(code || 'CORE_INVALID_ROUTE', '路线未通过 Schema 校验：' + S.formatErrors(result.errors), {
        errors: result.errors
      });
    }
    return route;
  }

  function assertComplete(cond) {
    const comp = checkCompleteness(cond);
    if (!comp.ok) {
      throw typedError('INCOMPLETE_CONDITIONS', '条件不完整：' + comp.missing.map(m => m.label).join('、'), {
        missing: comp.missing,
        questions: comp.questions
      });
    }
    return comp;
  }

  function noCandidates(cond, reason) {
    return typedError('NO_CANDIDATES', '没有可用候选地点：' + reason, {
      city: cond.city,
      suggestions: ['换一个城市（目前南京示例数据完整）', '放宽避开条件', '放宽兴趣或步行限制']
    });
  }

  function isRelevantPlace(p, cond) {
    const interests = cond.interests || [];
    if (!interests.length) return true;
    for (let i = 0; i < interests.length; i += 1) {
      const id = interests[i];
      if ((p.interests || []).indexOf(id) >= 0) return true;
      const it = D.interest(id);
      if (it && (it.cats || []).indexOf(p.cat) >= 0) return true;
    }
    return false;
  }

  /**
   * 从候选池选点（确定性）：
   * 1) 必去点优先纳入（即使超出目标数量也保留，最多 8 个）；
   * 2) 无必去点时以最相关地点为种子；兴趣非空时至少先选 2 个相关地点；
   * 3) 每步对“全部候选”试算完整路线的时长/步行/预算，选综合收益最高的一个：
   *    兴趣分 - 新增步行 - 停留成本 - 预算压力 + 类别多样性 + 室内偏好；
   * 4) 预算上限存在时：已有 2 站后不再接受超预算点；没有可行点时停止（由 conflict 呈现）。
   * 这样 240 分钟 + 预算 150 的场景会得到 3–5 个“便宜且顺路”的点，
   * 而不是按兴趣硬塞 2 个贵点后触发预算冲突。
   */
  function selectPlaces(cond) {
    const pool = D.placesOfCity(cond.city);
    if (!pool.length) throw noCandidates(cond, '城市暂无地点数据');
    const available = pool.filter(p => !isAvoided(p, cond));
    if (!available.length) throw noCandidates(cond, '所有候选都被避开条件排除了');

    const must = resolveMustVisit(cond);
    const picked = [];
    const pickedIds = {};
    must.resolved.slice(0, MAX_PLACES).forEach(p => {
      if (!pickedIds[p.id]) {
        pickedIds[p.id] = true;
        picked.push(p);
      }
    });

    const target = clamp(Math.max(targetPlaceCount(cond), picked.length), 1, MAX_PLACES);
    const cap = effectiveBudgetCap(cond);
    let relevantPicked = picked.filter(p => isRelevantPlace(p, cond)).length;
    const relevantNeeded = (cond.interests || []).length ? Math.min(2, target) : 0;

    // 没有必去点时的种子：兴趣非空 → 最相关且分数最高；否则按默认排序第一名。
    if (!picked.length) {
      const relevantPool = available.filter(p => isRelevantPlace(p, cond));
      const seedPool = relevantPool.length ? relevantPool : available;
      const seed = seedPool.slice().sort((a, b) => compareCandidates(a, b, cond))[0];
      picked.push(seed);
      pickedIds[seed.id] = true;
      if (isRelevantPlace(seed, cond)) relevantPicked += 1;
    }

    let currentOrdered = optimizeOrder(picked);
    let currentSeg = computeSegments(cond, currentOrdered, 0);
    let guard = 0;
    while (picked.length < target && guard < 24) {
      guard += 1;
      let best = null;
      let bestUtility = -Infinity;
      for (let i = 0; i < available.length; i += 1) {
        const p = available[i];
        if (pickedIds[p.id]) continue;
        // 兴趣非空时先保证至少 2 个相关地点，避免为了便宜选一堆无关点。
        if (relevantNeeded && relevantPicked < relevantNeeded && !isRelevantPlace(p, cond)) continue;

        const trial = picked.concat([p]);
        const ordered = optimizeOrder(trial);
        const seg = computeSegments(cond, ordered, 0);
        if (seg.actualMin > cond.durationMin * 1.0 + 1e-9) continue;
        if (seg.distanceKm > walkingLimit(cond) + 1e-9) continue;
        const budget = computeBudget(cond, ordered);
        if (cap != null && budget.max > cap + 1e-9 && picked.length >= 2) continue;

        const addedWalk = seg.walkTotalMin - currentSeg.walkTotalMin;
        const stay = estimateStayMin(p, cond, 0);
        const score = scorePlace(p, cond);
        let utility = score * 10;
        utility -= Math.max(0, addedWalk) * 1.2;
        utility -= stay * 0.25;
        if (cap != null) {
          const ratio = budget.max / Math.max(1, cap);
          utility -= ratio * ratio * 35;
          if (budget.max > cap + 1e-9) utility -= 60;
        }
        let nearest = Infinity;
        picked.forEach(q => {
          const d = legDistanceKm(p, q);
          if (d < nearest) nearest = d;
        });
        if (isFinite(nearest)) utility -= nearest * 1.5;
        if (!picked.some(q => q.cat === p.cat)) utility += 4;
        if (cond.weather === 'rain' && p.indoor === true) utility += 5;

        if (utility > bestUtility + 1e-9) {
          bestUtility = utility;
          best = p;
        } else if (Math.abs(utility - bestUtility) <= 1e-9 && best) {
          const cmp = compareCandidates(p, best, cond);
          if (cmp < 0) best = p;
        }
      }
      if (!best) break;
      picked.push(best);
      pickedIds[best.id] = true;
      if (isRelevantPlace(best, cond)) relevantPicked += 1;
      currentOrdered = optimizeOrder(picked);
      currentSeg = computeSegments(cond, currentOrdered, 0);
    }

    if (!picked.length) {
      const fallback = available.slice().sort((a, b) => compareCandidates(a, b, cond))[0];
      picked.push(fallback);
    }
    return optimizeOrder(picked);
  }

  function estimateTotalMinutes(cond, places) {
    if (!places.length) return 0;
    const ordered = optimizeOrder(places);
    let total = 0;
    ordered.forEach((p, i) => {
      total += estimateStayMin(p, cond, 0);
      if (i > 0) total += walkMinutesFromKm(legDistanceKm(ordered[i - 1], p));
    });
    return total;
  }

  /**
   * 计划阶段的自动收尾：若时长超 5% 或步行超上限，
   * 先移除“绕路最大/末尾”的非必去点，直到满足或只剩 1 个点。
   * 仍不满足时返回 conflict（不静默放宽）。
   */
  function trimRoute(cond, places, meta) {
    let current = places.slice();
    let route = assembleRoute(cond, current, meta);
    for (let guard = 0; guard < 16; guard += 1) {
      const overTime = route.actualMin > cond.durationMin * 1.05 + 1e-9;
      const overWalk = route.distanceKm > walkingLimit(cond) + 1e-9;
      if (!overTime && !overWalk) break;
      if (current.length <= 1) break;
      const mask = removableMask(cond, current);
      let idx = -1;
      if (overTime) idx = pickWorstSavedIndex(current, cond, mask);
      if (idx < 0 && overWalk) idx = pickWorstSavedIndex(current, cond, mask);
      if (idx < 0) break;
      current.splice(idx, 1);
      current = optimizeOrder(current);
      route = assembleRoute(cond, current, meta);
    }
    return route;
  }

  function dominantCategory(places) {
    const counts = {};
    places.forEach(p => { counts[p.cat] = (counts[p.cat] || 0) + 1; });
    let bestCat = null;
    let bestCount = 0;
    Object.keys(counts).sort().forEach(cat => {
      if (counts[cat] > bestCount) {
        bestCount = counts[cat];
        bestCat = cat;
      }
    });
    return { cat: bestCat, count: bestCount, share: places.length ? bestCount / places.length : 0 };
  }

  /** 同类占比过高时替换一个低分点，且替换后仍满足时长/步行。 */
  function applyDiversity(cond, places) {
    if (places.length < 3) return { places, replaced: null };
    const dom = dominantCategory(places);
    if (!dom.cat || dom.share < 0.6) return { places, replaced: null };
    const mask = removableMask(cond, places);
    let idx = -1;
    let idxScore = Infinity;
    places.forEach((p, i) => {
      if (p.cat !== dom.cat || mask[i]) return;
      const s = scorePlace(p, cond);
      if (s < idxScore - 1e-9 || (Math.abs(s - idxScore) <= 1e-9 && i > idx)) {
        idx = i;
        idxScore = s;
      }
    });
    if (idx < 0) return { places, replaced: null };

    const used = {};
    places.forEach(p => { used[p.id] = true; });
    const candidates = D.placesOfCity(cond.city)
      .filter(p => !used[p.id] && !isAvoided(p, cond) && p.cat !== dom.cat)
      .sort((a, b) => compareCandidates(a, b, cond));
    for (let i = 0; i < candidates.length; i += 1) {
      const trial = places.slice();
      trial[idx] = candidates[i];
      const ordered = optimizeOrder(trial);
      const seg = computeSegments(cond, ordered, 0);
      if (seg.actualMin <= cond.durationMin * 1.05 + 1e-9 && seg.distanceKm <= walkingLimit(cond) + 1e-9) {
        return { places: ordered, replaced: { from: places[idx], to: candidates[i] } };
      }
    }
    return { places, replaced: null };
  }

  function plan(input, opts) {
    const options = opts || {};
    const cond = prepareConditions(input);
    assertComplete(cond);
    let places = selectPlaces(cond);
    const identity = {
      id: options.id || makeRouteId(cond, places.map(p => p.id)),
      createdAt: timestampValue(options),
      source: options.source || 'mock',
      stayDeltaMin: 0
    };
    // 先按最终顺序做一次收尾（自动移除超限的非必去点）
    let route = trimRoute(cond, places, identity);
    // 多样性：同类占比过高时替换一个低分点
    const div = applyDiversity(cond, D.places(route.places));
    if (div.replaced) {
      places = div.places;
      route = assembleRoute(cond, places, {
        id: identity.id,
        createdAt: identity.createdAt,
        source: identity.source,
        stayDeltaMin: 0
      });
      // 替换后再次收尾，确保硬约束尽量满足
      route = trimRoute(cond, D.places(route.places), {
        id: identity.id,
        createdAt: identity.createdAt,
        source: identity.source,
        stayDeltaMin: 0
      });
    }
    route.name = routeName(cond, D.places(route.places));
    route.explanations = makeExplanations(route);
    ensureValidRoute(route, 'CORE_INVALID_ROUTE');
    return route;
  }

  /**
   * 由显式地点序列构建路线（保留给定顺序，用于精选路线 / 测试 / 服务端重算）。
   * 不自动删点；硬约束违反时返回 conflict，由调用方展示选项。
   */
  function buildRoute(input, placeIds, meta) {
    const m = meta || {};
    const cond = prepareConditions(input, m.durationMin);
    assertComplete(cond);
    const rawIds = Array.isArray(placeIds) ? placeIds : [];
    const seen = {};
    const places = [];
    rawIds.forEach(id => {
      if (typeof id !== 'string' || seen[id]) return;
      const p = D.place(id);
      if (!p || p.city !== cond.city) return;
      if (isAvoided(p, cond)) return;
      seen[id] = true;
      places.push(p);
    });
    if (!places.length) throw noCandidates(cond, '给定的地点 id 全部无效或被避开');
    if (places.length > MAX_PLACES) places.length = MAX_PLACES;

    const identity = {
      id: m.id || makeRouteId(cond, places.map(p => p.id)),
      createdAt: m.createdAt || timestampValue(m),
      source: m.source || 'mock',
      name: m.name,
      stayDeltaMin: isNum(m.stayDeltaMin) ? m.stayDeltaMin : 0,
      degraded: m.degraded,
      degradeReason: m.degradeReason
    };
    const route = assembleRoute(cond, places, identity);
    ensureValidRoute(route, 'CORE_INVALID_ROUTE');
    return route;
  }

  /**
   * 重算路线：segments / 时长 / 预算 / 评分 / 约束。
   * 保留 id / conditions / createdAt / name / source；返回新对象，不修改入参。
   */
  function recompute(route) {
    if (!route || typeof route !== 'object' || !Array.isArray(route.places)) {
      throw typedError('INVALID_ROUTE', 'recompute 需要合法的 Route 对象');
    }
    const cond = prepareConditions(route.conditions, route.durationMin);
    assertComplete(cond);
    const places = [];
    route.places.forEach(id => {
      const p = D.place(id);
      if (p) places.push(p);
    });
    if (!places.length) throw noCandidates(cond, '路线中的地点 id 全部无效');
    const next = assembleRoute(cond, places.slice(0, MAX_PLACES), {
      id: route.id,
      name: route.name,
      createdAt: route.createdAt,
      source: route.source,
      stayDeltaMin: isNum(route.stayDeltaMin) ? route.stayDeltaMin : 0,
      degraded: route.degraded,
      degradeReason: route.degradeReason
    });
    ensureValidRoute(next, 'CORE_INVALID_ROUTE');
    return next;
  }

  function applyOrder(route, placeIds) {
    if (!route || !Array.isArray(route.places)) {
      throw typedError('INVALID_ROUTE', 'applyOrder 需要合法的 Route 对象');
    }
    const rank = {};
    const ordered = [];
    (Array.isArray(placeIds) ? placeIds : []).forEach(id => {
      if (typeof id !== 'string' || rank[id] != null) return;
      if (route.places.indexOf(id) < 0) return;
      rank[id] = ordered.length;
      ordered.push(id);
    });
    route.places.forEach(id => {
      if (rank[id] == null) {
        rank[id] = ordered.length;
        ordered.push(id);
      }
    });
    const next = recompute(Object.assign({}, clone(route), { places: ordered }));
    next.orderDirty = false;
    return next;
  }

  function scoreRoute(route) {
    if (!route || !Array.isArray(route.places)) {
      return {
        overall: 0, interest: 0, timeFit: 0, efficiency: 0, budgetFit: 0, diversity: 0,
        weights: normalizeWeights(SCORING), method: METHOD
      };
    }
    const cond = prepareConditions(route.conditions, route.durationMin);
    const places = D.places(route.places);
    const seg = computeSegments(cond, places, route.stayDeltaMin);
    const budget = computeBudget(cond, places);
    const metrics = {
      segments: seg.segments,
      stayTotalMin: seg.stayTotalMin,
      walkTotalMin: seg.walkTotalMin,
      actualMin: seg.actualMin,
      distanceKm: seg.distanceKm
    };
    return computeScores(cond, places, metrics, budget);
  }

  /* =====================================================================
   * 8. Refine（自然语言调整）
   * ===================================================================== */

  function removeAt(places, idx) {
    const list = places.slice();
    const removed = list.splice(idx, 1)[0];
    return { list, removed };
  }

  function matchesCategory(place, pattern) {
    if (!pattern) return false;
    if (pattern.cat && place.cat === pattern.cat) return true;
    if (pattern.interest && (place.interests || []).indexOf(pattern.interest) >= 0) return true;
    return false;
  }

  function bestCandidate(cond, used, pattern) {
    const pool = D.placesOfCity(cond.city);
    const candidates = pool
      .filter(p => !used[p.id] && !isAvoided(p, cond) && matchesCategory(p, pattern))
      .sort((a, b) => compareCandidates(a, b, cond));
    return candidates.length ? candidates[0] : null;
  }

  function bestInsertPosition(cond, places, candidate) {
    let best = places.length;
    let bestDist = Infinity;
    for (let i = 0; i <= places.length; i += 1) {
      const trial = places.slice();
      trial.splice(i, 0, candidate);
      const ordered = trial;
      let d = 0;
      for (let j = 1; j < ordered.length; j += 1) d += legDistanceKm(ordered[j - 1], ordered[j]);
      if (d < bestDist - 1e-9) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function usedSet(places) {
    const used = {};
    places.forEach(p => { used[p.id] = true; });
    return used;
  }

  function fitRoute(cond, places) {
    const ordered = places.slice();
    const seg = computeSegments(cond, ordered, 0);
    return seg.actualMin <= cond.durationMin * 1.05 + 1e-9 && seg.distanceKm <= walkingLimit(cond) + 1e-9;
  }

  function refine(text, route, opts) {
    const t = String(text == null ? '' : text).trim();
    if (!route || !Array.isArray(route.places)) {
      throw typedError('INVALID_ROUTE', 'refine 需要合法的 Route 对象');
    }

    const before = clone(route);
    const baseCond = prepareConditions(route.conditions, route.durationMin);
    let cond = clone(baseCond);
    let routePlaces = D.places(route.places);
    if (!routePlaces.length) throw typedError('INVALID_ROUTE', 'refine 的路线没有有效地点');

    const unchanged = (reply, bullets) => makeRefineResult(before, clone(route), {
      changed: false,
      reply,
      bullets: bullets || [],
      changes: []
    });

    if (!t) {
      return unchanged('我没有收到调整内容。可以试试「少走点路」「把书店换成咖啡馆」「多看历史」「预算控制在 100 元以内」「17 点前结束」「保留第一站和最后一站」「下雨了，换成室内」「不要都差不多」「去掉书店」。');
    }

    let changed = false;
    let reply = '';
    let bullets = [];
    let changes = [];
    let places = routePlaces.slice();

    /* ---------- 8.1 保留首尾 ---------- */
    const keepEndsHit = /保留(第一站|首站).{0,12}(最后一站|末站)|首尾.{0,4}(不变|保留)|第一站和最后一站/.test(t);
    if (keepEndsHit) {
      if (places.length <= 2) return unchanged('路线只有两站或更少，首尾已经固定，不需要重排。');
      const original = places.map(p => p.id).join(',');
      const reordered = reorderMiddleNearest(places);
      if (reordered.map(p => p.id).join(',') === original) {
        return unchanged('首尾已保留，中间几站本来就已经是按最近邻排列的。');
      }
      places = reordered;
      changed = true;
      reply = '已锁定第一站「' + places[0].name + '」和最后一站「' + places[places.length - 1].name +
        '」，中间按最近邻重排，步行更顺。';
      changes.push({
        type: 'reorder',
        label: '中间地点顺序',
        from: routePlaces.slice(1, -1).map(p => p.name).join(' → '),
        to: places.slice(1, -1).map(p => p.name).join(' → ')
      });
    }

    /* ---------- 8.2 结束时间 ---------- */
    if (!changed && /(?:之前|以前|前).{0,6}(?:结束|回来|到家|收尾)|(?:结束|回来|到家|收尾).{0,6}(?:之前|以前)/.test(t)) {
      const end = parseEndTimeText(t);
      if (!end) {
        return unchanged('我没有识别出具体结束时间。可以说「17:00 前结束」或「下午五点前结束」。');
      }
      const derived = S.durationFromTimes(cond.startTime, end.value);
      if (derived == null) return unchanged('结束时间无法换算成可用时长，请检查时间格式。');
      const newDuration = clamp(Math.round(derived), S.LIMITS.durationMin[0], S.LIMITS.durationMin[1]);
      cond.endTime = end.value;
      cond.durationMin = newDuration;

      // 优先减站（非必去），直到进入 5% 缓冲或只剩 1 站
      let guard = 0;
      while (places.length > 1 && guard < 8) {
        const seg = computeSegments(cond, places, route.stayDeltaMin);
        if (seg.actualMin <= cond.durationMin * 1.05 + 1e-9) break;
        const mask = removableMask(cond, places);
        let idx = -1;
        for (let i = places.length - 1; i >= 0; i -= 1) {
          if (!mask[i]) { idx = i; break; }
        }
        if (idx < 0) break;
        const removed = places.splice(idx, 1)[0];
        changes.push({ type: 'remove', label: '移除地点', from: removed.name, placeId: removed.id });
        guard += 1;
      }
      changed = true;
      reply = '已把结束时间设为 ' + end.value + '（可用约 ' + formatDuration(cond.durationMin) + '），并按新时长压缩了路线。';
      bullets.push('如果还想更紧凑，可以说「每站停留缩短 15 分钟」。');
    }

    /* ---------- 8.3 把 X 换成 Y ---------- */
    if (!changed) {
      const replaceMatch = t.match(/把?\s*([^，,。；;\s]{1,12}?)\s*(?:换成|替换成|改为|变成)\s*([^，,。；;\s]{1,10})/);
      if (replaceMatch) {
        const fromText = replaceMatch[1];
        const toText = replaceMatch[2];
        const toPattern = findCategoryInText(toText);
        if (!toPattern) {
          return unchanged('我还认不出要换成哪一类，可以试试「把书店换成咖啡馆」「把历史街区换成公园」。');
        }
        let removeIdx = -1;
        const named = findPlaceByText(fromText, cond.city);
        if (named) removeIdx = places.findIndex(p => p.id === named.id);
        const fromPattern = findCategoryInText(fromText);
        if (removeIdx < 0 && fromPattern) {
          for (let i = places.length - 1; i >= 0; i -= 1) {
            if (matchesCategory(places[i], fromPattern)) { removeIdx = i; break; }
          }
        }
        if (removeIdx < 0) {
          return unchanged('这条路线里没有找到「' + fromText + '」，不改动路线。');
        }
        const mask = removableMask(cond, places);
        if (mask[removeIdx]) {
          return unchanged('「' + places[removeIdx].name + '」是必去点，不能直接替换；可以先取消必去限制。');
        }
        const candidate = bestCandidate(cond, usedSet(places), toPattern);
        if (!candidate) {
          return unchanged('示例地点库里暂时没有更多「' + toPattern.label + '」可以替换，保留当前路线。');
        }
        const removed = places[removeIdx];
        places[removeIdx] = candidate;
        changed = true;
        reply = '已把「' + removed.name + '」替换为「' + candidate.name + '」，其余站点顺序保持不变。';
        changes.push({ type: 'replace', label: '替换地点', from: removed.name, to: candidate.name, placeId: candidate.id });
      }
    }

    /* ---------- 8.4 天气 ---------- */
    if (!changed) {
      const rain = /下雨|雨天|下着雨|阴雨/.test(t);
      const hot = /太热|很热|晒/.test(t);
      const cold = /怕冷|太冷|降温/.test(t);
      if (rain || hot || cold) {
        if (rain) {
          const mask = removableMask(cond, places);
          const outdoors = [];
          places.forEach((p, i) => {
            if (p.indoor !== true && !mask[i]) outdoors.push(i);
          });
          if (!outdoors.length) {
            return unchanged('当前路线已经是室内点或全部为必去点，没有可以替换的室外点；出门记得带伞。', [
              '如果愿意取消必去限制，可以再说「下雨了，换成室内」。'
            ]);
          }
          const used = usedSet(places);
          const indoorCandidates = D.placesOfCity(cond.city)
            .filter(p => !used[p.id] && !isAvoided(p, cond) && p.indoor === true)
            .sort((a, b) => compareCandidates(a, b, cond));
          if (!indoorCandidates.length) {
            return unchanged('示例地点库里没有更多室内点可以替换；保留当前路线，下雨时请自备雨具。', [
              '也可以说「去掉某一类地点」来减少室外停留。'
            ]);
          }
          let replaced = 0;
          for (let i = 0; i < outdoors.length && replaced < indoorCandidates.length; i += 1) {
            const idx = outdoors[i];
            const candidate = indoorCandidates[replaced];
            const removed = places[idx];
            places[idx] = candidate;
            replaced += 1;
            changes.push({ type: 'replace', label: '雨天替换室内', from: removed.name, to: candidate.name, placeId: candidate.id });
          }
          if (!replaced) return unchanged('没有可执行的室内替换，保留当前路线。');
          cond.weather = 'rain';
          changed = true;
          reply = '已按下雨偏好把 ' + replaced + ' 个室外点换成室内点；未替换的点位请自备雨具。';
          bullets.push('这只是软偏好，不是硬过滤；如果你更想保留原点位，可以再说「保留原来的点」。');
        } else {
          cond.weather = hot ? 'hot' : 'cold';
          changed = true;
          reply = hot
            ? '已记录天气偏好「太热」：优先安排室内和树荫较多的点，但示例数据无法验证实时遮阴情况。'
            : '已记录天气偏好「怕冷」：建议缩短室外停留，示例数据无法验证实时体感。';
          bullets.push('如果你明确想换成室内点，可以说「换成室内」。');
        }
      }
    }

    /* ---------- 8.5 预算 ---------- */
    if (!changed) {
      const budgetHit = /预算|人均|花费|太贵|便宜|省钱|超支/.test(t);
      if (budgetHit) {
        if (/预算(?:充足|够用|不限|不是问题)|不差钱/.test(t)) {
          return unchanged('预算按不限处理，不需要修改路线。');
        }
        const parsed = parseBudgetText(t);
        if (parsed && parsed.budgetMax != null) {
          cond.budgetMax = clamp(parsed.budgetMax, 0, S.LIMITS.budgetMax[1]);
          cond.budgetBasis = parsed.budgetBasis;
          const cap = effectiveBudgetCap(cond);
          let guard = 0;
          while (places.length > 1 && guard < 8) {
            const budget = computeBudget(cond, places);
            if (budget.max <= cap + 1e-9) break;
            const mask = removableMask(cond, places);
            let idx = -1;
            let cost = -1;
            places.forEach((p, i) => {
              if (mask[i]) return;
              const c = isNum(p.cost && p.cost[1]) ? p.cost[1] : 0;
              if (c > cost + 1e-9 || (Math.abs(c - cost) <= 1e-9 && i > idx)) { cost = c; idx = i; }
            });
            if (idx < 0) break;
            const removed = places.splice(idx, 1)[0];
            changes.push({ type: 'remove', label: '预算移除', from: removed.name, placeId: removed.id });
            guard += 1;
          }
          changed = true;
          const after = computeBudget(cond, places);
          reply = '已把预算上限设为 ' + (cond.budgetBasis === 'per_person' ? '人均 ' : '') +
            formatMoney(cond.budgetMax) + '（合计上限 ' + formatMoney(effectiveBudgetCap(cond)) + '）。当前估算 ' +
            formatMoney(after.min) + '–' + formatMoney(after.max) + '。';
          bullets.push('示例消费区间只是估算，实际以门店为准。');
          if (after.max > effectiveBudgetCap(cond) + 1e-9) {
            reply += ' 仍超出预算，已保留原有点位并标出冲突，请选择处理方式。';
          }
        } else {
          // 只说“太贵/预算紧”，未给数字：先去掉最贵的一站（非必去）
          const mask = removableMask(cond, places);
          let idx = -1;
          let cost = -1;
          places.forEach((p, i) => {
            if (mask[i]) return;
            const c = isNum(p.cost && p.cost[1]) ? p.cost[1] : 0;
            if (c > cost + 1e-9 || (Math.abs(c - cost) <= 1e-9 && i > idx)) { cost = c; idx = i; }
          });
          if (idx < 0) return unchanged('当前路线没有可以去掉的非必去高消费点；可以告诉我具体预算，例如「预算控制在 100 元以内」。');
          const removed = places.splice(idx, 1)[0];
          changed = true;
          reply = '已去掉花费最高的一站「' + removed.name + '」；如果想设具体预算，可以说「预算控制在 100 元以内」。';
          changes.push({ type: 'remove', label: '预算移除', from: removed.name, placeId: removed.id });
        }
      }
    }

    /* ---------- 8.6 少走路 ---------- */
    if (!changed) {
      const walkHit = /少走|缩短步行|走不动|太累|腿疼|腿脚|减少步行|步行.{0,4}(太多|太长)|别走太远|近一点/.test(t);
      if (walkHit) {
        if (places.length <= 2) {
          return unchanged('现在只剩两站或更少，再减路线就不成立了。可以把节奏改成「轻松」，每站多休息一会儿。', [
            '也可以指定「去掉某一类地点」，例如「去掉书店」。'
          ]);
        }
        const mask = removableMask(cond, places);
        let idx = pickWorstMiddleIndex(places, cond, mask);
        if (idx > 0) {
          const removed = places.splice(idx, 1)[0];
          changed = true;
          reply = '已把绕路最多的「' + removed.name + '」从路线里拿掉，步行距离会相应减少。';
          changes.push({ type: 'remove', label: '减少步行', from: removed.name, placeId: removed.id });
        } else {
          const original = places.map(p => p.id).join(',');
          const reordered = reorderMiddleNearest(places);
          if (reordered.map(p => p.id).join(',') !== original) {
            places = reordered;
            changed = true;
            reply = '已保留首尾，把中间几站按最近邻重排，减少来回走。';
            changes.push({
              type: 'reorder',
              label: '减少步行重排',
              from: routePlaces.map(p => p.name).join(' → '),
              to: places.map(p => p.name).join(' → ')
            });
          } else {
            return unchanged('当前路线已经比较顺路，没有明显可减少的绕路；可以调成「轻松」节奏多休息。');
          }
        }
        bullets.push('如果还想更少走，可以把步行强度设为「轻松」或删掉一整类地点。');
      }
    }

    /* ---------- 8.7 去掉某类地点 ---------- */
    if (!changed) {
      let removePattern = null;
      const removeMatch = t.match(/(?:不要|去掉|删掉|不想去|别安排|取消|除了)\s*([^，,。；;\s]{1,10})/);
      if (removeMatch) removePattern = findCategoryInText(removeMatch[1]);
      if (removePattern) {
        const mask = removableMask(cond, places);
        const keep = [];
        const removedList = [];
        places.forEach((p, i) => {
          if (matchesCategory(p, removePattern) && !mask[i]) {
            removedList.push(p);
          } else {
            keep.push(p);
          }
        });
        if (!removedList.length) {
          return unchanged('这条路线里没有可去掉的「' + removePattern.label + '」（可能都是必去点），路线保持不变。');
        }
        if (!keep.length) {
          return unchanged('去掉全部「' + removePattern.label + '」后路线会没有地点；请保留至少一站，或换个类别。');
        }
        places = keep;
        changed = true;
        reply = '已去掉「' + removePattern.label + '」：' + removedList.map(p => '「' + p.name + '」').join('、') + '，其余站点顺序不变。';
        removedList.forEach(p => changes.push({ type: 'remove', label: '移除地点', from: p.name, placeId: p.id }));
      }
    }

    /* ---------- 8.8 增加主题 ---------- */
    if (!changed) {
      const addMatch = t.match(/(?:多看|多安排|想多|再来|加一?个?|加一?家?|增加|补一?个?|想要更多)\s*([^，,。；;\s]{1,10})/);
      if (addMatch) {
        const pattern = findCategoryInText(addMatch[1]);
        if (pattern) {
          const candidate = bestCandidate(cond, usedSet(places), pattern);
          if (!candidate) {
            return unchanged('示例地点库里暂时没有更多「' + pattern.label + '」可以加，或者它已经在路线里了。');
          }
          const trial = places.slice();
          trial.splice(bestInsertPosition(cond, places, candidate), 0, candidate);
          if (fitRoute(cond, trial)) {
            places = trial;
            changed = true;
            reply = '已加入「' + candidate.name + '」，并放在最顺路的位置；其余站点顺序尽量保持不变。';
            changes.push({ type: 'add', label: '增加地点', to: candidate.name, placeId: candidate.id });
          } else {
            // 时间/步行放不下：尝试替换一个低分的非同类点
            const mask = removableMask(cond, places);
            let replaceIdx = -1;
            let lowest = Infinity;
            places.forEach((p, i) => {
              if (mask[i] || matchesCategory(p, pattern)) return;
              const s = scorePlace(p, cond);
              if (s < lowest - 1e-9 || (Math.abs(s - lowest) <= 1e-9 && i > replaceIdx)) {
                lowest = s;
                replaceIdx = i;
              }
            });
            if (replaceIdx >= 0) {
              const replaced = places[replaceIdx];
              const trial2 = places.slice();
              trial2[replaceIdx] = candidate;
              if (fitRoute(cond, trial2)) {
                places = trial2;
                changed = true;
                reply = '时间/步行放不下额外一站，已用「' + candidate.name + '」替换低相关的「' + replaced.name + '」。';
                changes.push({ type: 'replace', label: '替换地点', from: replaced.name, to: candidate.name, placeId: candidate.id });
              }
            }
            if (!changed) {
              return unchanged('当前时间/步行预算放不下更多「' + pattern.label + '」。可以延长时长、减少一站，或把步行强度调高一点。');
            }
          }
        }
      }
    }

    /* ---------- 8.8b 节奏调整 ---------- */
    if (!changed) {
      if (/节奏(慢|轻|缓)|慢一点|轻松一点|别太赶|不要太赶/.test(t)) {
        if (cond.pace === 'light') return unchanged('现在已经是「轻松」节奏了，不需要再放慢。');
        cond.pace = 'light';
        changed = true;
        reply = '已把节奏调整为「轻松」：每站停留会更长，地点数量可能相应减少。';
      } else if (/节奏(快|紧)|紧凑一点|多走一点|多逛一点/.test(t)) {
        if (cond.pace === 'deep') return unchanged('现在已经是「深度探索」节奏了。');
        cond.pace = 'deep';
        changed = true;
        reply = '已把节奏调整为「深度探索」：会安排更多地点，步行量相应增加。';
      }
    }

    /* ---------- 8.9 多样性 ---------- */
    if (!changed) {
      if (/不要.{0,6}类似|别都.{0,4}一样|不要.{0,3}差不多|换点花样|多样性|同类型|太重复/.test(t)) {
        if (places.length < 3) return unchanged('路线站点较少，多样性调整空间有限；可以加一站再试试。');
        const dom = dominantCategory(places);
        if (!dom.cat || dom.share < 0.5) {
          return unchanged('当前路线类别已经比较分散，不需要再替换。');
        }
        const mask = removableMask(cond, places);
        let idx = -1;
        let lowest = Infinity;
        places.forEach((p, i) => {
          if (p.cat !== dom.cat || mask[i]) return;
          const s = scorePlace(p, cond);
          if (s < lowest - 1e-9 || (Math.abs(s - lowest) <= 1e-9 && i > idx)) { lowest = s; idx = i; }
        });
        if (idx < 0) return unchanged('同类地点都是必去点，不能替换；可以先取消必去限制。');
        const used = usedSet(places);
        const candidates = D.placesOfCity(cond.city)
          .filter(p => !used[p.id] && !isAvoided(p, cond) && p.cat !== dom.cat)
          .sort((a, b) => compareCandidates(a, b, cond));
        let picked = null;
        for (let i = 0; i < candidates.length; i += 1) {
          const trial = places.slice();
          trial[idx] = candidates[i];
          if (fitRoute(cond, trial)) { picked = candidates[i]; places = trial; break; }
        }
        if (!picked) return unchanged('没有找到既不同类、又能放进当前时间/步行预算的替代点。');
        changed = true;
        reply = '已把「' + routePlaces[idx].name + '」替换为「' + picked.name + '」，让路线类别更分散。';
        changes.push({ type: 'replace', label: '多样性替换', from: routePlaces[idx].name, to: picked.name, placeId: picked.id });
      }
    }

    /* ---------- 8.10 单独改时长（最后兜底，避免误吞其他指令）---------- */
    if (!changed) {
      const durationOnly = parseDurationText(t);
      if (durationOnly && /改成|改为|变成|调整到|缩短到|延长到|换成|只要/.test(t)) {
        cond.durationMin = clamp(durationOnly.minutes, S.LIMITS.durationMin[0], S.LIMITS.durationMin[1]);
        cond.endTime = '';
        changed = true;
        reply = '已把可用时长改为 ' + formatDuration(cond.durationMin) + '，其余条件不变。';
      }
    }

    if (!changed) {
      return unchanged(
        '我没太理解这条调整。可以试试「少走点路」「把书店换成咖啡馆」「多看历史」「预算控制在 100 元以内」「17 点前结束」「保留第一站和最后一站」「下雨了，换成室内」「不要都差不多」「去掉书店」。',
        ['也可以直接说「改成 3 小时」。']
      );
    }

    // 统一重算：segments / 时长 / 预算 / 评分 / 约束都重新生成，复用旧结论是不允许的。
    const nextConditions = cond;
    let next = assembleRoute(nextConditions, places, {
      id: before.id,
      name: before.name,
      createdAt: before.createdAt,
      source: before.source,
      stayDeltaMin: isNum(before.stayDeltaMin) ? before.stayDeltaMin : 0,
      degraded: before.degraded,
      degradeReason: before.degradeReason
    });

    // 若改动带来硬约束违反，保留改动但必须带 conflict + options，并在 reply 里明说。
    if (next.conflict) {
      reply += ' 注意：' + next.conflict.title + '——' + next.conflict.detail + ' 请从冲突选项里选择一个处理方式。';
    }
    const extraNumeric = diffRouteNumbers(before, next);
    changes = changes.concat(extraNumeric);
    return makeRefineResult(before, next, {
      changed: true,
      reply,
      bullets,
      changes
    });
  }

  /* =====================================================================
   * 9. 冲突选项执行
   * ===================================================================== */

  function makeRefineResult(before, after, opts) {
    const o = opts || {};
    const violated = (after.constraints || []).filter(c => c.status === 'violated');
    const result = {
      schemaVersion: S.REFINE_VERSION,
      changed: !!o.changed,
      reply: String(o.reply || ''),
      bullets: Array.isArray(o.bullets) ? o.bullets : [],
      changes: Array.isArray(o.changes) ? o.changes : [],
      constraintsAfter: clone(after.constraints || []),
      unresolved: violated.map(c => c.label + '：' + c.detail),
      conflict: clone(after.conflict || null),
      route: after
    };
    const validation = S.validateRefine(result);
    if (!validation.ok) {
      throw typedError('CORE_INVALID_REFINE', '调整结果未通过 Schema 校验：' + S.formatErrors(validation.errors), {
        errors: validation.errors
      });
    }
    return result;
  }

  function diffRouteNumbers(before, after) {
    const out = [];
    if (before.durationMin !== after.durationMin) {
      out.push({ type: 'duration', label: '可用时长（分钟）', from: before.durationMin, to: after.durationMin });
    }
    if (before.actualMin !== after.actualMin) {
      out.push({ type: 'duration', label: '预计总时长（分钟）', from: before.actualMin, to: after.actualMin });
    }
    const beforeBudget = before.budget || {};
    const afterBudget = after.budget || {};
    if (beforeBudget.max !== afterBudget.max) {
      out.push({ type: 'budget', label: '预算上限（元）', from: beforeBudget.max, to: afterBudget.max });
    }
    if (before.distanceKm !== after.distanceKm && !out.some(c => c.label === '预计总时长（分钟）')) {
      // 距离变化归入时长变化提示；不新增非法 type。
      out.push({ type: 'duration', label: '步行距离（km）', from: before.distanceKm, to: after.distanceKm });
    }
    return out;
  }

  function findConflictOption(route, optionId) {
    if (!route || !route.conflict || !Array.isArray(route.conflict.options)) return null;
    const id = String(optionId || '');
    for (let i = 0; i < route.conflict.options.length; i += 1) {
      const o = route.conflict.options[i];
      if (o && o.id === id) return o;
    }
    // 容错：允许直接用 action.op 作为 optionId
    for (let i = 0; i < route.conflict.options.length; i += 1) {
      const o = route.conflict.options[i];
      if (o && o.action && o.action.op === id) return o;
    }
    return null;
  }

  function executeConflictAction(option, route) {
    const action = option.action || {};
    const op = action.op;
    const cond = prepareConditions(route.conditions, route.durationMin);
    let places = D.places(route.places);
    const before = clone(route);
    let reply = '';
    const changes = [];
    let changed = false;

    if (op === 'extend_time') {
      const dur = clamp(Math.round(Number(action.value) || (route.actualMin + 15)),
        S.LIMITS.durationMin[0], S.LIMITS.durationMin[1]);
      cond.durationMin = dur;
      reply = '已把可用时间延长到 ' + formatDuration(dur) + '。';
      changed = true;
    } else if (op === 'drop_last') {
      if (places.length <= 1) return null;
      const removed = places.pop();
      reply = '已去掉最后一站「' + removed.name + '」。';
      changes.push({ type: 'remove', label: '移除最后一站', from: removed.name, placeId: removed.id });
      changed = true;
    } else if (op === 'shorten_stay') {
      const minutes = clamp(Math.round(Number(action.minutes) || 15), 1, 60);
      route = Object.assign({}, route, { stayDeltaMin: (isNum(route.stayDeltaMin) ? route.stayDeltaMin : 0) - minutes });
      reply = '已把每站停留缩短 ' + minutes + ' 分钟（每站最少 ' + MIN_STAY_MIN + ' 分钟）。';
      changed = true;
    } else if (op === 'raise_budget') {
      cond.budgetMax = clamp(Math.round(Number(action.value) || 0), 0, S.LIMITS.budgetMax[1]);
      reply = '已把预算上限提高到 ' + (cond.budgetBasis === 'per_person' ? '人均 ' : '') + formatMoney(cond.budgetMax) + '。';
      changed = true;
    } else if (op === 'drop_expensive') {
      if (places.length <= 1) return null;
      const mask = removableMask(cond, places);
      let idx = -1;
      let cost = -1;
      places.forEach((p, i) => {
        if (mask[i]) return;
        const c = isNum(p.cost && p.cost[1]) ? p.cost[1] : 0;
        if (c > cost + 1e-9 || (Math.abs(c - cost) <= 1e-9 && i > idx)) { cost = c; idx = i; }
      });
      if (idx < 0) return null;
      const removed = places.splice(idx, 1)[0];
      reply = '已去掉花费最高的一站「' + removed.name + '」。';
      changes.push({ type: 'remove', label: '移除高消费点', from: removed.name, placeId: removed.id });
      changed = true;
    } else if (op === 'drop_farthest') {
      if (places.length <= 1) return null;
      const mask = removableMask(cond, places);
      const idx = pickWorstSavedIndex(places, cond, mask);
      if (idx < 0) return null;
      const removed = places.splice(idx, 1)[0];
      reply = '已去掉绕路最多的一站「' + removed.name + '」。';
      changes.push({ type: 'remove', label: '移除绕路点', from: removed.name, placeId: removed.id });
      changed = true;
    } else if (op === 'relax_walking') {
      const level = action.value;
      if (WALKING_LIMITS[level] == null) return null;
      cond.walkingTolerance = level;
      reply = '已把步行强度放宽到 ' + level + '（上限 ' + WALKING_LIMITS[level] + ' km）。';
      changed = true;
    } else if (op === 'remove_must_visit') {
      const tokens = Array.isArray(action.tokens) ? action.tokens : (action.token ? [action.token] : []);
      if (!tokens.length) return null;
      const next = (cond.mustVisit || []).filter(t => tokens.indexOf(t) < 0);
      if (next.length === (cond.mustVisit || []).length) return null;
      cond.mustVisit = next;
      reply = '已取消必去点限制：' + tokens.map(t => '「' + t + '」').join('、') + '。';
      changed = true;
    } else if (op === 'replace_must_visit') {
      const token = action.token;
      const toPlaceId = action.toPlaceId;
      const toPlace = D.place(toPlaceId);
      if (!token || !toPlace) return null;
      cond.mustVisit = (cond.mustVisit || []).map(t => (t === token ? toPlaceId : t));
      if (places.map(p => p.id).indexOf(toPlaceId) < 0) {
        if (places.length >= MAX_PLACES) {
          const mask = removableMask(cond, places);
          let idx = -1;
          for (let i = places.length - 1; i >= 0; i -= 1) {
            if (!mask[i]) { idx = i; break; }
          }
          if (idx < 0) return null;
          const removed = places.splice(idx, 1)[0];
          changes.push({ type: 'remove', label: '腾出地点名额', from: removed.name, placeId: removed.id });
        }
        places.push(toPlace);
        places = optimizeOrder(places);
      }
      reply = '已用「' + toPlace.name + '」替代原先的必去项「' + token + '」。';
      changes.push({ type: 'replace', label: '替换必去地点', from: token, to: toPlace.name, placeId: toPlace.id });
      changed = true;
    } else {
      return null;
    }

    route = Object.assign({}, route, {
      conditions: cond,
      places: places.map(p => p.id)
    });
    const next = recompute(route);
    const numeric = diffRouteNumbers(before, next);
    if (next.conflict) {
      reply += ' 注意：' + next.conflict.title + '——' + next.conflict.detail + ' 请继续选择处理方式。';
    }
    return makeRefineResult(before, next, {
      changed: changed && next !== before,
      reply,
      bullets: [],
      changes: changes.concat(numeric)
    });
  }

  function resolveConflict(optionId, route, opts) {
    if (!route || !Array.isArray(route.places)) {
      throw typedError('INVALID_ROUTE', 'resolveConflict 需要合法的 Route 对象');
    }
    const option = findConflictOption(route, optionId);
    if (!option) {
      const before = clone(route);
      return makeRefineResult(before, before, {
        changed: false,
        reply: '没有找到冲突选项「' + optionId + '」；请从当前路线给出的选项中选择。',
        bullets: [],
        changes: []
      });
    }
    const result = executeConflictAction(option, route);
    if (!result) {
      const before = clone(route);
      return makeRefineResult(before, before, {
        changed: false,
        reply: '这个选项在当前路线状态下无法执行（例如只剩一站，或没有可移除的点）。',
        bullets: [],
        changes: []
      });
    }
    return result;
  }

  /* =====================================================================
   * 10. 导出
   * ===================================================================== */

  const api = {
    version: VERSION,

    // 常量（便于服务端/测试读取，不参与契约校验）
    SCORING_WEIGHTS,
    WALKING_LIMITS,
    PARTY_MULTIPLIER,
    STAY_FACTORS,
    WALK_KMH,
    MAP_UNIT_M,
    REAL_ROUTE_FACTOR,
    METHOD,

    // 条件
    defaultConditions,
    parseIntent,
    checkCompleteness,

    // 规划与重算
    plan,
    buildRoute,
    recompute,
    applyOrder,

    // 调整
    refine,
    resolveConflict,

    // 解释与工具
    explainPlace,
    haversineKm,
    walkMinutesFromKm,
    scoreRoute
  };

  return api;
});
