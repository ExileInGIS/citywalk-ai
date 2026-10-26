'use strict';
/* jsdom 集成测试辅助：构建单文件版 → 启动 DOM → 常用操作 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');

function buildSingleFile() {
  execFileSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'ignore' });
  return fs.readFileSync(path.join(ROOT, 'CityWalk-AI.html'), 'utf8');
}

async function boot(opts) {
  const html = buildSingleFile();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost:3000/#home',
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline-test'));
      window.scrollTo = () => {};
      if (!window.crypto) window.crypto = {};
      if (!window.crypto.randomUUID) {
        let n = 0;
        window.crypto.randomUUID = () => 'test-uuid-' + (++n);
      }
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      }
      window.addEventListener('error', e => {
        if (opts && opts.collectErrors) opts.collectErrors.push(String(e.error || e.message));
      });
    }
  });
  await new Promise(r => setTimeout(r, 200));
  return { dom, window: dom.window, document: dom.window.document };
}

function $(sel, root) { return (root || globalThis.document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || globalThis.document).querySelectorAll(sel)); }

function click(window, el) {
  if (!el) throw new Error('click target missing');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

function setValue(window, el, value) {
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function press(window, el, key) {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { ROOT, buildSingleFile, boot, $, $$, click, setValue, press, sleep };
