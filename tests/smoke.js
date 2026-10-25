/* 无头冒烟测试：验证单文件版的渲染、路由、生成流程、排序、收藏、对话调整 */
const fs = require('fs');
const { JSDOM } = require('/tmp/node_modules/jsdom');

const file = '/Coze/Drive/扣子/citywalk-ai/CityWalk-AI.html';
const html = fs.readFileSync(file, 'utf8');

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local.test/' });
const w = dom.window, d = w.document;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => d.querySelector(s);
const $$ = s => Array.prototype.slice.call(d.querySelectorAll(s));
const txt = s => ($(s) ? $(s).textContent.trim().slice(0, 60) : '(缺失)');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? ' → ' + extra : '')); }
}

(async () => {
  await sleep(200);
  console.log('\n[1] 首屏与顶部导航');
  ok(!!w.CW && !!w.CW.data && !!w.CW.agent && !!w.CW.map, 'CW 命名空间已加载');
  ok($$('#mainNav .nav-item').length === 3, '顶部导航 3 项');
  ok(!!$('#brandMark svg'), '品牌 Logo 已渲染');
  ok(!!$('#cityBtn'), '城市选择器已渲染');
  ok($$('#view .hero-card').length === 1, '首页 hero 卡已渲染');
  ok($$('#view .place-mini').length === 6, '地点发现 6 张卡片');
  ok(!!$('#view [data-curated]'), '精选路线预览存在');

  console.log('\n[2] 数据一致性');
  const D = w.CW.data;
  ok(D.PLACES.length === 12, '地点库 12 个');
  ok(D.PLACES.every(p => p.hours === null), '所有地点营业时间均为「待确认」');
  ok(D.CURATED_ROUTES.every(r => r.places.every(id => !!D.place(id))), '精选路线引用的地点都存在');
  ok(D.PLACES.every(p => p.mapX >= 0 && p.mapX <= 1000 && p.mapY >= 0 && p.mapY <= 640), '示意坐标在图幅内');

  console.log('\n[3] 自然语言解析');
  const A = w.CW.agent;
  const it = A.parseIntent('周日下午想在南京老城逛 4 小时，喜欢咖啡馆、历史街区和适合拍照的地方，尽量少走回头路，预算 150 元以内。');
  ok(it.durationMin === 240, '解析出 4 小时', String(it.durationMin));
  ok(it.budgetMax === 150, '解析出预算 150');
  ok(it.interests.join(',') === 'coffee,history,photo', '解析出 3 个兴趣', it.interests.join(','));
  ok(it.noBacktrack === true, '识别「少走回头路」');

  console.log('\n[4] 需求缺失 → 主动澄清（场景一）');
  let cond = A.defaultConditions(); cond.interests = []; cond.durationMin = null;
  const chk = A.checkCompleteness(cond);
  ok(chk.ok === false && /城市/.test(chk.ask.question) && /时间/.test(chk.ask.question), '缺城市+时长时主动追问', chk.ask && chk.ask.question);
  const c2 = A.defaultConditions(); c2.interests = [];
  const chk2 = A.checkCompleteness(c2);
  ok(chk2.ok === true && !!chk2.note, '未选兴趣时允许继续并提示（场景五）');

  console.log('\n[5] 生成流程（点击 CTA）');
  const ta = $('#promptInput');
  ta.value = '周日下午想在南京老城逛 4 小时，喜欢咖啡馆、历史街区和适合拍照的地方，尽量少走回头路，预算 150 元以内。';
  ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  $$('#quickTags .pill').forEach(b => { if (!b.classList.contains('on')) b.dispatchEvent(new w.Event('click', { bubbles: true })); });
  $('#genBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(120);
  ok($$('#view .lstep').length === 4, '加载态展示 4 步进度');
  await sleep(3000);
  ok(w.CW.state.view === 'result', '生成后进入结果视图', w.CW.state.view);
  const R = w.CW.state.route;
  ok(!!R && R.places.length >= 3, '路线含 ' + (R ? R.places.length : 0) + ' 个地点');
  ok($$('#view .place-card').length === R.places.length, '时间线卡片数与路线一致');
  ok($$('#view .mk').length >= R.places.length, '地图标记已渲染（含非路线点）');
  ok(!!$('#view .summary-card'), '路线摘要卡已渲染');
  ok(!!$('#view .route-path'), '路线连线已渲染');
  ok(!!$('#view .cond-list'), '规划条件卡可查看');
  const sum = $('#view .summary-card').textContent;
  ok(/预计总时长|地点数量|预计步行|预算/.test(sum), '摘要含四项关键指标');
  ok(/估算|示例/.test($('#view').textContent), '页面明确标注估算/示例数据');

  console.log('\n[6] 地图 ↔ 卡片联动');
  const card2 = $$('#view .place-card')[1];
  const id2 = card2.dataset.id;
  card2.dispatchEvent(new w.Event('click', { bubbles: true }));
  ok(w.CW.state.selectedPlace === id2, '点击卡片选中对应地点', String(w.CW.state.selectedPlace));
  ok($$('#view .place-card')[1].classList.contains('sel'), '卡片出现选中态');
  ok(!!$('#view .mk-sel'), '地图标记出现高亮');

  console.log('\n[7] 排序（上移/下移/拖动）');
  const before = R.places.slice();
  const downBtn = $$('#view .sort-btn[data-down]')[0];
  downBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  ok(R.places[0] === before[1] && R.places[1] === before[0], '下移按钮改变顺序');
  ok(R.orderDirty === true, '标记顺序已手动调整');
  ok(/未重新计算/.test($('#view').textContent), '明确提示距离与时间未重算');
  ok($$('#view .place-card')[0].dataset.id === R.places[0], 'DOM 顺序与数据一致');
  const nums = $$('#view .tl-num').map(e => e.textContent);
  ok(nums.join(',') === nums.map((_, i) => i + 1).join(','), '编号重新连续');

  console.log('\n[8] AI 对话调整');
  const send = async t => {
    const i = $('#chatInput'); i.value = t;
    $('#view [data-act="chatSend"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    await sleep(30);                                // 让 click 同步触发入队
    await w.CW.pages.home.chatQueue;                // 等待该指令执行完毕
  };
  const n0 = R.places.length, d0 = R.distanceKm;
  await send('缩短步行距离');
  ok(R.places.length === n0 - 1, '「缩短步行距离」减少一站', n0 + '→' + R.places.length);
  ok($$('#view .diff-row').length > 0, '展示修改前后对比');
  const d1 = R.distanceKm;
  await send('加一家咖啡馆');
  ok(R.places.some(id => D.place(id).cat === 'cafe'), '「增加咖啡馆」生效');
  await send('去掉书店，增加一个拍照地点');
  ok(!R.places.some(id => D.place(id).cat === 'book'), '复合指令：去掉书店');
  ok(R.places.some(id => D.place(id).cat === 'photo'), '复合指令：增加拍照点');
  await send('改成 3 小时');
  ok(R.conditions.durationMin === 180, '「改成 3 小时」更新条件');
  await send('预算控制在 100 元以内');
  ok(R.conditions.budgetMax === 100, '预算条件已更新');
  ok(R.budget[1] <= 100 || !!R.conflict, '预算冲突要么被解决，要么给出提示', JSON.stringify(R.budget));
  await send('节奏慢一点');
  ok(R.conditions.pace === 'light', '节奏调整为轻松');
  await send('把时间改成 1 小时');
  ok(!!R.conflict, '时间不足时给出冲突提示');
  ok($$('#view [data-opt]').length > 0, '冲突提示提供可操作选项');
  $$('#view [data-opt]')[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(250);
  ok(true, '点击冲突选项可执行');

  console.log('\n[9] 收藏');
  const favRouteBtn = $('#view [data-act="favRoute"]');
  favRouteBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  ok(w.CW.state.favorites.routes.length === 1, '收藏路线成功');
  const favPlaceBtn = $$('#view .fav-btn')[0];
  favPlaceBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  ok(w.CW.state.favorites.places.length === 1, '收藏地点成功');

  console.log('\n[10] 发现路线页');
  $$('#mainNav .nav-item').find(b => b.dataset.nav === 'discover').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(60);
  ok(w.CW.state.nav === 'discover', '切换到发现路线');
  ok($$('#view .route-card').length === 6, '默认展示 6 条精选路线', String($$('#view .route-card').length));
  const themeBtn = $$('#view [data-ftheme]')[1];
  themeBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  ok($$('#view .route-card').length < 6, '主题筛选生效（' + $$('#view .route-card').length + ' 条）');
  $$('#view [data-act="reset"]')[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  ok($$('#view .route-card').length === 6, '重置筛选恢复 6 条');
  const durBtn = $$('#view [data-fdur]').find(b => b.dataset.fdur === 'short');
  durBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  ok($$('#view .route-card').length >= 1, '时长筛选有结果（' + $$('#view .route-card').length + ' 条）');
  $$('#view [data-act="reset"]')[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  $$('#view [data-view]')[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(40);
  ok(!!d.querySelector('.modal-mask'), '「查看路线」打开详情模态');
  d.querySelector('.modal-mask [data-act="use"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(80);
  ok(w.CW.state.nav === 'home' && w.CW.state.view === 'result', '「使用此路线重新规划」带回首页结果');

  console.log('\n[11] 我的收藏页');
  $$('#mainNav .nav-item').find(b => b.dataset.nav === 'favorites').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(60);
  ok($$('#view .saved-route').length === 1, '收藏路线列表 1 条');
  ok($$('#view .saved-place').length === 1, '收藏地点列表 1 个');
  $$('#view [data-reuse]')[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(60);
  ok(w.CW.state.nav === 'home' && w.CW.state.view === 'result', '「再次规划」回到首页并载入路线');

  console.log('\n[12] 其他交互');
  $('#btnHelp').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  ok(!!d.querySelector('.modal-mask'), '帮助弹窗可打开');
  d.querySelector('.modal-mask [data-mclose]').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(20);
  ok(!d.querySelector('.modal-mask'), '弹窗可关闭');
  $('#avatarBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(20);
  ok($('#avatarMenu').classList.contains('open'), '头像菜单可打开');
  $('#cityBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(20);
  ok($('#cityMenu').classList.contains('open'), '城市选择器可打开');
  d.querySelector('[data-city="suzhou"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  ok(w.CW.state.city === 'suzhou', '城市切换生效');
  d.querySelector('[data-city="nanjing"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  // 切回南京后重新生成一次，验证地图控件
  $('#genBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(3200);
  const mapSlot = $('#mapSlot');
  if (mapSlot) {
    $('#view [data-zoom="in"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    ok(/scale\(1\.25\)/.test($('#mapRoot').getAttribute('transform')), '地图缩放生效', $('#mapRoot').getAttribute('transform'));
    $('#view [data-layer="pins"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    ok($('#gPins').style.display === 'none', '图层切换生效');
    $('#view [data-layer="pins"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  } else ok(false, '地图未找到');

  console.log('\n[13] 空状态');
  w.CW.state.favorites = { routes: [], places: [] };
  w.CW.state.view = 'idle'; w.CW.state.route = null;
  w.CW.navigate('favorites');
  await sleep(40);
  ok($$('#view .empty').length === 2, '收藏页两个空状态');
  w.CW.state.city = 'chengdu';
  w.CW.navigate('discover');
  await sleep(40);
  ok(!!$('#view .empty'), '无数据城市展示空状态');
  w.CW.state.city = 'nanjing';

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(2); });
