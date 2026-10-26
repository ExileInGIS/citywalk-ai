'use strict';
/* jsdom 集成测试：首页渲染 → 生成 → 调整 → 差异 → 收藏/导出 → 状态 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, $, $$, click, setValue, sleep } = require('./helpers');

async function waitFor(fn, timeout = 9000, interval = 100) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    try {
      const v = fn();
      if (v) return v;
    } catch (e) { last = e; }
    await sleep(interval);
  }
  throw new Error('waitFor timeout' + (last ? ': ' + last.message : ''));
}

async function generate(window, document, text) {
  const ta = $('#promptInput', document);
  assert.ok(ta, '输入框存在');
  setValue(window, ta, text || '周日下午想在南京老城逛 4 小时，喜欢咖啡馆、历史街区和适合拍照的地方，预算 150 元以内');
  click(window, $('#genBtn', document));
  await waitFor(() => $('.summary-card', document));
}

test('首屏：导航、hero、状态条、地点发现', async () => {
  const { window, document, dom } = await boot();
  try {
    assert.ok($('#mainNav', document), '导航存在');
    assert.equal($$('#mainNav .nav-item', document).length, 3, '三个导航项');
    assert.ok($('.hero-card', document), 'hero 卡存在');
    assert.ok($('#promptInput', document), '输入框存在');
    assert.ok($('.service-bar', document), '服务状态条存在');
    assert.ok($('.place-mini', document), '地点发现卡存在');
    assert.ok($$('.place-mini', document).length >= 4);
    assert.match($('.service-bar', document).textContent, /模拟|Mock|本地/i);
    dom.window.close();
  } catch (e) { dom.window.close(); throw e; }
});

test('生成：结果摘要、时间线、地图、约束清单', async () => {
  const { window, document, dom } = await boot();
  try {
    await generate(window, document);
    assert.ok($('.summary-card', document), '摘要卡');
    const cards = $$('.place-card', document);
    assert.ok(cards.length >= 2, '时间线地点 >=2，实际 ' + cards.length);
    assert.ok($('#mapSlot svg', document), 'SVG 地图已渲染');
    assert.ok($('.constraint-list', document), '约束清单已渲染');
    assert.equal($$('.constraint-item', document).length >= 1, true);
    const text = $('.summary-card', document).textContent;
    assert.match(text, /总计|时长|地点/);
    assert.match($('.map-note', document).textContent, /示意|估算/);
    dom.window.close();
  } catch (e) { dom.window.close(); throw e; }
});

test('调整：发送指令后出现差异面板与新的 AI 回复', async () => {
  const { window, document, dom } = await boot();
  try {
    await generate(window, document);
    const before = $$('.msg', document).length;
    const ci = $('#chatInput', document);
    assert.ok(ci, '对话输入框存在');
    setValue(window, ci, '把咖啡馆换成书店');
    click(window, $('[data-act="chatSend"]', document));
    await waitFor(() => $$('.msg', document).length > before, 6000);
    await waitFor(() => $('.diff-panel', document), 6000);
    const panel = $('.diff-panel', document).textContent;
    assert.match(panel, /调整|变化|替换|本次/);
    dom.window.close();
  } catch (e) { dom.window.close(); throw e; }
});

test('收藏与导出：写入 localStorage、打开导出面板', async () => {
  const { window, document, dom } = await boot();
  try {
    await generate(window, document);
    click(window, $('[data-act="favRoute"]', document));
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) keys.push(window.localStorage.key(i));
    assert.ok(keys.some(k => /favorite|route|fav/i.test(k)), 'localStorage 应有收藏键，实际 ' + keys.join(','));
    click(window, $('[data-act="export"]', document));
    await waitFor(() => $('.export-item', document), 3000);
    assert.ok($$('.export-item', document).length >= 2, '导出至少两种格式');
    dom.window.close();
  } catch (e) { dom.window.close(); throw e; }
});

test('地图与时间线联动：点击卡片有选中态', async () => {
  const { window, document, dom } = await boot();
  try {
    await generate(window, document);
    const card = $('.place-card', document);
    click(window, card);
    await sleep(120);
    assert.ok(card.classList.contains('sel') || $('.tl-item.sel', document), '卡片应有选中态');
    dom.window.close();
  } catch (e) { dom.window.close(); throw e; }
});
