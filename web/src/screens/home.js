// Home: your last channel playing in the hero, the main sections, then rows of
// things to continue, favourites and new arrivals.
import { h, fmtClock, nowSec, cleanTitle, plural } from '../util.js';
import { App, Screen } from '../ui/app.js';
import { HRow } from '../ui/list.js';
import { icon, art, setArt, clock, progressBar, setProgress, button } from '../ui/widgets.js';
import { Menu } from '../ui/dialogs.js';
import { Session, bus } from '../data/session.js';
import { progressOf } from '../data/epg.js';
import { settings } from '../store.js';
import { Video } from '../player/video.js';
import { playChannel, useExternal } from '../player/playback.js';
import { go } from './nav.js';
import { itemLocked } from './access.js';
import MARK from '../../assets/mark.svg';

const NAV = [
  { id: 'live', label: 'Live TV', icon: 'tv' },
  { id: 'vod', label: 'Movies', icon: 'film' },
  { id: 'series', label: 'Series', icon: 'series' },
  { id: 'guide', label: 'TV Guide', icon: 'guide' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export class HomeScreen extends Screen {
  constructor() {
    super('home');
    this.zone = 'nav';
    this.ni = 0;
    this.bi = 0;
    this.ri = 0;
    this.rows = [];
    this.heroCh = null;
  }

  build() {
    this.plName = h('div.brand-pl');
    this.chip = h('div.acct-chip');
    this.el.append(
      h('header.home-head', null, h('div.brand', null, h('div.brand-mark', { html: MARK }), h('div.brand-name', { text: 'IPTV Player' }), this.plName, this.chip), clock(true))
    );
    // hero
    this.hole = h('div.hole.home-hole', null, h('div.hole-face', null, icon('tv'), h('div.hole-msg', { text: 'Pick a channel in Live TV and it plays here.' })), h('div.hole-spin', null, h('div.spin')));
    this.hNum = h('div.hero-num');
    this.hName = h('div.hero-name.bidi');
    this.hProg = h('div.hero-prog.bidi');
    this.hTime = h('div.hero-time');
    this.hBar = progressBar();
    this.hLeft = h('span.hero-left');
    this.hNext = h('div.hero-next.bidi');
    this.btns = [button('Watch', 'play'), button('Live TV', 'list')];
    this.info = h('div.hero-info.over', null, this.hNum, this.hName, this.hProg, h('div.hero-timeline', null, this.hTime, this.hBar, this.hLeft), this.hNext, h('div.hero-btns', null, this.btns));
    this.el.append(this.hole, this.info);
    // nav
    this.navEls = NAV.map((n) => h('div.nav-item', null, h('div.nav-top', null, icon(n.icon), h('span.nav-label', { text: n.label })), h('div.nav-sub')));
    this.navLine = h('div.nav-line');
    this.nav = h('nav.home-nav.over', null, this.navEls, this.navLine);
    this.el.append(this.nav);
    // rows
    this.rowsTrack = h('div.rows-track');
    this.rowsBox = h('div.home-rows.over', null, this.rowsTrack);
    this.el.append(this.rowsBox);
    this.offs = [
      bus.on('synced', () => this.refreshAll()),
      bus.on('account', () => this.paintHeader()),
      bus.on('guide', () => this.paintHero()),
      Video.on('state', () => this.paintHole()),
      Video.on('firstframe', () => this.paintHole()),
    ];
    this.timer = setInterval(() => {
      if (App.top() === this) this.paintHero();
    }, 30000);
  }

  destroy() {
    for (const f of this.offs) f();
    clearInterval(this.timer);
    if (this.guideOff) this.guideOff();
    super.destroy();
  }

  enter(params, back) {
    this.paintHeader();
    this.refreshAll(back);
    this.paint();
    if (Video.cur && Video.cur.meta.kind === 'live' && Video.cur.opts.muted === false) Video.volume(0);
  }

  leave() {}

  video() {
    if (!this.heroCh || !settings().homePreview || useExternal('live')) return null;
    return this.hole;
  }

  async refreshAll(back) {
    const cat = Session.catalog;
    if (!cat) return;
    await cat.ensure('live');
    if (App.top() !== this) return;
    this.pickHero();
    this.paintNav();
    this.buildRows();
    this.paintHero();
    this.startPreview();
    // movies and series are loaded after the first paint
    const more = [cat.ensure('vod'), cat.ensure('series')];
    Promise.all(more).then(() => {
      if (!this.el.parentNode) return;
      this.paintNav();
      this.buildRows();
    });
  }

  pickHero() {
    const live = Session.catalog.get('live');
    const lib = Session.lib;
    let ch = null;
    if (Video.cur && Video.cur.meta.kind === 'live') ch = Video.cur.meta.ch;
    if (!ch && live && lib.lastChannel) ch = live.byId.get(lib.lastChannel) || null;
    if (!ch && live) {
      const f = lib.favs('live')[0];
      if (f) ch = live.byId.get(f) || null;
    }
    if (ch && itemLocked(ch)) ch = null;
    if (ch !== this.heroCh) {
      this.heroCh = ch;
      if (this.guideOff) this.guideOff();
      this.guideOff = Session.guide.onUpdate((id) => {
        if (this.heroCh && id === this.heroCh.id) this.paintHero();
      });
      if (ch) Session.guide.load(ch, false);
    }
  }

  startPreview() {
    const v = this.video();
    if (!v) {
      this.paintHole();
      return;
    }
    const cur = Video.cur;
    if (cur && cur.meta.kind === 'live' && cur.meta.ch.id === this.heroCh.id) {
      Video.place(v);
      Video.volume(0);
    } else {
      playChannel(this.heroCh, v, { muted: true, noRecent: true, internal: true });
    }
    this.paintHole();
  }

  paintHole() {
    const playing = !!(Video.cur && this.heroCh && Video.cur.meta.kind === 'live' && Video.cur.meta.ch.id === this.heroCh.id && Video.state !== 'idle' && Video.state !== 'error');
    this.hole.classList.toggle('is-playing', playing && Video.state === 'playing');
    this.hole.classList.toggle('is-buffering', playing && Video.buffering);
    const msg = this.hole.querySelector('.hole-msg');
    if (!this.heroCh) msg.textContent = 'Pick a channel in Live TV and it plays here.';
    else if (Video.state === 'error' && playing) msg.textContent = 'This channel is not playing right now.';
    else if (!settings().homePreview) msg.textContent = 'Preview is off. Select Watch to play.';
    else msg.textContent = 'Tuning in';
  }

  paintHeader() {
    const pl = Session.pl;
    this.plName.textContent = pl ? pl.name : '';
    const acc = pl && pl.account;
    let txt = '';
    let warn = false;
    if (acc && acc.exp) {
      const days = Math.ceil((acc.exp - nowSec()) / 86400);
      if (days < 0) {
        txt = 'Subscription expired';
        warn = true;
      } else if (days <= 7) {
        txt = days <= 1 ? 'Subscription ends tomorrow' : `Subscription ends in ${days} days`;
        warn = true;
      }
    }
    if (acc && acc.status && /expired|banned|disabled/i.test(acc.status)) {
      txt = `Account ${acc.status.toLowerCase()}`;
      warn = true;
    }
    this.chip.textContent = txt;
    this.chip.style.display = txt ? '' : 'none';
    this.chip.classList.toggle('warn', warn);
  }

  paintNav() {
    const pl = Session.pl;
    const c = (pl && pl.counts) || {};
    const subs = {
      live: c.live != null ? plural(c.live, 'channel') : '',
      vod: c.vod != null ? plural(c.vod, 'movie') : '',
      series: c.series != null ? plural(c.series, 'series', 'series') : '',
      guide: 'What is on now',
      search: 'Channels, movies, series',
      settings: pl ? pl.name : '',
    };
    NAV.forEach((n, i) => (this.navEls[i].lastChild.textContent = subs[n.id] || ''));
  }

  paintHero() {
    const ch = this.heroCh;
    this.info.classList.toggle('empty', !ch);
    if (!ch) {
      this.hNum.textContent = '';
      this.hName.textContent = 'Welcome';
      this.hProg.textContent = 'Your channels, movies and series are ready.';
      this.hTime.textContent = '';
      this.hLeft.textContent = '';
      this.hNext.textContent = 'Open Live TV to start watching.';
      this.hBar.style.visibility = 'hidden';
      this.btns[0].style.display = 'none';
      this.btns[1].lastChild.textContent = 'Open Live TV';
      return;
    }
    this.btns[0].style.display = '';
    this.btns[1].lastChild.textContent = 'Live TV';
    this.hNum.textContent = ch.num || '';
    this.hName.textContent = ch.name;
    const nn = Session.guide.nowNext(ch);
    if (nn && nn.now) {
      const p = nn.now;
      this.hProg.textContent = p.title;
      this.hTime.textContent = `${fmtClock(p.start)} to ${fmtClock(p.stop)}`;
      setProgress(this.hBar, progressOf(p));
      const left = Math.max(0, Math.round((p.stop - nowSec()) / 60));
      this.hLeft.textContent = left ? `${left} min left` : 'Ending now';
      this.hBar.style.visibility = '';
      this.hNext.textContent = nn.next ? `Next at ${fmtClock(nn.next.start)}: ${nn.next.title}` : '';
    } else {
      this.hProg.textContent = 'Live';
      this.hTime.textContent = '';
      this.hLeft.textContent = '';
      this.hBar.style.visibility = 'hidden';
      this.hNext.textContent = '';
    }
  }

  // ------------------------------------------------------------ rows

  rowsData() {
    const out = [];
    const lib = Session.lib;
    const cat = Session.catalog;
    const live = cat.get('live');
    const vod = cat.get('vod');
    const ser = cat.get('series');
    const w = lib.watching().filter((e) => {
      const sec = e.type === 'vod' ? vod : ser;
      return !sec || sec.byId.has(e.id);
    });
    if (w.length) out.push({ id: 'watching', title: 'Continue watching', kind: 'wide', items: w.slice(0, 20) });
    if (live) {
      const favs = lib.favs('live').map((id) => live.byId.get(id)).filter(Boolean).slice(0, 40);
      if (favs.length) out.push({ id: 'favch', title: 'Favorite channels', kind: 'channel', items: favs });
      const rec = lib.recent().map((id) => live.byId.get(id)).filter((c) => c && !itemLocked(c)).slice(0, 20);
      if (rec.length) out.push({ id: 'recent', title: 'Recently watched channels', kind: 'channel', items: rec });
    }
    if (vod && vod.items.length) {
      const f = lib.favs('vod').map((id) => vod.byId.get(id)).filter(Boolean).slice(0, 30);
      if (f.length) out.push({ id: 'favvod', title: 'Favorite movies', kind: 'poster', items: f });
      const r = vod.recent(40).filter((m) => !itemLocked(m)).slice(0, 30);
      if (r.length) out.push({ id: 'newvod', title: 'Recently added movies', kind: 'poster', items: r });
    }
    if (ser && ser.items.length) {
      const f = lib.favs('series').map((id) => ser.byId.get(id)).filter(Boolean).slice(0, 30);
      if (f.length) out.push({ id: 'favser', title: 'Favorite series', kind: 'poster', items: f });
      const r = ser.recent(40).slice(0, 30);
      if (r.length) out.push({ id: 'newser', title: 'Recently updated series', kind: 'poster', items: r });
    }
    return out;
  }

  buildRows() {
    const keepId = this.rows[this.ri] ? this.rows[this.ri].id : null;
    const keepIndex = this.rows[this.ri] ? this.rows[this.ri].row.index : 0;
    const data = this.rowsData();
    this.rowsTrack.innerHTML = '';
    this.rows = data.map((d) => {
      const dims = { wide: [320, 24], channel: [220, 22], poster: [150, 22] }[d.kind];
      const row = new HRow({
        width: 1776,
        cardW: dims[0],
        gap: dims[1],
        peek: 1,
        create: () => this.createCard(d.kind),
        bind: (el, i) => this.bindCard(d, el, i),
      });
      const block = h('div.row-block.row-' + d.kind, null, h('div.row-title', { text: d.title }), row.el);
      this.rowsTrack.appendChild(block);
      d.row = row;
      d.block = block;
      row.setCount(d.items.length, d.id === keepId ? Math.min(keepIndex, d.items.length - 1) : 0);
      return d;
    });
    const ni = this.rows.findIndex((r) => r.id === keepId);
    this.ri = ni >= 0 ? ni : 0;
    if (this.zone === 'rows' && !this.rows.length) this.zone = 'nav';
    this.paint();
  }

  createCard(kind) {
    if (kind === 'wide') return h('div.card-wide', null, art('wide-art'), progressBar('pbar-signal'), h('div.card-title.ellip.bidi'), h('div.card-sub.ellip'));
    if (kind === 'channel') return h('div.card-ch', null, art('logo.ch-tile'), h('div.card-title.ellip.bidi'));
    return h('div.card-poster', null, art('poster-art'), h('div.card-title.ellip.bidi'));
  }

  bindCard(d, el, i) {
    const it = d.items[i];
    if (d.kind === 'wide') {
      setArt(el.children[0], it.img, it.title, 320, 60);
      setProgress(el.children[1], it.dur ? it.pos / it.dur : 0);
      el.children[1].style.display = it.done ? 'none' : '';
      el.children[2].textContent = it.title;
      el.children[3].textContent = it.sub || '';
    } else if (d.kind === 'channel') {
      setArt(el.children[0], it.logo, it.name, 220, 60);
      el.children[1].textContent = it.name;
    } else {
      setArt(el.children[0], it.icon || it.cover, cleanTitle(it.name), 150, 60);
      el.children[1].textContent = cleanTitle(it.name);
    }
  }

  // ------------------------------------------------------------ focus

  paint() {
    this.navEls.forEach((e, i) => e.classList.toggle('is-focused', this.zone === 'nav' && i === this.ni));
    const cur = this.navEls[this.ni];
    this.navLine.style.width = cur.offsetWidth + 'px';
    this.navLine.style.transform = `translate3d(${cur.offsetLeft}px,0,0)`;
    this.nav.classList.toggle('is-active', this.zone === 'nav');
    this.btns.forEach((b, i) => b.classList.toggle('is-focused', this.zone === 'hero' && i === this.bi));
    this.rows.forEach((r, i) => {
      r.row.setActive(this.zone === 'rows' && i === this.ri);
      r.block.classList.toggle('is-current', this.zone === 'rows' && i === this.ri);
    });
    const blk = this.rows[this.ri] && this.rows[this.ri].block;
    const y = this.zone === 'rows' && blk ? blk.offsetTop : 0;
    this.rowsTrack.style.transform = `translate3d(0,${-y}px,0)`;
    this.el.classList.toggle('rows-mode', this.zone === 'rows');
  }

  heroButtons() {
    return this.btns.filter((b) => b.style.display !== 'none');
  }

  key(ev) {
    const k = ev.key;
    if (this.zone === 'nav') {
      if (k === 'left' && this.ni > 0) this.ni--;
      else if (k === 'right' && this.ni < NAV.length - 1) this.ni++;
      else if (k === 'down') {
        if (this.rows.length) this.zone = 'rows';
      } else if (k === 'up') {
        this.zone = 'hero';
        this.bi = 0;
      } else if (k === 'ok') return this.openNav(NAV[this.ni].id), true;
      else return false;
      this.paint();
      return true;
    }
    if (this.zone === 'hero') {
      const btns = this.heroButtons();
      if (k === 'left' && this.bi > 0) this.bi--;
      else if (k === 'right' && this.bi < btns.length - 1) this.bi++;
      else if (k === 'down') this.zone = 'nav';
      else if (k === 'ok') return this.heroAction(btns[this.bi]), true;
      else if (k === 'up' || k === 'left' || k === 'right') return true;
      else return false;
      this.paint();
      return true;
    }
    if (this.zone === 'rows') {
      const r = this.rows[this.ri];
      if (!r) {
        this.zone = 'nav';
        this.paint();
        return true;
      }
      if (k === 'left') r.row.move(-1);
      else if (k === 'right') r.row.move(1);
      else if (k === 'up') {
        if (this.ri > 0) this.ri--;
        else this.zone = 'nav';
      } else if (k === 'down') {
        if (this.ri < this.rows.length - 1) this.ri++;
      } else if (k === 'ok') return this.openItem(r, r.items[r.row.index], false), true;
      else if (k === 'okLong' || k === 'menu') return this.itemMenu(r, r.items[r.row.index]), true;
      else return false;
      this.paint();
      return true;
    }
    return false;
  }

  heroAction(btn) {
    const label = btn.lastChild.textContent;
    if (label === 'Watch' && this.heroCh) {
      Video.volume(1);
      go('player', { mode: 'live', ch: this.heroCh });
    } else go('live', { focusId: this.heroCh ? this.heroCh.id : null });
  }

  openNav(id) {
    if (id === 'live') go('live', {});
    else if (id === 'vod' || id === 'series') go('browse', { kind: id });
    else go(id, {});
  }

  openItem(r, it) {
    if (!it) return;
    if (r.kind === 'channel') {
      go('player', { mode: 'live', ch: it, list: r.items });
      return;
    }
    if (r.kind === 'wide') {
      if (it.type === 'vod') go('movie', { id: it.id, resume: true, play: true });
      else go('seriesInfo', { id: it.id, play: true });
      return;
    }
    if (it.type === 'vod') go('movie', { id: it.id });
    else go('seriesInfo', { id: it.id });
  }

  itemMenu(r, it) {
    if (!it) return;
    const lib = Session.lib;
    const items = [];
    if (r.kind === 'wide') {
      items.push({ label: 'Open details', icon: 'info', action: () => (it.type === 'vod' ? go('movie', { id: it.id }) : go('seriesInfo', { id: it.id })) });
      items.push({ label: 'Remove from Continue watching', icon: 'trash', action: () => {
        lib.removeWatching(it.k);
        this.buildRows();
      } });
    } else {
      const type = r.kind === 'channel' ? 'live' : it.type;
      const fav = lib.isFav(type, it.id);
      items.push({ label: fav ? 'Remove from favorites' : 'Add to favorites', icon: fav ? 'starOn' : 'star', action: () => {
        lib.toggleFav(type, it.id);
        this.buildRows();
      } });
      if (r.kind !== 'channel') items.push({ label: 'Open details', icon: 'info', action: () => this.openItem({ kind: 'poster' }, it) });
    }
    new Menu(r.kind === 'channel' ? it.name : it.title || cleanTitle(it.name), items).open();
  }
}

