// On-screen keyboard tuned for typing server addresses and searching with a remote.
import { h } from '../util.js';
import { icon } from './widgets.js';

const LETTERS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ':'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '/', '-'],
];
const SYMBOLS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '#', '$', '%', '&', '*', '(', ')', '_', '!'],
  ['+', '=', '?', ';', "'", '"', ',', '~', '|', '\\'],
  ['<', '>', '[', ']', '{', '}', '^', '`', '.', '/'],
];

export class Keyboard {
  /** opts: mode 'url' | 'text' | 'search', onChange(value), onDone(value), onVoice(), value */
  constructor(opts) {
    this.o = opts;
    this.value = opts.value || '';
    this.shift = false;
    this.symbols = false;
    this.row = 1;
    this.col = 0;
    this.el = h('div.kbd' + (opts.mode === 'search' ? '.kbd-search' : ''));
    this.render();
  }

  layout() {
    if (this.o.mode === 'search') {
      const L = 'abcdefghijklmnopqrstuvwxyz'.split('');
      const k = (c) => ({ k: c, label: c, w: 1 });
      const rows = [L.slice(0, 7), L.slice(7, 14), L.slice(14, 21), L.slice(21, 26).concat(["'", '-']), ['1', '2', '3', '4', '5', '6', '7']].map((r) => r.map(k));
      rows.push([k('8'), k('9'), k('0'), { k: 'space', icon: 'space', w: 2 }, { k: 'del', icon: 'backspace', w: 2 }]);
      rows.push(this.o.onVoice ? [{ k: 'voice', icon: 'mic', label: '', w: 3.5 }, { k: 'clear', label: 'Clear', w: 3.5 }] : [{ k: 'clear', label: 'Clear', w: 7 }]);
      return rows;
    }
    const base = (this.symbols ? SYMBOLS : LETTERS).map((r) => r.map((k) => ({ k, label: this.shift && !this.symbols ? k.toUpperCase() : k, w: 1 })));
    const mode = this.o.mode;
    const fn = [];
    if (mode !== 'search') {
      fn.push({ k: 'shift', icon: 'shift', w: 1.5, on: this.shift });
      fn.push({ k: 'sym', label: this.symbols ? 'abc' : '#+=', w: 1.5 });
    } else if (this.o.onVoice) {
      fn.push({ k: 'voice', icon: 'mic', w: 1.5 });
    }
    fn.push({ k: 'space', icon: 'space', w: mode === 'search' ? (this.o.onVoice ? 3.5 : 5) : 3 });
    fn.push({ k: 'del', icon: 'backspace', w: 1.5 });
    if (mode === 'search') fn.push({ k: 'clear', label: 'Clear', w: 1.5 });
    else fn.push({ k: 'done', label: 'Done', w: 2.5, primary: true });
    const rows = base.concat([fn]);
    if (mode === 'url') rows.push(['http://', 'https://', '.com', '.net', ':8080', 'www.'].map((s) => ({ k: 'str:' + s, label: s, w: 10 / 6, chip: true })));
    return rows;
  }

  render() {
    this.rows = this.layout();
    this.el.innerHTML = '';
    this.cells = [];
    const U = this.o.mode === 'search' ? 80 : 84;
    this.rows.forEach((r, ri) => {
      const rowEl = h('div.kbd-row');
      const cells = [];
      let x = 0;
      r.forEach((key) => {
        const w = key.w * U + (key.w - 1) * 8;
        const el = h('div.kbd-key' + (key.primary ? '.kbd-primary' : '') + (key.chip ? '.kbd-chip' : '') + (key.on ? '.is-on' : ''), { style: `width:${Math.round(w)}px` }, key.icon ? icon(key.icon) : key.label);
        el.__key = key;
        el.__cx = x + w / 2;
        x += w + 8;
        rowEl.appendChild(el);
        cells.push(el);
      });
      this.cells.push(cells);
      this.el.appendChild(rowEl);
    });
    this.row = Math.min(this.row, this.rows.length - 1);
    this.col = Math.min(this.col, this.rows[this.row].length - 1);
    this.mark();
  }

  setActive(on) {
    this.active = on;
    this.el.classList.toggle('is-active', on);
    this.mark();
  }

  mark() {
    this.cells.forEach((r, ri) => r.forEach((c, ci) => c.classList.toggle('is-focused', !!this.active && ri === this.row && ci === this.col)));
  }

  setValue(v) {
    this.value = v || '';
  }

  _emit() {
    if (this.o.onChange) this.o.onChange(this.value);
  }

  type(s) {
    this.value += s;
    this._emit();
  }

  press(key) {
    const k = key.k;
    if (k === 'shift') {
      this.shift = !this.shift;
      this.render();
    } else if (k === 'sym') {
      this.symbols = !this.symbols;
      this.render();
    } else if (k === 'space') this.type(' ');
    else if (k === 'del') {
      this.value = this.value.slice(0, -1);
      this._emit();
    } else if (k === 'clear') {
      this.value = '';
      this._emit();
    } else if (k === 'done') {
      if (this.o.onDone) this.o.onDone(this.value);
    } else if (k === 'voice') {
      if (this.o.onVoice) this.o.onVoice();
    } else if (k.indexOf('str:') === 0) this.type(k.slice(4));
    else this.type(this.shift && !this.symbols ? k.toUpperCase() : k);
  }

  _vertical(d) {
    const nr = this.row + d;
    if (nr < 0 || nr >= this.cells.length) return false;
    const cx = this.cells[this.row][this.col].__cx;
    let best = 0;
    let bd = 1e9;
    this.cells[nr].forEach((c, i) => {
      const dd = Math.abs(c.__cx - cx);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    this.row = nr;
    this.col = best;
    this.mark();
    return true;
  }

  /** Returns false when the key should be handled by the parent (leaving an edge). */
  key(ev) {
    switch (ev.key) {
      case 'left':
        if (this.col === 0) return false;
        this.col--;
        this.mark();
        return true;
      case 'right':
        if (this.col >= this.cells[this.row].length - 1) return false;
        this.col++;
        this.mark();
        return true;
      case 'up':
        return this._vertical(-1);
      case 'down':
        return this._vertical(1);
      case 'ok':
        this.press(this.rows[this.row][this.col]);
        return true;
      case 'char':
        this.type(ev.ch);
        return true;
      case 'digit':
        this.type(String(ev.digit));
        return true;
      case 'del':
        this.value = this.value.slice(0, -1);
        this._emit();
        return true;
    }
    return false;
  }
}
