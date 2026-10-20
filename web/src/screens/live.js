// Live TV: categories, channels with what is on now, a preview window and the
// channel's programmes (with catch-up for past ones where the provider records).
import { h, fmtClock, fmtDay, nowSec, debounce, plural } from '../util.js';
import { App, Screen } from '../ui/app.js';
import { VList } from '../ui/list.js';
import { icon, art, setArt, topbar, progressBar, setProgress } from '../ui/widgets.js';
import { Menu } from '../ui/dialogs.js';
import { Session, bus, canCatchup } from '../data/session.js';
import { progressOf, pickNow } from '../data/epg.js';
import { settings } from '../store.js';
import { Video } from '../player/video.js';
import { playChannel, openExternal } from '../player/playback.js';
import { liveSource } from '../data/session.js';
import { go } from './nav.js';
import { liveCats, catCount, catLocked, locate } from './livecats.js';
import { unlock } from './access.js';
import { NumberEntry } from './numentry.js';

export class LiveScreen extends Screen {
  constructor(opts) {
    super('live');
    this.opts = opts || {};
    this.zone = 'channels';
    this.ci = 0;
    this.cats = [];
    this.list = [];
    this.progs = [];
    this.playingId = null;
  }

  build() {
    this.bar = topbar('Live TV', '');
    this.el.append(this.bar);
    const H = App.height - 200;
    this.catList = new VList({
      rowH: 68,
      height: H,
      margin: 2,
      cls: 'live-cats',
      create: () => h('div.crow', null, h('span.crow-ic'), h('span.crow-name.bidi'), h('span.crow-n')),
      bind: (el, i) => {
        const c = this.cats[i];
        const ic = el.children[0];
        ic.innerHTML = '';
        const locked = catLocked(c);
        if (c.icon || locked) ic.appendChild(icon(locked ? 'lock' : c.icon));
        el.children[1].textContent = c.name;
        el.children[2].textContent = locked ? '' : String(catCount(c));
        el.classList.toggle('is-current', i === this.ci);
        el.classList.toggle('is-locked', locked);
      },
      onFocus: (i) => this.onCatFocus(i),
    });
    this.chList = new VList({
      rowH: 104,
      height: H,
      margin: 2,
      cls: 'live-chans',
      create: () =>
        h('div.chrow', null, h('div.ch-num'), art('logo'), h('div.ch-text', null, h('div.ch-name.bidi'), h('div.ch-now', null, h('span.ch-now-t.bidi'), progressBar())), h('div.ch-side', null, h('span.onair', null, h('i'), h('i'), h('i')), h('span.ch-fav'))),
      bind: (el, i, f) => this.bindChannel(el, i),
      onFocus: (i) => this.onChannelFocus(i),
    });
    this.empty = h('div.live-empty');
    this.chBox = h('div.live-chbox', null, this.chList.el, this.empty);
    // right side
    this.hole = h('div.hole.live-hole', null, h('div.hole-face', null, icon('tv'), h('div.hole-msg', { text: 'Press OK on a channel to watch it here' })), h('div.hole-spin', null, h('div.spin')));
    this.pTitle = h('div.pv-title.bidi');
    this.pTime = h('div.pv-time');
    this.pBar = progressBar();
    this.pDesc = h('div.pv-desc.bidi');
    this.pNow = h('div.pv-now.over', null, h('div.pv-meta', null, this.pTime, this.pBar), this.pTitle, this.pDesc);
    this.progList = new VList({
      rowH: 76,
      height: Math.max(152, Math.floor((App.height - 200 - 326 - 300) / 76) * 76),
      margin: 1,
      cls: 'live-progs',
      create: () => h('div.prow', null, h('span.prow-time', null, h('span.prow-day'), h('span.prow-clock')), h('span.prow-title.bidi'), h('span.prow-tag')),
      bind: (el, i) => this.bindProg(el, i),
      onFocus: () => this.paintProgInfo(),
    });
    this.right = h('div.live-right', null, this.hole, this.pNow, h('div.over', null, this.progList.el));
    this.el.append(h('div.live-body.over', null, h('div.live-left', null, this.catList.el), this.chBox), this.right);
    this.num = new NumberEntry(this.el, (n) => this.jumpTo(n));
    this.focusLater = debounce(() => this.loadFocused(), 280);
    this.visibleLater = debounce(() => this.loadVisible(), 180);
    this.offs = [
      Video.on('state', () => this.paintPlaying()),
      Video.on('firstframe', () => this.paintPlaying()),
      bus.on('synced', (s) => {
        if (s.indexOf('live') >= 0) this.reload();
      }),
      bus.on('guide', () => {
        this.chList.refresh();
        this.loadFocused();
      }),
    ];
    this.guideOff = null;
    this.tick = setInterval(() => {
      if (App.top() === this) {
        this.chList.refresh();
        this.paintNow();
      }
    }, 30000);
  }

  destroy() {
    for (const f of this.offs) f();
    if (this.guideOff) this.guideOff();
    clearInterval(this.tick);
    clearTimeout(this.catTimer);
    this.focusLater.cancel();
    this.visibleLater.cancel();
    super.destroy();
  }

  async enter(params, back) {
    if (this.guideOff) this.guideOff();
    this.guideOff = Session.guide.onUpdate((id) => this.onGuide(id));
    if (!back || !this.live) {
      await this.reload(params && params.focusId);
    } else {
      // favourites and recently watched may have changed; the channel may have changed in full screen
      const curId = this.cats[this.ci] && this.cats[this.ci].id;
      this.cats = liveCats(this.live);
      let ci = this.cats.findIndex((c) => c.id === curId);
      if (ci < 0) ci = 0;
      this.ci = ci;
      this.catList.setCount(this.cats.length, ci, true);
      const keep = this.list[this.chList.index];
      this.list = catLocked(this.cats[ci]) ? [] : this.cats[ci].list;
      const ki = keep ? this.list.indexOf(keep) : -1;
      this.chList.setCount(this.list.length, ki >= 0 ? ki : Math.min(this.chList.index, Math.max(0, this.list.length - 1)), true);
      if (Video.cur && Video.cur.meta.kind === 'live') this.focusChannel(Video.cur.meta.ch, false);
    }
    if (Video.cur && Video.cur.meta.kind === 'live') Video.volume(1);
    this.paintPlaying();
    this.paint();
  }

  leave() {
    if (this.guideOff) this.guideOff();
    this.guideOff = null;
    this.num.cancel();
  }

  video() {
    if (Video.cur && (Video.cur.meta.kind === 'live' || Video.cur.meta.kind === 'catchup')) return this.hole;
    return null;
  }

  async reload(focusId) {
    const cat = Session.catalog;
    this.live = await cat.ensure('live');
    this.cats = liveCats(this.live);
    let ch = null;
    if (focusId) ch = this.live.byId.get(focusId);
    if (!ch && Video.cur && Video.cur.meta.kind === 'live') ch = Video.cur.meta.ch;
    if (!ch && Session.lib.lastChannel) ch = this.live.byId.get(Session.lib.lastChannel);
    const lastCat = Session.lib.lastCat('live');
    if (ch) {
      const [ci, i] = locate(this.cats, ch, lastCat);
      this.ci = ci;
      this.catList.setCount(this.cats.length, ci);
      this.setList(i);
      this.zone = 'channels';
    } else {
      let ci = lastCat ? this.cats.findIndex((c) => c.id === lastCat) : -1;
      if (ci < 0 || catLocked(this.cats[ci])) ci = 0;
      this.ci = ci;
      this.catList.setCount(this.cats.length, ci);
      this.setList(0);
      this.zone = this.list.length ? 'channels' : 'cats';
    }
    if (!this.live.items.length) {
      this.zone = 'cats';
      this.empty.textContent = 'This playlist has no live channels.';
    }
    this.paint();
  }

  // ------------------------------------------------------------ data

  setList(index) {
    const c = this.cats[this.ci];
    const locked = catLocked(c);
    this.list = locked ? [] : c.list;
    this.chList.setCount(this.list.length, index || 0);
    this.empty.classList.toggle('show', !this.list.length);
    if (locked) this.empty.innerHTML = '<b>This category is locked.</b><br>Press OK to enter your PIN.';
    else if (!this.list.length) this.empty.textContent = c.special === 'fav' ? 'No favorite channels yet. Long-press OK on a channel to add it.' : c.special === 'recent' ? 'Channels you watch appear here.' : 'No channels in this category.';
    this.bar.setSub(`${c.name}${locked ? '' : ', ' + plural(this.list.length, 'channel')}`);
    this.visibleLater();
  }

  onCatFocus(i) {
    if (this.zone !== 'cats') return;
    if (i === this.ci) return;
    const old = this.ci;
    this.ci = i;
    this.catList.refreshRow(old);
    this.catList.refreshRow(i);
    // while scrolling quickly through categories, fill the channel list once it settles
    clearTimeout(this.catTimer);
    this.catTimer = setTimeout(() => this.flushCat(), 150);
  }

  flushCat() {
    if (!this.catTimer) return;
    clearTimeout(this.catTimer);
    this.catTimer = 0;
    this.setList(0);
  }

  onChannelFocus() {
    this.paintNow();
    this.focusLater();
    this.visibleLater();
  }

  onGuide(id) {
    const ch = this.list[this.chList.index];
    const [a, b] = this.chList.visibleRange();
    for (let i = a; i <= b; i++) if (this.list[i] && this.list[i].id === id) this.chList.refreshRow(i);
    if (ch && ch.id === id) {
      this.paintNow();
      this.buildProgs();
    }
  }

  loadVisible() {
    if (!settings().showNowInList) return;
    const [a, b] = this.chList.visibleRange();
    for (let i = b; i >= a; i--) if (this.list[i]) Session.guide.load(this.list[i], false);
  }

  loadFocused() {
    const ch = this.list[this.chList.index];
    if (!ch) {
      this.progs = [];
      this.progList.setCount(0);
      return;
    }
    Session.guide.load(ch, true).then(() => {
      if (this.list[this.chList.index] === ch) {
        this.paintNow();
        this.buildProgs();
      }
    });
  }

  buildProgs() {
    const ch = this.list[this.chList.index];
    const all = (ch && Session.guide.cached(ch)) || [];
    const t = nowSec();
    const showPast = ch && canCatchup(Session.pl, ch);
    this.progs = all.filter((p) => p.stop > t - (showPast ? ch.arch * 86400 : 0) && p.start < t + 18 * 3600 && (p.stop > t || (showPast && p.arch)));
    const nn = pickNow(this.progs, t);
    const idx = nn.index >= 0 ? nn.index : 0;
    this.progList.setCount(this.progs.length, this.zone === 'progs' ? Math.min(this.progList.index, this.progs.length - 1) : idx);
    this.progCh = ch;
    this.paintProgInfo();
  }

  // ------------------------------------------------------------ painting

  bindChannel(el, i) {
    const ch = this.list[i];
    if (!ch) return;
    el.children[0].textContent = ch.num || '';
    setArt(el.children[1], ch.logo || Session.guide.iconFor(ch), ch.name, 112, 80);
    const name = el.children[2].children[0];
    name.textContent = ch.name;
    const nowEl = el.children[2].children[1];
    const nn = Session.guide.nowNext(ch);
    if (nn && nn.now) {
      nowEl.firstChild.textContent = nn.now.title;
      setProgress(nowEl.lastChild, progressOf(nn.now));
      nowEl.lastChild.style.visibility = '';
    } else {
      nowEl.firstChild.textContent = ch.arch ? 'Catch-up available' : '';
      nowEl.lastChild.style.visibility = 'hidden';
    }
    const fav = Session.lib.isFav('live', ch.id);
    const favEl = el.children[3].children[1];
    if (favEl.__fav !== fav) {
      favEl.innerHTML = '';
      if (fav) favEl.appendChild(icon('starOn'));
      favEl.__fav = fav;
    }
    el.classList.toggle('is-playing', ch.id === this.playingId);
  }

  bindProg(el, i) {
    const p = this.progs[i];
    if (!p) return;
    const t = nowSec();
    const today = fmtDay(p.start);
    const tm = el.children[0];
    tm.children[0].textContent = today === 'Today' ? '' : today;
    tm.children[1].textContent = fmtClock(p.start);
    el.children[1].textContent = p.title;
    const tag = el.children[2];
    tag.className = 'prow-tag';
    if (p.start <= t && p.stop > t) {
      tag.textContent = 'Live';
      tag.classList.add('tag-live');
    } else if (p.stop <= t && p.arch) {
      tag.textContent = 'Replay';
      tag.classList.add('tag-replay');
    } else tag.textContent = '';
    el.classList.toggle('is-past', p.stop <= t);
  }

  paintNow() {
    const ch = this.list[this.chList.index];
    if (!ch) {
      this.pTitle.textContent = '';
      this.pTime.textContent = '';
      this.pDesc.textContent = '';
      this.pBar.style.visibility = 'hidden';
      return;
    }
    if (this.zone === 'progs') return this.paintProgInfo();
    const nn = Session.guide.nowNext(ch);
    if (nn && nn.now) {
      const p = nn.now;
      this.pTime.textContent = `${fmtClock(p.start)} to ${fmtClock(p.stop)}`;
      this.pTitle.textContent = p.title;
      this.pDesc.textContent = p.desc || (nn.next ? `Next at ${fmtClock(nn.next.start)}: ${nn.next.title}` : '');
      setProgress(this.pBar, progressOf(p));
      this.pBar.style.visibility = '';
    } else {
      this.pTime.textContent = '';
      this.pTitle.textContent = ch.name;
      this.pDesc.textContent = Session.guide.mode === 'xmltv' && Session.guide.xml && Session.guide.xml.empty ? 'No TV guide for this playlist. Add a guide link in Settings.' : 'No programme information for this channel.';
      this.pBar.style.visibility = 'hidden';
    }
  }

  paintProgInfo() {
    if (this.zone !== 'progs') return;
    const p = this.progs[this.progList.index];
    if (!p) return;
    const t = nowSec();
    this.pTime.textContent = `${fmtDay(p.start)}, ${fmtClock(p.start)} to ${fmtClock(p.stop)}`;
    this.pTitle.textContent = p.title;
    this.pDesc.textContent = p.desc || (p.stop <= t && p.arch ? 'Press OK to watch from the start.' : '');
    if (p.start <= t && p.stop > t) {
      setProgress(this.pBar, progressOf(p));
      this.pBar.style.visibility = '';
    } else this.pBar.style.visibility = 'hidden';
  }

  paintPlaying() {
    const cur = Video.cur;
    const id = cur && (cur.meta.kind === 'live' || cur.meta.kind === 'catchup') && Video.state !== 'idle' ? cur.meta.ch.id : null;
    if (id !== this.playingId) {
      this.playingId = id;
      this.chList.refresh();
    }
    const playing = !!id && Video.state === 'playing';
    this.hole.classList.toggle('is-playing', playing);
    this.hole.classList.toggle('is-buffering', !!id && Video.buffering);
    const msg = this.hole.querySelector('.hole-msg');
    if (id && Video.state === 'error') msg.textContent = 'This channel is not playing right now. It may be offline, or your connection limit is reached.';
    else if (id && Video.state === 'reconnecting') msg.textContent = 'Reconnecting';
    else if (id) msg.textContent = 'Tuning in';
    else msg.textContent = 'Press OK on a channel to watch it here';
  }

  paint() {
    this.catList.setActive(this.zone === 'cats');
    this.chList.setActive(this.zone === 'channels');
    this.progList.setActive(this.zone === 'progs');
    this.el.classList.toggle('zone-cats', this.zone === 'cats');
    this.el.classList.toggle('zone-progs', this.zone === 'progs');
    if (this.zone !== 'progs') this.paintNow();
  }

  focusChannel(ch, keepCat) {
    let i = this.list.indexOf(ch);
    if (i < 0 && !keepCat) {
      const [ci, j] = locate(this.cats, ch, this.cats[this.ci] && this.cats[this.ci].id);
      if (ci !== this.ci) {
        this.ci = ci;
        this.catList.setIndex(ci);
        this.catList.refresh();
        this.setList(j);
        return;
      }
      i = j;
    }
    if (i >= 0) this.chList.setIndex(i, false);
  }

  jumpTo(num) {
    const ch = this.live.items.find((c) => String(c.num) === String(num));
    if (!ch) {
      App.toast(`There is no channel ${num}`);
      return;
    }
    this.focusChannel(ch);
    this.zone = 'channels';
    this.paint();
    this.play(ch);
  }

  // ------------------------------------------------------------ actions

  play(ch) {
    if (settings().openLiveFullscreen) {
      go('player', { mode: 'live', ch, list: this.list, catName: this.cats[this.ci].name });
      return;
    }
    playChannel(ch, this.hole);
    Session.lib.setLastCat('live', this.cats[this.ci].id);
    const rec = this.cats.findIndex((c) => c.special === 'recent');
    if (rec >= 0) {
      this.cats[rec]._l = null;
      this.catList.refreshRow(rec);
    }
    this.paintPlaying();
  }

  openFull(ch) {
    Session.lib.setLastCat('live', this.cats[this.ci].id);
    go('player', { mode: 'live', ch, list: this.list, catName: this.cats[this.ci].name });
  }

  async enterCat() {
    this.flushCat();
    const c = this.cats[this.ci];
    if (catLocked(c)) {
      if (!(await unlock())) return;
      this.cats = liveCats(this.live);
      this.catList.refresh();
      this.setList(0);
    }
    if (this.list.length) {
      this.zone = 'channels';
      this.paint();
    }
  }

  channelMenu(ch) {
    const lib = Session.lib;
    const fav = lib.isFav('live', ch.id);
    const c = this.cats[this.ci];
    const items = [
      { label: fav ? 'Remove from favorites' : 'Add to favorites', icon: fav ? 'starOn' : 'star', action: () => {
        const on = lib.toggleFav('live', ch.id);
        App.toast(on ? `${ch.name} added to favorites` : `${ch.name} removed from favorites`);
        if (c.special === 'fav') {
          this.cats = liveCats(this.live);
          this.setList(Math.min(this.chList.index, this.cats[this.ci].list.length - 1));
        } else this.chList.refresh();
        this.catList.refresh();
      } },
    ];
    if (c.special === 'fav') {
      items.push({ label: 'Move up', icon: 'chevron', action: () => this.moveFav(ch, -1), sub: 'Change the order of your favorites' });
      items.push({ label: 'Move down', icon: 'chevron', action: () => this.moveFav(ch, 1) });
    }
    items.push({ label: 'Watch full screen', icon: 'play', action: () => this.openFull(ch) });
    if (canCatchup(Session.pl, ch)) items.push({ label: 'Catch-up', sub: `Watch shows from the last ${plural(ch.arch, 'day')}`, icon: 'history', action: () => {
      this.zone = 'progs';
      this.loadFocused();
      this.paint();
    } });
    items.push({ label: 'TV guide for this category', icon: 'guide', action: () => go('guide', { catId: c.id, focusId: ch.id }) });
    items.push({ label: 'Open in another player', sub: 'VLC, MX Player or any installed player', icon: 'external', action: () => openExternal(liveSource(Session.pl, ch), ch.name) });
    new Menu(ch.name, items, { sub: ch.num ? `Channel ${ch.num}` : '' }).open();
  }

  moveFav(ch, d) {
    if (!Session.lib.moveFav('live', ch.id, d)) return;
    this.cats = liveCats(this.live);
    const list = this.cats[this.ci].list;
    this.list = list;
    this.chList.setCount(list.length, list.indexOf(ch), true);
  }

  catMenu() {
    const c = this.cats[this.ci];
    if (!c.cat) return;
    new Menu(c.name, [
      { label: 'Hide this category', sub: 'Show it again from Settings, Categories', icon: 'eyeOff', action: () => {
        Session.lib.setHidden('live', c.id, true);
        this.cats = liveCats(this.live);
        this.ci = Math.min(this.ci, this.cats.length - 1);
        this.catList.setCount(this.cats.length, this.ci);
        this.setList(0);
      } },
      { label: 'TV guide for this category', icon: 'guide', action: () => go('guide', { catId: c.id }) },
    ]).open();
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
    if (k === 'guide') {
      const c = this.cats[this.ci];
      const ch = this.list[this.chList.index];
      go('guide', { catId: c.id, focusId: ch ? ch.id : null });
      return true;
    }
    if (this.zone === 'cats') {
      const l = this.catList;
      if (k === 'up') l.move(-1);
      else if (k === 'down') l.move(1);
      else if (k === 'pgup' || k === 'chup') l.page(-1);
      else if (k === 'pgdown' || k === 'chdown') l.page(1);
      else if (k === 'right' || k === 'ok') this.enterCat();
      else if (k === 'menu' || k === 'okLong') this.catMenu();
      else return false;
      return true;
    }
    if (this.zone === 'channels') {
      const l = this.chList;
      const ch = this.list[l.index];
      if (k === 'up') {
        if (!l.move(-1) && !ev.repeat) l.setIndex(l.count - 1);
      } else if (k === 'down') {
        if (!l.move(1) && !ev.repeat) l.setIndex(0);
      } else if (k === 'pgup' || k === 'chup') l.page(-1);
      else if (k === 'pgdown' || k === 'chdown') l.page(1);
      else if (k === 'left') {
        this.zone = 'cats';
        this.catList.setIndex(this.ci, false);
        this.paint();
      } else if (k === 'right') {
        if (ch && this.progs.length && this.progCh === ch) {
          this.zone = 'progs';
          this.paint();
          this.paintProgInfo();
        }
      } else if (k === 'ok') {
        if (!ch) return true;
        if (this.playingId === ch.id && Video.state !== 'error') this.openFull(ch);
        else this.play(ch);
      } else if (k === 'okLong' || k === 'menu') {
        if (ch) this.channelMenu(ch);
      } else if (k === 'fav' || k === 'yellow') {
        if (ch) {
          const on = Session.lib.toggleFav('live', ch.id);
          App.toast(on ? `${ch.name} added to favorites` : `${ch.name} removed from favorites`);
          l.refreshRow(l.index);
        }
      } else if (k === 'info') {
        this.loadFocused();
      } else return false;
      return true;
    }
    if (this.zone === 'progs') {
      const l = this.progList;
      if (k === 'up') l.move(-1);
      else if (k === 'down') l.move(1);
      else if (k === 'left' || k === 'back') {
        this.zone = 'channels';
        this.paint();
      } else if (k === 'ok') {
        const p = this.progs[l.index];
        const ch = this.list[this.chList.index];
        if (!p || !ch) return true;
        const t = nowSec();
        if (p.stop <= t && p.arch) {
          go('player', { mode: 'catchup', ch, prog: p, list: this.list });
        } else if (p.start <= t) this.openFull(ch);
        else App.toast(`${p.title} starts at ${fmtClock(p.start)}`);
      } else return false;
      return true;
    }
    return false;
  }
}
