// Icons, artwork with monogram placeholders, progress bars, clock and buttons.
import { h, initials, tint, fmtClock, fmtDate } from '../util.js';
import { imgUrl } from '../native.js';

const P = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  rew: '<path d="M11 6 4 12l7 6V6zm9 0-7 6 7 6V6z" fill="currentColor"/>',
  ff: '<path d="m13 6 7 6-7 6V6zM4 6l7 6-7 6V6z" fill="currentColor"/>',
  next: '<path d="M6 6l9 6-9 6V6z" fill="currentColor"/><rect x="16" y="6" width="2.6" height="12" rx="1" fill="currentColor"/>',
  star: '<path d="m12 3.6 2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.5l-5.1 2.8L8 13.6l-4.3-4 5.8-.7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  starOn: '<path d="m12 3.6 2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.5l-5.1 2.8L8 13.6l-4.3-4 5.8-.7z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  search: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="15" cy="7" r="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="9" cy="17" r="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  tv: '<rect x="3" y="6" width="18" height="12.5" rx="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m8.5 2.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  film: '<rect x="4" y="4" width="16" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4" stroke="currentColor" stroke-width="2"/>',
  series: '<rect x="3.5" y="8" width="17" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M6 5h12M8.5 2.5h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  guide: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M3.5 9.5h17M9 9.5v10M14 14.5h6.5" stroke="currentColor" stroke-width="2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  audio: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  subs: '<rect x="3" y="5.5" width="18" height="13" rx="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M6.5 12.5h4M13 12.5h4.5M6.5 15.5h7M15.5 15.5h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  aspect: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 11v5.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="7.8" r="1.4" fill="currentColor"/>',
  refresh: '<path d="M19.5 12A7.5 7.5 0 1 1 17 6.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M19.5 3.5v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>',
  edit: '<path d="m14.5 5.5 4 4L8.5 19.5H4.5v-4z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  user: '<circle cx="12" cy="8.5" r="4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  history: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  list: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="4.8" cy="6.5" r="1.3" fill="currentColor"/><circle cx="4.8" cy="12" r="1.3" fill="currentColor"/><circle cx="4.8" cy="17.5" r="1.3" fill="currentColor"/>',
  close: '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  external: '<path d="M13.5 4.5h6v6M19.5 4.5l-8 8M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  eyeOff: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  backspace: '<path d="M8.5 5.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-11L3 12z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="m11.5 9.5 5 5M16.5 9.5l-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  shift: '<path d="M12 4 4.5 12H9v7.5h6V12h4.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
  space: '<path d="M4 10v4h16v-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  live: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  speed: '<path d="M4.5 16.5a8 8 0 1 1 15 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="m12 15 4-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
};

export function icon(name, cls) {
  const s = h('span.ico' + (cls ? '.' + cls : ''));
  s.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
  return s;
}

export function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

/** Artwork box: monogram placeholder that cross-fades to the image when it arrives. */
export function art(cls) {
  return h('div.art' + (cls ? '.' + cls : ''), null, h('span.art-mono'), h('img.art-img', { alt: '', decoding: 'async' }));
}

export function setArt(box, src, name, width, delay) {
  const mono = box.firstChild;
  const img = box.lastChild;
  if (box.__name !== name) {
    box.__name = name;
    mono.textContent = initials(name);
    box.style.setProperty('--tint', tint(name));
  }
  const url = imgUrl(src, width);
  if (img.__src === url) return;
  img.__src = url;
  clearTimeout(img.__t);
  box.classList.remove('loaded');
  img.onload = img.onerror = null;
  img.removeAttribute('src');
  if (!url) return;
  const go = () => {
    if (img.__src !== url) return;
    img.onload = () => {
      if (img.__src === url) box.classList.add('loaded');
    };
    img.onerror = () => {
      if (img.__src === url) box.classList.remove('loaded');
    };
    img.src = url;
  };
  if (delay) img.__t = setTimeout(go, delay);
  else go();
}

export function progressBar(cls) {
  return h('div.pbar' + (cls ? '.' + cls : ''), null, h('i'));
}

export function setProgress(bar, f) {
  bar.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, f || 0))})`;
}

export function button(label, ic, cls) {
  return h('div.btn' + (cls ? '.' + cls : ''), null, ic ? icon(ic) : null, h('span.btn-label', { text: label }));
}

export function setButton(btn, label, ic) {
  btn.innerHTML = '';
  if (ic) btn.appendChild(icon(ic));
  btn.appendChild(h('span.btn-label', { text: label }));
}

/** Clock in the corner of most screens; one timer for all instances. */
const clocks = new Set();
let clockTimer = 0;
function tickClocks() {
  const d = new Date();
  for (const c of clocks) {
    const attached = document.body.contains(c);
    if (!attached && c.__ever) {
      clocks.delete(c);
      continue;
    }
    c.__ever = c.__ever || attached;
    c.firstChild.textContent = fmtClock(d);
    if (c.lastChild !== c.firstChild) c.lastChild.textContent = fmtDate(d);
  }
  clockTimer = setTimeout(tickClocks, (60 - d.getSeconds()) * 1000 + 50);
}
export function clock(withDate) {
  const c = h('div.clock', null, h('span.clock-time'), withDate ? h('span.clock-date') : null);
  clocks.add(c);
  const d = new Date();
  c.firstChild.textContent = fmtClock(d);
  if (withDate) c.lastChild.textContent = fmtDate(d);
  if (!clockTimer) tickClocks();
  return c;
}
export function refreshClocks() {
  clearTimeout(clockTimer);
  tickClocks();
}

/** Screen header: title (+ subtitle) on the left, clock on the right. */
export function topbar(title, sub) {
  const t = h('h1.top-title', { text: title });
  const s = h('div.top-sub', { text: sub || '' });
  const bar = h('header.topbar', null, h('div.top-left', null, t, s), clock(true));
  bar.setTitle = (a, b) => {
    t.textContent = a;
    s.textContent = b || '';
  };
  bar.setSub = (b) => {
    s.textContent = b || '';
  };
  return bar;
}

/** Channel number + logo tile used in lists. */
export function logoBox(cls) {
  return art('logo' + (cls ? '.' + cls : ''));
}
