// Tiny DOM helpers. `html` tagged template escapes interpolated values unless wrapped in raw().

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(s);

export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.s;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
      else if (v === false || v == null) out += '';
      else out += esc(v);
    }
  });
  return raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function mount(el, content) {
  el.innerHTML = String(content);
  return el;
}

export function toast(msg, ms = 3200) {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// Opens a modal. `render(body, close)` fills it; returns a promise resolved with close(value).
export function modal(title, render) {
  return new Promise((resolve) => {
    const root = document.getElementById('overlay-root');
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><div class="body"></div><div class="actions"></div></div>`;
    root.appendChild(back);
    let cleanup = () => {};
    const close = (value) => {
      cleanup();
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !back.dataset.trapEscape) close(undefined);
    };
    document.addEventListener('keydown', onKey, true);
    const res = render($('.body', back), $('.actions', back), close, back);
    if (typeof res === 'function') cleanup = res;
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const fmt = {
  gb: (n) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)} TB` : `${Math.round(n)} GB`),
  num: (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US')),
  hours: (h) => {
    if (h == null) return '—';
    if (h < 48) return `${h} hours`;
    const y = h / 8766;
    return y >= 1 ? `${h.toLocaleString('en-US')} h (~${y.toFixed(1)} years of running)` : `${h.toLocaleString('en-US')} h (~${Math.round(h / 24)} days of running)`;
  },
};
