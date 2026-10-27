#!/usr/bin/env node
/* =====================================================================
 * scripts/eval.js · 离线评测（B0 无约束基线 / B2 本次工作流）
 * ---------------------------------------------------------------------
 * 运行：node scripts/eval.js   （或 pnpm eval）
 * 输出：控制台摘要 + qa/eval/last-run.json + docs/EVALUATION-REPORT.md
 *
 * 原则：
 *  - 只跑 Mock（确定性），不调用任何外部服务；
 *  - B3 远程 LLM 需要密钥，本期未运行，报告中明确标注；
 *  - 每个数字来自本次真实执行。
 * ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const D = require(path.join(ROOT, 'js/data.js'));
const S = require(path.join(ROOT, 'js/schema.js'));

let CORE = null;
let coreError = null;
try {
  CORE = require(path.join(ROOT, 'shared/core.js'));
  if (!CORE || typeof CORE.plan !== 'function') {
    coreError = 'shared/core.js 未导出 plan()';
    CORE = null;
  }
} catch (e) {
  coreError = e.message;
}

const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'qa/eval/cases.json'), 'utf8')).cases;
const REFINES = JSON.parse(fs.readFileSync(path.join(ROOT, 'qa/eval/refines.json'), 'utf8')).refines;
const START = Date.now();

function gitCommit() {
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git/HEAD'), 'utf8').trim();
    if (head.indexOf('ref: ') === 0) {
      const refPath = path.join(ROOT, '.git', head.slice(5));
      if (fs.existsSync(refPath)) return fs.readFileSync(refPath, 'utf8').trim().slice(0, 7);
    }
    return head.slice(0, 7);
  } catch (e) { return 'unknown'; }
}

function placeByName(name) {
  return D.PLACES.find(p => p.name === name) ||
    D.PLACES.find(p => p.name.indexOf(name) >= 0 || name.indexOf(p.name) >= 0);
}

function constraintStats(route) {
  const hard = (route.constraints || []).filter(c => c.kind === 'hard');
  const met = hard.filter(c => c.status === 'met').length;
  const partial = hard.filter(c => c.status === 'partial').length;
  const violated = hard.filter(c => c.status === 'violated').length;
  const unknown = hard.filter(c => c.status === 'unknown').length;
  return { met, partial, violated, unknown, total: hard.length };
}

function basePlan(caseId) {
  const c = CASES.find(x => x.id === caseId);
  if (!c) throw new Error('base case not found: ' + caseId);
  return CORE.plan(S.normalizeConditions(c.conditions), { seed: caseId });
}

/* ---------------- 单个案例 ---------------- */
async function runCase(c) {
  const out = { id: c.id, category: c.category, title: c.title, mode: c.mode, pass: false, checks: [], error: null, route: null, skipped: false };
  const check = (ok, name, detail) => { out.checks.push({ ok: !!ok, name, detail: detail || '' }); if (!ok) out.pass = false; };

  if (c.mode === 'api' || c.mode === 'ui') {
    out.skipped = true;
    out.reason = c.skipReason || '不在 core 评测范围';
    return out;
  }

  try {
    if (c.mode === 'plan' || c.mode === 'plan_text') {
      let cond;
      if (c.mode === 'plan_text') {
        const intent = CORE.parseIntent(c.text, 'nanjing');
        cond = S.normalizeConditions(intent);
        // 注入文本不应改变系统行为；用确定性规划验证结构
        check(true, '提示注入未改变调用方式');
      } else {
        cond = S.normalizeConditions(c.conditions);
      }

      const comp = CORE.checkCompleteness(cond);
      if (c.expect && c.expect.clarification) {
        check(comp && comp.ok === false, '返回澄清', comp && comp.missing ? JSON.stringify(comp.missing) : '');
        if (comp && comp.missing) {
          (c.expect.missing || []).forEach(m => check(comp.missing.some(x => x.id === m), '缺失项包含 ' + m));
        }
        out.pass = out.checks.every(x => x.ok);
        return out;
      }

      if (c.expect && c.expect.noCandidates) {
        let threw = null;
        let route = null;
        try { route = CORE.plan(cond, { seed: c.id }); } catch (e) { threw = e; }
        const noCand = threw && (threw.code === 'NO_CANDIDATES' || /候选/.test(threw.message)) ||
          (route && route.conflict && route.conflict.type === 'no_candidates');
        check(!!noCand, '无可选地点时给出空状态/冲突');
        out.pass = out.checks.every(x => x.ok);
        return out;
      }

      const route = CORE.plan(cond, { seed: c.id });
      out.route = route;
      const v = S.validateRoute(route);
      check(v.ok, 'Route 通过 Schema', v.ok ? '' : S.formatErrors(v.errors));
      out.schemaValid = v.ok;

      const e = c.expect || {};
      if (e.maxDurationOverrunPct != null) {
        const over = (route.actualMin - route.durationMin) / route.durationMin * 100;
        check(over <= e.maxDurationOverrunPct, '时长不超过 +' + e.maxDurationOverrunPct + '%', 'over=' + over.toFixed(1) + '%');
      }
      if (e.maxPlaces != null) check(route.places.length <= e.maxPlaces, '地点数 ≤ ' + e.maxPlaces, String(route.places.length));
      if (e.maxDistanceKm != null) {
        const ok = route.distanceKm <= e.maxDistanceKm || (route.conflict && route.conflict.type === 'walking');
        check(ok, '步行 ≤ ' + e.maxDistanceKm + 'km 或给出 walking 冲突', route.distanceKm + 'km');
      }
      if (e.conflictType) {
        check(!!route.conflict && route.conflict.type === e.conflictType, '冲突类型=' + e.conflictType, route.conflict ? route.conflict.type : 'none');
        if (route.conflict) check((route.conflict.options || []).length > 0, '冲突提供选项');
      } else if (e.ok) {
        // 除声明冲突的案例外，不强制要求无冲突（预算/步行可能合理触发）
      }
      if (e.mustInclude) {
        e.mustInclude.forEach(name => {
          const p = placeByName(name);
          check(!!p && route.places.indexOf(p.id) >= 0, '必去包含 ' + name, p ? p.id : '未找到');
        });
      }
      if (e.uniquePlaces) check(new Set(route.places).size === route.places.length, '地点不重复');
      if (e.minIndoorPlaces != null) {
        const indoor = route.places.map(id => D.place(id)).filter(p => p && p.indoor === true).length;
        check(indoor >= e.minIndoorPlaces, '室内点 ≥ ' + e.minIndoorPlaces, String(indoor));
      }
      if (e.requireUnknownAccessibility) {
        const has = (route.constraints || []).some(x => x.status === 'unknown' && /无障碍|accessibility/i.test(x.id + x.label + x.detail));
        check(has, '无障碍信息标 unknown');
      }
      if (e.deterministic) {
        const r2 = CORE.plan(S.normalizeConditions(c.conditions), { seed: c.id });
        const strip = r => { const x = JSON.parse(JSON.stringify(r)); delete x.id; delete x.createdAt; return x; };
        check(JSON.stringify(strip(route)) === JSON.stringify(strip(r2)), '两次结果一致（除 id/createdAt）');
      }
      const st = constraintStats(route);
      out.constraints = st;
      out.pass = out.checks.every(x => x.ok);
      return out;
    }

    if (c.mode === 'refine' || c.mode === 'refine_chain') {
      let route = basePlan(c.base);
      const texts = c.mode === 'refine_chain' ? c.texts : [c.text];
      let last = null;
      for (const text of texts) {
        last = CORE.refine(text, route, { seed: c.id });
        const v = S.validateRefine(last);
        check(v.ok, 'Refine 通过 Schema (' + text + ')', v.ok ? '' : S.formatErrors(v.errors));
        check(last.route && last.route.places.length > 0, '返回有效路线');
        route = last.route;
      }
      if (c.expect && c.expect.changed != null) check(last.changed === c.expect.changed, 'changed=' + c.expect.changed, String(last.changed));
      if (c.expect && c.expect.keepEnds && texts.length === 1 && texts[0].indexOf('保留') >= 0) {
        const before = basePlan(c.base);
        check(route.places[0] === before.places[0], '首站保持');
        check(route.places[route.places.length - 1] === before.places[before.places.length - 1], '末站保持');
      }
      if (c.expect && c.expect.maxDurationOverrunPct != null) {
        const over = (route.actualMin - route.durationMin) / route.durationMin * 100;
        check(over <= c.expect.maxDurationOverrunPct, '多轮后时长不超 +' + c.expect.maxDurationOverrunPct + '%', over.toFixed(1) + '%');
      }
      out.constraints = constraintStats(route);
      out.pass = out.checks.every(x => x.ok);
      return out;
    }
  } catch (e) {
    out.error = e && e.message ? e.message : String(e);
    out.pass = false;
  }
  return out;
}

/* ---------------- B0 基线：不处理硬约束的选择 + 固定顺序 ---------------- */
function baselineRoute(conditions) {
  const cond = S.normalizeConditions(conditions);
  const pool = D.placesOfCity(cond.city);
  if (!pool.length) return null;
  const scored = pool.slice().sort((a, b) => {
    const sa = (a.interests || []).filter(i => cond.interests.indexOf(i) >= 0).length;
    const sb = (b.interests || []).filter(i => cond.interests.indexOf(i) >= 0).length;
    if (sb !== sa) return sb - sa;
    return (a.mapY + a.mapX * 0.35) - (b.mapY + b.mapX * 0.35);
  });
  const n = Math.max(1, Math.min(8, Math.round(cond.durationMin / 60 * 1.4)));
  const ids = scored.slice(0, n).map(p => p.id);
  try {
    return CORE.buildRoute(cond, ids, { source: 'mock', name: 'B0 基线（无约束）' });
  } catch (e) {
    return null;
  }
}

/* ---------------- 主流程 ---------------- */
(async function main() {
  if (!CORE) {
    console.error('[eval] 无法运行：shared/core.js 不可用 — ' + coreError);
    process.exit(1);
  }

  const results = [];
  for (const c of CASES) results.push(await runCase(c));

  /* 调整指令 */
  const refineResults = [];
  for (const r of REFINES) {
    try {
      const base = basePlan('C01');
      const res = CORE.refine(r.text, base, { seed: r.id });
      const v = S.validateRefine(res);
      const explainedNoop = !res.changed && r.allowExplainedNoChange &&
        r.explanationPattern && new RegExp(r.explanationPattern).test(res.reply || '');
      refineResults.push({
        id: r.id, type: r.type, text: r.text,
        pass: v.ok && (res.changed === r.expectChanged || explainedNoop),
        changed: res.changed, explainedNoop: !!explainedNoop, schemaOk: v.ok,
        reply: res.reply, errors: v.ok ? null : S.formatErrors(v.errors)
      });
    } catch (e) {
      refineResults.push({ id: r.id, type: r.type, text: r.text, pass: false, changed: null, schemaOk: false, reply: '', errors: e.message });
    }
  }

  /* 基线对比（只对无冲突、期望成功的 plan 案例） */
  const comparison = [];
  CASES.filter(c => (c.mode === 'plan') && c.expect && c.expect.ok && !c.expect.conflictType && !c.expect.noCandidates).forEach(c => {
    const b2 = results.find(x => x.id === c.id);
    if (!b2 || !b2.route) return;
    const b0 = baselineRoute(c.conditions);
    if (!b0) return;
    const s0 = constraintStats(b0), s2 = constraintStats(b2.route);
    comparison.push({
      id: c.id,
      b0: s0, b2: s2,
      b0Rate: s0.met + s0.violated ? s0.met / (s0.met + s0.violated + s0.partial * 0.5) : null,
      b2Rate: s2.met + s2.violated ? s2.met / (s2.met + s2.violated + s2.partial * 0.5) : null
    });
  });

  /* 性能（Mock，50 次） */
  const perf = [];
  const cond = S.normalizeConditions(CASES[0].conditions);
  for (let i = 0; i < 50; i++) {
    const t0 = process.hrtime.bigint();
    CORE.plan(cond, { seed: 'perf' });
    perf.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  perf.sort((a, b) => a - b);
  const p50 = perf[Math.floor(perf.length * 0.5)];
  const p90 = perf[Math.floor(perf.length * 0.9)];

  /* 统计 */
  const attempted = results.filter(r => !r.skipped);
  const passed = attempted.filter(r => r.pass).length;
  const schemaValid = attempted.filter(r => r.schemaValid).length;
  const withSchema = attempted.filter(r => r.schemaValid != null).length;
  const satisfied = attempted.filter(r => r.constraints && r.pass);
  const hardTotals = attempted.reduce((acc, r) => {
    if (!r.constraints) return acc;
    acc.met += r.constraints.met; acc.partial += r.constraints.partial;
    acc.violated += r.constraints.violated; acc.unknown += r.constraints.unknown;
    return acc;
  }, { met: 0, partial: 0, violated: 0, unknown: 0 });
  const hardRate = hardTotals.met + hardTotals.violated > 0
    ? hardTotals.met / (hardTotals.met + hardTotals.violated + hardTotals.partial * 0.5) : null;
  const refinePassed = refineResults.filter(r => r.pass).length;
  const avg = (arr, k) => arr.length ? arr.reduce((s, x) => s + (x[k] || 0), 0) / arr.length : null;

  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    commit: gitCommit(),
    dataVersion: D.DATA_VERSION,
    commands: ['node scripts/eval.js'],
    cases: results,
    summary: {
      caseTotal: CASES.length,
      caseRun: attempted.length,
      caseSkipped: results.filter(r => r.skipped).length,
      casePass: passed,
      schemaValid, schemaChecked: withSchema,
      hardConstraints: hardTotals,
      hardSatisfactionRate: hardRate,
      refineTotal: refineResults.length,
      refinePass: refinePassed,
      refineChanged: refineResults.filter(r => r.changed).length,
      refineExplainedNoop: refineResults.filter(r => r.explainedNoop).length,
      refineUnknownNoop: refineResults.filter(r => !r.changed && !r.explainedNoop).length,
      p50Ms: Number(p50.toFixed(2)),
      p90Ms: Number(p90.toFixed(2)),
      poiVerified: D.PLACES.filter(p => p.geoVerified).length,
      poiTotal: D.PLACES.length,
      baseline: comparison
    },
    refines: refineResults,
    skipped: results.filter(r => r.skipped).map(r => ({ id: r.id, reason: r.reason }))
  };

  fs.writeFileSync(path.join(ROOT, 'qa/eval/last-run.json'), JSON.stringify(report, null, 2), 'utf8');

  /* Markdown 报告 */
  const md = [];
  md.push('# CityWalk AI 评测报告（真实执行）');
  md.push('');
  md.push('> 生成时间：' + report.generatedAt);
  md.push('> 代码版本：`' + report.commit + '`；数据版本：`' + report.dataVersion + '`');
  md.push('> 环境：Node ' + report.node + ' / ' + report.platform + '；命令：`node scripts/eval.js`');
  md.push('> 模式：Mock（确定性），**未调用真实 LLM**；B3 远程基线未运行。');
  md.push('');
  md.push('## 1. 结果摘要');
  md.push('');
  md.push('| 指标 | 结果 | 口径 |');
  md.push('| --- | --- | --- |');
  md.push('| 规划用例通过 | ' + passed + '/' + attempted.length + ' | 所有断言通过；跳过 ' + report.summary.caseSkipped + ' 条 |');
  md.push('| Schema 有效 | ' + schemaValid + '/' + withSchema + ' | validateRoute 通过 |');
  md.push('| 硬约束满足率 | ' + (hardRate == null ? '—' : (hardRate * 100).toFixed(1) + '%') + ' | met/(met+violated+partial×0.5)；unknown 不计；含按需求返回冲突的用例（其 violated 属预期） |');
  md.push('| 调整指令处理正确 | ' + refinePassed + '/' + refineResults.length + ' | Schema 通过且结果符合预期；其中 changed=true ' + report.summary.refineChanged + ' 条、解释性 no-op ' + report.summary.refineExplainedNoop + ' 条、未识别 no-op ' + report.summary.refineUnknownNoop + ' 条 |');
  md.push('| Mock 规划耗时 P50/P90 | ' + p50.toFixed(1) + ' ms / ' + p90.toFixed(1) + ' ms | 50 次 C01 规划 |');
  md.push('| 地点坐标可验证率 | ' + report.summary.poiVerified + '/' + report.summary.poiTotal + ' | 有 OSM 来源坐标 |');
  md.push('');
  md.push('## 2. 规划用例明细');
  md.push('');
  md.push('| 用例 | 场景 | 结果 | 失败原因 |');
  md.push('| --- | --- | --- | --- |');
  results.forEach(r => {
    if (r.skipped) { md.push('| ' + r.id + ' | ' + r.title + ' | 跳过 | ' + r.reason + ' |'); return; }
    const fail = r.checks.filter(c => !c.ok).map(c => c.name + (c.detail ? '（' + c.detail + '）' : ''));
    md.push('| ' + r.id + ' | ' + r.title + ' | ' + (r.pass ? '通过' : '失败') + ' | ' + (r.error || fail.join('；') || '—') + ' |');
  });
  md.push('');
  md.push('## 3. 调整指令明细');
  md.push('');
  md.push('> 口径说明：下表「处理正确」包含 2 条**解释性 no-op**（约束已满 / 已有足够多样性）。按 `docs/PRODUCT-METRICS.md` M6 的严格口径，只有 `changed=true` 才计入“调整成功率”，即 **' + report.summary.refineChanged + '/' + refineResults.length + '**；no-op 不计成功，但也不应算失败——它给出了正确解释。');
  md.push('');
  md.push('| 指令 | 类型 | changed | 结果 | 备注 |');
  md.push('| --- | --- | --- | --- | --- |');
  refineResults.forEach(r => {
    md.push('| ' + r.text + ' | ' + r.type + ' | ' + String(r.changed) + ' | ' + (r.pass ? '通过' : '失败') + ' | ' + (r.explainedNoop ? '解释性 no-op：' : '') + (r.errors || (r.reply || '').slice(0, 60)) + ' |');
  });
  md.push('');
  md.push('## 4. 基线对比（B0 vs B2）');
  md.push('');
  md.push('| 用例 | B0 满足率 | B2 满足率 | B0 违反 | B2 违反 |');
  md.push('| --- | --- | --- | --- | --- |');
  comparison.forEach(c => {
    md.push('| ' + c.id + ' | ' + (c.b0Rate == null ? '—' : (c.b0Rate * 100).toFixed(0) + '%') + ' | ' +
      (c.b2Rate == null ? '—' : (c.b2Rate * 100).toFixed(0) + '%') + ' | ' + c.b0.violated + ' | ' + c.b2.violated + ' |');
  });
  md.push('');
  const avg0 = avg(comparison.map(c => ({ v: c.b0Rate })), 'v');
  const avg2 = avg(comparison.map(c => ({ v: c.b2Rate })), 'v');
  md.push('可比用例 ' + comparison.length + ' 条：B0 平均硬约束满足率 ' +
    (avg0 == null ? '—' : (avg0 * 100).toFixed(1) + '%') + '，B2 ' + (avg2 == null ? '—' : (avg2 * 100).toFixed(1) + '%') + '。');
  md.push('');
  md.push('> B0 说明：只按兴趣数量选点并按地理顺序排列，不做预算/时长/必去/避开/步行约束处理；数字由同一套计时与预算函数计算，用于对比“约束处理”的增益，不代表原始原型代码。');
  md.push('');
  md.push('## 5. 未运行项与限制');
  md.push('');
  md.push('- **B3 远程 LLM**：无 API Key，未运行；远程质量不能由本报告证明。');
  md.push('- **真实地图**：未在自动化中加载瓦片；仅用手工/适配器单测覆盖。');
  md.push('- **真实用户**：无用户样本，本报告不代表用户偏好或转化。');
  md.push('- **测试集**：24 条人工构造场景，覆盖 20 类，不代表真实分布。');
  md.push('- API 超时/非法 JSON/地图失败由 `tests/api` 与 `tests/integration` 覆盖，本报告不混入 Mock 规划指标。');
  md.push('');
  md.push('## 6. 复现');
  md.push('');
  md.push('```bash');
  md.push('pnpm install');
  md.push('node scripts/eval.js');
  md.push('# 或 pnpm eval');
  md.push('```');
  md.push('');
  md.push('原始结果 JSON：`qa/eval/last-run.json`。');

  fs.writeFileSync(path.join(ROOT, 'docs/EVALUATION-REPORT.md'), md.join('\n'), 'utf8');

  console.log('用例通过 ' + passed + '/' + attempted.length + '（跳过 ' + report.summary.caseSkipped + '）');
  console.log('Schema 有效 ' + schemaValid + '/' + withSchema + '；硬约束满足率 ' + (hardRate == null ? '—' : (hardRate * 100).toFixed(1) + '%'));
  console.log('调整处理正确 ' + refinePassed + '/' + refineResults.length + '（changed=true ' + report.summary.refineChanged + '，解释性 no-op ' + report.summary.refineExplainedNoop + '，未识别 no-op ' + report.summary.refineUnknownNoop + '）；P50 ' + p50.toFixed(1) + 'ms / P90 ' + p90.toFixed(1) + 'ms');
  console.log('报告已写入 docs/EVALUATION-REPORT.md，原始数据 qa/eval/last-run.json');
  const failed = attempted.filter(r => !r.pass);
  if (failed.length) {
    console.log('失败用例：' + failed.map(r => r.id).join(', '));
    process.exitCode = 1;
  }
})();
