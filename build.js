/* =====================================================================
 * build.js · 打包为单文件 HTML
 *   把 CSS / JS 内联，并把 assets/img/*.jpg 转成 base64 data URI，
 *   输出「CityWalk-AI.html」，可直接双击打开，不依赖任何外部文件。
 *   用法： node build.js
 * ===================================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'CityWalk-AI.html');

const JS_ORDER = [
  // config 必须第一；shared/core.js 在 schema/data 之后提供确定性规划核心
  'js/config.js',
  'js/data.js', 'js/schema.js', 'shared/core.js',
  'js/ui.js', 'js/agent.js', 'js/map.js', 'js/storage.js', 'js/telemetry.js',
  'js/pages/home.js', 'js/pages/discover.js', 'js/pages/favorites.js', 'js/app.js'
];

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* 图片 → data URI */
function imgDataUri(rel) {
  const abs = path.join(ROOT, rel);
  const buf = fs.readFileSync(abs);
  const ext = path.extname(rel).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

let html = read('index.html');

/* 1. CSS 内联 */
const css = read('css/style.css');
html = html.replace(/<link rel="stylesheet" href="\.\/css\/style\.css"\s*\/?>/, () => `<style>\n${css}\n</style>`);

/* 2. JS 内联（保持加载顺序）。用 index.html 里的脚本注释块作为锚点，
 *    从该注释到 </body> 之间整段替换，避免宽泛正则误吞源码字符。
 *    示例适配器 / CDN 位于该锚点之前，自然保留为注释、不会被内联。 */
const scripts = JS_ORDER.map(f => `/* ===== ${f} ===== */\n${read(f)}`).join('\n\n');
const anchor = '<!-- ============ 脚本';
const ai = html.indexOf(anchor);
if (ai < 0) throw new Error('index.html 缺少脚本锚点注释');
html = html.slice(0, ai) +
  `<!-- ============ 脚本（已内联，顺序同 index.html） ============ -->\n<script>\n${scripts}\n</script>\n</body>` +
  html.slice(html.indexOf('</body>', ai) + '</body>'.length);

/* 3. 图片 → base64（CSS 与 JS 中的相对路径统一替换） */
let count = 0, bytes = 0;
html = html.replace(/assets\/img\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png)/g, m => {
  try {
    const uri = imgDataUri(m);
    count++; bytes += uri.length;
    return uri;
  } catch (e) {
    console.warn('  ! 缺少图片：' + m);
    return m;
  }
});

fs.writeFileSync(OUT, html, 'utf8');

const size = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('已生成：' + OUT);
console.log('  内联图片 ' + count + ' 张（base64 约 ' + (bytes / 1024).toFixed(0) + ' KB）');
console.log('  文件大小 ' + size + ' KB');
