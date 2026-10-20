// Overlays: option sheets, confirmation dialogs, PIN entry and progress.
import { h, clamp } from '../util.js';
import { App } from './app.js';
import { VList } from './list.js';
import { icon } from './widgets.js';

/**
 * Side sheet with a list of options.
 * items: [{label, sub, icon, value, checked, danger, disabled, action(item) -> false keeps it open}]
 */
export class Menu {
  constructor(title, items, opts) {
    opts = opts || {};
    this.items = items;
    this.opts = opts;
    const rowH = opts.rowH || (items.some((i) => i.sub) ? 104 : 84);
    const head = h('div.sheet-head', null, h('div.sheet-title', { text: title }), opts.sub ? h('div.sheet-sub', { text: opts.sub }) : null);
    const height = Math.min(App.height - 260, Math.max(rowH, items.length * rowH));
    this.list = new VList({
      rowH,
      height,
      margin: 1,
      create: () => h('div.mrow', null, h('span.mrow-ico'), h('div.mrow-text', null, h('div.mrow-label'), h('div.mrow-sub')), h('span.mrow-val')),
      bind: (el, i) => {
        const it = this.items[i];
        const ic = el.children[0];
        ic.innerHTML = '';
        if (it.checked !== undefined) ic.appendChild(icon(it.checked ? 'check' : 'none'));
        else if (it.icon) ic.appendChild(icon(it.icon));
        el.children[1].children[0].textContent = it.label;
        el.children[1].children[1].textContent = it.sub || '';
        el.children[2].textContent = it.value || '';
        el.classList.toggle('is-danger', !!it.danger);
        el.classList.toggle('is-disabled', !!it.disabled);
        el.classList.toggle('is-checked', !!it.checked);
        el.classList.toggle('has-sub', !!it.sub);
      },
    });
    this.el = h('div.ov.ov-sheet' + (opts.wide ? '.wide' : ''), null, h('div.ov-dim'), h('div.sheet', null, head, this.list.el, opts.hint ? h('div.sheet-hint', { text: opts.hint }) : null));
    let start = opts.index || 0;
    if (opts.index == null) {
      const c = items.findIndex((i) => i.checked);
      if (c >= 0) start = c;
    }
    this.list.setCount(items.length, start);
    this.list.setActive(true);
  }
  open() {
    App.openOverlay(this);
    return this;
  }
  close() {
    App.closeOverlay(this);
    if (this.opts.onClose) this.opts.onClose();
  }
  update(items) {
    this.items = items;
    this.list.setCount(items.length, Math.min(this.list.index, items.length - 1), true);
  }
  key(ev) {
    const l = this.list;
    switch (ev.key) {
      case 'up':
        if (!l.move(-1) && !ev.repeat) l.setIndex(l.count - 1);
        return true;
      case 'down':
        if (!l.move(1) && !ev.repeat) l.setIndex(0);
        return true;
      case 'pgup':
      case 'chup':
        l.page(-1);
        return true;
      case 'pgdown':
      case 'chdown':
        l.page(1);
        return true;
      case 'ok': {
        const it = this.items[l.index];
        if (!it || it.disabled) return true;
        const keep = it.action ? it.action(it, l.index) : undefined;
        if (keep === false) l.refresh();
        else this.close();
        return true;
      }
      case 'left':
        if (this.opts.onLeft) {
          this.opts.onLeft(this.items[l.index], l.index);
          l.refreshRow(l.index);
        }
        return true;
      case 'right':
        if (this.opts.onRight) {
          this.opts.onRight(this.items[l.index], l.index);
          l.refreshRow(l.index);
        }
        return true;
      case 'back':
      case 'del':
      case 'menu':
        this.close();
        return true;
    }
    return true;
  }
}

/** Single choice picker. Resolves with the chosen value or undefined. */
export function pick(title, options, current, opts) {
  return new Promise((resolve) => {
    let done = false;
    const m = new Menu(
      title,
      options.map((o) => ({
        label: o.label,
        sub: o.sub,
        checked: o.value === current,
        action: () => {
          done = true;
          resolve(o.value);
        },
      })),
      Object.assign({}, opts, {
        onClose: () => {
          if (!done) resolve(undefined);
        },
      })
    );
    m.open();
  });
}

/** Centered dialog with buttons. Resolves with the chosen button value (or null on back). */
export function confirm(title, message, buttons, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const btns = buttons.map((b) => h('div.btn' + (b.danger ? '.btn-danger' : ''), { text: b.label }));
    let index = clamp(opts.focus || 0, 0, btns.length - 1);
    const mark = () => btns.forEach((b, i) => b.classList.toggle('is-focused', i === index));
    const ov = {
      el: h('div.ov.ov-dialog', null, h('div.ov-dim'), h('div.dialog', null, h('div.dialog-title', { text: title }), message ? h('div.dialog-msg', { text: message }) : null, h('div.dialog-btns', null, btns))),
      key(ev) {
        if (ev.key === 'left') {
          index = Math.max(0, index - 1);
          mark();
        } else if (ev.key === 'right') {
          index = Math.min(btns.length - 1, index + 1);
          mark();
        } else if (ev.key === 'ok') {
          App.closeOverlay(ov);
          resolve(buttons[index].value);
        } else if (ev.key === 'back' || ev.key === 'del') {
          App.closeOverlay(ov);
          resolve(null);
        }
        return true;
      },
    };
    mark();
    App.openOverlay(ov);
  });
}

/** Four digit PIN entry. Resolves with the PIN or null. */
export function askPin(title, message) {
  return new Promise((resolve) => {
    let pin = '';
    const dots = [0, 1, 2, 3].map(() => h('i'));
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'];
    const cells = keys.map((k) => h('div.pin-key' + (k.length > 1 ? '.pin-fn' : ''), k === 'del' ? null : { text: k === 'clear' ? 'Clear' : k }, k === 'del' ? icon('backspace') : null));
    let index = 4;
    const mark = () => cells.forEach((c, i) => c.classList.toggle('is-focused', i === index));
    const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
    const msg = h('div.dialog-msg', { text: message || 'Use the number keys on your remote or the keypad.' });
    const ov = {
      el: h('div.ov.ov-dialog', null, h('div.ov-dim'), h('div.dialog.dialog-pin', null, h('div.dialog-title', { text: title }), msg, h('div.pin-dots', null, dots), h('div.pin-pad', null, cells))),
      key(ev) {
        const press = (k) => {
          if (k === 'del') pin = pin.slice(0, -1);
          else if (k === 'clear') pin = '';
          else if (pin.length < 4) pin += k;
          paint();
          if (pin.length === 4) {
            setTimeout(() => {
              App.closeOverlay(ov);
              resolve(pin);
            }, 160);
          }
        };
        switch (ev.key) {
          case 'digit':
            press(String(ev.digit));
            break;
          case 'left':
            if (index % 3) index--;
            mark();
            break;
          case 'right':
            if (index % 3 < 2) index++;
            mark();
            break;
          case 'up':
            if (index >= 3) index -= 3;
            mark();
            break;
          case 'down':
            if (index < 9) index += 3;
            mark();
            break;
          case 'ok':
            press(keys[index]);
            break;
          case 'del':
            press('del');
            break;
          case 'back':
            App.closeOverlay(ov);
            resolve(null);
            break;
        }
        return true;
      },
    };
    mark();
    App.openOverlay(ov);
  });
}

/** Blocking progress card used while a playlist loads. */
export function progress(title) {
  const bars = h('div.load-bars', null, ['#F4F0E6', '#FFC83A', '#48D6E0', '#5BD98C', '#D36BD9', '#FF5148', '#3B6FE0'].map((c) => h('i', { style: `background:${c}` })));
  const line = h('div.load-line', { text: '' });
  const count = h('div.load-count', { text: '' });
  const ov = {
    el: h('div.ov.ov-dialog.ov-load', null, h('div.ov-dim'), h('div.dialog.dialog-load', null, bars, h('div.dialog-title', { text: title }), line, count)),
    key() {
      return true;
    },
    set(text, n) {
      line.textContent = text || '';
      count.textContent = n || '';
    },
    close() {
      App.closeOverlay(ov);
    },
  };
  App.openOverlay(ov);
  return ov;
}
