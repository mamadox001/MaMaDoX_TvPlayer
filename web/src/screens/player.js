// Full screen playback for live channels, catch-up, movies and episodes.
import { h, fmtClock, fmtPos, fmtDay, nowSec, cleanTitle, clamp, debounce, yearOf } from '../util.js';
import { App, Screen } from '../ui/app.js';
import { VList } from '../ui/list.js';
import { icon, art, setArt, progressBar, setProgress, button, clock } from '../ui/widgets.js';
import { Menu, pick, confirm } from '../ui/dialogs.js';
import { Session, liveSource, movieSource, episodeSource, catchupSource, canCatchup } from '../data/session.js';
import { progressOf } from '../data/epg.js';
import { settings, saveSettings } from '../store.js';
import { Video } from '../player/video.js';
import { playChannel, playCatchup, playMovie, playEpisode, openExternal, useExternal } from '../player/playback.js';
import { liveCats, catLocked } from './livecats.js';
import { NumberEntry } from './numentry.js';
import { go } from './nav.js';

const ASPECTS = [
  { value: 'fit', label: 'Fit to screen' },
  { value: 'fill', label: 'Fill screen (crop)' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'stretch', label: 'Stretch' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
];

const LANGS = { en: 'English', eng: 'English', fr: 'French', fre: 'French', fra: 'French', ar: 'Arabic', ara: 'Arabic', es: 'Spanish', spa: 'Spanish', de: 'German', ger: 'German', deu: 'German', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese', tr: 'Turkish', tur: 'Turkish', nl: 'Dutch', dut: 'Dutch', ru: 'Russian', rus: 'Russian', hi: 'Hindi', hin: 'Hindi', und: 'Unknown' };

/** Open the player, or an external app if the user chose one. */
export function watch(params) {
  const kind = params.mode === 'live' ? 'live' : 'vod';
  if (useExternal(kind)) {
    let src;
    if (params.mode === 'live') src = liveSource(Session.pl, params.ch);
    else if (params.mode === 'catchup') src = catchupSource(Session.pl, params.ch, params.prog, 0);
    else if (params.mode === 'vod') src = movieSource(Session.pl, params.item);
    else src = episodeSource(Session.pl, params.ep);
    const title = params.mode === 'live' ? params.ch.name : params.mode === 'vod' ? cleanTitle(params.item.name) : params.mode === 'episode' ? `${cleanTitle(params.series.name)} S${params.ep.season} E${params.ep.episode}` : params.prog.title;
    if (params.mode === 'live') Session.lib.addRecent(params.ch.id);
    return openExternal(src, title, params.start || 0);
  }
  go('player', params);
  return true;
}

export class PlayerScreen extends Screen {
  constructor(p) {
    super('player.see-through');
    this.p = p || {};
    this.mode = this.p.mode;
    this.osdTimer = 0;
    this.seekTarget = -1;
    this.seekSteps = 0;
    this.lastSeekKey = 0;
    this.sleepAt = 0;
  }

  get isLive() {
    return this.mode === 'live';
  }

  build() {
    this.spinner = h('div.pl-spin', null, h('div.spin'));
    this.subs = h('div.pl-subs.bidi');
    this.errBox = h('div.pl-error');
    this.el.append(this.spinner, this.subs, this.errBox);
    if (this.isLive) this.buildLive();
    else this.buildVod();
    this.num = new NumberEntry(this.el, (n) => this.jumpTo(n));
    this.offs = [
      Video.on('state', () => this.onState()),
      Video.on('firstframe', () => this.onState()),
      Video.on('size', () => this.paintBadge()),
      Video.on('text', (t) => {
        this.subs.textContent = t;
      }),
      Video.on('error', () => this.onError()),
    ];
    this.ticker = setInterval(() => this.tick(), 1000);
  }

  destroy() {
    for (const f of this.offs) f();
    clearInterval(this.ticker);
    clearTimeout(this.osdTimer);
    clearTimeout(this.seekTimer);
    clearTimeout(this.nextTimer);
    if (this.guideOff) this.guideOff();
    super.destroy();
  }

  enter(params, back) {
    if (!back) this.start();
    else this.onState();
    if (this.isLive) {
      this.guideOff && this.guideOff();
      this.guideOff = Session.guide.onUpdate((id) => {
        if (this.ch && id === this.ch.id) this.paintBanner();
        if (this.listOpen) this.ovList.refresh();
      });
    }
  }

  leave() {
    this.saveProgress(true);
    this.num.cancel();
    if (this.guideOff) this.guideOff();
    this.guideOff = null;
  }

  video() {
    return 'full';
  }

  // ------------------------------------------------------------ start / modes

  start() {
    const p = this.p;
    this.errBox.classList.remove('show');
    if (this.mode === 'live') {
      this.ch = p.ch;
      this.zapList = p.list && p.list.length ? p.list : this.defaultList(p.ch);
      const cur = Video.cur;
      if (!(cur && cur.meta.kind === 'live' && cur.meta.ch.id === p.ch.id && Video.state !== 'error')) playChannel(p.ch, 'full');
      else Video.volume(1);
      Session.guide.load(p.ch, false);
      this.showBanner();
    } else if (this.mode === 'catchup') {
      this.ch = p.ch;
      this.prog = p.prog;
      this.offset = p.offset || 0;
      playCatchup(p.ch, p.prog, this.offset, 'full');
      this.showOsd(false);
    } else if (this.mode === 'vod') {
      playMovie(p.item, p.start || 0, p.info);
      this.showOsd(false);
    } else if (this.mode === 'episode') {
      this.ep = p.ep;
      playEpisode(p.series, p.ep, p.start || 0, { episodes: p.episodes });
      this.showOsd(false);
    }
    this.paintVodTitle && this.paintVodTitle();
  }

  defaultList(ch) {
    const live = Session.catalog.get('live');
    if (!live) return [ch];
    const c = live.catById.get(ch.cat);
    return c ? c.items.map((i) => live.items[i]) : [ch];
  }

  // ------------------------------------------------------------ live UI

  buildLive() {
    this.bNum = h('div.bn-num');
    this.bLogo = art('logo.bn-logo');
    this.bName = h('div.bn-name.bidi');
    this.bBadge = h('div.bn-badges');
    this.bNowT = h('div.bn-now-t.bidi');
    this.bTime = h('span.bn-time');
    this.bBar = progressBar();
    this.bNext = h('div.bn-next.bidi');
    this.banner = h(
      'div.banner',
      null,
      h('div.bn-left', null, this.bNum, this.bLogo),
      h('div.bn-mid', null, h('div.bn-row', null, this.bName, this.bBadge), this.bNowT, h('div.bn-tl', null, this.bTime, this.bBar), this.bNext),
      h('div.bn-right', null, clock(true), h('div.bn-hint', { text: 'OK for the channel list' }))
    );
    this.el.appendChild(this.banner);
    // channel list overlay
    this.ovCat = h('div.ovl-cat');
    this.ovList = new VList({
      rowH: 96,
      height: App.height - 220,
      margin: 2,
      create: () => h('div.chrow.ovl-row', null, h('div.ch-num'), art('logo'), h('div.ch-text', null, h('div.ch-name.bidi'), h('div.ch-now', null, h('span.ch-now-t.bidi'), progressBar())), h('div.ch-side', null, h('span.onair', null, h('i'), h('i'), h('i')))),
      bind: (el, i) => {
        const ch = this.ovChannels[i];
        if (!ch) return;
        el.children[0].textContent = ch.num || '';
        setArt(el.children[1], ch.logo, ch.name, 112, 60);
        el.children[2].children[0].textContent = ch.name;
        const nn = Session.guide.nowNext(ch);
        const now = el.children[2].children[1];
        now.firstChild.textContent = nn && nn.now ? nn.now.title : '';
        setProgress(now.lastChild, nn && nn.now ? progressOf(nn.now) : 0);
        now.lastChild.style.visibility = nn && nn.now ? '' : 'hidden';
        el.classList.toggle('is-playing', this.ch && ch.id === this.ch.id);
      },
      onFocus: debounce(() => this.loadOverlayGuide(), 200),
    });
    this.overlay = h('div.ovl', null, h('div.ovl-head', null, icon('chevron', 'flip'), this.ovCat, icon('chevron')), this.ovList.el);
    this.el.appendChild(this.overlay);
  }

  showBanner() {
    this.paintBanner();
    this.banner.classList.add('show');
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => this.banner.classList.remove('show'), 5000);
  }

  paintBanner() {
    const ch = this.ch;
    if (!ch || !this.bNum) return;
    this.bNum.textContent = ch.num || '';
    setArt(this.bLogo, ch.logo || Session.guide.iconFor(ch), ch.name, 180);
    this.bName.textContent = ch.name;
    const nn = Session.guide.nowNext(ch);
    if (nn && nn.now) {
      this.bNowT.textContent = nn.now.title;
      this.bTime.textContent = `${fmtClock(nn.now.start)} to ${fmtClock(nn.now.stop)}`;
      setProgress(this.bBar, progressOf(nn.now));
      this.bBar.style.visibility = '';
      this.bNext.textContent = nn.next ? `Next at ${fmtClock(nn.next.start)}: ${nn.next.title}` : '';
    } else {
      this.bNowT.textContent = '';
      this.bTime.textContent = '';
      this.bBar.style.visibility = 'hidden';
      this.bNext.textContent = '';
    }
    this.paintBadge();
  }

  paintBadge() {
    if (!this.bBadge) return;
    const b = [];
    b.push('<span class="badge badge-live">Live</span>');
    const hgt = Video.h;
    if (hgt) b.push(`<span class="badge">${hgt >= 2000 ? '4K' : hgt >= 1000 ? '1080p' : hgt >= 700 ? '720p' : hgt + 'p'}</span>`);
    if (Session.lib && this.ch && Session.lib.isFav('live', this.ch.id)) b.push('<span class="badge badge-fav">Favorite</span>');
    this.bBadge.innerHTML = b.join('');
  }

  zap(d) {
    const list = this.zapList;
    if (!list || list.length < 2) return;
    let i = list.indexOf(this.ch);
    if (i < 0) i = list.findIndex((c) => c.id === this.ch.id);
    const n = list[(i + d + list.length) % list.length];
    this.tune(n);
  }

  tune(ch) {
    if (!ch || (this.ch && ch.id === this.ch.id)) {
      this.showBanner();
      return;
    }
    this.prevCh = this.ch;
    this.ch = ch;
    this.errBox.classList.remove('show');
    playChannel(ch, 'full');
    Session.guide.load(ch, false);
    this.showBanner();
  }

  jumpTo(num) {
    const live = Session.catalog.get('live');
    const ch = live && live.items.find((c) => String(c.num) === String(num));
    if (!ch) {
      App.toast(`There is no channel ${num}`);
      return;
    }
    if (this.isLive) {
      if (this.zapList.indexOf(ch) < 0) this.zapList = this.defaultList(ch);
      this.tune(ch);
    }
  }

  openList() {
    const live = Session.catalog.get('live');
    if (!live) return;
    this.ovCats = liveCats(live).filter((c) => !catLocked(c));
    let ci = this.ovCats.findIndex((c) => c.list === this.zapList);
    if (ci < 0) ci = Math.max(0, this.ovCats.findIndex((c) => c.id === this.ch.cat));
    this.ovCi = ci;
    this.fillOverlay(true);
    this.listOpen = true;
    this.overlay.classList.add('show');
    this.banner.classList.remove('show');
  }

  fillOverlay(focusCurrent) {
    const c = this.ovCats[this.ovCi];
    this.ovChannels = c.list;
    this.ovCat.textContent = c.name;
    let idx = focusCurrent ? this.ovChannels.indexOf(this.ch) : 0;
    if (idx < 0) idx = 0;
    this.ovList.setCount(this.ovChannels.length, idx);
    this.ovList.setActive(true);
    this.loadOverlayGuide();
  }

  loadOverlayGuide() {
    if (!this.listOpen || !settings().showNowInList) return;
    const [a, b] = this.ovList.visibleRange();
    for (let i = b; i >= a; i--) if (this.ovChannels[i]) Session.guide.load(this.ovChannels[i], false);
  }

  closeList() {
    this.listOpen = false;
    this.overlay.classList.remove('show');
  }

  liveKey(ev) {
    const k = ev.key;
    if (this.listOpen) {
      const l = this.ovList;
      if (k === 'up') {
        if (!l.move(-1) && !ev.repeat) l.setIndex(l.count - 1);
      } else if (k === 'down') {
        if (!l.move(1) && !ev.repeat) l.setIndex(0);
      } else if (k === 'pgup' || k === 'chup') l.page(-1);
      else if (k === 'pgdown' || k === 'chdown') l.page(1);
      else if (k === 'left' || k === 'right') {
        const n = this.ovCats.length;
        this.ovCi = (this.ovCi + (k === 'left' ? -1 : 1) + n) % n;
        this.fillOverlay(false);
      } else if (k === 'ok') {
        const ch = this.ovChannels[l.index];
        if (ch) {
          this.zapList = this.ovChannels;
          this.closeList();
          this.tune(ch);
        }
      } else if (k === 'back' || k === 'del') this.closeList();
      else if (k === 'okLong' || k === 'menu') {
        const ch = this.ovChannels[l.index];
        if (ch) {
          const on = Session.lib.toggleFav('live', ch.id);
          App.toast(on ? `${ch.name} added to favorites` : `${ch.name} removed from favorites`);
        }
      }
      return true;
    }
    switch (k) {
      case 'up':
      case 'chup':
        this.zap(-1);
        return true;
      case 'down':
      case 'chdown':
        this.zap(1);
        return true;
      case 'ok':
      case 'left':
        this.openList();
        return true;
      case 'right':
      case 'info':
        if (this.banner.classList.contains('show')) this.banner.classList.remove('show');
        else this.showBanner();
        return true;
      case 'last':
      case 'blue':
        if (this.prevCh) this.tune(this.prevCh);
        return true;
      case 'okLong':
      case 'menu':
        this.optionsMenu();
        return true;
      case 'fav':
      case 'yellow': {
        const on = Session.lib.toggleFav('live', this.ch.id);
        App.toast(on ? `${this.ch.name} added to favorites` : `${this.ch.name} removed from favorites`);
        this.paintBadge();
        return true;
      }
      case 'guide':
        go('guide', { focusId: this.ch.id, catId: this.ch.cat });
        return true;
      case 'back':
      case 'del':
        if (this.banner.classList.contains('show')) {
          this.banner.classList.remove('show');
          return true;
        }
        return false;
    }
    return false;
  }

  // ------------------------------------------------------------ VOD UI

  buildVod() {
    this.vTitle = h('div.osd-title.bidi');
    this.vSub = h('div.osd-sub.bidi');
    this.vPos = h('span.osd-pos');
    this.vDur = h('span.osd-dur');
    this.vBar = h('div.seekbar', null, h('div.seek-buf'), h('div.seek-fill'), h('div.seek-knob', null, h('div.seek-tip')));
    this.ctrl = [
      { id: 'rew', icon: 'rew', label: 'Back 10 s' },
      { id: 'play', icon: 'pause', label: 'Pause' },
      { id: 'ff', icon: 'ff', label: 'Forward 30 s' },
      { id: 'audio', icon: 'audio', label: 'Audio' },
      { id: 'subs', icon: 'subs', label: 'Subtitles' },
      { id: 'aspect', icon: 'aspect', label: 'Picture' },
    ];
    if (this.mode === 'episode') this.ctrl.push({ id: 'next', icon: 'next', label: 'Next episode' });
    if (this.mode === 'catchup') this.ctrl.push({ id: 'live', icon: 'live', label: 'Watch live' });
    this.ctrlEls = this.ctrl.map((c) => h('div.ctl', null, icon(c.icon), h('span.ctl-label', { text: c.label })));
    this.ci = 1;
    this.osdZone = 'bar';
    this.osd = h(
      'div.osd',
      null,
      h('div.osd-top', null, h('div.osd-heading', null, this.vTitle, this.vSub), clock(true)),
      h('div.osd-bottom', null, h('div.osd-times', null, this.vPos, this.vDur), this.vBar, h('div.osd-ctrls', null, this.ctrlEls))
    );
    this.el.appendChild(this.osd);
    this.nextCard = h('div.next-card');
    this.el.appendChild(this.nextCard);
  }

  paintVodTitle() {
    if (this.isLive || !this.vTitle) return;
    const p = this.p;
    if (this.mode === 'vod') {
      this.vTitle.textContent = cleanTitle(p.item.name);
      const y = yearOf(p.item);
      this.vSub.textContent = y || '';
    } else if (this.mode === 'episode') {
      this.vTitle.textContent = cleanTitle(p.series.name);
      this.vSub.textContent = `Season ${this.ep.season}, episode ${this.ep.episode}${this.ep.title ? ': ' + this.ep.title : ''}`;
    } else if (this.mode === 'catchup') {
      this.vTitle.textContent = this.prog.title;
      this.vSub.textContent = `${this.ch.name}, ${fmtDay(this.prog.start)} ${fmtClock(this.prog.start)}`;
    }
  }

  showOsd(stay) {
    if (!this.osd) return;
    this.osd.classList.add('show');
    this.paintOsd();
    clearTimeout(this.osdTimer);
    if (!stay) this.osdTimer = setTimeout(() => this.hideOsd(), 4500);
  }

  hideOsd() {
    if (!this.osd || this.seekTarget >= 0) return;
    if (Video.state === 'paused') return;
    this.osd.classList.remove('show');
    this.osdZone = 'bar';
  }

  /** {pos, dur} in ms, catch-up uses the programme as the timeline. */
  timeline() {
    const st = Video.status();
    if (this.mode === 'catchup') {
      const dur = (this.prog.stop - this.prog.start) * 1000;
      return { pos: this.offset * 1000 + (st.pos || 0), dur };
    }
    return { pos: st.pos || 0, dur: st.dur || 0, buf: st.buf || 0 };
  }

  paintOsd() {
    if (!this.osd) return;
    const t = this.timeline();
    const pos = this.seekTarget >= 0 ? this.seekTarget : t.pos;
    const f = t.dur ? clamp(pos / t.dur, 0, 1) : 0;
    this.vPos.textContent = fmtPos(pos);
    this.vDur.textContent = t.dur ? '-' + fmtPos(Math.max(0, t.dur - pos)) : '';
    this.vBar.children[1].style.transform = `scaleX(${f})`;
    this.vBar.children[0].style.transform = `scaleX(${t.buf ? clamp(t.buf / 100, 0, 1) : 0})`;
    this.vBar.children[2].style.transform = `translate3d(${Math.round(f * 1776)}px,0,0)`;
    this.vBar.children[2].firstChild.textContent = fmtPos(pos);
    this.vBar.classList.toggle('seeking', this.seekTarget >= 0);
    this.vBar.classList.toggle('is-focused', this.osdZone === 'bar');
    const paused = Video.state === 'paused';
    const playCtl = this.ctrlEls[1];
    if (playCtl.__p !== paused) {
      playCtl.__p = paused;
      playCtl.innerHTML = '';
      playCtl.appendChild(icon(paused ? 'play' : 'pause'));
      playCtl.appendChild(h('span.ctl-label', { text: paused ? 'Play' : 'Pause' }));
    }
    this.ctrlEls.forEach((c, i) => c.classList.toggle('is-focused', this.osdZone === 'ctrls' && i === this.ci));
  }

  seekBy(dir) {
    const t = this.timeline();
    if (!t.dur) return;
    const now = Date.now();
    if (now - this.lastSeekKey < 600) this.seekSteps++;
    else this.seekSteps = 0;
    this.lastSeekKey = now;
    const steps = [10, 10, 10, 30, 30, 60, 60, 120, 300];
    const step = steps[Math.min(this.seekSteps, steps.length - 1)] * 1000;
    const base = this.seekTarget >= 0 ? this.seekTarget : t.pos;
    this.seekTarget = clamp(base + dir * step, 0, Math.max(0, t.dur - 2000));
    this.showOsd(true);
    clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => this.commitSeek(), 750);
  }

  commitSeek() {
    if (this.seekTarget < 0) return;
    const target = this.seekTarget;
    this.seekTarget = -1;
    if (this.mode === 'catchup') {
      const off = Math.floor(target / 60000) * 60;
      this.offset = off;
      playCatchup(this.ch, this.prog, off, 'full');
    } else Video.seek(target);
    this.paintOsd();
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => this.hideOsd(), 3000);
  }

  ctrlAction(id) {
    switch (id) {
      case 'rew':
        this.seekBy(-1);
        break;
      case 'ff':
        this.seekBy(1);
        this.seekBy(1);
        this.seekBy(1);
        break;
      case 'play':
        Video.toggle();
        setTimeout(() => this.paintOsd(), 120);
        break;
      case 'audio':
        this.trackMenu('audio');
        break;
      case 'subs':
        this.trackMenu('text');
        break;
      case 'aspect':
        this.aspectMenu();
        break;
      case 'next':
        this.playNext();
        break;
      case 'live':
        this.mode = 'live';
        App.replace(new PlayerScreen({ mode: 'live', ch: this.ch, list: this.p.list }));
        break;
    }
  }

  vodKey(ev) {
    const k = ev.key;
    const visible = this.osd.classList.contains('show');
    if (this.nextCard.classList.contains('show')) {
      if (k === 'ok') {
        this.playNext();
        return true;
      }
      if (k === 'back') {
        this.cancelNext();
        return true;
      }
    }
    switch (k) {
      case 'playpause':
        Video.toggle();
        this.showOsd(false);
        setTimeout(() => this.paintOsd(), 120);
        return true;
      case 'play':
        Video.resume();
        this.showOsd(false);
        return true;
      case 'pause':
        Video.pause();
        this.showOsd(true);
        return true;
      case 'ff':
        this.seekBy(1);
        this.seekBy(1);
        this.seekBy(1);
        return true;
      case 'rew':
        this.seekBy(-1);
        return true;
      case 'next':
        if (this.mode === 'episode') this.playNext();
        return true;
      case 'menu':
      case 'okLong':
        this.optionsMenu();
        return true;
      case 'audio':
        this.trackMenu('audio');
        return true;
      case 'subs':
        this.trackMenu('text');
        return true;
    }
    if (!visible) {
      if (k === 'left' || k === 'right') {
        this.osdZone = 'bar';
        this.seekBy(k === 'left' ? -1 : 1);
        return true;
      }
      if (k === 'ok') {
        Video.toggle();
        this.showOsd(false);
        setTimeout(() => this.paintOsd(), 150);
        return true;
      }
      if (k === 'up' || k === 'down' || k === 'info') {
        this.osdZone = k === 'down' ? 'ctrls' : 'bar';
        this.showOsd(false);
        return true;
      }
      return false;
    }
    // OSD visible
    if (this.osdZone === 'bar') {
      if (k === 'left' || k === 'right') this.seekBy(k === 'left' ? -1 : 1);
      else if (k === 'ok') {
        if (this.seekTarget >= 0) this.commitSeek();
        else {
          Video.toggle();
          setTimeout(() => this.paintOsd(), 150);
        }
      } else if (k === 'down') this.osdZone = 'ctrls';
      else if (k === 'up') {
        /* stay */
      } else if (k === 'back' || k === 'del') {
        if (this.seekTarget >= 0) {
          this.seekTarget = -1;
          clearTimeout(this.seekTimer);
          this.paintOsd();
          return true;
        }
        if (Video.state === 'paused') return false; // leave the player
        this.osd.classList.remove('show');
        return true;
      } else return false;
    } else {
      if (k === 'left') this.ci = Math.max(0, this.ci - 1);
      else if (k === 'right') this.ci = Math.min(this.ctrl.length - 1, this.ci + 1);
      else if (k === 'up') this.osdZone = 'bar';
      else if (k === 'ok') this.ctrlAction(this.ctrl[this.ci].id);
      else if (k === 'back' || k === 'del') {
        this.osdZone = 'bar';
        this.osd.classList.remove('show');
        return true;
      } else return true;
    }
    this.showOsd(Video.state === 'paused');
    return true;
  }

  // ------------------------------------------------------------ menus

  trackMenu(kind) {
    const tracks = Video.loadTracks().filter((t) => t.kind === kind && (kind !== 'text' || t.renderable !== false));
    if (!tracks.length) {
      App.toast(kind === 'audio' ? 'This stream has one audio track' : 'This stream has no subtitles the player can show');
      return;
    }
    const items = tracks.map((t, i) => ({
      label: trackLabel(t, i),
      sub: t.mime ? t.mime.replace(/^audio\/|^text\//, '').toUpperCase() + (t.channels ? `, ${t.channels === 6 ? '5.1' : t.channels === 8 ? '7.1' : t.channels + ' ch'}` : '') : '',
      checked: !!t.selected,
      action: () => {
        Video.track(t.index, true);
        App.toast(`${kind === 'audio' ? 'Audio' : 'Subtitles'}: ${trackLabel(t, i)}`);
      },
    }));
    if (kind === 'text') items.unshift({ label: 'Off', checked: !tracks.some((t) => t.selected), action: () => {
      for (const t of tracks) if (t.selected) Video.track(t.index, false);
      this.subs.textContent = '';
    } });
    new Menu(kind === 'audio' ? 'Audio' : 'Subtitles', items).open();
  }

  aspectMenu() {
    pick('Picture', ASPECTS, settings().aspect).then((v) => {
      if (!v) return;
      settings().aspect = v;
      saveSettings();
      Video.aspect(v);
    });
  }

  sleepMenu() {
    const left = this.sleepAt ? Math.max(1, Math.round((this.sleepAt - Date.now()) / 60000)) : 0;
    pick('Sleep timer', [{ value: 0, label: 'Off' }, { value: 15, label: '15 minutes' }, { value: 30, label: '30 minutes' }, { value: 60, label: '1 hour' }, { value: 90, label: '1 hour 30 minutes' }, { value: 120, label: '2 hours' }], left ? -1 : 0, { sub: left ? `Stops in ${left} min` : '' }).then((v) => {
      if (v === undefined || v === -1) return;
      this.sleepAt = v ? Date.now() + v * 60000 : 0;
      App.toast(v ? `Playback stops in ${v} minutes` : 'Sleep timer off');
    });
  }

  optionsMenu() {
    const items = [];
    if (this.isLive) {
      const fav = Session.lib.isFav('live', this.ch.id);
      items.push({ label: fav ? 'Remove from favorites' : 'Add to favorites', icon: fav ? 'starOn' : 'star', action: () => {
        Session.lib.toggleFav('live', this.ch.id);
        this.paintBadge();
      } });
      if (canCatchup(Session.pl, this.ch)) items.push({ label: 'Catch-up', sub: 'Watch earlier shows on this channel', icon: 'history', action: () => go('live', { focusId: this.ch.id }) });
      if (this.prevCh) items.push({ label: `Back to ${this.prevCh.name}`, icon: 'history', action: () => this.tune(this.prevCh) });
    }
    items.push({ label: 'Audio', icon: 'audio', action: () => this.trackMenu('audio') });
    items.push({ label: 'Subtitles', icon: 'subs', action: () => this.trackMenu('text') });
    items.push({ label: 'Picture', value: (ASPECTS.find((a) => a.value === settings().aspect) || ASPECTS[0]).label, icon: 'aspect', action: () => this.aspectMenu() });
    items.push({ label: 'Sleep timer', value: this.sleepAt ? `${Math.max(1, Math.round((this.sleepAt - Date.now()) / 60000))} min` : 'Off', icon: 'moon', action: () => this.sleepMenu() });
    items.push({ label: 'Stream info', icon: 'info', action: () => this.streamInfo() });
    items.push({ label: 'Restart stream', icon: 'refresh', action: () => this.retry() });
    items.push({ label: 'Open in another player', icon: 'external', action: () => {
      const c = Video.cur;
      if (c) openExternal(c.src, this.isLive ? this.ch.name : this.vTitle.textContent, this.timeline().pos);
    } });
    new Menu('Options', items).open();
  }

  streamInfo() {
    const c = Video.cur;
    if (!c) return;
    const st = Video.status();
    const host = (/^[a-z]+:\/\/([^/:?#]+)/i.exec(c.src.url) || [])[1] || '';
    const fmt = (/\.(m3u8|ts|mp4|mkv|avi|mov)(\?|$)/i.exec(c.src.url) || [])[1] || '';
    const lines = [
      ['Picture', st.w ? `${st.w} x ${st.h}` : 'Waiting for video'],
      ['Format', fmt ? fmt.toUpperCase() : 'Stream'],
      ['Server', host],
      ['Audio tracks', String(Video.loadTracks().filter((t) => t.kind === 'audio').length || 1)],
    ];
    new Menu('Stream info', lines.map((l) => ({ label: l[0], value: l[1], disabled: false, action: () => false }))).open();
  }

  // ------------------------------------------------------------ state, errors, progress

  onState() {
    const s = Video.state;
    const busy = Video.buffering || s === 'preparing' || s === 'reconnecting';
    this.spinner.classList.toggle('show', busy && s !== 'error' && s !== 'idle');
    if (s === 'playing') this.errBox.classList.remove('show');
    if (s === 'ended') this.onEnded();
    if (this.osd) this.paintOsd();
  }

  onError() {
    const c = Video.cur;
    if (!c) return;
    if (c.meta.kind === 'live' && !c.meta.triedAlt && Session.pl.type === 'xtream' && settings().liveFormat === 'auto') return; // fallback in progress
    const live = this.isLive;
    this.errBox.innerHTML = '';
    const btns = [button('Try again', 'refresh'), button('Open in another player', 'external'), button('Back')];
    let bi = 0;
    const mark = () => btns.forEach((b, i) => b.classList.toggle('is-focused', i === bi));
    mark();
    this.errBox.append(
      h('div.pl-err-title', { text: live ? 'This channel is not playing' : 'This video cannot be played' }),
      h('div.pl-err-msg', { text: live ? 'The stream may be offline, or your subscription allows fewer screens than are in use right now.' : 'The file may be missing on the server, or its format is not supported by this TV. Another player such as VLC can play more formats.' }),
      h('div.pl-err-btns', null, btns)
    );
    this.errBox.classList.add('show');
    this.errKeys = (ev) => {
      if (ev.key === 'left') bi = Math.max(0, bi - 1);
      else if (ev.key === 'right') bi = Math.min(2, bi + 1);
      else if (ev.key === 'ok') {
        this.errBox.classList.remove('show');
        this.errKeys = null;
        if (bi === 0) this.retry();
        else if (bi === 1) openExternal(Video.cur ? Video.cur.src : liveSource(Session.pl, this.ch), live ? this.ch.name : this.vTitle.textContent);
        else App.pop();
        return true;
      } else if (ev.key === 'back') {
        this.errBox.classList.remove('show');
        this.errKeys = null;
        App.pop();
        return true;
      } else if (live && (ev.key === 'up' || ev.key === 'down' || ev.key === 'chup' || ev.key === 'chdown')) {
        this.errBox.classList.remove('show');
        this.errKeys = null;
        return false;
      }
      mark();
      return true;
    };
  }

  retry() {
    this.errBox.classList.remove('show');
    if (this.isLive) {
      const ch = this.ch;
      this.ch = null;
      this.tune(ch);
    } else if (this.mode === 'catchup') playCatchup(this.ch, this.prog, this.offset, 'full');
    else {
      const pos = this.timeline().pos;
      if (this.mode === 'vod') playMovie(this.p.item, pos || this.p.start || 0);
      else playEpisode(this.p.series, this.ep, pos || this.p.start || 0);
    }
  }

  tick() {
    if (this.sleepAt && Date.now() > this.sleepAt) {
      this.sleepAt = 0;
      Video.stop();
      App.toast('Sleep timer: playback stopped', 'long');
      App.pop();
      return;
    }
    if (this.osd && this.osd.classList.contains('show')) this.paintOsd();
    if (this.isLive && this.banner.classList.contains('show')) this.paintBanner();
    if (!this.isLive && Video.state === 'playing') {
      this.saveTick = (this.saveTick || 0) + 1;
      if (this.saveTick % 10 === 0) this.saveProgress(false);
    }
  }

  saveProgress() {
    const lib = Session.lib;
    if (!lib || this.isLive || this.mode === 'catchup' || !Video.cur) return;
    const st = Video.status();
    if (!st.dur || st.state === 'idle') return;
    const pos = st.pos || 0;
    if (this.mode === 'vod') {
      const m = this.p.item;
      const info = this.p.info || {};
      lib.setProgress('m:' + m.id, pos, st.dur, { k: 'm:' + m.id, type: 'vod', id: m.id, title: cleanTitle(m.name), img: info.backdrop || m.icon, sub: yearOf(m) });
    } else if (this.mode === 'episode') {
      const s = this.p.series;
      const ep = this.ep;
      const next = this.nextEpisode();
      const done = pos > st.dur * 0.93;
      const target = done && next ? next : ep;
      lib.setProgress('e:' + s.id + ':' + (ep.id || ep.url), pos, st.dur, {
        k: 's:' + s.id,
        type: 'series',
        id: s.id,
        title: cleanTitle(s.name),
        img: (target.info && target.info.movie_image) || target.icon || s.cover,
        sub: `S${target.season} E${target.episode}${target.title ? ': ' + target.title : ''}`,
        ep: { id: target.id || target.url, season: target.season, episode: target.episode },
        nextEp: done && !!next,
      });
    }
  }

  nextEpisode() {
    const eps = this.p.episodes;
    if (!eps || !this.ep) return null;
    const i = eps.findIndex((e) => (e.id || e.url) === (this.ep.id || this.ep.url));
    return i >= 0 && i < eps.length - 1 ? eps[i + 1] : null;
  }

  onEnded() {
    this.saveProgress(true);
    if (this.mode === 'episode') {
      const next = this.nextEpisode();
      if (next && settings().autoplayNext) {
        this.showNextCard(next);
        return;
      }
    }
    if (this.mode !== 'live') setTimeout(() => App.top() === this && App.pop(), 600);
  }

  showNextCard(next) {
    let left = 10;
    this.nextCard.innerHTML = '';
    const count = h('span.next-count', { text: String(left) });
    this.nextCard.append(h('div.next-label', null, 'Next episode in ', count), h('div.next-title.bidi', { text: `S${next.season} E${next.episode}${next.title ? ': ' + next.title : ''}` }), h('div.next-hint', { text: 'OK to play now, Back to stop' }));
    this.nextCard.classList.add('show');
    clearInterval(this.nextTimer);
    this.nextTimer = setInterval(() => {
      left--;
      count.textContent = String(left);
      if (left <= 0) this.playNext();
    }, 1000);
  }

  cancelNext() {
    clearInterval(this.nextTimer);
    this.nextCard.classList.remove('show');
    App.pop();
  }

  playNext() {
    clearInterval(this.nextTimer);
    this.nextCard.classList.remove('show');
    const next = this.nextEpisode();
    if (!next) {
      App.toast('This is the last episode');
      return;
    }
    this.saveProgress(true);
    this.ep = next;
    this.p.ep = next;
    this.p.start = 0;
    this.errBox.classList.remove('show');
    playEpisode(this.p.series, next, 0, { episodes: this.p.episodes });
    this.paintVodTitle();
    this.showOsd(false);
  }

  key(ev) {
    if (this.errKeys && this.errBox.classList.contains('show')) {
      if (this.errKeys(ev)) return true;
    }
    if (ev.key === 'digit' && this.isLive) {
      this.num.push(ev.digit);
      return true;
    }
    if (this.num.active && ev.key === 'ok') {
      this.num.commit();
      return true;
    }
    if (this.isLive) return this.liveKey(ev);
    return this.vodKey(ev);
  }
}

export function trackLabel(t, i) {
  const l = (t.lang || '').toLowerCase();
  const name = LANGS[l] || (l && l !== 'und' ? l.toUpperCase() : '');
  return name || `Track ${i + 1}`;
}

