#!/usr/bin/env node
/* =====================================================================
 * tests/run.js · 在进程内依次加载测试文件
 * ---------------------------------------------------------------------
 * 为什么不用 `node --test <目录>`：
 *   · Node 的测试 runner 会为每个文件 spawn 子进程，在受限沙箱/部分
 *     Windows 环境中会出现 EPERM（named pipe）；
 *   · `--test-isolation=none` 只在较新 Node 可用。
 * 本 runner 直接 require 测试文件，由 node:test 在当前进程执行并汇总，
 * 退出码能正确反映失败。用法：
 *   node tests/run.js            # 全部
 *   node tests/run.js unit       # 只跑 tests/unit
 *   node tests/run.js api ui     # 可组合
 * ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALL = ['unit', 'api', 'integration'];
const wanted = process.argv.slice(2).filter(Boolean);
const groups = wanted.length ? wanted : ALL;

const files = [];
groups.forEach(group => {
  const dir = path.join(ROOT, 'tests', group);
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir)
    .filter(f => f.endsWith('.test.js'))
    .sort()
    .forEach(f => files.push(path.join(dir, f)));
});

if (!files.length) {
  console.error('[tests] 没有找到测试文件：' + groups.join(', '));
  process.exit(1);
}

console.log('[tests] 加载 ' + files.length + ' 个测试文件：' + files.map(f => path.relative(ROOT, f)).join(', '));
files.forEach(f => require(f));
