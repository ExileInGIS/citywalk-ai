#!/usr/bin/env node
/* =====================================================================
 * qa/run-all.js · 一条命令跑完 QA（测试 + 评测 + 自检）
 * ---------------------------------------------------------------------
 * 用法：node qa/run-all.js   （或 pnpm qa）
 * 逐项执行，任何一项失败最终退出码为 1；输出保留各项真实结果。
 * 不引入依赖；使用当前 node 可执行文件。
 * ===================================================================== */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STEPS = [
  { name: '单元 + API + 集成测试', args: ['tests/run.js'] },
  { name: '离线评测', args: ['scripts/eval.js'] },
  { name: '交付一致性自检', args: ['scripts/check.js'] }
];

let failed = 0;
const results = [];

for (const step of STEPS) {
  console.log('\n==============================================================');
  console.log('▶ ' + step.name + '  (node ' + step.args.join(' ') + ')');
  console.log('==============================================================');
  const t0 = Date.now();
  const res = spawnSync(process.execPath, step.args, { cwd: ROOT, stdio: 'inherit' });
  const ms = Date.now() - t0;
  const ok = res.status === 0;
  if (!ok) failed++;
  results.push({ name: step.name, ok, code: res.status, ms });
  console.log((ok ? '✔ 通过' : '✘ 失败') + '：' + step.name + '（' + ms + ' ms）');
}

console.log('\n================ QA 汇总 ================');
results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + ' — exit ' + r.code + ', ' + r.ms + ' ms'));
console.log(failed ? '\n' + failed + ' 项失败' : '\n全部通过');
process.exit(failed ? 1 : 0);
