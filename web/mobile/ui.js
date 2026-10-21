// Phone interface building blocks: page stack with tabs, sheets, dialogs, toasts and
// a virtual scroller for very long lists.
import { h, clamp } from '../src/util.js';
import { icon } from '../src/ui/widgets.js';
import { Video } from '../src/player/video.js';

// ------------------------------------------------------------------ pages

export class Page {
  constructor(cls) {
    this.el = h('section.page' + (cls ? '.' + cls : ''));
    this.built = false;
  }
  build() {}
  enter() {}
  leave() {}
  /** null (no video), 'keep', 'full' or an element the video should cover. */
  video() {
    return null;
  }
  /** Return true when Back was handled inside the page. */
  back() {
    return false;
  }
  resize() {}
}

export const Nav = {
  root: null,
  host: null,
  tabbar: null,
  tabs: [],
  tabPages: {},
  tab: null,
  stack: [],
  overlays: [],
  onExit: null,

  init(root, tabs) {
    this.root = root;
    this.host = h('div.pages');
    this.tabbar = h('nav.tabbar');
    this.overlayHost = h('div.overlays');
    this.toastEl = h('div.toast');
    root.append(this.host, this.tabbar, this.overlayHost, this.toastEl);
    this.tabs = tabs;
    for (const t of tabs) {
      t.btn = h('button.tab', { type: 'button' }, icon(t.icon), h('span', { text: t.label }));
      t.btn.addEventListener('click', () => this.show(t.id));
      this.tabbar.appendChild(t.btn);
    }
    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        const p = this.top();
        if (p) p.resize();
        this.place();
      }, 120);
    });
  },

  top() {
    return this.stack.length ? this.stack[this.stack.length - 1] : this.tab ? this.tabPages[this.tab] : null;
  },

  _mount(p) {
    if (!p.built) {
      p.built = true;
      p.build();
    }
    if (!p.el.parentNode) this.host.appendChild(p.el);
  },

  /** Switches to a tab, closing any pages opened over it. */
  show(id) {
    while (this.stack.length) this._popOne();
    const cur = this.tab && this.tabPages[this.tab];
    if (cur && this.tab !== id) {
      cur.leave();
      cur.el.classList.remove('on');
    }
    const t = this.tabs.find((x) => x.id === id);
    let p = this.tabPages[id];
    if (!p) p = this.tabPages[id] = t.make();
    this._mount(p);
    const was = this.tab;
    this.tab = id;
    p.el.classList.add('on');
    for (const x of this.tabs) x.btn.classList.toggle('on', x.id === id);
    this.root.classList.remove('no-tabs');
    if (was !== id) p.enter(false);
    else p.enter(true);
    this.place();
  },

  push(p, params) {
    const under = this.top();
    if (under) under.leave();
    this._mount(p);
    this.stack.push(p);
    p.el.classList.add('on', 'pushed');
    this.root.classList.toggle('no-tabs', !!p.fullscreen);
    this.cover();
    p.enter(params || {});
    requestAnimationFrame(() => p.el.classList.add('in'));
    this.place();
  },

  pop() {
    if (!this.stack.length) return false;
    this._popOne();
    const p = this.top();
    if (p) {
      this.root.classList.toggle('no-tabs', !!p.fullscreen);
      p.enter(true);
    }
    this.cover();
    this.place();
    return true;
  },

  _popOne() {
    const p = this.stack.pop();
    p.leave();
    p.el.classList.remove('in');
    const el = p.el;
    setTimeout(() => {
      if (el.parentNode && this.stack.indexOf(p) < 0) {
        el.classList.remove('on', 'pushed');
        el.parentNode.removeChild(el);
        if (p.destroy) p.destroy();
      }
    }, 260);
  },

  /** The video player shows the video through the page, so nothing may sit under it. */
  cover() {
    const top = this.top();
    const hide = !!(top && top.fullscreen && top.el.classList.contains('player'));
    for (const el of this.host.children) el.classList.toggle('under', hide && el !== top.el);
  },

  /** Replaces everything (used for first setup). */
  reset(p) {
    while (this.stack.length) this._popOne();
    if (this.tab) {
      this.tabPages[this.tab].leave();
      this.tabPages[this.tab].el.classList.remove('on');
    }
    this.tab = null;
    for (const x of this.tabs) x.btn.classList.remove('on');
    this.push(p);
  },

  /** Puts the video where the visible page wants it. */
  place() {
    const p = this.top();
    if (!p) return;
    const v = p.video();
    if (v === 'keep') return;
    Video.place(v);
  },

  back() {
    if (this.overlays.length) {
      this.overlays[this.overlays.length - 1].close(null);
      return;
    }
    const p = this.top();
    if (p && p.back()) return;
    if (this.pop()) return;
    if (this.tab && this.tab !== this.tabs[0].id) return this.show(this.tabs[0].id);
    if (this.onExit) this.onExit();
  },
};

// ------------------------------------------------------------------ toast

let toastTimer = 0;
export function toast(msg, long) {
  const t = Nav.toastEl;
  t.textContent = msg;
  t.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('in'), long ? 4200 : 2400);
}

// ------------------------------------------------------------------ overlays

function overlay(cls, body, onClose) {
  const scrim = h('div.scrim');
  const box = h('div.ov.' + cls, null, body);
  const wrap = h('div.ov-wrap', null, scrim, box);
  Nav.overlayHost.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  const o = {
    close(v) {
      const i = Nav.overlays.indexOf(o);
      if (i < 0) return;
      Nav.overlays.splice(i, 1);
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 220);
      if (onClose) onClose(v);
    },
  };
  scrim.addEventListener('click', () => o.close(null));
  Nav.overlays.push(o);
  return o;
}

/** Bottom sheet with a list of actions. items: {label, sub, icon, danger, on, action} */
export function sheet(title, items) {
  return new Promise((resolve) => {
    const list = h('div.sheet-list');
    const body = h('div', null, h('div.sheet-grab'), title ? h('div.sheet-title', { text: title }) : null, list);
    const o = overlay('sheet', body, resolve);
    items.forEach((it, i) => {
      const row = h(
        'button.srow' + (it.danger ? '.danger' : '') + (it.on ? '.on' : ''),
        { type: 'button' },
        it.icon ? icon(it.icon) : null,
        h('span.srow-text', null, h('span.srow-label', { text: it.label }), it.sub ? h('span.srow-sub', { text: it.sub }) : null),
        it.on ? icon('check', 'srow-check') : null
      );
      row.addEventListener('click', () => {
        o.close(i);
        if (it.action) setTimeout(() => it.action(), 0);
      });
      list.appendChild(row);
    });
  });
}

/** Dialog with a message and buttons; resolves with the chosen value (null if dismissed). */
export function confirm(title, msg, buttons) {
  return new Promise((resolve) => {
    const btns = h('div.dlg-btns');
    const body = h('div', null, h('div.dlg-title', { text: title }), msg ? h('div.dlg-msg', { text: msg }) : null, btns);
    const o = overlay('dlg', body, resolve);
    (buttons || [{ label: 'OK', value: 1 }]).forEach((b, i) => {
      const e = h('button.btn' + (i === 0 ? '.primary' : '') + (b.danger ? '.danger' : ''), { type: 'button', text: b.label });
      e.addEventListener('click', () => o.close(b.value));
      btns.appendChild(e);
    });
  });
}

/** Asks for a 4-digit PIN. */
export function askPin(title, sub) {
  return new Promise((resolve) => {
    const input = h('input.pin-input', { type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', pattern: '[0-9]*' });
    const ok = h('button.btn.primary', { type: 'button', text: 'OK' });
    const body = h('div', null, h('div.dlg-title', { text: title }), sub ? h('div.dlg-msg', { text: sub }) : null, input, h('div.dlg-btns', null, ok));
    const o = overlay('dlg', body, resolve);
    const done = () => {
      const v = input.value.replace(/\D/g, '');
      if (v.length === 4) o.close(v);
      else input.classList.add('bad');
    };
    ok.addEventListener('click', done);
    input.addEventListener('input', () => {
      input.classList.remove('bad');
      if (input.value.replace(/\D/g, '').length === 4) done();
    });
    setTimeout(() => input.focus(), 250);
  });
}

/** Blocking progress card for long work. */
export function progress(title) {
  const label = h('div.prog-label', { text: '' });
  const count = h('div.prog-count');
  const body = h('div', null, h('div.spinner'), h('div.dlg-title', { text: title }), label, count);
  const o = overlay('dlg.prog', body);
  o.closeable = false;
  return {
    set(l, c) {
      label.textContent = l || '';
      count.textContent = c || '';
    },
    close() {
      o.close(null);
    },
  };
}

// ------------------------------------------------------------------ virtual scroller

/**
 * Scrolling list or grid that only keeps the visible items in the page.
 * opts: cls, cols(width) -> n, rowH(colW) -> px, gap, pad, create(), bind(el, i), onTap(i), onHold(i)
 */
export class VScroll {
  constructor(opts) {
    this.o = opts;
    this.el = h('div.vs' + (opts.cls ? '.' + opts.cls : ''));
    this.inner = h('div.vs-inner');
    this.el.appendChild(this.inner);
    this.pool = [];
    this.count = 0;
    this.cols = 1;
    this.rowH = 60;
    this.colW = 100;
    this.gap = opts.gap || 0;
    this.pad = opts.pad || 0;
    this.empty = h('div.vs-empty');
    this.el.appendChild(this.empty);
    let ticking = false;
    this.el.addEventListener(
      'scroll',
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          this.render();
          if (this.o.onScroll) this.o.onScroll();
        });
      },
      { passive: true }
    );
    const find = (e) => {
      let t = e.target;
      while (t && t !== this.el && t.__i === undefined) t = t.parentNode;
      return t && t !== this.el && t.__i >= 0 ? t : null;
    };
    this.el.addEventListener('click', (e) => {
      const c = find(e);
      if (c && this.o.onTap) this.o.onTap(c.__i, c, e);
    });
    this.el.addEventListener('contextmenu', (e) => {
      const c = find(e);
      if (!c) return;
      e.preventDefault();
      if (this.o.onHold) this.o.onHold(c.__i, c);
    });
  }

  setEmpty(text) {
    this.empty.textContent = text || '';
    this.empty.style.display = this.count || !text ? 'none' : '';
  }

  setCount(n, keepScroll) {
    this.count = n;
    for (const c of this.pool) c.__i = -1;
    this.layout();
    if (!keepScroll) this.el.scrollTop = 0;
    this.render();
    this.empty.style.display = n || !this.empty.textContent ? 'none' : '';
  }

  layout() {
    const w = this.el.clientWidth || window.innerWidth;
    this.cols = Math.max(1, this.o.cols ? this.o.cols(w) : 1);
    this.colW = (w - this.pad * 2 - this.gap * (this.cols - 1)) / this.cols;
    this.rowH = Math.round(this.o.rowH(this.colW));
    const rows = Math.ceil(this.count / this.cols);
    this.inner.style.height = rows * this.rowH + this.pad * 2 + 'px';
    const visRows = Math.ceil((this.el.clientHeight || window.innerHeight) / this.rowH) + 6;
    const need = visRows * this.cols;
    while (this.pool.length < need) {
      const c = this.o.create();
      c.classList.add('vs-cell');
      c.__i = -1;
      c.style.display = 'none';
      this.inner.appendChild(c);
      this.pool.push(c);
    }
    for (const c of this.pool) {
      c.style.width = this.colW + 'px';
      c.style.height = this.rowH - (this.cols > 1 ? this.gap : 0) + 'px';
      c.__i = -1;
    }
  }

  render() {
    const n = this.pool.length;
    if (!n) return;
    const top = this.el.scrollTop - this.pad;
    const vh = this.el.clientHeight || window.innerHeight;
    const r0 = Math.max(0, Math.floor(top / this.rowH) - 2);
    const first = r0 * this.cols;
    const last = Math.min(this.count - 1, first + n - 1, (Math.ceil((top + vh) / this.rowH) + 3) * this.cols - 1);
    const used = new Set();
    for (let i = first; i <= last; i++) {
      const c = this.pool[i % n];
      used.add(c);
      if (c.__i !== i) {
        c.__i = i;
        const row = Math.floor(i / this.cols);
        const col = i % this.cols;
        c.style.transform = `translate(${this.pad + col * (this.colW + this.gap)}px,${this.pad + row * this.rowH}px)`;
        c.style.display = '';
        this.o.bind(c, i);
      }
    }
    for (const c of this.pool) {
      if (!used.has(c) && c.__i !== -2) {
        c.__i = -2;
        c.style.display = 'none';
      }
    }
  }

  /** Rebinds the visible items (for example after new guide data). */
  refresh() {
    for (const c of this.pool) if (c.__i >= 0) this.o.bind(c, c.__i);
  }

  visibleRange() {
    const top = this.el.scrollTop - this.pad;
    const vh = this.el.clientHeight || window.innerHeight;
    const a = Math.max(0, Math.floor(top / this.rowH) * this.cols);
    const b = Math.min(this.count - 1, Math.ceil((top + vh) / this.rowH) * this.cols - 1);
    return [a, b];
  }

  scrollTo(i) {
    const row = Math.floor(clamp(i, 0, Math.max(0, this.count - 1)) / this.cols);
    const y = this.pad + row * this.rowH;
    const vh = this.el.clientHeight;
    if (y < this.el.scrollTop || y + this.rowH > this.el.scrollTop + vh) this.el.scrollTop = Math.max(0, y - vh / 3);
  }
}

/** Horizontal scrolling chips; items: {id, label, count, lock}. */
export function chips(onPick) {
  const el = h('div.chips');
  let cur = null;
  const api = {
    el,
    set(items, active) {
      el.innerHTML = '';
      cur = active;
      for (const it of items) {
        const b = h('button.chip' + (it.id === active ? '.on' : ''), { type: 'button' }, it.lock ? icon('lock') : null, h('span', { text: it.label }));
        b.__id = it.id;
        b.addEventListener('click', () => onPick(it.id));
        el.appendChild(b);
      }
      api.reveal();
    },
    select(id) {
      cur = id;
      for (const b of el.children) b.classList.toggle('on', b.__id === id);
      api.reveal();
    },
    reveal() {
      for (const b of el.children) {
        if (b.__id === cur) {
          const x = b.offsetLeft - 16;
          if (x < el.scrollLeft || b.offsetLeft + b.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, x);
        }
      }
    },
  };
  return api;
}

/** Labelled icon button. */
export function ibtn(name, label, onClick, cls) {
  const b = h('button.ibtn' + (cls ? '.' + cls : ''), { type: 'button', 'aria-label': label || name }, icon(name), label ? h('span', { text: label }) : null);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
