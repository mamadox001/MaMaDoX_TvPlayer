// Full-screen player on the phone (landscape): touch controls for live TV, catch-up,
// movies and episodes.
import { h, fmtClock, fmtPos, cleanTitle, yearOf, nowSec } from '../../src/util.js';
import { icon } from '../../src/ui/widgets.js';
import { Video } from '../../src/player/video.js';
import { Native } from '../../src/native.js';
import { Session } from '../../src/data/session.js';
import { progressOf } from '../../src/data/epg.js';
import { settings, saveSettings } from '../../src/store.js';
import { Page, Nav, sheet, toast } from '../ui.js';
import { playChannel, playCatchup, playMovie, playEpisode, openExternal, sourceFor, titleFor } from '../playback.js';

const ASPECTS = [
  ['fit', 'Fit'],
  ['fill', 'Fill the screen'],
  ['zoom', 'Zoom'],
  ['stretch', 'Stretch'],
  ['16:9', '16:9'],
  ['4:3', '4:3'],
];

export class PlayerPage extends Page {
  /** p: {mode: live|catchup|vod|episode, ch, list, prog, item, info, series, ep, episodes, start} */
  constructor(p) {
    super('player');
    this.p = p;
    this.mode = p.mode;
    this.fullscreen = true;
    this.seeking = false;
  }

  get isLive() {
    return this.mode === 'live';
  }

  build() {
    this.title = h('div.pl-title.bidi');
    this.sub = h('div.pl-sub.bidi');
    const top = h(
      'div.pl-top',
      null,
      this.btn('back', () => Nav.back(), 'close'),
      h('div.pl-head', null, this.title, this.sub),
      this.btn('tracks', () => this.tracks(), 'audio'),
      this.btn('aspect', () => this.aspect(), 'aspect'),
      this.btn('more', () => this.more(), 'list')
    );
    this.playBtn = this.btn('play', () => this.toggle(), 'pause', 'big');
    const center = this.isLive
      ? h('div.pl-center', null, this.btn('prev', () => this.zap(-1), 'rew'), this.playBtn, this.btn('next', () => this.zap(1), 'ff'))
      : h('div.pl-center', null, this.btn('rew', () => this.skip(-10000), 'rew'), this.playBtn, this.btn('ff', () => this.skip(30000), 'ff'));
    this.pos = h('span.pl-pos');
    this.dur = h('span.pl-dur');
    this.range = h('input.pl-range', { type: 'range', min: '0', max: '1000', value: '0' });
    this.range.addEventListener('input', () => {
      this.seeking = true;
      const st = this.status || {};
      if (st.dur) this.pos.textContent = fmtPos((this.range.value / 1000) * st.dur);
      this.kick();
    });
    this.range.addEventListener('change', () => {
      const st = this.status || {};
      if (st.dur) Video.seek((this.range.value / 1000) * st.dur);
      this.seeking = false;
    });
    this.nextBtn = h('button.pl-next', { type: 'button' }, icon('next'), h('span', { text: 'Next episode' }));
    this.nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.playNext();
    });
    const bottom = h('div.pl-bottom', null, h('div.pl-times', null, this.pos, this.dur), this.range, this.nextBtn);
    this.spin = h('div.spinner');
    this.err = h('div.pl-err');
    this.ui = h('div.pl-ui', null, top, center, bottom);
    this.el.append(this.spin, this.ui, this.err);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el || e.target === this.ui) this.toggleUi();
    });
    this.offs = [
      Video.on('state', (s) => this.onState(s)),
      Video.on('prepared', () => this.onState(Video.state)),
    ];
  }

  btn(name, fn, ico, cls) {
    const b = h('button.pl-btn' + (cls ? '.' + cls : ''), { type: 'button', 'aria-label': name }, icon(ico));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
      this.kick();
    });
    return b;
  }

  enter(params) {
    if (params === true) return;
    Native.setOrientation('landscape');
    this.el.classList.toggle('live', this.isLive);
    this.el.classList.toggle('vod', !this.isLive);
    this.start();
    this.showUi();
    this.tick = setInterval(() => this.update(), 500);
    this.saveTick = 0;
    // keyboard on computers: Space pauses, arrows seek or change channel
    this.onKey = (e) => {
      if (Nav.top() !== this || Nav.overlays.length) return;
      const k = e.key;
      if (k === ' ' || k === 'k') this.toggle();
      else if (k === 'ArrowLeft') this.isLive ? this.zap(-1) : this.skip(-10000);
      else if (k === 'ArrowRight') this.isLive ? this.zap(1) : this.skip(30000);
      else if (k === 'ArrowUp' && this.isLive) this.zap(-1);
      else if (k === 'ArrowDown' && this.isLive) this.zap(1);
      else return;
      e.preventDefault();
      this.showUi();
    };
    document.addEventListener('keydown', this.onKey);
    this.el.onmousemove = () => this.showUi();
  }

  leave() {
    clearInterval(this.tick);
    if (this.onKey) document.removeEventListener('keydown', this.onKey);
    this.saveProgress();
    if (!this.isLive) Video.stop();
    Native.setOrientation('portrait');
  }

  video() {
    return 'full';
  }

  start() {
    const p = this.p;
    this.err.classList.remove('show');
    if (this.isLive) {
      const cur = Video.cur;
      if (!(cur && cur.meta.kind === 'live' && cur.meta.ch.id === p.ch.id && Video.state !== 'error')) playChannel(p.ch, 'full');
      else Video.volume(1);
      Session.guide.load(p.ch, false);
    } else if (this.mode === 'catchup') playCatchup(p.ch, p.prog, p.offset || 0);
    else if (this.mode === 'vod') playMovie(p.item, p.start || 0, p.info);
    else playEpisode(p.series, p.ep, p.start || 0);
    this.paintTitle();
  }

  paintTitle() {
    const p = this.p;
    if (this.isLive) {
      this.title.textContent = (p.ch.num ? p.ch.num + '  ' : '') + p.ch.name;
    } else if (this.mode === 'catchup') {
      this.title.textContent = p.prog.title;
      this.sub.textContent = `${p.ch.name}, ${fmtClock(p.prog.start)} to ${fmtClock(p.prog.stop)}`;
    } else if (this.mode === 'vod') {
      this.title.textContent = cleanTitle(p.item.name);
      this.sub.textContent = yearOf(p.item) || '';
    } else {
      this.title.textContent = cleanTitle(p.series.name);
      this.sub.textContent = `S${p.ep.season} E${p.ep.episode}${p.ep.title ? ': ' + p.ep.title : ''}`;
    }
    this.nextBtn.style.display = this.mode === 'episode' && this.nextEpisode() ? '' : 'none';
  }

  update() {
    const st = (this.status = Video.status());
    if (this.isLive) {
      const nn = Session.guide.nowNext(this.p.ch);
      const now = nn && nn.now;
      this.sub.textContent = now ? `${now.title}, ${fmtClock(now.start)} to ${fmtClock(now.stop)}` : '';
      this.pos.textContent = now ? fmtClock(now.start) : '';
      this.dur.textContent = now ? fmtClock(now.stop) : '';
      this.range.value = now ? Math.round(progressOf(now) * 1000) : 0;
      return;
    }
    if (!this.seeking && st.dur) {
      this.pos.textContent = fmtPos(st.pos || 0);
      this.dur.textContent = fmtPos(st.dur);
      this.range.value = Math.round(((st.pos || 0) / st.dur) * 1000);
    }
    if (++this.saveTick % 20 === 0) this.saveProgress();
  }

  onState(s) {
    const busy = Video.buffering || s === 'preparing' || s === 'reconnecting';
    this.spin.style.display = busy && s !== 'error' && s !== 'idle' ? '' : 'none';
    this.playBtn.innerHTML = '';
    this.playBtn.appendChild(icon(s === 'paused' ? 'play' : 'pause'));
    if (s === 'playing') this.err.classList.remove('show');
    if (s === 'error' && Nav.top() === this) this.showError();
    if (s === 'ended' && Nav.top() === this) this.ended();
  }

  showError() {
    this.err.innerHTML = '';
    const live = this.isLive;
    const b = (label, fn, primary) => {
      const e = h('button.btn' + (primary ? '.primary' : ''), { type: 'button', text: label });
      e.addEventListener('click', (ev) => {
        ev.stopPropagation();
        fn();
      });
      return e;
    };
    this.err.append(
      h('div.dlg-title', { text: live ? 'This channel is not playing' : 'This video cannot be played' }),
      h('div.dlg-msg', { text: live ? 'The stream may be offline, or your subscription allows fewer screens than are in use right now.' : 'The file may be missing on the server, or its format is not supported by this phone. Another player such as VLC can play more formats.' }),
      h(
        'div.dlg-btns',
        null,
        b('Try again', () => this.start(), true),
        b('Open in another player', () => openExternal(sourceFor(this.p), titleFor(this.p), (this.status && this.status.pos) || this.p.start || 0)),
        b('Close', () => Nav.back())
      )
    );
    this.err.classList.add('show');
    this.showUi(true);
  }

  ended() {
    const next = this.mode === 'episode' && settings().autoplayNext ? this.nextEpisode() : null;
    this.saveProgress();
    if (next) {
      toast('Next episode');
      this.playNext();
    } else Nav.back();
  }

  toggle() {
    if (this.isLive && Video.state === 'error') return this.start();
    Video.toggle();
  }

  skip(ms) {
    const st = Video.status();
    if (st.dur) Video.seek(Math.max(0, Math.min(st.dur - 2000, (st.pos || 0) + ms)));
  }

  zap(d) {
    const list = this.p.list && this.p.list.length ? this.p.list : [this.p.ch];
    const i = list.indexOf(this.p.ch);
    const ch = list[(i + d + list.length) % list.length];
    if (!ch || ch === this.p.ch) return;
    this.p.ch = ch;
    playChannel(ch, 'full');
    Session.guide.load(ch, false);
    this.paintTitle();
    this.update();
  }

  nextEpisode() {
    const eps = this.p.episodes;
    if (!eps || !this.p.ep) return null;
    const i = eps.findIndex((e) => (e.id || e.url) === (this.p.ep.id || this.p.ep.url));
    return i >= 0 && i < eps.length - 1 ? eps[i + 1] : null;
  }

  playNext() {
    const n = this.nextEpisode();
    if (!n) return;
    this.saveProgress();
    this.p.ep = n;
    this.p.start = 0;
    playEpisode(this.p.series, n, 0);
    this.paintTitle();
  }

  tracks() {
    const ts = Video.loadTracks();
    const audio = ts.filter((t) => t.kind === 'audio');
    const text = ts.filter((t) => t.kind === 'text' && t.renderable !== false);
    if (!audio.length && !text.length) return toast('This stream has no other audio or subtitle tracks');
    const lang = (t, n) => (t.lang && t.lang !== 'und' ? t.lang.toUpperCase() : `Track ${n}`) + (t.channels ? `, ${t.channels} ch` : '');
    const items = audio.map((t, n) => ({ label: 'Audio: ' + lang(t, n + 1), icon: 'audio', on: t.selected, action: () => Video.track(t.index, true) }));
    if (text.length) {
      items.push({ label: 'Subtitles off', icon: 'subs', on: !text.some((t) => t.selected), action: () => text.forEach((t) => t.selected && Video.track(t.index, false)) });
      text.forEach((t, n) => items.push({ label: 'Subtitles: ' + lang(t, n + 1), icon: 'subs', on: t.selected, action: () => Video.track(t.index, true) }));
    }
    sheet('Audio and subtitles', items);
  }

  aspect() {
    const s = settings();
    const i = ASPECTS.findIndex((a) => a[0] === s.aspect);
    const n = ASPECTS[(i + 1) % ASPECTS.length];
    s.aspect = n[0];
    saveSettings();
    Video.aspect(n[0]);
    toast('Picture: ' + n[1]);
  }

  more() {
    const items = [{ label: 'Open in another player', sub: 'VLC, MX Player or any installed player', icon: 'external', action: () => openExternal(sourceFor(this.p), titleFor(this.p), (this.status && this.status.pos) || 0) }];
    if (!this.isLive) items.unshift({ label: 'Start from the beginning', icon: 'restart', action: () => Video.seek(0) });
    if (this.isLive) {
      const fav = Session.lib.isFav('live', this.p.ch.id);
      items.unshift({
        label: fav ? 'Remove from favorites' : 'Add to favorites',
        icon: fav ? 'star' : 'starOn',
        action: () => toast(Session.lib.toggleFav('live', this.p.ch.id) ? 'Added to favorites' : 'Removed from favorites'),
      });
      items.push({ label: 'Restart the stream', icon: 'refresh', action: () => playChannel(this.p.ch, 'full', { noRecent: true }) });
    }
    sheet(titleFor(this.p), items);
  }

  // ---------------------------------------------------------------- controls visibility

  showUi(stay) {
    this.el.classList.add('ui-on');
    this.kick(stay);
  }

  kick(stay) {
    clearTimeout(this.hideT);
    if (!stay) this.hideT = setTimeout(() => this.el.classList.remove('ui-on'), 4500);
  }

  toggleUi() {
    if (this.el.classList.contains('ui-on')) this.el.classList.remove('ui-on');
    else this.showUi();
  }

  back() {
    if (this.err.classList.contains('show')) return false;
    return false;
  }

  // ---------------------------------------------------------------- resume points

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
    } else {
      const s = this.p.series;
      const ep = this.p.ep;
      const next = this.nextEpisode();
      const done = pos > st.dur * 0.93;
      const target = done && next ? next : ep;
      lib.setProgress('e:' + s.id + ':' + (ep.id || ep.url), pos, st.dur, {
        k: 's:' + s.id,
        type: 'series',
        id: s.id,
        title: cleanTitle(s.name),
        img: target.still || s.cover,
        sub: `S${target.season} E${target.episode}${target.title ? ': ' + target.title : ''}`,
        ep: { id: target.id || target.url, season: target.season, episode: target.episode },
        nextEp: done && !!next,
      });
    }
  }

  destroy() {
    clearTimeout(this.hideT);
    this.offs.forEach((f) => f());
  }
}

export { nowSec };
