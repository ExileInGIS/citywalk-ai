'use strict';
/* jsdom 集成测试：可访问性基线（标签、弹窗焦点、live region、键盘卡片） */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, $, $$, click, setValue, press, sleep } = require('./helpers');

const CSS = fs.readFileSync(path.resolve(__dirname, '../../css/style.css'), 'utf8');

async function waitFor(fn, timeout = 9000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = fn(); if (v) return v; } catch (e) { /* retry */ }
    await sleep(interval);
  }
  throw new Error('waitFor timeout');
}

test('表单控件有可访问名称', async () => {
  const { document, dom } = await boot();
  try {
    const prompt = $('#promptInput', document);
    const named = prompt.getAttribute('aria-label') || prompt.getAttribute('aria-labelledby') ||
      (prompt.id && document.querySelector('label[for="' + prompt.id + '"]'));
    assert.ok(named, '#promptInput 缺少可访问名称');

    const controls = $$('input, select, textarea', document).filter(el => el.type !== 'hidden');
    const unnamed = controls.filter(el => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
      if (el.closest('label')) return false;
      if (el.id && document.querySelector('label[for="' + el.id + '"]')) return false;
      if (el.type === 'button' || el.type === 'submit') return false;
      return true;
    });
    assert.equal(unnamed.length, 0, '未命名的控件: ' + unnamed.map(e => e.id || e.tagName).join(','));
    dom.window.close();
  } catch (e) { dom.window.close(); throw e; }
});

test('Toast 与加载步骤使用 live region', async () => {
  const { document, dom } = await boot();
  try {
    const toast = $('#toastRoot', document);
    assert.ok(toast, '#toastRoot 存在');
    assert.ok(toast.getAttribute('aria-live') || toast.getAttribute('role'), 'Toast 需要 aria-live/role');
    const steps = $('#loadSteps', document);
    if (steps) assert.ok(steps.getAttribute('aria-live') || steps.getAttribute('role'), '加载步骤需要 live region');
    dom.window.close();
  } catch (e) { dom.window.close(); throw e; }
});

test('弹窗：role=dialog、焦点移入、Esc 关闭并归还焦点', async () => {
  const { window, document, dom } = await boot();
  try {
    const help = $('#btnHelp', document);
    help.focus();
    click(window, help);
    await waitFor(() => $('.modal-mask', document));
    await sleep(40);
    const dialog = $('[role="dialog"]', document);
    assert.ok(dialog, '弹窗需要 role=dialog');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.ok(dialog.getAttribute('aria-labelledby') || dialog.getAttribute('aria-label'));
    assert.ok(dialog.contains(document.activeElement), '打开后焦点应移入弹窗');
    press(window, document.activeElement, 'Escape');
    await sleep(80);
    assert.equal($('.modal-mask', document), null, 'Esc 应关闭弹窗');
    assert.equal(document.activeElement, help, '关闭后焦点应回到触发按钮');
    dom.window.close();
  } catch (e) { dom.window.close(); throw e; }
});

test('结果页地点卡可键盘操作，图标对读屏隐藏', async () => {
  const { window, document, dom } = await boot();
  try {
    setValue(window, $('#promptInput', document), '南京 4 小时，喜欢咖啡馆和历史，预算 150');
    click(window, $('#genBtn', document));
    await waitFor(() => $('.place-card', document));
    const card = $('.place-card', document);
    assert.equal(card.getAttribute('role'), 'button', '地点卡需要 role=button');
    assert.equal(card.getAttribute('tabindex'), '0', '地点卡需要 tabindex=0');
    assert.ok(card.getAttribute('aria-label'), '地点卡需要 aria-label');
    card.focus();
    press(window, card, 'Enter');
    await sleep(100);
    assert.ok(card.classList.contains('sel') || $('.tl-item.sel', document), 'Enter 应选中卡片');
    const icons = $$('svg', document);
    assert.ok(icons.length > 0);
    assert.ok(icons.every(svg => svg.getAttribute('aria-hidden') === 'true' || svg.closest('[aria-label]')), '装饰图标应 aria-hidden');
    dom.window.close();
  } catch (e) { dom.window.close(); throw e; }
});

test('CSS 包含 focus-visible 与 reduced-motion', () => {
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /prefers-reduced-motion/);
});
