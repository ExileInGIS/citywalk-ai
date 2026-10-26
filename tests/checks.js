/* 补充校验：异常场景文案、地图结构、拖拽排序、反向联动、无死按钮 */
const fs = require('fs');
const { JSDOM } = require('/tmp/node_modules/jsdom');
const dir = '/Coze/Drive/扣子/citywalk-ai';
const html = fs.readFileSync(dir + '/CityWalk-AI.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, l, e) { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l + (e ? ' → ' + e : '')); } }

/* ---------- A. 静态：按钮是否有绑定 ---------- */
console.log('\n[A] 按钮绑定完整性（防止装饰性按钮）');
['js/pages/home.js', 'js/pages/discover.js', 'js/pages/favorites.js', 'js/app.js'].forEach(f => {
  const s = fs.readFileSync(dir + '/' + f, 'utf8');
  const acts = new Set();
  const re = /data-act="([a-zA-Z0-9_]+)"/g; let m;
  while ((m = re.exec(s))) acts.add(m[1]);
  const handlers = new Set();
  const re2 = /(?:on\(|bind\([^,]*,\s*\{|\[data-act=")(?:'|")([a-zA-Z0-9_]+)(?:'|")/g;
  while ((m = re2.exec(s))) handlers.add(m[1]);
  const re3 = /\{\s*([a-zA-Z0-9_]+)\s*:/g;
  const decl = s.match(/data-act/g) ? s : s;
  // 收集 bind(root,{ key: fn }) 里的 key
  const bindBlocks = s.match(/U\.bind\([^)]*\{[\s\S]*?\}\s*\)/g) || [];
  bindBlocks.forEach(b => { let mm; const r = /([a-zA-Z0-9_]+)\s*:/g; while ((mm = r.exec(b))) handlers.add(mm[1]); });
  // 收集 el.addEventListener 之前的 data-act 查询
  const qs = s.match(/querySelector(?:All)?\('\[data-act="([a-zA-Z0-9_]+)"\]'\)/g) || [];
  qs.forEach(x => handlers.add(x.match(/data-act="([a-zA-Z0-9_]+)"/)[1]));
  const missing = [...acts].filter(a => !handlers.has(a));
  ok(missing.length === 0, f + ' 中 ' + acts.size + ' 个 data-act 均有处理', missing.join(','));
});

/* ---------- B. 运行时 ---------- */
(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local.test/' });
  const w = dom.window, d = w.document;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => d.querySelector(s), $$ = s => Array.prototype.slice.call(d.querySelectorAll(s));
  await sleep(250);

  console.log('\n[B] 加载步骤文案');
  $('#genBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(200);
  const stepTxt = $$('#view .lstep').map(e => e.textContent.replace(/\s+/g, '')).join('|');
  ok($$('#view .lstep').length === 4, '4 个步骤');
  ok(/理解/.test(stepTxt) && /筛选/.test(stepTxt) && /顺序/.test(stepTxt) && /约束/.test(stepTxt), '步骤文案覆盖理解/筛选/排序/约束', stepTxt);
  await sleep(3200);

  console.log('\n[C] 地图结构（示意地图，不伪造真实地图 API）');
  const svg = $('#mapSvg');
  ok(!!svg, 'SVG 地图已渲染');
  const pins = $$('#gPins .mk');
  ok(pins.length === w.CW.data.PLACES.length, '全部 ' + w.CW.data.PLACES.length + ' 个地点都有标记');
  const vb = svg.getAttribute('viewBox').split(' ').map(Number);
  const badPin = pins.filter(g => {
    const t = (g.getAttribute('transform') || '').match(/translate\(([-\d.]+) ([-\d.]+)\)/);
    if (!t) return true;
    const x = +t[1], y = +t[2];
    return !(x >= 0 && x <= vb[2] && y >= 0 && y <= vb[3]);
  });
  ok(badPin.length === 0, '标记坐标均在图幅内（viewBox ' + vb[2] + '×' + vb[3] + '）', String(badPin.length));
  ok(!!$('#gRoute .route-path') && !!$('#gRoute .route-path-dash'), '路线连线（实线 + 虚线动画）');
  ok($$('#gRoute .route-path').length === 1, '只有一条路线路径');
  ok(/示意|估算|不含真实坐标/.test($('#view .map-note').textContent), '地图区标注为示意图');
  ok(!!$('[data-zoom="in"]') && !!$('[data-zoom="out"]') && !!$('[data-zoom="reset"]'), '缩放与定位控件齐备');
  ok($$('#view [data-layer]').length >= 2, '图层切换控件 ≥2');
  ok(!!$('#view .map-legend'), '图例存在');
  ok($$('#gPins .mk .mk-label').length === w.CW.state.route.places.length, '仅路线点显示名称标签（' + $$('#gPins .mk .mk-label').length + ' 个 = 地点数）');
  ok($$('#gPins .mk text:not(.mk-label):not(.mk-tag)').length === w.CW.state.route.places.length, '路线点带顺序编号');
  ok($$('#gPins .mk-start').length === 1 && $$('#gPins .mk-end').length === 1, '地图区分起点与终点');
  ok($('#gPins .mk-start').dataset.pin === w.CW.state.route.places[0], '起点标记对应第一站');
  ok(/起点 · 终点/.test($('#mapLegend').textContent), '图例含起终点说明');

  console.log('\n[D] 地图 → 卡片 反向联动');
  const routeIds = w.CW.state.route.places;
  const pin = $$('#gPins .mk').find(g => g.dataset.pin === routeIds[1]);
  pin.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  const selId = w.CW.state.selectedPlace;
  ok(!!selId, '点击地图标记选中地点', String(selId));
  ok(!!$$('#view .place-card.sel').length, '对应卡片高亮');

  console.log('\n[E] 拖动排序');
  const cards = $$('#view .place-card');
  const order0 = w.CW.state.route.places.slice();
  const dt = { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; }, effectAllowed: '', dropEffect: '' };
  const ev = (type, el, extra) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); Object.assign(e, extra); el.dispatchEvent(e); return e; };
  ev('dragstart', cards[0], { dataTransfer: dt });
  ev('dragover', cards[2], { dataTransfer: dt });
  ev('drop', cards[2], { dataTransfer: dt });
  ev('dragend', cards[0], { dataTransfer: dt });
  await sleep(40);
  const order1 = w.CW.state.route.places;
  ok(order1[0] !== order0[0] || order1[2] === order0[0], '拖动后顺序变化', order1.join(',') + ' vs ' + order0.join(','));
  ok($$('#view .place-card')[0].dataset.id === order1[0], 'DOM 顺序同步');

  console.log('\n[F] 摘要动作：编辑条件 / 分享');
  $('#view [data-act="editCond2"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  ok($('#advPanel').classList.contains('open'), '「编辑条件」展开高级筛选面板');
  $('#view [data-act="share"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  ok(!!d.querySelector('.modal-mask') || $$('#toastRoot .toast').length > 0, '「分享路线」有反馈');
  if (d.querySelector('.modal-mask')) d.querySelector('.modal-mask [data-mclose]').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);

  console.log('\n[G] 场景二：未指定预算');
  w.CW.state.route.conditions.budgetMax = null;
  w.CW.state.route.budgetMax = null;
  w.CW.render();
  await sleep(40);
  ok(/未指定/.test($('#view').textContent), '预算显示为「未指定」而非猜测值');

  console.log('\n[H] 场景四：营业信息缺失');
  const cardsTxt = $$('#view .place-card').map(c => c.textContent).join(' ');
  ok(/信息待确认|待确认/.test(cardsTxt), '地点卡片标注营业信息待确认');
  ok(/估算/.test(cardsTxt), '停留与交通标注为估算值');

  console.log('\n[I] 详情模态与收藏联动');
  $$('#view .place-card [data-detail]')[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  const mask = d.querySelector('.modal-mask');
  ok(!!mask, '地点详情弹窗打开');
  ok(/示例|估算|待确认/.test(mask.textContent), '详情弹窗含数据说明');
  mask.querySelector('[data-act="fav"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  ok(w.CW.state.favorites.places.length >= 1, '弹窗内可收藏地点');

  console.log('\n[J] 条件卡可修改');
  ok(!!$('#view .cond-list'), '条件卡存在');
  const editBtn = $('#view .cond-list [data-act="editCond"]') || $('#view [data-act="editCond"]');
  ok(!!editBtn, '条件卡带「修改」入口');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(2); });
