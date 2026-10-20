// Virtualised lists for remote-control navigation. Only the rows on screen exist
// in the DOM; scrolling is a single compositor transform.
import { h, clamp } from '../util.js';

export class VList {
  /**
   * opts: rowH, height, create() -> el, bind(el, index, focused), overscan, margin (rows kept
   * visible around focus), cls, onFocus(index)
   */
  constructor(opts) {
    this.o = opts;
    this.rowH = opts.rowH;
    this.height = opts.height;
    this.overscan = opts.overscan == null ? 3 : opts.overscan;
    this.margin = opts.margin == null ? 2 : opts.margin;
    this.count = 0;
    this.index = 0;
    this.top = 0;
    this.active = false;
    this.el = h('div.vlist' + (opts.cls ? '.' + opts.cls : ''), { style: `height:${this.height}px` });
    this.track = h('div.vlist-track');
    this.el.appendChild(this.track);
    this.pool = [];
    this.byIndex = new Map();
    const n = Math.ceil(this.height / this.rowH) + this.overscan * 2 + 1;
    for (let k = 0; k < n; k++) {
      const r = opts.create();
      r.__i = -1;
      r.classList.add('vrow');
      r.style.height = this.rowH + 'px';
      r.style.display = 'none';
      this.track.appendChild(r);
      this.pool.push(r);
    }
  }

  get visibleRows() {
    return Math.floor(this.height / this.rowH);
  }

  setHeight(px) {
    this.height = px;
    this.el.style.height = px + 'px';
    this.top = this._target(this.index);
    this._render(true, false);
  }

  setCount(n, index, keepTop) {
    this.count = n;
    this.index = clamp(index || 0, 0, Math.max(0, n - 1));
    if (!keepTop) this.top = 0;
    this.top = this._target(this.index);
    this._render(true, false);
    if (this.o.onFocus && n) this.o.onFocus(this.index);
  }

  /** Scroll position keeping `margin` rows around the focus; always whole rows. */
  _target(i) {
    const rh = this.rowH;
    const vis = this.height;
    const total = this.count * rh;
    const m = Math.min(this.margin, Math.max(0, Math.floor((vis - rh) / 2 / rh))) * rh;
    let top = this.top;
    const y = i * rh;
    if (y - top < m) top = y - m;
    if (y + rh - top > vis - m) top = Math.ceil((y + rh - vis + m) / rh) * rh;
    const maxTop = total > vis ? Math.ceil((total - vis) / rh) * rh : 0;
    return clamp(Math.round(top / rh) * rh, 0, maxTop);
  }

  setIndex(i, animate) {
    if (!this.count) return;
    i = clamp(i, 0, this.count - 1);
    const old = this.index;
    this.index = i;
    const nt = this._target(i);
    if (nt !== this.top) {
      const ot = this.top;
      this.top = nt;
      this._render(false, animate !== false && Math.abs(nt - ot) < this.height * 1.5, ot);
    }
    this._focus(old, i);
  }

  move(d) {
    const i = this.index + d;
    if (i < 0 || i >= this.count) return false;
    this.setIndex(i);
    return true;
  }

  page(d) {
    if (!this.count) return false;
    const i = clamp(this.index + d * Math.max(1, this.visibleRows - 1), 0, this.count - 1);
    if (i === this.index) return false;
    this.setIndex(i, false);
    return true;
  }

  _focus(a, b) {
    const ra = this.byIndex.get(a);
    const rb = this.byIndex.get(b);
    if (ra && a !== b) ra.classList.remove('is-focused');
    if (rb) rb.classList.toggle('is-focused', this.active);
    if (this.o.onFocus) this.o.onFocus(b);
  }

  setActive(on) {
    this.active = on;
    this.el.classList.toggle('is-active', on);
    const r = this.byIndex.get(this.index);
    if (r) r.classList.toggle('is-focused', on);
  }

  /** Re-bind every visible row (data changed). */
  refresh() {
    this._render(true, false);
  }

  refreshRow(i) {
    const r = this.byIndex.get(i);
    if (r) this.o.bind(r, i, i === this.index && this.active);
  }

  rowEl(i) {
    return this.byIndex.get(i == null ? this.index : i) || null;
  }

  /** Indexes currently bound to visible rows (for lazy data loading). */
  visibleRange() {
    const first = Math.floor(this.top / this.rowH);
    return [first, Math.min(this.count - 1, first + Math.ceil(this.height / this.rowH))];
  }

  _render(force, animate, oldTop) {
    const rh = this.rowH;
    const vis = this.height;
    const ot = oldTop == null ? this.top : oldTop;
    const lo = Math.min(this.top, ot);
    const hi = Math.max(this.top, ot);
    let first = Math.max(0, Math.floor(lo / rh) - this.overscan);
    let last = Math.min(this.count - 1, Math.ceil((hi + vis) / rh) + this.overscan);
    if (last - first + 1 > this.pool.length) {
      first = Math.max(0, Math.floor(this.top / rh) - this.overscan);
      last = Math.min(this.count - 1, first + this.pool.length - 1);
      animate = false;
    }
    const free = [];
    for (const r of this.pool) {
      if (force || r.__i < first || r.__i > last || r.__i >= this.count) {
        if (r.__i >= 0 && this.byIndex.get(r.__i) === r) this.byIndex.delete(r.__i);
        r.__i = -1;
        free.push(r);
      }
    }
    for (let i = first; i <= last; i++) {
      if (this.byIndex.has(i)) continue;
      const r = free.pop();
      if (!r) break;
      r.__i = i;
      this.byIndex.set(i, r);
      r.style.transform = `translate(0,${i * rh}px)`;
      r.style.display = '';
      const f = i === this.index && this.active;
      r.classList.toggle('is-focused', f);
      this.o.bind(r, i, f);
    }
    for (const r of free) r.style.display = 'none';
    const ts = this.track.style;
    if (!animate) ts.transition = 'none';
    ts.transform = `translate3d(0,${-this.top}px,0)`;
    if (!animate) {
      void this.track.offsetHeight;
      ts.transition = '';
    }
  }
}

export class VGrid {
  /** opts: cols, cellW, cellH, height, create, bind(el, index, focused), cls, onFocus, overscanRows */
  constructor(opts) {
    this.o = opts;
    this.cols = opts.cols;
    this.cellW = opts.cellW;
    this.cellH = opts.cellH;
    this.height = opts.height;
    this.overscan = opts.overscanRows == null ? 1 : opts.overscanRows;
    this.count = 0;
    this.index = 0;
    this.top = 0;
    this.active = false;
    this.el = h('div.vgrid' + (opts.cls ? '.' + opts.cls : ''), { style: `height:${this.height}px` });
    this.track = h('div.vgrid-track');
    this.el.appendChild(this.track);
    this.pool = [];
    this.byIndex = new Map();
    const rows = Math.ceil(this.height / this.cellH) + this.overscan * 2 + 1;
    for (let k = 0; k < rows * this.cols; k++) {
      const c = opts.create();
      c.__i = -1;
      c.classList.add('vcell');
      c.style.display = 'none';
      this.track.appendChild(c);
      this.pool.push(c);
    }
  }

  get rows() {
    return Math.ceil(this.count / this.cols);
  }

  setCount(n, index) {
    this.count = n;
    this.index = clamp(index || 0, 0, Math.max(0, n - 1));
    this.top = 0;
    this.top = this._target(this.index);
    this._render(true, false);
    if (this.o.onFocus && n) this.o.onFocus(this.index);
  }

  _target(i) {
    const row = Math.floor(i / this.cols);
    const y = row * this.cellH;
    const vis = this.height;
    const total = this.rows * this.cellH;
    let top = this.top;
    const lead = this.cellH * 0.18;
    if (y - top < lead) top = y - lead;
    if (y + this.cellH - top > vis) top = y + this.cellH - vis + lead * 0.5;
    return clamp(top, 0, Math.max(0, total - vis + lead));
  }

  setIndex(i, animate) {
    if (!this.count) return;
    i = clamp(i, 0, this.count - 1);
    const old = this.index;
    this.index = i;
    const nt = this._target(i);
    if (nt !== this.top) {
      const ot = this.top;
      this.top = nt;
      this._render(false, animate !== false && Math.abs(nt - ot) < this.height * 1.5, ot);
    }
    const a = this.byIndex.get(old);
    const b = this.byIndex.get(i);
    if (a && old !== i) a.classList.remove('is-focused');
    if (b) b.classList.toggle('is-focused', this.active);
    if (this.o.onFocus) this.o.onFocus(i);
  }

  /** Returns false when the move leaves the grid on that side. */
  move(dx, dy) {
    if (!this.count) return false;
    const col = this.index % this.cols;
    if (dx) {
      const nc = col + dx;
      if (nc < 0 || nc >= this.cols) return false;
      const ni = this.index + dx;
      if (ni >= this.count) return false;
      this.setIndex(ni);
      return true;
    }
    const row = Math.floor(this.index / this.cols);
    const nr = row + dy;
    if (nr < 0 || nr >= this.rows) return false;
    this.setIndex(Math.min(this.count - 1, nr * this.cols + col));
    return true;
  }

  page(d) {
    const rowsVis = Math.max(1, Math.floor(this.height / this.cellH));
    const ni = clamp(this.index + d * rowsVis * this.cols, 0, this.count - 1);
    if (ni === this.index) return false;
    this.setIndex(ni, false);
    return true;
  }

  setActive(on) {
    this.active = on;
    this.el.classList.toggle('is-active', on);
    const c = this.byIndex.get(this.index);
    if (c) c.classList.toggle('is-focused', on);
  }

  refresh() {
    this._render(true, false);
  }

  cellEl(i) {
    return this.byIndex.get(i == null ? this.index : i) || null;
  }

  _render(force, animate, oldTop) {
    const ch = this.cellH;
    const ot = oldTop == null ? this.top : oldTop;
    const lo = Math.min(this.top, ot);
    const hi = Math.max(this.top, ot);
    let r0 = Math.max(0, Math.floor(lo / ch) - this.overscan);
    let r1 = Math.min(this.rows - 1, Math.ceil((hi + this.height) / ch) + this.overscan);
    const maxRows = Math.floor(this.pool.length / this.cols);
    if (r1 - r0 + 1 > maxRows) {
      r0 = Math.max(0, Math.floor(this.top / ch) - this.overscan);
      r1 = Math.min(this.rows - 1, r0 + maxRows - 1);
      animate = false;
    }
    const first = r0 * this.cols;
    const last = Math.min(this.count - 1, (r1 + 1) * this.cols - 1);
    const free = [];
    for (const c of this.pool) {
      if (force || c.__i < first || c.__i > last || c.__i >= this.count) {
        if (c.__i >= 0 && this.byIndex.get(c.__i) === c) this.byIndex.delete(c.__i);
        c.__i = -1;
        free.push(c);
      }
    }
    for (let i = first; i <= last; i++) {
      if (this.byIndex.has(i)) continue;
      const c = free.pop();
      if (!c) break;
      c.__i = i;
      this.byIndex.set(i, c);
      c.style.transform = `translate(${(i % this.cols) * this.cellW}px,${Math.floor(i / this.cols) * ch}px)`;
      c.style.display = '';
      const f = i === this.index && this.active;
      c.classList.toggle('is-focused', f);
      this.o.bind(c, i, f);
    }
    for (const c of free) c.style.display = 'none';
    const ts = this.track.style;
    if (!animate) ts.transition = 'none';
    ts.transform = `translate3d(0,${-this.top}px,0)`;
    if (!animate) {
      void this.track.offsetHeight;
      ts.transition = '';
    }
  }
}

/** A short horizontal row of cards (not virtualised). */
export class HRow {
  /** opts: width, cardW, gap, create, bind(el, index), cls, onFocus, peek */
  constructor(opts) {
    this.o = opts;
    this.step = opts.cardW + (opts.gap == null ? 24 : opts.gap);
    this.width = opts.width;
    this.peek = opts.peek == null ? 1 : opts.peek;
    this.el = h('div.hrow' + (opts.cls ? '.' + opts.cls : ''), { style: `width:${opts.width}px` });
    this.track = h('div.hrow-track');
    this.el.appendChild(this.track);
    this.cards = [];
    this.count = 0;
    this.index = 0;
    this.active = false;
    this.x = 0;
  }
  setCount(n, index) {
    this.count = n;
    while (this.cards.length < n) {
      const c = this.o.create();
      c.classList.add('hcard');
      this.track.appendChild(c);
      this.cards.push(c);
    }
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      if (i < n) {
        c.style.display = '';
        c.style.transform = `translate(${i * this.step}px,0)`;
        this.o.bind(c, i);
      } else c.style.display = 'none';
    }
    this.index = clamp(index || 0, 0, Math.max(0, n - 1));
    this._scroll(false);
    this._mark();
  }
  refreshCard(i) {
    if (i < this.count) this.o.bind(this.cards[i], i);
  }
  move(d) {
    const i = this.index + d;
    if (i < 0 || i >= this.count) return false;
    this.index = i;
    this._scroll(true);
    this._mark();
    if (this.o.onFocus) this.o.onFocus(i);
    return true;
  }
  setIndex(i) {
    this.index = clamp(i, 0, Math.max(0, this.count - 1));
    this._scroll(true);
    this._mark();
  }
  setActive(on) {
    this.active = on;
    this.el.classList.toggle('is-active', on);
    this._mark();
    if (on && this.o.onFocus && this.count) this.o.onFocus(this.index);
  }
  cardEl(i) {
    return this.cards[i == null ? this.index : i] || null;
  }
  _mark() {
    for (let i = 0; i < this.count; i++) this.cards[i].classList.toggle('is-focused', this.active && i === this.index);
  }
  _scroll(animate) {
    const max = Math.max(0, this.count * this.step - (this.step - this.o.cardW) - this.width);
    const x = clamp((this.index - this.peek) * this.step, 0, max);
    this.x = x;
    const ts = this.track.style;
    if (!animate) ts.transition = 'none';
    ts.transform = `translate3d(${-x}px,0,0)`;
    if (!animate) {
      void this.track.offsetHeight;
      ts.transition = '';
    }
  }
}
