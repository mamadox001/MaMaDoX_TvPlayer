// Small DOM + formatting helpers shared by every screen.

/** h('div.a.b', {text, html, style, on, attrs...}, ...children) */
export function h(sel, props, ...kids) {
  let tag = 'div';
  let cls = '';
  const m = /^([a-z0-9-]*)((?:\.[\w-]+)*)$/i.exec(sel);
  if (m) {
    if (m[1]) tag = m[1];
    if (m[2]) cls = m[2].slice(1).replace(/\./g, ' ');
  }
  const el = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(tag);
  if (cls) el.className = cls;
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'class') el.className = (el.className ? el.className + ' ' : '') + v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else Object.assign(el.style, v);
      } else if (k === 'on') {
        for (const e in v) el.addEventListener(e, v[e]);
      } else if (k === 'data') {
        for (const d in v) el.dataset[d] = v[d];
      } else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids) add(el, k);
  return el;
}

function add(el, k) {
  if (k == null || k === false) return;
  if (Array.isArray(k)) for (const x of k) add(el, x);
  else el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const now = () => Date.now();
export const nowSec = () => Math.floor(Date.now() / 1000);

export function debounce(fn, ms) {
  let t = 0;
  const d = function (...a) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

export function idle(fn) {
  if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 600 });
  else setTimeout(fn, 60);
}

const pad = (n) => (n < 10 ? '0' : '') + n;

let use12h = false;
export function setClock12(v) {
  use12h = !!v;
}

/** 21:45 or 9:45 PM */
export function fmtClock(t) {
  const d = t instanceof Date ? t : new Date(t > 1e12 ? t : t * 1000);
  const H = d.getHours();
  const M = d.getMinutes();
  if (use12h) return `${H % 12 || 12}:${pad(M)} ${H < 12 ? 'AM' : 'PM'}`;
  return `${pad(H)}:${pad(M)}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(t, withYear) {
  const d = t instanceof Date ? t : new Date(t > 1e12 ? t : t * 1000);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
}

/** Today / Tomorrow / Yesterday / Mon 20 Oct */
export function fmtDay(t) {
  const d = new Date(t * 1000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fmtDate(d);
}

/** 1:52:10 / 52:10 */
export function fmtPos(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const H = Math.floor(s / 3600);
  s -= H * 3600;
  const M = Math.floor(s / 60);
  s -= M * 60;
  return H ? `${H}:${pad(M)}:${pad(s)}` : `${M}:${pad(s)}`;
}

/** 1 h 52 min / 45 min */
export function fmtLength(sec) {
  sec = Math.round(sec);
  if (!sec || sec < 0) return '';
  const H = Math.floor(sec / 3600);
  const M = Math.round((sec % 3600) / 60);
  if (H && M) return `${H} h ${M} min`;
  if (H) return `${H} h`;
  return `${M} min`;
}

export function fmtCount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function plural(n, one, many) {
  return `${fmtCount(n)} ${n === 1 ? one : many || one + 's'}`;
}

/** Base64 (as used by Xtream EPG) to a UTF-8 string. */
export function b64(s) {
  if (!s) return '';
  try {
    const bin = atob(s);
    if (window.TextDecoder) {
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(escape(bin));
  } catch (e) {
    return s;
  }
}

const MARKS = /[̀-ͯ]/g;
/** Normalised text for search. */
export function norm(s) {
  if (!s) return '';
  let t = String(s).toLowerCase();
  if (t.normalize) t = t.normalize('NFD').replace(MARKS, '');
  // punctuation, symbols and spaces (kept compatible with old WebViews: no \p{} classes)
  return t.replace(/[\s!-\/:-@\[-`{-~ -¿ -⁯　-〿]+/g, ' ').trim();
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** First letters for monogram placeholders. */
export function initials(name) {
  const clean = String(name || '')
    .replace(/^\s*(\|[^|]{1,8}\||[A-Za-z]{2,4}\s*[:|]|[A-Za-z]{2,3}\s+-\s+)\s*/, '')
    .replace(/\b(UHD|FHD|HD|SD|4K|HEVC|H265)\b/gi, '')
    .trim();
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  const a = words[0][0] || '';
  const b = /\d/.test(words[1][0]) ? words[1].slice(0, 2) : words[1][0];
  return (a + (b || '')).toUpperCase();
}

const TINTS = ['#2E5C8A', '#7A4E9C', '#2F7D6B', '#9C5A2E', '#8A2E4E', '#3E6E2E', '#2E4E8A', '#6B5C2E'];
export function tint(name) {
  let x = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return TINTS[Math.abs(x) % TINTS.length];
}

/** Strip "(2019)" style suffixes and container junk from titles. */
export function cleanTitle(name) {
  return String(name || '')
    .replace(/\s*[([]\s*(19|20)\d\d\s*[)\]]\s*$/, '')
    .replace(/\s*\|\s*$/, '')
    .trim();
}

export function yearOf(item) {
  if (item.year && /^\d{4}$/.test(item.year)) return item.year;
  const m = /[([]((?:19|20)\d\d)[)\]]/.exec(item.name || '');
  return m ? m[1] : '';
}

export function qs(params) {
  const out = [];
  for (const k in params) if (params[k] != null && params[k] !== '') out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  return out.join('&');
}

export function parseQS(s) {
  const o = {};
  if (!s) return o;
  for (const kv of s.split('&')) {
    const i = kv.indexOf('=');
    if (i > 0) {
      try {
        o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      } catch (e) {
        o[kv.slice(0, i)] = kv.slice(i + 1);
      }
    }
  }
  return o;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Simple LRU map. */
export class LRU {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }
  get(k) {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k, v) {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  delete(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

/** Tiny event emitter. */
export class Emitter {
  constructor() {
    this._l = {};
  }
  on(ev, fn) {
    (this._l[ev] || (this._l[ev] = [])).push(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) {
    const l = this._l[ev];
    if (l) {
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    }
  }
  emit(ev, ...a) {
    const l = this._l[ev];
    if (l) for (const fn of l.slice()) {
      try {
        fn(...a);
      } catch (e) {
        console.error(e);
      }
    }
  }
}
