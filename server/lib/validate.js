/* =====================================================================
 * validate.js · 请求输入校验（只做结构与范围，不做路线业务规则）
 * ---------------------------------------------------------------------
 * 业务规则在 shared/core.js；这里负责：
 *  - /api/agent/run 的 task / payload / conditions / refine 校验；
 *  - 提示注入迹象检测（只返回 boolean，绝不记录原文）；
 *  - /api/events 的事件名白名单与批量上限。
 * ===================================================================== */
'use strict';

const schema = require('../../js/schema.js');
const { ApiError } = require('./http');

/** 匿名事件白名单，来自 docs/PRODUCT-METRICS.md 2.2。 */
const EVENT_WHITELIST = new Set([
  'plan_started',
  'clarify_shown',
  'clarify_answered',
  'plan_succeeded',
  'plan_failed',
  'refine_started',
  'refine_succeeded',
  'refine_failed',
  'conflict_shown',
  'conflict_option_clicked',
  'route_saved',
  'route_exported',
  'route_copied',
  'agent_degraded',
  'map_failed',
  'retry_clicked'
]);

const MAX_EVENTS_PER_REQUEST = 50;

/** 常见提示注入句式。只用于记一个 boolean 安全信号，不改变确定性流程。 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /忽略(之前|以上|前面|上述|你).{0,8}(指令|规则|要求|提示)/,
  /(system|developer)\s*prompt/i,
  /(泄露|输出|告诉我|展示).{0,10}(提示词|系统提示|prompt)/i,
  /(你现在是|从现在开始你是|假装你是|扮演)/,
  /(jailbreak|developer\s*mode|dan\s*mode)/i,
  /(跳过|绕过|关闭).{0,8}(校验|规则|限制|审核)/,
  /<\s*script|javascript\s*:|data:text\/html/i
];

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(message, details) {
  throw new ApiError('INVALID_INPUT', message, { details });
}

function detectInjection(text) {
  if (typeof text !== 'string' || !text) return false;
  return INJECTION_PATTERNS.some(re => re.test(text));
}

/** 汇总用户可控文本，用于注入迹象检测（不落日志、不回传）。 */
function collectUserText(task, payload) {
  if (!isPlainObject(payload)) return '';
  if (task === 'refine') return typeof payload.text === 'string' ? payload.text : '';
  const cond = isPlainObject(payload.conditions) ? payload.conditions : {};
  return [cond.additionalRequirements, cond.startLocation]
    .filter(value => typeof value === 'string' && value)
    .join('\n');
}

function checkRawConditionTypes(cond, errors) {
  if (cond.city !== undefined && cond.city !== null && typeof cond.city !== 'string') {
    errors.push({ path: 'payload.conditions.city', message: '城市必须是字符串' });
  }
  if (cond.city !== undefined && cond.city !== null && typeof cond.city === 'string' && cond.city.length > 40) {
    errors.push({ path: 'payload.conditions.city', message: '城市名过长' });
  }
  if (
    cond.durationMin !== undefined &&
    cond.durationMin !== null &&
    !(typeof cond.durationMin === 'number' && Number.isFinite(cond.durationMin))
  ) {
    errors.push({ path: 'payload.conditions.durationMin', message: '时长必须是数字（分钟）' });
  }
  if (
    cond.budgetMax !== undefined &&
    cond.budgetMax !== null &&
    !(typeof cond.budgetMax === 'number' && Number.isFinite(cond.budgetMax))
  ) {
    errors.push({ path: 'payload.conditions.budgetMax', message: '预算必须是数字或 null' });
  }
  ['startTime', 'endTime'].forEach(key => {
    if (cond[key] !== undefined && cond[key] !== null && typeof cond[key] !== 'string') {
      errors.push({ path: 'payload.conditions.' + key, message: '时间必须是 HH:mm 字符串' });
    }
  });
  ['interests', 'avoid', 'mustVisit', 'foodPreferences', 'accessibility'].forEach(key => {
    if (cond[key] !== undefined && cond[key] !== null && !Array.isArray(cond[key])) {
      errors.push({ path: 'payload.conditions.' + key, message: '必须是数组' });
    }
  });
}

function validatePlan(conditions) {
  if (!isPlainObject(conditions)) {
    fail('payload.conditions 必须是对象', [{ path: 'payload.conditions', message: '必须是对象' }]);
  }

  const manual = [];
  checkRawConditionTypes(conditions, manual);

  const check = schema.validateConditions(conditions);
  check.errors.forEach(item => {
    // 缺少城市/时长属于「信息不完整」，应该走 clarification（200），
    // 而不是当成参数非法拒绝。这里只过滤「城市必填」这一条。
    if (item.path === 'conditions.city' && /必填/.test(item.message)) return;
    manual.push({ path: 'payload.' + item.path, message: item.message });
  });

  if (manual.length) fail('请求参数不合法', manual.slice(0, 8));

  const normalized = schema.normalizeConditions(conditions);
  return { task: 'plan', payload: { conditions: normalized } };
}

function validateRefine(payload) {
  const text = payload.text;
  if (typeof text !== 'string' || !text.trim()) {
    fail('payload.text 必须是非空字符串', [{ path: 'payload.text', message: '必须是非空字符串' }]);
  }
  if (text.length > schema.LIMITS.textLen) {
    fail('调整指令不能超过 2000 字', [{ path: 'payload.text', message: '超过 2000 字' }]);
  }
  if (!isPlainObject(payload.route)) {
    fail('payload.route 必须是 Route v1 对象', [{ path: 'payload.route', message: '必须是对象' }]);
  }
  const check = schema.validateRoute(payload.route);
  if (!check.ok) {
    fail('payload.route 不是合法的 Route v1', check.errors.slice(0, 8));
  }
  let route;
  try {
    route = JSON.parse(JSON.stringify(payload.route));
  } catch (_) {
    fail('payload.route 无法解析', [{ path: 'payload.route', message: '不是可序列化对象' }]);
  }
  return { task: 'refine', payload: { text: text.trim(), route } };
}

/**
 * 校验 /api/agent/run 的请求体。
 * @param {unknown} body
 * @returns {{task: 'plan'|'refine', payload: object}}
 */
function validateAgentRequest(body) {
  if (!isPlainObject(body)) fail('请求体必须是 JSON 对象');
  const task = body.task;
  if (task !== 'plan' && task !== 'refine') {
    fail('task 必须是 plan 或 refine', [{ path: 'task', message: '只支持 plan / refine' }]);
  }
  const payload = body.payload;
  if (!isPlainObject(payload)) {
    fail('payload 必须是对象', [{ path: 'payload', message: '必须是对象' }]);
  }
  if (task === 'plan') return validatePlan(payload.conditions);
  return validateRefine(payload);
}

/**
 * 校验 /api/events 请求体。只统计白名单事件的数量，
 * 不保存、不记录事件里的其它字段（避免自由文本/PII 进入日志）。
 * @returns {{accepted: number, ignored: number, counts: Record<string, number>}}
 */
function validateEventsBody(body) {
  if (!isPlainObject(body)) fail('请求体必须是 JSON 对象');
  let list;
  if (Array.isArray(body.events)) {
    list = body.events;
  } else if (typeof body.event === 'string') {
    list = [body];
  } else {
    fail('events 必须是数组', [{ path: 'events', message: '必须是数组' }]);
  }
  if (list.length > MAX_EVENTS_PER_REQUEST) {
    fail('单次最多上报 50 条事件', [{ path: 'events', message: '超过 50 条' }]);
  }

  const counts = Object.create(null);
  let accepted = 0;
  let ignored = 0;
  list.forEach(item => {
    if (!isPlainObject(item) || typeof item.event !== 'string' || !EVENT_WHITELIST.has(item.event)) {
      ignored += 1;
      return;
    }
    counts[item.event] = (counts[item.event] || 0) + 1;
    accepted += 1;
  });
  return { accepted, ignored, counts };
}

module.exports = {
  EVENT_WHITELIST,
  MAX_EVENTS_PER_REQUEST,
  detectInjection,
  collectUserText,
  validateAgentRequest,
  validateEventsBody
};
