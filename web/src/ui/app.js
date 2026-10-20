// Root of the interface: scaling to the TV, the screen stack, overlays and key routing.
import { h } from '../util.js';
import { setKeyHandler } from '../keys.js';
import { Video } from '../player/video.js';

const W = 1920;

export class Screen {
  constructor(cls) {
    this.el = h('section.screen' + (cls ? '.' + cls : ''));
    this.built = false;
  }
  /** Build DOM once, lazily before the first enter. */
  build() {}
  /** Shown (first time or after a child closed). back = returning from a child. */
  enter(params, back) {}
  leave() {}
  /** Return true if handled. */
  key(ev) {
    return false;
  }
  /** Where video should be: null (stop), 'keep', 'full' or an element (a hole in the UI). */
  video() {
    return null;
  }
  destroy() {
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}

export const App = {
  root: null,
  layer: null,
  overlayLayer: null,
  stack: [],
  overlays: [],
  scale: 1,
  height: 1080,
  motion: true,
  globalKey: null,

  init(root) {
    this.root = root;
    this.layer = h('div.screens');
    this.overlayLayer = h('div.overlays');
    this.toastEl = h('div.toasts');
    root.append(this.layer, this.overlayLayer, this.toastEl);
    this.fit();
    window.addEventListener('resize', () => this.fit());
    setKeyHandler((ev) => this.onKey(ev));
  },

  fit() {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    this.scale = vw / W;
    this.height = Math.round(vh / this.scale);
    const s = this.root.style;
    s.width = W + 'px';
    s.height = this.height + 'px';
    s.transform = `scale(${this.scale})`;
    document.documentElement.style.setProperty('--app-h', this.height + 'px');
    if (this.stack.length) Video.place(this.top().video());
  },

  setMotion(on) {
    this.motion = on;
    document.documentElement.classList.toggle('reduced', !on);
  },

  top() {
    return this.stack[this.stack.length - 1] || null;
  },

  _show(scr, dir, params, back) {
    if (!scr.built) {
      scr.build();
      scr.built = true;
    }
    const el = scr.el;
    if (!el.parentNode) this.layer.appendChild(el);
    el.classList.remove('is-hidden', 'leave-fwd', 'leave-back');
    if (this.motion && dir) {
      el.classList.add(dir === 'fwd' ? 'enter-fwd' : 'enter-back');
      void el.offsetWidth;
      el.classList.remove('enter-fwd', 'enter-back');
    }
    scr.enter(params || {}, !!back);
    Video.place(scr.video());
  },

  _hide(scr, dir, destroy) {
    scr.leave();
    const el = scr.el;
    const done = () => {
      if (destroy) scr.destroy();
      else if (this.stack.indexOf(scr) >= 0 && this.top() !== scr) el.classList.add('is-hidden');
      el.classList.remove('leave-fwd', 'leave-back');
    };
    if (this.motion && dir) {
      el.classList.add(dir === 'fwd' ? 'leave-fwd' : 'leave-back');
      setTimeout(done, 280);
    } else done();
  },

  push(scr, params) {
    const prev = this.top();
    this.stack.push(scr);
    if (prev) this._hide(prev, 'fwd', false);
    this._show(scr, prev ? 'fwd' : null, params, false);
  },

  /** Replace the top screen. */
  replace(scr, params) {
    const prev = this.stack.pop();
    this.stack.push(scr);
    if (prev) this._hide(prev, 'fwd', true);
    this._show(scr, prev ? 'fwd' : null, params, false);
  },

  /** Clear everything and show scr. */
  reset(scr, params) {
    const old = this.stack.slice();
    this.stack = [scr];
    for (const s of old) if (s !== scr) this._hide(s, 'fwd', true);
    this._show(scr, old.length ? 'fwd' : null, params, false);
  },

  pop(result) {
    if (this.stack.length < 2) return false;
    const cur = this.stack.pop();
    this._hide(cur, 'back', true);
    const prev = this.top();
    this._show(prev, 'back', result, true);
    return true;
  },

  /** Remove a screen below the top without animation. */
  remove(scr) {
    const i = this.stack.indexOf(scr);
    if (i >= 0 && i < this.stack.length - 1) {
      this.stack.splice(i, 1);
      scr.leave();
      scr.destroy();
    }
  },

  find(Type) {
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i] instanceof Type) return this.stack[i];
    return null;
  },

  /** Re-evaluate where the video should be (after layout changes). */
  updateVideo() {
    const t = this.top();
    if (t && !this.overlays.some((o) => o.ownsVideo)) Video.place(t.video());
  },

  openOverlay(ov) {
    this.overlays.push(ov);
    this.overlayLayer.appendChild(ov.el);
    if (this.motion) {
      ov.el.classList.add('ov-enter');
      void ov.el.offsetWidth;
      ov.el.classList.remove('ov-enter');
    }
    if (ov.opened) ov.opened();
  },

  closeOverlay(ov) {
    const i = this.overlays.indexOf(ov);
    if (i < 0) return;
    this.overlays.splice(i, 1);
    const el = ov.el;
    if (this.motion) {
      el.classList.add('ov-leave');
      setTimeout(() => el.parentNode && el.parentNode.removeChild(el), 220);
    } else if (el.parentNode) el.parentNode.removeChild(el);
    if (ov.closed) ov.closed();
  },

  closeAllOverlays() {
    for (const o of this.overlays.slice()) this.closeOverlay(o);
  },

  onKey(ev) {
    const ov = this.overlays[this.overlays.length - 1];
    if (ov) {
      if (ov.key(ev)) return;
      if (ev.key === 'back' || ev.key === 'del') this.closeOverlay(ov);
      return;
    }
    const top = this.top();
    if (!top) return;
    if (top.key(ev)) return;
    if (this.globalKey && this.globalKey(ev)) return;
    if (ev.key === 'back' || ev.key === 'del') {
      if (!this.pop()) this.onRootBack();
    }
  },

  onRootBack() {},

  toast(msg, kind) {
    const t = h('div.toast' + (kind ? '.toast-' + kind : ''), { text: msg });
    this.toastEl.appendChild(t);
    void t.offsetWidth;
    t.classList.add('in');
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.parentNode && t.parentNode.removeChild(t), 300);
    }, kind === 'long' ? 4200 : 2600);
  },
};
