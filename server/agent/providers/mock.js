/* =====================================================================
 * mock.js · 确定性 Mock Provider
 * ---------------------------------------------------------------------
 * 唯一职责：调用 shared/core.js 的确定性实现，不复制任何规划/调整逻辑。
 * 输出仍由 agent/run.js 做 Schema 校验与来源标记。
 * ===================================================================== */
'use strict';

const { ApiError } = require('../../lib/http');

function coreUnavailable(missing) {
  return new ApiError('INTERNAL', '确定性核心模块 shared/core.js 不可用', {
    details: { missing }
  });
}

function hasFunction(core, names) {
  return names.some(name => core && typeof core[name] === 'function');
}

function firstFunction(core, names) {
  for (const name of names) {
    if (core && typeof core[name] === 'function') return core[name];
  }
  return null;
}

/**
 * @param {{core: object, conditions: object}} input
 * @returns {object} Route v1（未校验，由 run.js 校验）
 */
function plan(input) {
  const core = input && input.core;
  const fn = firstFunction(core, ['plan', 'planRoute']);
  if (!fn) throw coreUnavailable(['plan']);
  return fn(input.conditions);
}

/**
 * @param {{core: object, text: string, route: object}} input
 * @returns {object} RefineResult v1（未校验，由 run.js 校验）
 */
function refine(input) {
  const core = input && input.core;
  const fn = firstFunction(core, ['refine', 'applyInstruction']);
  if (!fn) throw coreUnavailable(['refine']);
  return fn(input.text, input.route);
}

module.exports = {
  id: 'mock-rules',
  hasPlan: (core) => hasFunction(core, ['plan', 'planRoute']),
  hasRefine: (core) => hasFunction(core, ['refine', 'applyInstruction']),
  plan,
  refine
};
