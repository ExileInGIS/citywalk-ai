#!/usr/bin/env node
/* =====================================================================
 * scripts/check.js · 交付一致性自检
 * ---------------------------------------------------------------------
 * 不引入依赖；检查文档完整性、数据一致性、密钥风险、脚本顺序等。
 * 用法：node scripts/check.js   （或 pnpm check）
 * ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const results = [];

function ok(name, detail) { results.push({ ok: true, name, detail: detail || '' }); }
function bad(name, detail) { results.push({ ok: false, name, detail: detail || '' }); }

function exists(rel) {
  try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (e) { return false; }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ---------- 1. 必备文档 ---------- */
const REQUIRED_DOCS = [
  'docs/COMPETITIVE-ANALYSIS.md',
  'docs/PRODUCT-REQUIREMENTS.md',
  'docs/USER-FLOWS.md',
  'docs/PRODUCT-METRICS.md',
  'docs/ARCHITECTURE.md',
  'docs/AGENT-WORKFLOW.md',
  'docs/RAG-DESIGN.md',
  'docs/API-INTEGRATION.md',
  'docs/TEST-PLAN.md',
  'docs/EVALUATION-REPORT.md',
  'docs/DEPLOYMENT.md',
  'docs/PROJECT-RETROSPECTIVE.md'
];
REQUIRED_DOCS.forEach(f => {
  if (!exists(f)) return bad('document exists: ' + f, 'missing');
  const size = fs.statSync(path.join(ROOT, f)).size;
  if (size < 500) return bad('document non-empty: ' + f, size + ' bytes');
  ok('document: ' + f, size + ' bytes');
});

/* ---------- 2. 数据一致性：data.js vs poi-coords.json ---------- */
try {
  const D = require(path.join(ROOT, 'js/data.js'));
  const P = JSON.parse(read('server/data/poi-coords.json'));
  const byId = {};
  P.places.forEach(p => { byId[p.id] = p; });
  const missing = D.PLACES.filter(p => !byId[p.id]).map(p => p.id);
  if (missing.length) bad('poi-coords covers all places', 'missing: ' + missing.join(','));
  else ok('poi-coords covers all places', D.PLACES.length + ' ids');

  const mismatch = [];
  D.PLACES.forEach(p => {
    const q = byId[p.id];
    if (!q) return;
    const lat = p.lat == null ? null : Number(p.lat.toFixed(6));
    const lon = p.lng == null ? null : Number(p.lng.toFixed(6));
    const qlat = q.lat == null ? null : Number(Number(q.lat).toFixed(6));
    const qlon = q.lon == null ? null : Number(Number(q.lon).toFixed(6));
    if (lat !== qlat || lon !== qlon) mismatch.push(p.id);
  });
  if (mismatch.length) bad('poi-coords matches data.js', mismatch.join(','));
  else ok('poi-coords matches data.js', D.PLACES.filter(p => p.geoVerified).length + ' verified / ' + D.PLACES.filter(p => !p.geoVerified).length + ' null');

  const verified = D.PLACES.filter(p => p.geoVerified).length;
  if (!verified) bad('verified coordinates exist', '0');
  else ok('verified coordinates exist', verified + '/' + D.PLACES.length);
} catch (e) {
  bad('data consistency check runs', e.message);
}

/* ---------- 3. 无真实密钥 ---------- */
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/gi
];
function walkFiles(dir, acc) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  entries.forEach(ent => {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      if (/^(\.git|node_modules|\.pnpm-store|\.config|\.data|\.cache|\.dsh-crew)$/.test(ent.name)) return;
      walkFiles(abs, acc);
    } else if (ent.isFile()) {
      acc.push(rel);
    }
  });
  return acc;
}
function trackedFiles() {
  // 不依赖 git（某些沙箱/环境禁止子进程）；扫描仓库内可读文本文件。
  return walkFiles(ROOT, []);
}
const files = trackedFiles();
let secretHits = [];
files.forEach(f => {
  if (!/\.(js|json|md|html|yml|yaml|env|example|txt)$/i.test(f)) return;
  if (f === '.env.example') return;
  if (/^\.env(\.|$)/.test(f)) return;
  let text = '';
  try { text = read(f); } catch (e) { return; }
  SECRET_PATTERNS.forEach(re => {
    const m = text.match(re);
    if (m) secretHits.push(f + ': ' + m[0].slice(0, 12) + '…');
  });
});
if (files.length === 0) bad('file walk readable', 'no files');
else if (secretHits.length) bad('no hard-coded secrets', secretHits.join(' | '));
else ok('no hard-coded secrets', files.length + ' files scanned');

/* ---------- 4. .gitignore ---------- */
try {
  const gi = read('.gitignore');
  ['.env', 'node_modules', '.pnpm-store'].forEach(k => {
    if (gi.indexOf(k) < 0) bad('.gitignore contains ' + k, 'missing');
    else ok('.gitignore contains ' + k);
  });
} catch (e) { bad('.gitignore readable', e.message); }

/* ---------- 5. 入口脚本与顺序 ---------- */
try {
  const pkg = JSON.parse(read('package.json'));
  ['start', 'test', 'eval'].forEach(k => {
    if (!pkg.scripts || !pkg.scripts[k]) bad('package.json script ' + k, 'missing');
    else ok('package.json script ' + k, pkg.scripts[k]);
  });
  if (!pkg.devDependencies || !pkg.devDependencies.jsdom) bad('jsdom declared', 'missing');
  else ok('jsdom declared', pkg.devDependencies.jsdom);
} catch (e) { bad('package.json readable', e.message); }

try {
  const html = read('index.html');
  const srcs = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["']/g))
    .map(m => m[1].replace(/^\.\//, ''));
  const order = ['js/config.js', 'js/data.js', 'js/schema.js', 'shared/core.js', 'js/ui.js',
    'js/agent.js', 'js/map.js', 'js/storage.js', 'js/telemetry.js',
    'js/pages/home.js', 'js/pages/discover.js', 'js/pages/favorites.js', 'js/app.js'];
  let last = -1;
  const wrong = [];
  order.forEach(f => {
    const i = srcs.indexOf(f);
    if (i < 0) wrong.push('missing ' + f);
    else if (i < last) wrong.push('order ' + f);
    else last = i;
  });
  if (wrong.length) bad('index.html script order', wrong.join(', '));
  else ok('index.html script order', order.length + ' scripts');
  if (html.indexOf('width=device-width') < 0) bad('index.html responsive viewport', 'missing device-width');
  else ok('index.html responsive viewport');
} catch (e) { bad('index.html readable', e.message); }

/* ---------- 6. 关键契约文本 ---------- */
try {
  const api = read('docs/API-INTEGRATION.md');
  if (api.indexOf('/api/agent/run') < 0) bad('API doc mentions /api/agent/run', 'missing');
  else ok('API doc mentions /api/agent/run');
  if (api.indexOf('requestId') < 0 || api.indexOf('traceId') < 0) bad('API doc mentions requestId/traceId', 'missing');
  else ok('API doc mentions requestId/traceId');
} catch (e) { bad('API doc readable', e.message); }

/* ---------- 7. 文档一致性（避免“已上线”等不实表述） ---------- */
const FORBIDDEN_CLAIMS = [
  { re: /已上线|已经上线|正式发布到公网/, why: '未部署公网，不能声称上线' },
  { re: /用户调研(显示|表明|证实)/, why: '没有真实用户调研' }
];
files.filter(f => /^docs\/.*\.md$/.test(f)).forEach(f => {
  let t = '';
  try { t = read(f); } catch (e) { return; }
  const lines = t.split(/\r?\n/);
  FORBIDDEN_CLAIMS.forEach(rule => {
    lines.forEach((line, idx) => {
      if (rule.re.test(line) && !/未|不|禁止|不得|没有|非|无/.test(line)) {
        bad('no unverified claim in ' + f, rule.why + ' (line ' + (idx + 1) + ')');
      }
    });
  });
});
ok('unverified-claim scan finished', files.length + ' tracked files');

/* ---------- 输出 ---------- */
const pass = results.filter(r => r.ok).length;
const fail = results.length - pass;
results.forEach(r => {
  console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.detail ? ' — ' + r.detail : ''));
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
