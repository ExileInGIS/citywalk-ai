/* =====================================================================
 * ids.js · 请求标识生成与净化
 * ---------------------------------------------------------------------
 * requestId / traceId 用于把一次请求在日志与前端错误提示里串起来。
 * 头部值必须校验后才继承，防止任意字符串进入日志或响应头。
 * ===================================================================== */
'use strict';

const crypto = require('node:crypto');

/** 允许继承的 id：长度 1–128，只含常见的安全字符。 */
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function newRequestId() {
  return uuid();
}

function newTraceId() {
  return uuid();
}

/** 校验外部传入的 id 是否可安全继承；不合法返回 null。 */
function pickIncomingId(value) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return ID_PATTERN.test(v) ? v : null;
}

function isValidId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value.trim());
}

module.exports = {
  ID_PATTERN,
  uuid,
  newRequestId,
  newTraceId,
  pickIncomingId,
  isValidId
};
