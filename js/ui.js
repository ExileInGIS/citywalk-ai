/* =====================================================================
 * ui.js · 通用 UI 工具（图标 / Toast / 模态框 / DOM 助手）
 * 纯原生实现，无第三方依赖。
 * 本版按 DESIGN-SYSTEM P0 补齐：Modal 焦点管理、Toast live region、
 * 统一 :focus-visible（样式在 CSS）、下载 / 复制 / 路线字段兼容工具。
 * ===================================================================== */
(function () {
  const CW = (window.CW = window.CW || {});

  /* ---------------- DOM 助手 ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /* 事件委托绑定：data-act="xxx" */
  function bind(root, map) {
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-act]');
      if (!t || !root.contains(t)) return;
      const fn = map[t.dataset.act];
      if (fn) { e.preventDefault(); fn(t, e); }
    });
  }

  /* ---------------- 图标（24×24 stroke） ---------------- */
  const P = {
    logo: '<circle cx="6" cy="18.5" r="2.2"/><circle cx="17.6" cy="5.6" r="2.2"/><path d="M7.6 17.1c2.6-.9 3.1-3.4 4.4-5.2 1.3-1.8 2.2-3.2 3.6-4.4"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    chevronUp: '<path d="M18 15l-6-6-6 6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.3"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/>',
    sparkle: '<path d="M12 3l1.7 4.6L18.3 9.3l-4.6 1.7L12 15.6l-1.7-4.6L5.7 9.3l4.6-1.7L12 3z"/><path d="M18.5 15.5l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z"/>',
    pin: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/>',
    walk: '<path d="M13 4.6a1.6 1.6 0 1 0 0-.1z"/><path d="M11.2 21l1.4-5.2-2.1-2 .7-4.6-2.4 2.1L7.6 14"/><path d="M12.6 8.2l3 1.6 2.6-.6"/><path d="M14.4 14.6l1.5 6.4"/>',
    heart: '<path d="M12 20s-7.2-4.3-7.2-9.4A4.2 4.2 0 0 1 12 7.7a4.2 4.2 0 0 1 7.2 2.9C19.2 15.7 12 20 12 20z"/>',
    arrowUp: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14"/><path d="M18 13l-6 6-6-6"/>',
    arrowRight: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    locate: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>',
    layers: '<path d="M12 3l8.5 4.6L12 12.2 3.5 7.6 12 3z"/><path d="M4.5 12.2l7.5 4 7.5-4"/><path d="M4.5 16.4l7.5 4 7.5-4"/>',
    share: '<circle cx="17.5" cy="6" r="2.4"/><circle cx="6.5" cy="12" r="2.4"/><circle cx="17.5" cy="18" r="2.4"/><path d="M8.6 10.9l6.8-3.7M8.6 13.1l6.8 3.7"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 5v6h-6"/>',
    edit: '<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>',
    alert: '<path d="M12 4l8.5 15h-17L12 4z"/><path d="M12 10v4"/><circle cx="12" cy="16.6" r=".85" fill="currentColor" stroke="none"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8.5 3.5v3M15.5 3.5v3"/>',
    users: '<circle cx="9.5" cy="8.5" r="3.2"/><path d="M3.5 19.5c0-3.1 2.7-5.2 6-5.2s6 2.1 6 5.2"/><path d="M16.5 6.4a3 3 0 0 1 0 5.6M18 19.5c0-2.2-.8-3.9-2-5"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    book: '<path d="M4.5 5.2A2.2 2.2 0 0 1 6.7 3H19v15.5H6.7A2.2 2.2 0 0 0 4.5 20.7V5.2z"/><path d="M4.5 20.7A2.2 2.2 0 0 1 6.7 18.5H19"/>',
    coffee: '<path d="M4.5 8h12v6.5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/><path d="M16.5 9.5h1.8a2.2 2.2 0 0 1 0 4.4h-1.8"/><path d="M7.5 3.5v2M11 3.5v2"/>',
    tree: '<path d="M12 21v-4"/><path d="M12 4l5 7h-3l4 6H6l4-6H7l5-7z"/>',
    camera: '<path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h1.8l1.2-2h6.9l1.2 2h1.9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-9z"/><circle cx="12" cy="13" r="3.4"/>',
    building: '<path d="M5 21V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V21"/><path d="M15 10h3.5A1.5 1.5 0 0 1 20 11.5V21"/><path d="M3.5 21h17M8 8h4M8 12h4M8 16h4"/>',
    route: '<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.4 6h5.1a3 3 0 0 1 0 6h-3a3 3 0 0 0 0 6h5.1"/>',
    bookmark: '<path d="M6.5 4.5h11v16l-5.5-3.6L6.5 20.5v-16z"/>',
    star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8L12 3.8z"/>',
    drag: '<circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
    send: '<path d="M21 3L3 10.5l7 2.6 2.6 7L21 3z"/><path d="M10 13.1L21 3"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.2 8.8l-1.9 4.4-4.4 1.9 1.9-4.4 4.4-1.9z"/>',
    key: '<circle cx="8" cy="15" r="3.6"/><path d="M10.7 12.3L20 3M16.5 6.5l2.2 2.2M14 9l2.2 2.2"/>',
    logout: '<path d="M15 4.5h3.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4.5 20.5h15"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="12" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v9A1.5 1.5 0 0 0 6 16.5h2.5"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>'
  };
  function icon(name, cls) {
    const d = P[name] || P.info;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class="${cls || ''}">${d}</svg>`;
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, type, opts) {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    if (!root.getAttribute('role')) {
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
      root.setAttribute('aria-atomic', 'false');
    }
    const isErr = type === 'err';
    const ico = isErr ? 'alert' : type === 'warn' ? 'alert' : 'check';
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'ok');
    el.setAttribute('role', isErr ? 'alert' : 'status');
    if (isErr) el.setAttribute('aria-live', 'assertive');
    el.innerHTML = icon(ico) + '<span>' + esc(msg) + '</span>';
    root.appendChild(el);
    const ttl = (opts && opts.duration) || (isErr ? 4200 : 2600);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 260);
    }, ttl);
  }

  /* ---------------- 模态框（焦点圈闭 + 归还） ---------------- */
  let modalSeq = 0;
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function modal(opts) {
    const root = document.getElementById('modalRoot');
    if (!root) return { el: null, close() {} };
    const titleId = 'modal-title-' + (++modalSeq);
    const prevFocus = document.activeElement;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1" style="max-width:${opts.width || 620}px">
        <div class="modal-head">
          <div><h3 id="${titleId}">${esc(opts.title || '')}</h3>${opts.sub ? `<p>${esc(opts.sub)}</p>` : ''}</div>
          <button class="close-x" type="button" data-mclose aria-label="关闭" title="关闭">${icon('close')}</button>
        </div>
        <div class="modal-body">${opts.body || ''}</div>
        ${opts.footer === false ? '' : `<div class="modal-foot">${opts.footer || `<button class="btn btn-ghost" type="button" data-mclose>关闭</button>`}</div>`}
      </div>`;
    root.appendChild(mask);
    const modalEl = mask.querySelector('.modal');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    let closed = false;

    function focusables() {
      return $$(FOCUSABLE, modalEl).filter(el => el.offsetParent !== null || el === document.activeElement);
    }
    function close() {
      if (closed) return;
      closed = true;
      mask.remove();
      document.removeEventListener('keydown', onKey, true);
      if (!document.querySelector('.modal-mask')) document.body.style.overflow = prevOverflow;
      const back = prevFocus && prevFocus.isConnected ? prevFocus : null;
      if (back && typeof back.focus === 'function') {
        try { back.focus(); } catch (e) { /* 忽略 */ }
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) { e.preventDefault(); modalEl.focus(); return; }
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === modalEl)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    mask.addEventListener('click', e => {
      if (e.target === mask || e.target.closest('[data-mclose]')) close();
    });
    setTimeout(() => {
      const auto = mask.querySelector('[autofocus]');
      const target = auto || focusables()[0] || modalEl;
      try { target.focus(); } catch (e) { /* 忽略 */ }
    }, 0);
    return { el: mask, close };
  }

  /* ---------------- 小工具 ---------------- */
  function fmtDuration(min) {
    if (min == null || isNaN(Number(min))) return '—';
    const n = Math.max(0, Math.round(Number(min)));
    const h = Math.floor(n / 60), m = n % 60;
    if (h && m) return `${h} 小时 ${m} 分`;
    if (h) return `${h} 小时`;
    return `${m} 分钟`;
  }
  function fmtCost(cost) {
    if (!cost) return '未指定';
    if (Array.isArray(cost)) {
      const [lo, hi] = cost;
      if (lo === 0 && hi === 0) return '免费';
      if (lo === 0) return `¥0–${hi}`;
      return `¥${lo}–${hi}`;
    }
    if (typeof cost === 'object') {
      const lo = Number(cost.min) || 0, hi = Number(cost.max) || 0;
      if (lo === 0 && hi === 0) return '免费';
      if (lo === 0) return `¥0–${hi}`;
      return `¥${lo}–${hi}`;
    }
    return '未指定';
  }
  /* 预算既支持旧数组 [lo,hi]，也支持 Route v1 的 {min,max,currency,basis} */
  function budgetRange(budget) {
    if (Array.isArray(budget)) return [Number(budget[0]) || 0, Number(budget[1]) || 0];
    if (budget && typeof budget === 'object') return [Number(budget.min) || 0, Number(budget.max) || 0];
    return null;
  }
  function fmtBudget(budget, opts) {
    const rg = budgetRange(budget);
    if (!rg) return '未指定';
    const [lo, hi] = rg;
    const basis = budget && !Array.isArray(budget) && budget.basis === 'per_person' ? '人均 ' : '';
    if (lo === 0 && hi === 0) return '免费';
    if (lo === hi) return `${basis}¥${hi}`;
    if (lo === 0) return `${basis}¥0–${hi}`;
    return `${basis}¥${lo}–${hi}`;
  }
  function placeIds(route) {
    if (!route || !Array.isArray(route.places)) return [];
    return route.places.map(x => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  }
  /* 旧 Route（stay / walkFromPrev）与 Route v1（stayMin / walkFromPrevMin）统一读取 */
  function segmentsOf(route) {
    const ids = placeIds(route);
    const segs = route && Array.isArray(route.segments) ? route.segments : [];
    return ids.map((id, i) => {
      const s = segs[i] || {};
      const n = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      return {
        placeId: id,
        stayMin: n(s.stayMin, n(s.stay, 0)),
        walkFromPrevMin: n(s.walkFromPrevMin, n(s.walkFromPrev, 0)),
        distanceFromPrevKm: n(s.distanceFromPrevKm, null),
        indoor: s.indoor !== undefined ? s.indoor : null,
        arriveAt: s.arriveAt || null,
        departAt: s.departAt || null
      };
    });
  }
  function fmtDateTime(iso) {
    if (!iso) return '未知';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '未知';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function catIcon(cat) {
    return ({ street: 'walk', cafe: 'coffee', book: 'book', history: 'building', park: 'tree', arch: 'building', food: 'coffee', photo: 'camera' })[cat] || 'pin';
  }
  /* 文本输入防注入 */
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

  /* ---------------- 下载 / 复制 ---------------- */
  function download(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'citywalk.txt';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }, 800);
      return true;
    } catch (e) {
      return false;
    }
  }
  /* 返回 Promise<boolean>；失败时由调用方提示手动复制 */
  function copy(text) {
    return new Promise(resolve => {
      const fallback = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = String(text == null ? '' : text);
          ta.setAttribute('readonly', 'readonly');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          let ok = false;
          try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
          ta.remove();
          resolve(ok);
        } catch (e) { resolve(false); }
      };
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(String(text == null ? '' : text)).then(() => resolve(true), fallback);
        } else fallback();
      } catch (e) { fallback(); }
    });
  }

  CW.ui = {
    $, $$, esc, bind, icon, toast, modal,
    fmtDuration, fmtCost, fmtBudget, budgetRange, placeIds, segmentsOf, fmtDateTime,
    catIcon, nl2br, download, copy
  };

  /* 尽早给全局 live region 补上语义，避免第一次 Toast 之前读屏不可见 */
  const toastRoot = document.getElementById('toastRoot');
  if (toastRoot) {
    toastRoot.setAttribute('role', 'status');
    toastRoot.setAttribute('aria-live', 'polite');
    toastRoot.setAttribute('aria-atomic', 'false');
  }
})();
