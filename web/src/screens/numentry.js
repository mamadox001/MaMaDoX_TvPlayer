// Typing a channel number with the remote's digit keys.
import { h } from '../util.js';

export class NumberEntry {
  constructor(parent, onCommit) {
    this.onCommit = onCommit;
    this.value = '';
    this.el = h('div.numentry', null, h('div.numentry-v'), h('div.numentry-hint', { text: 'Channel' }));
    parent.appendChild(this.el);
    this.t = 0;
  }
  get active() {
    return this.value.length > 0;
  }
  push(d) {
    if (this.value.length >= 5) this.value = '';
    this.value += String(d);
    this.el.firstChild.textContent = this.value;
    this.el.classList.add('show');
    clearTimeout(this.t);
    this.t = setTimeout(() => this.commit(), this.value.length >= 4 ? 600 : 1500);
  }
  commit() {
    clearTimeout(this.t);
    const v = this.value;
    this.cancel();
    if (v) this.onCommit(+v);
  }
  cancel() {
    clearTimeout(this.t);
    this.value = '';
    this.el.classList.remove('show');
  }
}
