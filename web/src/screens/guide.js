// TV guide grid: channels down, time across. OK plays what is on now, replays
// past shows on catch-up channels, and tells you when future ones start.
import { h, fmtClock, fmtDay, nowSec, debounce } from '../util.js';
import { App, Screen } from '../ui/app.js';
import { VList } from '../ui/list.js';
import { icon, art, setArt, topbar } from '../ui/widgets.js';
import { pick } from '../ui/dialogs.js';
import { Session, bus, canCatchup } from '../data/session.js';
import { Video } from '../player/video.js';
import { playChannel } from '../player/playback.js';
import { liveCats, catLocked } from './livecats.js';
import { NumberEntry } from './numentry.js';
import { go } from './nav.js';

const PPM = 9.6; // pixels per minute: 30 minutes = 288 px
const TL_W = 1440; // timeline width
const SLOT = 1800;
const VIS = Math.floor((TL_W / PPM) * 60); // visible seconds

export class GuideScreen extends Screen {
  constructor(opts) {
    super('guide');
    this.opts = opts || {};
    this.list = [];
    this.t = nowSec();
    this.win = 0;
  }

  build() {
    this.bar = topbar('TV Guide', '');
    this.dTitle = h('div.gd-title.bidi');
    this.dTime = h('div.gd-time');
    this.dDesc = h('div.gd-desc.bidi');
    this.details = h('div.gd-details.over', null, this.dTime, this.dTitle, this.dDesc);
    this.hole = h('div.hole.gd-hole', null, h('div.hole-face', null, icon('tv'), h('div.hole-msg', { text: 'OK on a show that is on now plays it here' })), h('div.hole-spin', null, h('div.spin')));
    this.ticks = h('div.gd-ticks');
    this.day = h('div.gd-day');
    this.header = h('div.gd-head.over', null, this.day, h('div.gd-tickbox', null, this.ticks));
    this.rows = new VList({
      rowH: 88,
      height: App.height - 452,
      margin: 2,
      overscan: 2,
      cls: 'gd-rows',
      create: () => h('div.gd-row', null, h('div.gd-ch', null, h('span.gd-num'), art('logo.gd-logo'), h('span.gd-name.bidi')), h('div.gd-tl')),
      bind: (el, i) => this.bindRow(el, i),
      onFocus: () => this.afterMove(),
    });
    this.nowLine = h('div.gd-now');
    this.gridBox = h('div.gd-grid.over', null, this.rows.el, this.nowLine);
    this.el.append(this.bar, this.hole, this.details, this.header, this.gridBox);
    this.num = new NumberEntry(this.el, (n) => this.jump(n));
    this.loadVisible = debounce(() => this.requestVisible(), 120);
    this.offs = [
      bus.on('guide', () => this.rows.refresh()),
      Video.on('state', () => this.paintHole()),
      Video.on('firstframe', () => this.paintHole()),
    ];
    this.tick = setInterval(() => {
      if (App.top() === this) this.paintNow();
    }, 30000);
  }

  destroy() {
    for (const f of this.offs) f();
    if (this.guideOff) this.guideOff();
    clearInterval(this.tick);
    super.destroy();
  }

  async enter(params, back) {
    if (this.guideOff) this.guideOff();
    this.guideOff = Session.guide.onUpdate((id) => this.onData(id));
    if (!back) {
      const live = await Session.catalog.ensure('live');
      this.cats = liveCats(live).filter((c) => !catLocked(c));
      let ci = this.opts.catId ? this.cats.findIndex((c) => c.id === this.opts.catId) : -1;
      if (ci < 0) {
        const last = Session.lib.lastCat('live');
        ci = last ? this.cats.findIndex((c) => c.id === last) : -1;
      }
      if (ci < 0) ci = 0;
      let ch = this.opts.focusId ? live.byId.get(this.opts.focusId) : null;
      if (!ch && Video.cur && Video.cur.meta.kind === 'live') ch = Video.cur.meta.ch;
      this.setCat(ci, ch);
    } else this.rows.refresh();
    this.paintHole();
  }

  leave() {
    if (this.guideOff) this.guideOff();
    this.guideOff = null;
    this.num.cancel();
  }

  video() {
    return Video.cur && Video.cur.meta.kind === 'live' ? this.hole : null;
  }

  setCat(ci, ch) {
    this.ci = ci;
    this.list = this.cats[ci].list;
    const t = nowSec();
    this.t = t;
    this.win = Math.floor(t / SLOT) * SLOT - SLOT;
    let idx = ch ? this.list.indexOf(ch) : 0;
    if (idx < 0) idx = 0;
    this.rows.setCount(this.list.length, idx);
    this.rows.setActive(true);
    this.bar.setSub(`${this.cats[ci].name}. Menu changes the category.`);
    this.paintTicks();
    this.paintNow();
    this.afterMove();
  }

  // ------------------------------------------------------------ data

  requestVisible() {
    const [a, b] = this.rows.visibleRange();
    for (let i = b; i >= a; i--) {
      const ch = this.list[i];
      if (ch) Session.guide.load(ch, true);
    }
  }

  onData(id) {
    const [a, b] = this.rows.visibleRange();
    for (let i = Math.max(0, a - 2); i <= b + 2; i++) {
      if (this.list[i] && this.list[i].id === id) this.rows.refreshRow(i);
    }
    const ch = this.list[this.rows.index];
    if (ch && ch.id === id) this.paintDetails();
  }

  progsOf(ch) {
    return Session.guide.cached(ch);
  }

  /** Programme under the time cursor in a row (or the nearest one). */
  focusProg(ch) {
    const l = this.progsOf(ch);
    if (!l || !l.length) return null;
    let best = null;
    for (const p of l) {
      if (p.start <= this.t && p.stop > this.t) return p;
      if (!best || Math.abs(p.start - this.t) < Math.abs(best.start - this.t)) best = p;
    }
    if (best && (best.stop < this.win || best.start > this.win + VIS)) return null;
    return best;
  }

  // ------------------------------------------------------------ painting

  paintTicks() {
    this.ticks.innerHTML = '';
    for (let s = this.win; s < this.win + VIS + SLOT; s += SLOT) {
      const x = ((s - this.win) / 60) * PPM;
      if (x > TL_W - 40) break;
      this.ticks.appendChild(h('span.gd-tick', { style: `transform:translate(${x}px,0)`, text: fmtClock(s) }));
    }
    this.day.textContent = fmtDay(this.t);
  }

  paintNow() {
    const t = nowSec();
    const x = ((t - this.win) / 60) * PPM;
    const on = x >= 0 && x <= TL_W;
    this.nowLine.style.display = on ? '' : 'none';
    if (on) this.nowLine.style.transform = `translate3d(${Math.round(x)}px,0,0)`;
  }

  bindRow(el, i) {
    const ch = this.list[i];
    if (!ch) return;
    const c = el.children[0];
    c.children[0].textContent = ch.num || '';
    setArt(c.children[1], ch.logo || Session.guide.iconFor(ch), ch.name, 100, 80);
    c.children[2].textContent = ch.name;
    const tl = el.children[1];
    tl.innerHTML = '';
    const focused = i === this.rows.index;
    const l = this.progsOf(ch);
    if (!l) {
      tl.appendChild(h('div.gp.gp-wait' + (focused ? '.is-focused' : ''), { style: `width:${TL_W - 6}px` }, h('span.gp-title', { text: 'Loading' })));
      return;
    }
    const now = nowSec();
    const fp = focused ? this.focusProg(ch) : null;
    let any = false;
    for (const p of l) {
      if (p.stop <= this.win || p.start >= this.win + VIS) continue;
      any = true;
      const x0 = Math.max(0, ((p.start - this.win) / 60) * PPM);
      const x1 = Math.min(TL_W, ((p.stop - this.win) / 60) * PPM);
      const w = Math.max(4, x1 - x0 - 6);
      const cls = 'div.gp' + (p.stop <= now ? '.is-past' : p.start <= now ? '.is-now' : '') + (p === fp ? '.is-focused' : '') + (p.arch && p.stop <= now ? '.has-arch' : '');
      const cell = h(cls, { style: `transform:translate(${Math.round(x0)}px,0);width:${Math.round(w)}px` });
      if (w > 60) {
        cell.appendChild(h('span.gp-title.bidi', { text: p.title }));
        if (w > 150) cell.appendChild(h('span.gp-time', { text: `${fmtClock(p.start)} to ${fmtClock(p.stop)}` }));
      }
      if (p.arch && p.stop <= now && w > 40) cell.appendChild(icon('restart', 'gp-arch'));
      tl.appendChild(cell);
    }
    if (!any) tl.appendChild(h('div.gp.gp-none' + (focused ? '.is-focused' : ''), { style: `width:${TL_W - 6}px` }, h('span.gp-title', { text: 'No programme information' })));
  }

  paintDetails() {
    const ch = this.list[this.rows.index];
    if (!ch) return;
    const p = this.focusProg(ch);
    const now = nowSec();
    if (p) {
      const state = p.stop <= now ? (p.arch && canCatchup(Session.pl, ch) ? 'Press OK to watch from the start' : 'Ended') : p.start <= now ? 'On now, press OK to watch' : `Starts at ${fmtClock(p.start)}`;
      this.dTime.textContent = `${ch.num ? ch.num + '  ' : ''}${ch.name}. ${fmtDay(p.start)}, ${fmtClock(p.start)} to ${fmtClock(p.stop)}. ${state}`;
      this.dTitle.textContent = p.title;
      this.dDesc.textContent = p.desc || '';
    } else {
      this.dTime.textContent = `${ch.num ? ch.num + '  ' : ''}${ch.name}`;
      this.dTitle.textContent = this.progsOf(ch) ? 'No programme information' : 'Loading the guide';
      this.dDesc.textContent = '';
    }
  }

  paintHole() {
    const cur = Video.cur;
    const playing = !!cur && cur.meta.kind === 'live' && Video.state !== 'idle';
    this.hole.classList.toggle('is-playing', playing && Video.state === 'playing');
    this.hole.classList.toggle('is-buffering', playing && Video.buffering);
    App.updateVideo();
  }

  afterMove() {
    const i = this.rows.index;
    if (this.lastRow != null && this.lastRow !== i) this.rows.refreshRow(this.lastRow);
    this.rows.refreshRow(i);
    this.lastRow = i;
    this.paintDetails();
    this.loadVisible();
  }

  rerender() {
    this.paintTicks();
    this.paintNow();
    this.rows.refresh();
    this.paintDetails();
  }

  // ------------------------------------------------------------ moving

  setTime(t) {
    const min = nowSec() - 7 * 86400;
    const max = nowSec() + 4 * 86400;
    t = Math.max(min, Math.min(max, t));
    this.t = t;
    let w = this.win;
    if (t < w) w = Math.floor(t / SLOT) * SLOT;
    if (t >= w + VIS - SLOT / 2) w = Math.floor(t / SLOT) * SLOT - SLOT;
    if (w !== this.win) {
      this.win = w;
      this.rerender();
    } else {
      this.rows.refreshRow(this.rows.index);
      this.paintDetails();
    }
  }

  horizontal(d) {
    const ch = this.list[this.rows.index];
    const l = ch ? this.progsOf(ch) : null;
    const p = ch ? this.focusProg(ch) : null;
    if (!l || !l.length || !p) {
      this.setTime(this.t + d * SLOT);
      return;
    }
    const i = l.indexOf(p);
    const q = l[i + d];
    if (!q) {
      this.setTime(d < 0 ? p.start - SLOT : p.stop + 1);
      return;
    }
    this.setTime(q.start);
  }

  select() {
    const ch = this.list[this.rows.index];
    if (!ch) return;
    const p = this.focusProg(ch);
    const now = nowSec();
    if (p && p.stop <= now) {
      if (p.arch && canCatchup(Session.pl, ch)) go('player', { mode: 'catchup', ch, prog: p, list: this.list });
      else App.toast('This show has ended and this channel has no catch-up');
      return;
    }
    if (p && p.start > now) {
      App.toast(`${p.title} starts ${fmtDay(p.start).toLowerCase() === 'today' ? 'at' : fmtDay(p.start) + ' at'} ${fmtClock(p.start)}`);
      return;
    }
    const cur = Video.cur;
    if (cur && cur.meta.kind === 'live' && cur.meta.ch.id === ch.id && Video.state !== 'error') go('player', { mode: 'live', ch, list: this.list });
    else {
      playChannel(ch, this.hole);
      this.paintHole();
    }
  }

  jump(num) {
    let i = this.list.findIndex((c) => String(c.num) === String(num));
    if (i < 0) {
      const all = this.cats[0].list;
      const ch = all.find((c) => String(c.num) === String(num));
      if (!ch) {
        App.toast(`There is no channel ${num}`);
        return;
      }
      this.setCat(0, ch);
      return;
    }
    this.rows.setIndex(i, false);
  }

  catMenu() {
    pick('Category', this.cats.map((c, i) => ({ value: i, label: c.name })), this.ci).then((v) => {
      if (v === undefined || v === this.ci) return;
      this.setCat(v, null);
    });
  }

  key(ev) {
    const k = ev.key;
    if (k === 'digit') {
      this.num.push(ev.digit);
      return true;
    }
    if (this.num.active && k === 'ok') {
      this.num.commit();
      return true;
    }
    const l = this.rows;
    switch (k) {
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
      case 'left':
        this.horizontal(-1);
        return true;
      case 'right':
        this.horizontal(1);
        return true;
      case 'ok':
        this.select();
        return true;
      case 'menu':
      case 'okLong':
        this.catMenu();
        return true;
      case 'ff':
        this.setTime(this.t + 3 * 3600);
        return true;
      case 'rew':
        this.setTime(this.t - 3 * 3600);
        return true;
      case 'guide':
        App.pop();
        return true;
      case 'info':
      case 'play':
        this.setTime(nowSec());
        return true;
    }
    return false;
  }
}
