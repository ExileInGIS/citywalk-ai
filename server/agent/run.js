/* =====================================================================
 * run.js · Agent 编排层
 * ---------------------------------------------------------------------
 * 一次 /api/agent/run 的确定性流程：
 *   校验（index/validate）→ 完整度检查 → Mock 或远程调用
 *   → 服务端重算所有数字 → Schema 校验 → 修复重试（≤2）→ 降级/错误
 *
 * 原则：
 *  - LLM 只负责「挑哪些地点 + 怎么说」，数字全部由 shared/core.js 计算；
 *  - 本文件不复制 shared/core.js 的规划/调整逻辑；
 *  - 远程失败按 AGENT_FALLBACK 决定降级到 Mock 还是返回标准错误。
 * ===================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const schema = require('../../js/schema.js');
const data = require('../../js/data.js');
const { ApiError, STATUS_BY_CODE } = require('../lib/http');
const mockProvider = require('./providers/mock');
const openaiProvider = require('./providers/openai-compatible');
const cozeProvider = require('./providers/coze');

const CORE_PATH = path.resolve(__dirname, '..', '..', 'shared', 'core.js');
const DEFAULT_PROMPT_DIR = path.join(__dirname, 'prompts');
const MAX_REPAIR_ATTEMPTS = 2;
const MAX_PLACES = schema.LIMITS.places[1];
const PROMPT_CACHE = new Map();

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(err) {
  return err && err.message ? String(err.message) : String(err || 'unknown error');
}

function clip(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) : text;
}

function readPrompt(name, promptDir) {
  const dir = promptDir || DEFAULT_PROMPT_DIR;
  const key = dir + '|' + name;
  if (PROMPT_CACHE.has(key)) return PROMPT_CACHE.get(key);
  const file = path.join(dir, name + '.md');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new ApiError('INTERNAL', '系统提示词文件缺失：' + name + '.md', { cause: err });
  }
  PROMPT_CACHE.set(key, text);
  return text;
}

/** 加载 shared/core.js；空文件不会抛错，只有调用具体函数时才报「缺少 xxx」。 */
function loadCore() {
  try {
    return require(CORE_PATH);
  } catch (err) {
    throw new ApiError('INTERNAL', '共享核心模块加载失败', { cause: err });
  }
}

function missingCore(names) {
  return new ApiError('INTERNAL', '确定性核心 shared/core.js 尚未提供：' + names.join(' / '), {
    details: { missing: names }
  });
}

/* ------------------------------------------------------------------ *
 * 模型输出错误（可修复 / 可降级）
 * ------------------------------------------------------------------ */

class InvalidModelOutput extends Error {
  /**
   * @param {string} message
   * @param {string[]} [details]
   * @param {string} [rawOutput] 仅用于回传修复提示，绝不写日志
   */
  constructor(message, details, rawOutput) {
    super(message);
    this.name = 'InvalidModelOutput';
    this.code = 'INVALID_OUTPUT';
    this.details = Array.isArray(details) ? details : [String(details || message)];
    this.rawOutput = typeof rawOutput === 'string' ? rawOutput : '';
  }
}

/* ------------------------------------------------------------------ *
 * 数据目录（只读 js/data.js）
 * ------------------------------------------------------------------ */

function placesOfCity(city) {
  if (typeof data.placesOfCity === 'function') return data.placesOfCity(city) || [];
  return (data.PLACES || []).filter(place => place.city === city);
}

function placeById(id) {
  if (typeof data.place === 'function') return data.place(id);
  return (data.PLACES || []).find(place => place.id === id);
}

function placeName(id) {
  const place = placeById(id);
  return place ? place.name : id;
}

function candidatesFor(city) {
  return placesOfCity(city).slice(0, 40).map(place => ({
    id: place.id,
    name: place.name,
    cat: place.cat,
    area: place.area,
    interests: place.interests,
    indoor: place.indoor,
    stayMin: place.stay,
    cost: place.cost
  }));
}

function resolveMustVisit(conditions) {
  const ids = [];
  (Array.isArray(conditions.mustVisit) ? conditions.mustVisit : []).forEach(entry => {
    if (typeof entry !== 'string' || !entry.trim()) return;
    const byId = placeById(entry);
    if (byId && byId.city === conditions.city) {
      if (ids.indexOf(byId.id) < 0) ids.push(byId.id);
      return;
    }
    const byName = placesOfCity(conditions.city).find(place => (
      place.name === entry || place.name.indexOf(entry) >= 0 || entry.indexOf(place.name) >= 0
    ));
    if (byName && ids.indexOf(byName.id) < 0) ids.push(byName.id);
  });
  return ids;
}

function isAvoided(place, avoidList) {
  if (!place || !Array.isArray(avoidList) || !avoidList.length) return false;
  const category = typeof data.cat === 'function' ? data.cat(place.cat) : null;
  const categoryName = category && category.name ? category.name : '';
  return avoidList.some(entry => {
    if (typeof entry !== 'string' || !entry) return false;
    return entry === place.id
      || entry === place.cat
      || entry === place.name
      || (categoryName && entry === categoryName);
  });
}

/* ------------------------------------------------------------------ *
 * 完整度检查
 * ------------------------------------------------------------------ */

function normalizeCompleteness(raw, conditions) {
  const source = isObject(raw) ? raw : {};
  let missing = [];
  if (Array.isArray(source.missing)) {
    source.missing.forEach(item => {
      if (typeof item === 'string' && item) {
        missing.push(item);
        return;
      }
      if (isObject(item)) {
        // shared/core.js 返回 { id, label }；对外的 clarification 统一用字段名，
        // 同时把 durationMin 映射成旧前端使用的 duration，保持兼容。
        const id = item.id || item.field || item.key;
        if (typeof id === 'string' && id) {
          missing.push(id === 'durationMin' ? 'duration' : id);
        }
      }
    });
  } else if (isObject(source.missing)) {
    missing = Object.keys(source.missing)
      .filter(key => source.missing[key])
      .map(key => (key === 'durationMin' ? 'duration' : key));
  }
  // 缺少城市/时长必须走澄清；即使 core 只返回 ok:false 也要补出 missing。
  if (!conditions.city && missing.indexOf('city') < 0) missing.push('city');
  if (!conditions.durationMin && missing.indexOf('duration') < 0 && missing.indexOf('durationMin') < 0) {
    missing.push('duration');
  }

  let questions = [];
  if (Array.isArray(source.questions)) {
    questions = source.questions;
  } else if (source.ask) {
    questions = [source.ask];
  } else if (typeof source.question === 'string' && source.question) {
    questions = [{
      question: source.question,
      detail: typeof source.detail === 'string' ? source.detail : '',
      options: Array.isArray(source.chips) ? source.chips : []
    }];
  }
  if (!questions.length) {
    if (missing.indexOf('city') >= 0) {
      questions.push({ field: 'city', question: '你想在哪座城市漫步？', options: ['南京'] });
    }
    if (missing.indexOf('duration') >= 0 || missing.indexOf('durationMin') >= 0) {
      questions.push({
        field: 'duration',
        question: '这次大概有多少时间？',
        options: ['2 小时', '3 小时', '4 小时', '半天（6 小时）']
      });
    }
  } else {
    // core 只会追问它识别到的缺失项；这里补齐「服务端额外判定缺失」的问题，
    // 保证 missing 里的每一项都有对应的可回答问题。
    const asked = new Set();
    questions.forEach(item => {
      if (!isObject(item)) return;
      const id = item.id || item.field || item.key;
      if (typeof id === 'string') asked.add(id);
    });
    if (missing.indexOf('city') >= 0 && !asked.has('city')) {
      questions.push({ id: 'city', text: '你想在哪座城市漫步？', options: [{ value: 'nanjing', label: '南京' }] });
    }
    if ((missing.indexOf('duration') >= 0 || missing.indexOf('durationMin') >= 0)
      && !asked.has('duration') && !asked.has('durationMin')) {
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
  }

  const explicitIncomplete = source.ok === false || source.complete === false;
  const explicitComplete = source.ok === true || source.complete === true;
  const incomplete = missing.length > 0
    || explicitIncomplete
    || (!explicitComplete && source.ask != null);

  return {
    incomplete,
    missing,
    questions,
    note: typeof source.note === 'string' ? source.note : ''
  };
}

function checkCompleteness(core, conditions) {
  const fn = core && core.checkCompleteness;
  if (typeof fn !== 'function') throw missingCore(['checkCompleteness']);
  let raw;
  try {
    raw = fn(conditions);
  } catch (err) {
    throw new ApiError('INTERNAL', '需求完整度检查失败', { cause: err });
  }
  return normalizeCompleteness(raw, conditions);
}

/* ------------------------------------------------------------------ *
 * 路线构造与校验
 * ------------------------------------------------------------------ */

function normalizePlanRoute(route, conditions, source) {
  if (!isObject(route)) {
    throw new ApiError('INTERNAL', '核心返回的路线不是对象');
  }
  route.schemaVersion = schema.SCHEMA_VERSION;
  route.source = source;
  route.conditions = conditions;
  if (!route.createdAt) route.createdAt = new Date().toISOString();
  if (source === 'mock' || source === 'remote') {
    delete route.degraded;
    delete route.degradeReason;
  }
  return route;
}

function assertRoute(route, code, message) {
  const check = schema.validateRoute(route);
  if (!check.ok) {
    if (code === 'INVALID_OUTPUT') {
      throw new InvalidModelOutput(
        message,
        check.errors.slice(0, 8).map(item => item.path + ': ' + item.message),
        ''
      );
    }
    throw new ApiError(code || 'INTERNAL', message, { details: check.errors.slice(0, 8) });
  }
  return route;
}

function rebuildRoute(core, conditions, placeIds) {
  if (!core || typeof core.buildRoute !== 'function') {
    throw missingCore(['buildRoute']);
  }
  let built;
  try {
    built = core.buildRoute(conditions, placeIds);
  } catch (err) {
    throw new InvalidModelOutput('服务端无法根据模型给出的地点重建路线', [errorMessage(err)], '');
  }
  if (built && isObject(built.route)) built = built.route;
  if (!isObject(built)) {
    throw new InvalidModelOutput('服务端重建路线失败', ['buildRoute 未返回路线对象'], '');
  }
  return built;
}

function extractPlaces(modelOutput, conditions) {
  if (!isObject(modelOutput)) {
    throw new InvalidModelOutput('模型输出必须是 JSON 对象', ['顶层必须是对象'], '');
  }
  const raw = modelOutput.places;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PLACES) {
    throw new InvalidModelOutput(
      '模型输出的 places 不合法',
      ['places 必须是 1–' + MAX_PLACES + ' 个地点 id 的数组'],
      JSON.stringify(modelOutput)
    );
  }

  const ids = [];
  const errors = [];
  raw.forEach((id, index) => {
    if (typeof id !== 'string' || !id.trim()) {
      errors.push('places[' + index + '] 不是非空字符串');
      return;
    }
    if (ids.indexOf(id) >= 0) {
      errors.push('地点重复：' + id);
      return;
    }
    const place = placeById(id);
    if (!place || place.city !== conditions.city) {
      errors.push('地点不存在或不属于当前城市：' + id);
      return;
    }
    ids.push(id);
  });
  if (errors.length) {
    throw new InvalidModelOutput('模型输出的地点不合法', errors.slice(0, 8), JSON.stringify(modelOutput));
  }

  const avoided = ids.filter(id => isAvoided(placeById(id), conditions.avoid));
  if (avoided.length) {
    throw new InvalidModelOutput(
      '模型选择了用户要求避开的地点',
      avoided.slice(0, 8).map(id => '避开：' + id),
      JSON.stringify(modelOutput)
    );
  }

  const mustVisitIds = resolveMustVisit(conditions);
  const missingMustVisit = mustVisitIds.filter(id => ids.indexOf(id) < 0);
  if (missingMustVisit.length) {
    throw new InvalidModelOutput(
      '模型遗漏了必去地点',
      missingMustVisit.slice(0, 8).map(id => '必去未包含：' + id),
      JSON.stringify(modelOutput)
    );
  }
  return ids;
}

/* ------------------------------------------------------------------ *
 * 模型文本解析
 * ------------------------------------------------------------------ */

function parseModelJson(text) {
  const source = typeof text === 'string' ? text.trim().replace(/^\uFEFF/, '') : '';
  if (!source) {
    throw new InvalidModelOutput('模型输出为空', ['输出为空'], '');
  }
  let candidate = source;
  const fenced = candidate.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  if (fenced) candidate = fenced[1].trim();

  const pieces = [candidate];
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) pieces.push(candidate.slice(start, end + 1));

  for (const piece of pieces) {
    try {
      const parsed = JSON.parse(piece);
      if (isObject(parsed)) return parsed;
    } catch (_) {
      /* 尝试下一个候选片段 */
    }
  }
  throw new InvalidModelOutput(
    '模型输出不是合法的 JSON 对象',
    ['只输出一个 JSON 对象，不要 Markdown 或解释文字'],
    source
  );
}

function composeRepairPrompt(basePrompt, feedback, promptDir) {
  const repair = readPrompt('repair', promptDir);
  const payload = {
    previousOutput: clip(feedback && feedback.previousOutput, 4000),
    errors: (feedback && Array.isArray(feedback.errors) ? feedback.errors : []).slice(0, 8)
  };
  return basePrompt + '\n\n' + repair + '\n\n' + JSON.stringify(payload);
}

/* ------------------------------------------------------------------ *
 * 差异（changes）生成：优先用 core 的差异函数，否则做最小结构比较
 * ------------------------------------------------------------------ */

function isValidChange(item) {
  return isObject(item)
    && schema.ENUMS.changeType.indexOf(item.type) >= 0
    && typeof item.label === 'string'
    && !!item.label;
}

function localChanges(before, after) {
  const changes = [];
  const beforePlaces = Array.isArray(before.places) ? before.places : [];
  const afterPlaces = Array.isArray(after.places) ? after.places : [];
  const removed = beforePlaces.filter(id => afterPlaces.indexOf(id) < 0);
  const added = afterPlaces.filter(id => beforePlaces.indexOf(id) < 0);

  if (removed.length && added.length && removed.length === added.length) {
    removed.forEach((id, index) => {
      changes.push({
        type: 'replace',
        label: '替换地点',
        from: placeName(id),
        to: placeName(added[index]),
        placeId: added[index]
      });
    });
  } else {
    removed.forEach(id => {
      changes.push({ type: 'remove', label: '移除「' + placeName(id) + '」', placeId: id });
    });
    added.forEach(id => {
      changes.push({ type: 'add', label: '新增「' + placeName(id) + '」', placeId: id });
    });
  }

  if (!removed.length && !added.length && beforePlaces.join('|') !== afterPlaces.join('|')) {
    changes.push({ type: 'reorder', label: '调整游览顺序' });
  }
  if (Number(before.actualMin) !== Number(after.actualMin)) {
    changes.push({
      type: 'duration',
      label: '预计总时长',
      from: String(before.actualMin),
      to: String(after.actualMin)
    });
  }
  const beforeMax = before.budget && Number(before.budget.max);
  const afterMax = after.budget && Number(after.budget.max);
  if (Number.isFinite(beforeMax) && Number.isFinite(afterMax) && beforeMax !== afterMax) {
    const beforeMin = before.budget && Number(before.budget.min);
    const afterMin = after.budget && Number(after.budget.min);
    changes.push({
      type: 'budget',
      label: '预算估算',
      from: '¥' + beforeMin + '–' + beforeMax,
      to: '¥' + afterMin + '–' + afterMax
    });
  }
  return changes.slice(0, 20);
}

function buildChanges(before, after, core) {
  for (const name of ['diffRoutes', 'diff', 'changesOf']) {
    if (!core || typeof core[name] !== 'function') continue;
    try {
      const out = core[name](before, after);
      const list = Array.isArray(out) ? out : (out && Array.isArray(out.changes) ? out.changes : null);
      if (list && list.every(isValidChange)) return list.slice(0, 20);
    } catch (_) {
      /* 差异函数不可用时退回最小比较，不影响主流程 */
    }
  }
  return localChanges(before, after);
}

function placesDiffer(before, after) {
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  if (a.length !== b.length) return true;
  return a.some((id, index) => id !== b[index]);
}

/* ------------------------------------------------------------------ *
 * Mock 路径
 * ------------------------------------------------------------------ */

function normalizeMockRefine(raw, previousRoute, core) {
  if (!isObject(raw)) throw new ApiError('INTERNAL', '核心 refine 未返回对象');
  if (!isObject(raw.route)) throw new ApiError('INTERNAL', '核心 refine 未返回 route');
  const result = Object.assign({}, raw);
  result.schemaVersion = schema.REFINE_VERSION;
  if (typeof result.changed !== 'boolean') {
    result.changed = placesDiffer(previousRoute.places, result.route.places);
  }
  if (!Array.isArray(result.bullets)) result.bullets = [];
  if (!Array.isArray(result.changes)) result.changes = buildChanges(previousRoute, result.route, core);
  if (!Array.isArray(result.constraintsAfter)) {
    result.constraintsAfter = Array.isArray(result.route.constraints) ? result.route.constraints : [];
  }
  if (!Array.isArray(result.unresolved)) result.unresolved = [];
  if (result.conflict === undefined) result.conflict = result.route.conflict || null;
  if (typeof result.reply !== 'string') result.reply = '';
  return result;
}

async function runMock(task, payload, core, config) {
  if (task === 'plan') {
    let route;
    try {
      route = mockProvider.plan({ core, conditions: payload.conditions });
    } catch (err) {
      if (err && err.code === 'NO_CANDIDATES') {
        throw new ApiError('INVALID_INPUT', '当前城市暂无可用地点数据，请选择南京（本次仅提供南京示例数据）', {
          details: { coreCode: err.code }
        });
      }
      throw err;
    }
    normalizePlanRoute(route, payload.conditions, 'mock');
    assertRoute(route, 'INTERNAL', '核心生成的路线未通过 Schema 校验');
    return { data: route, provider: 'mock-rules', degraded: false, attempts: 1 };
  }

  const raw = mockProvider.refine({ core, text: payload.text, route: payload.route });
  const result = normalizeMockRefine(raw, payload.route, core);
  const check = schema.validateRefine(result);
  if (!check.ok) {
    throw new ApiError('INTERNAL', '核心生成的调整结果未通过 Schema 校验', {
      details: check.errors.slice(0, 8)
    });
  }
  return { data: result, provider: 'mock-rules', degraded: false, attempts: 1 };
}

/* ------------------------------------------------------------------ *
 * 远程路径
 * ------------------------------------------------------------------ */

function resolveProvider(config) {
  if (!config || !config.remoteProvider) {
    throw new ApiError(
      'REMOTE_NOT_CONFIGURED',
      '远程模式未配置模型：请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，或 COZE_API_TOKEN / COZE_BOT_ID'
    );
  }
  if (config.remoteProvider === 'openai-compatible') {
    return {
      id: 'openai-compatible',
      call: options => openaiProvider.callLLM({
        baseUrl: config.llm.baseUrl,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        system: options.system,
        prompt: options.prompt,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl
      })
    };
  }
  if (config.remoteProvider === 'coze') {
    return {
      id: 'coze',
      call: options => cozeProvider.callLLM({
        baseUrl: config.coze.baseUrl || undefined,
        apiToken: config.coze.apiToken,
        botId: config.coze.botId,
        prompt: options.prompt,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl
      })
    };
  }
  throw new ApiError('REMOTE_NOT_CONFIGURED', '未知的远程 Provider');
}

function classifyProviderError(err) {
  if (err instanceof ApiError) return err;
  if (err && typeof err.code === 'string' && STATUS_BY_CODE[err.code]) {
    return new ApiError(err.code, err.message || '远程调用失败', { cause: err });
  }
  return null;
}

async function remotePlanAttempt(args) {
  const { config, core, conditions, fetchImpl, promptDir, timeoutMs, feedback } = args;
  const provider = resolveProvider(config);
  const system = readPrompt('system-plan', promptDir);
  const base = JSON.stringify({
    request: 'plan',
    conditions,
    candidates: candidatesFor(conditions.city)
  });
  const prompt = feedback ? composeRepairPrompt(base, feedback, promptDir) : base;
  const text = await provider.call({ system, prompt, timeoutMs, fetchImpl });
  const modelOutput = parseModelJson(text);
  const placeIds = extractPlaces(modelOutput, conditions);
  const route = rebuildRoute(core, conditions, placeIds);
  normalizePlanRoute(route, conditions, 'remote');
  assertRoute(route, 'INVALID_OUTPUT', '服务端重算后的路线未通过 Schema 校验');
  return { data: route, provider: provider.id };
}

async function remoteRefineAttempt(args) {
  const {
    config, core, route: currentRoute, text: instruction,
    fetchImpl, promptDir, timeoutMs, feedback, now
  } = args;
  const provider = resolveProvider(config);
  const conditions = currentRoute.conditions;
  const system = readPrompt('system-refine', promptDir);
  const base = JSON.stringify({
    request: 'refine',
    text: instruction,
    route: currentRoute,
    candidates: candidatesFor(currentRoute.city)
  });
  const prompt = feedback ? composeRepairPrompt(base, feedback, promptDir) : base;
  const text = await provider.call({ system, prompt, timeoutMs, fetchImpl });
  const modelOutput = parseModelJson(text);

  if (typeof modelOutput.reply !== 'string' || !modelOutput.reply.trim()) {
    throw new InvalidModelOutput('模型输出缺少 reply', ['reply 必须是非空字符串'], text);
  }
  let bullets = [];
  if (modelOutput.bullets !== undefined && modelOutput.bullets !== null) {
    if (!Array.isArray(modelOutput.bullets)) {
      throw new InvalidModelOutput('模型输出的 bullets 不合法', ['bullets 必须是字符串数组'], text);
    }
    bullets = modelOutput.bullets
      .filter(item => typeof item === 'string' && item.trim())
      .map(item => item.trim().slice(0, 200))
      .slice(0, 5);
  }

  const placeIds = extractPlaces(modelOutput, conditions);
  const rebuilt = rebuildRoute(core, conditions, placeIds);
  normalizePlanRoute(rebuilt, conditions, 'remote');
  rebuilt.id = currentRoute.id;
  rebuilt.createdAt = currentRoute.createdAt || new Date(now()).toISOString();
  assertRoute(rebuilt, 'INVALID_OUTPUT', '服务端重算后的调整路线未通过 Schema 校验');

  const result = {
    schemaVersion: schema.REFINE_VERSION,
    changed: placesDiffer(currentRoute.places, rebuilt.places),
    reply: modelOutput.reply.trim().slice(0, schema.LIMITS.replyLen),
    bullets,
    changes: buildChanges(currentRoute, rebuilt, core),
    constraintsAfter: Array.isArray(rebuilt.constraints) ? rebuilt.constraints : [],
    unresolved: rebuilt.conflict ? [rebuilt.conflict.title] : [],
    conflict: rebuilt.conflict || null,
    route: rebuilt
  };
  const check = schema.validateRefine(result);
  if (!check.ok) {
    throw new InvalidModelOutput(
      '调整结果未通过 Schema 校验',
      check.errors.slice(0, 8).map(item => item.path + ': ' + item.message),
      text
    );
  }
  return { data: result, provider: provider.id };
}

function markDegraded(data, task, reason) {
  if (task === 'plan') {
    data.degraded = true;
    data.degradeReason = reason;
    return data;
  }
  data.degraded = true;
  data.degradeReason = reason;
  if (data.route) {
    data.route.degraded = true;
    data.route.degradeReason = reason;
  }
  return data;
}

async function fallbackOrThrow(args) {
  const { code, reason, task, payload, core, config, attempts, details } = args;
  if (config.agentFallback !== 'mock') {
    const messages = {
      INVALID_OUTPUT: '远程模型输出无法通过校验（已重试 2 次）',
      UPSTREAM_TIMEOUT: '远程模型请求超时',
      UPSTREAM_ERROR: '远程模型服务不可用'
    };
    throw new ApiError(code, messages[code] || '远程模型调用失败', { details });
  }
  const mockResult = await runMock(task, payload, core, config);
  markDegraded(mockResult.data, task, reason + '，已切换本地模拟');
  return {
    data: mockResult.data,
    provider: 'mock-rules',
    degraded: true,
    attempts: attempts || 1,
    fallbackCode: code
  };
}

async function runRemote(args) {
  const { task, payload, config, core, fetchImpl, now, promptDir } = args;
  if (!config.remoteProvider) {
    throw new ApiError(
      'REMOTE_NOT_CONFIGURED',
      '远程模式未配置模型：请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，或 COZE_API_TOKEN / COZE_BOT_ID'
    );
  }

  const deadline = now() + Math.max(1, config.agentTimeoutMs);
  let feedback = null;
  let lastErrors = [];

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      return fallbackOrThrow({
        code: 'UPSTREAM_TIMEOUT',
        reason: '远程模型请求超时',
        task, payload, core, config,
        attempts: attempt,
        details: { attempts: attempt }
      });
    }

    try {
      const output = task === 'plan'
        ? await remotePlanAttempt({
          config, core, conditions: payload.conditions,
          fetchImpl, promptDir, timeoutMs: remaining, feedback
        })
        : await remoteRefineAttempt({
          config, core, route: payload.route, text: payload.text,
          fetchImpl, promptDir, timeoutMs: remaining, feedback, now
        });

      return {
        data: output.data,
        provider: output.provider,
        degraded: false,
        attempts: attempt + 1
      };
    } catch (err) {
      if (err instanceof InvalidModelOutput) {
        lastErrors = err.details;
        if (attempt >= MAX_REPAIR_ATTEMPTS) {
          return fallbackOrThrow({
            code: 'INVALID_OUTPUT',
            reason: '远程模型输出不合法（已重试 2 次）',
            task, payload, core, config,
            attempts: attempt + 1,
            details: { attempts: attempt + 1, errors: lastErrors.slice(0, 5) }
          });
        }
        feedback = { previousOutput: err.rawOutput, errors: lastErrors };
        continue;
      }

      const apiErr = classifyProviderError(err);
      if (apiErr && apiErr.code === 'REMOTE_NOT_CONFIGURED') throw apiErr;
      if (apiErr && apiErr.code === 'INTERNAL') throw apiErr;

      if (apiErr && (apiErr.code === 'UPSTREAM_TIMEOUT' || apiErr.code === 'UPSTREAM_ERROR')) {
        return fallbackOrThrow({
          code: apiErr.code,
          reason: apiErr.code === 'UPSTREAM_TIMEOUT' ? '远程模型请求超时' : '远程模型服务不可用',
          task, payload, core, config,
          attempts: attempt + 1,
          details: undefined
        });
      }

      if (apiErr && apiErr.code === 'INVALID_OUTPUT') {
        lastErrors = [apiErr.message];
        if (attempt >= MAX_REPAIR_ATTEMPTS) {
          return fallbackOrThrow({
            code: 'INVALID_OUTPUT',
            reason: '远程模型输出不合法（已重试 2 次）',
            task, payload, core, config,
            attempts: attempt + 1,
            details: { attempts: attempt + 1, errors: lastErrors }
          });
        }
        feedback = { previousOutput: '', errors: lastErrors };
        continue;
      }

      if (apiErr) throw apiErr;
      throw new ApiError('INTERNAL', '远程调用编排失败', { cause: err });
    }
  }

  // 理论不可达；保留一个安全出口。
  return fallbackOrThrow({
    code: 'INVALID_OUTPUT',
    reason: '远程模型输出不合法（已重试 2 次）',
    task, payload, core, config,
    attempts: MAX_REPAIR_ATTEMPTS + 1,
    details: { attempts: MAX_REPAIR_ATTEMPTS + 1, errors: lastErrors.slice(0, 5) }
  });
}

/* ------------------------------------------------------------------ *
 * 对外入口
 * ------------------------------------------------------------------ */

/**
 * @param {{
 *   task: 'plan'|'refine',
 *   payload: object,
 *   config: object,
 *   core?: object,
 *   fetchImpl?: Function,
 *   now?: () => number,
 *   promptDir?: string
 * }} options
 * @returns {Promise<{task: string, mode: string, degraded: boolean, data: object,
 *   provider: string, schemaVersion: string, durationMs: number, attempts: number,
 *   clarification: boolean}>}
 */
async function runAgent(options) {
  const opts = options || {};
  const config = opts.config;
  if (!config) throw new ApiError('INTERNAL', '缺少运行时配置');
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const promptDir = opts.promptDir || config.promptDir || DEFAULT_PROMPT_DIR;
  const core = opts.core || loadCore();
  const task = opts.task;
  const payload = opts.payload;
  const startedAt = now();

  if (task !== 'plan' && task !== 'refine') {
    throw new ApiError('INVALID_INPUT', 'task 必须是 plan 或 refine');
  }
  if (!isObject(payload)) {
    throw new ApiError('INVALID_INPUT', 'payload 必须是对象');
  }

  let result;
  let clarification = false;

  if (task === 'plan') {
    const conditions = payload.conditions;
    const completeness = checkCompleteness(core, conditions);
    if (completeness.incomplete) {
      clarification = true;
      result = {
        data: {
          clarification: {
            missing: completeness.missing,
            questions: completeness.questions,
            note: completeness.note
          },
          conditions
        },
        provider: config.agentMode === 'remote' && config.remoteProvider
          ? config.remoteProvider
          : 'mock-rules',
        degraded: false,
        attempts: 1
      };
    } else if (!placesOfCity(conditions.city).length) {
      // 城市存在但示例数据只覆盖南京：这是输入无法满足，不是服务端故障。
      throw new ApiError('INVALID_INPUT', '当前城市暂无可用地点数据，请选择南京（本次仅提供南京示例数据）', {
        details: { reason: 'NO_CANDIDATES' }
      });
    } else if (config.agentMode === 'remote') {
      result = await runRemote({
        task, payload, config, core,
        fetchImpl: opts.fetchImpl, now, promptDir
      });
    } else {
      result = await runMock(task, payload, core, config);
    }
  } else if (config.agentMode === 'remote') {
    result = await runRemote({
      task, payload, config, core,
      fetchImpl: opts.fetchImpl, now, promptDir
    });
  } else {
    result = await runMock(task, payload, core, config);
  }

  const data = result.data;
  const schemaVersion = task === 'plan'
    ? (data && data.schemaVersion) || schema.SCHEMA_VERSION
    : (data && data.schemaVersion) || schema.REFINE_VERSION;

  return {
    task,
    mode: config.agentMode,
    degraded: !!result.degraded,
    data,
    provider: result.provider || 'mock-rules',
    schemaVersion,
    durationMs: Math.max(0, Math.round(now() - startedAt)),
    attempts: result.attempts || 1,
    clarification
  };
}

module.exports = {
  runAgent,
  loadCore,
  readPrompt,
  DEFAULT_PROMPT_DIR,
  MAX_REPAIR_ATTEMPTS,
  InvalidModelOutput
};
