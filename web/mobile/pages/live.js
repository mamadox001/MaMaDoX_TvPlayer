// Live TV on the phone: a player at the top, categories as chips, channels below.
import { h, fmtClock, fmtDay, nowSec, debounce } from '../../src/util.js';
import { icon, art, setArt, progressBar, setProgress } from '../../src/ui/widgets.js';
import { Video } from '../../src/player/video.js';
import { Session, bus, canCatchup } from '../../src/data/session.js';
import { progressOf } from '../../src/data/epg.js';
import { settings } from '../../src/store.js';
import { Page, Nav, VScroll, chips, sheet, toast, ibtn } from '../ui.js';
import { isLocked, itemLocked, unlock } from '../access.js';
import { playChannel, openExternal, useExternal } from '../playback.js';
import { liveSource } from '../../src/data/session.js';
import { PlayerPage } from './player.js';

export function liveCats(live) {
  const lib = Session.lib;
  const hidden = new Set(lib.d.hidden.live);
  const cats = [];
  const lazy = (o, fn) => Object.defineProperty(o, 'list', { get() { return this._l || (this._l = fn()); } });
  cats.push(lazy({ id: '__all', name: 'All' }, () => live.items.filter((c) => !hidden.has(c.cat) && !itemLocked(c))));
  cats.push(lazy({ id: '__fav', name: 'Favorites', special: 'fav' }, () => lib.favs('live').map((id) => live.byId.get(id)).filter((c) => c && !itemLocked(c))));
  cats.push(lazy({ id: '__recent', name: 'Recent', special: 'recent' }, () => lib.recent().map((id) => live.byId.get(id)).filter((c) => c && !itemLocked(c))));
  for (const c of live.cats) {
    if (hidden.has(c.id) || (settings().hideEmptyCats && !c.items.length)) continue;
    cats.push(lazy({ id: c.id, name: c.name, cat: c }, () => c.items.map((i) => live.items[i])));
  }
  return cats;
}

export class LivePage extends Page {
  constructor() {
    super('live.has-hole');
    this.cats = [];
    this.catId = null;
    this.list = [];
    this.playing = null;
  }

  build() {
    this.face = h('div.hole-face', null, icon('tv'), h('span', { text: 'Tap a channel to watch it here' }));
    this.spin = h('div.spinner.small');
    this.hole = h('div.hole', null, this.face, this.spin);
    this.hole.addEventListener('click', () => this.openFull());
    this.nName = h('div.np-name.bidi');
    this.nProg = h('div.np-prog.bidi');
    this.nTime = h('span.np-time');
    this.nBar = progressBar();
    this.favBtn = ibtn('star', null, () => this.toggleFav(this.playing));
    this.np = h(
      'div.np',
      null,
      h('div.np-text', null, this.nName, this.nProg, h('div.np-meta', null, this.nTime, this.nBar)),
      h('div.np-btns', null, ibtn('guide', null, () => this.showGuide(this.playing)), this.favBtn, ibtn('aspect', null, () => this.openFull()))
    );
    this.chips = chips((id) => this.pickCat(id));
    this.vs = new VScroll({
      cls: 'chlist',
      rowH: () => 68,
      create: () => h('div.chrow', null, h('span.ch-num'), art('ch-logo'), h('div.ch-text', null, h('div.ch-name.bidi'), h('div.ch-now.bidi'), progressBar('ch-bar')), icon('starOn', 'ch-fav')),
      bind: (el, i) => this.bindRow(el, i),
      onTap: (i) => this.tap(this.list[i]),
      onHold: (i) => this.menu(this.list[i]),
      onScroll: () => this.loadLater(),
    });
    this.el.append(this.hole, h('div.live-body', null, this.np, this.chips.el, this.vs.el));
    this.loadLater = debounce(() => this.loadVisible(), 200);
    this.offs = [
      Video.on('state', () => this.paintNow()),
      Video.on('firstframe', () => this.paintNow()),
      bus.on('synced', (s) => s.indexOf('live') >= 0 && this.reload()),
      bus.on('guide', () => this.vs.refresh()),
    ];
    this.guideOff = null;
    this.timer = setInterval(() => {
      if (Nav.top() === this) {
        this.vs.refresh();
        this.paintNow();
      }
    }, 30000);
  }

  async reload() {
    const live = await Session.catalog.ensure('live');
    if (this.guideOff) this.guideOff();
    this.guideOff = Session.guide.onUpdate(() => {
      this.refreshLater();
    });
    this.cats = liveCats(live);
    const last = Session.lib.lastCat('live');
    if (!this.catId) this.catId = this.cats.some((c) => c.id === last && !(c.cat && isLocked(c.cat))) ? last : '__all';
    this.paintCats();
    this.showCat(this.catId, true);
  }

  refreshLater() {
    clearTimeout(this.rt);
    this.rt = setTimeout(() => {
      this.vs.refresh();
      this.paintNow();
    }, 120);
  }

  paintCats() {
    this.chips.set(
      this.cats.map((c) => ({ id: c.id, label: c.name, lock: !!(c.cat && isLocked(c.cat)) })),
      this.catId
    );
  }

  async pickCat(id) {
    const c = this.cats.find((x) => x.id === id);
    if (!c) return;
    if (c.cat && isLocked(c.cat)) {
      if (!(await unlock())) return;
      for (const x of this.cats) x._l = null;
      this.paintCats();
    }
    this.showCat(id);
  }

  showCat(id, keep) {
    const c = this.cats.find((x) => x.id === id) || this.cats[0];
    if (!c) return;
    this.catId = c.id;
    this.chips.select(c.id);
    Session.lib.setLastCat('live', c.id);
    c._l = c.special ? null : c._l;
    this.list = c.list;
    this.vs.setEmpty(c.special === 'fav' ? 'No favorites yet. Touch and hold a channel to add it.' : c.special === 'recent' ? 'Channels you watch appear here.' : 'No channels in this category.');
    this.vs.setCount(this.list.length, keep);
    this.loadLater();
  }

  enter(back) {
    if (!this.cats.length) this.reload();
    else if (back !== false) {
      for (const c of this.cats) if (c.special) c._l = null;
      const c = this.cats.find((x) => x.id === this.catId);
      if (c && c.special) this.showCat(c.id, true);
      else this.vs.refresh();
    }
    const cur = Video.cur;
    if (cur && cur.meta.kind === 'live') {
      this.playing = cur.meta.ch;
      Video.volume(1);
    }
    this.paintNow();
  }

  leave() {}

  resize() {
    this.vs.setCount(this.list.length, true);
  }

  video() {
    const cur = Video.cur;
    if (cur && (cur.meta.kind === 'live' || cur.meta.kind === 'catchup')) return this.hole;
    return null;
  }

  bindRow(el, i) {
    const ch = this.list[i];
    if (!ch) return;
    el.children[0].textContent = ch.num || '';
    setArt(el.children[1], ch.logo, ch.name, 96, 60);
    const t = el.children[2];
    t.children[0].textContent = ch.name;
    const nn = Session.guide.nowNext(ch);
    const p = nn && nn.now;
    t.children[1].textContent = p ? p.title : '';
    t.children[2].style.visibility = p ? '' : 'hidden';
    if (p) setProgress(t.children[2], progressOf(p));
    el.classList.toggle('is-fav', Session.lib.isFav('live', ch.id));
    el.classList.toggle('is-playing', !!(this.playing && this.playing.id === ch.id && Video.cur));
  }

  loadVisible() {
    if (Nav.top() !== this) return;
    const [a, b] = this.vs.visibleRange();
    for (let i = a; i <= b && i < this.list.length; i++) Session.guide.load(this.list[i], false);
  }

  tap(ch) {
    if (!ch) return;
    if (useExternal('live')) {
      Session.lib.addRecent(ch.id);
      openExternal(liveSource(Session.pl, ch), ch.name);
      return;
    }
    const cur = Video.cur;
    if (cur && cur.meta.kind === 'live' && cur.meta.ch.id === ch.id && Video.state !== 'error') return this.openFull();
    this.playing = ch;
    playChannel(ch, this.hole);
    Session.guide.load(ch, false);
    this.vs.refresh();
    this.paintNow();
  }

  openFull() {
    const cur = Video.cur;
    if (!cur || cur.meta.kind !== 'live' || !this.playing) return;
    Nav.push(new PlayerPage({ mode: 'live', ch: this.playing, list: this.list }));
  }

  paintNow() {
    if (!this.built) return;
    const ch = this.playing;
    const cur = Video.cur;
    const on = !!(ch && cur && cur.meta.kind === 'live');
    const s = Video.state;
    this.hole.classList.toggle('is-playing', on && (s === 'playing' || s === 'paused') && !Video.buffering);
    this.spin.style.display = on && (Video.buffering || s === 'preparing' || s === 'reconnecting') && s !== 'error' ? '' : 'none';
    this.face.lastChild.textContent = on && s === 'error' ? 'This channel is not playing right now' : 'Tap a channel to watch it here';
    this.np.classList.toggle('empty', !ch);
    if (!ch) return;
    this.nName.textContent = (ch.num ? ch.num + '  ' : '') + ch.name;
    const nn = Session.guide.nowNext(ch);
    const p = nn && nn.now;
    this.nProg.textContent = p ? p.title : 'No programme information';
    this.nTime.textContent = p ? `${fmtClock(p.start)} to ${fmtClock(p.stop)}` : '';
    this.nBar.style.visibility = p ? '' : 'hidden';
    if (p) setProgress(this.nBar, progressOf(p));
    this.favBtn.classList.toggle('on', Session.lib.isFav('live', ch.id));
    this.favBtn.innerHTML = '';
    this.favBtn.appendChild(icon(Session.lib.isFav('live', ch.id) ? 'starOn' : 'star'));
  }

  toggleFav(ch) {
    if (!ch) return;
    const on = Session.lib.toggleFav('live', ch.id);
    toast(on ? `${ch.name} added to favorites` : `${ch.name} removed from favorites`);
    const c = this.cats.find((x) => x.id === this.catId);
    if (c && c.special === 'fav') this.showCat(c.id, true);
    else this.vs.refresh();
    this.paintNow();
  }

  menu(ch) {
    if (!ch) return;
    const fav = Session.lib.isFav('live', ch.id);
    const items = [
      { label: 'Watch', icon: 'play', action: () => this.tap(ch) },
      { label: fav ? 'Remove from favorites' : 'Add to favorites', icon: fav ? 'star' : 'starOn', action: () => this.toggleFav(ch) },
      { label: 'TV guide', sub: canCatchup(Session.pl, ch) ? 'With catch-up' : '', icon: 'guide', action: () => this.showGuide(ch) },
      { label: 'Open in another player', icon: 'external', action: () => openExternal(liveSource(Session.pl, ch), ch.name) },
    ];
    sheet(ch.name, items);
  }

  /** Programme list for a channel; past shows with catch-up can be played. */
  async showGuide(ch) {
    if (!ch) return;
    const list = await Session.guide.load(ch, true);
    const t = nowSec();
    const arch = canCatchup(Session.pl, ch);
    const progs = (list || []).filter((p) => p.stop > t - (arch ? ch.arch * 86400 : 0)).slice(0, 80);
    if (!progs.length) return toast('No programme information for this channel');
    let first = progs.findIndex((p) => p.stop > t);
    if (first > 6) progs.splice(0, first - 6);
    const items = progs.map((p) => {
      const now = p.start <= t && p.stop > t;
      const past = p.stop <= t;
      const day = fmtDay(p.start);
      return {
        label: `${day === 'Today' ? '' : day + ' '}${fmtClock(p.start)}  ${p.title}`,
        sub: now ? 'On now' : past ? (arch && p.arch ? 'Watch from the start' : 'Ended') : '',
        icon: now ? 'live' : past && arch && p.arch ? 'history' : null,
        on: false,
        action: () => {
          if (now) this.tap(ch);
          else if (past && arch && p.arch) Nav.push(new PlayerPage({ mode: 'catchup', ch, prog: p }));
        },
      };
    });
    sheet(ch.name, items);
  }

  destroy() {
    clearInterval(this.timer);
    this.offs.forEach((f) => f());
    if (this.guideOff) this.guideOff();
  }
}
