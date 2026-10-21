// Movie and series details on the phone.
import { h, cleanTitle, yearOf, fmtLength, fmtPos } from '../../src/util.js';
import { art, setArt, icon, progressBar, setProgress } from '../../src/ui/widgets.js';
import { Native } from '../../src/native.js';
import { Session, movieSource, episodeSource } from '../../src/data/session.js';
import * as X from '../../src/data/xtream.js';
import { Page, Nav, toast, ibtn } from '../ui.js';
import { useExternal, openExternal } from '../playback.js';
import { PlayerPage } from './player.js';

function parseDur(s) {
  const m = /^(\d+):(\d\d)(?::(\d\d))?$/.exec(s || '');
  if (!m) return 0;
  return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
}

function trailer(t) {
  if (!t) return;
  if (!Native.openUrl(/^https?:/.test(t) ? t : 'https://www.youtube.com/watch?v=' + t)) toast('Install YouTube to watch trailers');
}

/** Shared layout: backdrop, poster, title, facts, buttons, story. */
class DetailPage extends Page {
  constructor(item, type) {
    super('detail');
    this.item = item;
    this.type = type;
    this.info = {};
  }

  buildHead() {
    this.backdrop = art('backdrop');
    this.poster = art('dposter');
    this.title = h('h1.d-title.bidi');
    this.facts = h('div.d-facts');
    this.btns = h('div.d-btns');
    this.plot = h('p.d-plot.bidi');
    this.credits = h('div.d-credits.bidi');
    const back = ibtn('close', null, () => Nav.back(), 'd-back');
    this.scroll = h('div.d-scroll', null, h('div.d-hero', null, this.backdrop, h('div.d-shade')), h('div.d-head', null, this.poster, h('div.d-headtext', null, this.title, this.facts)), this.btns, this.plot, this.credits);
    this.el.append(this.scroll, back);
  }

  paintHead() {
    const it = this.item;
    const inf = this.info;
    const name = cleanTitle(it.name);
    this.title.textContent = name;
    setArt(this.poster, inf.poster || it.icon || it.cover, name, 240);
    setArt(this.backdrop, inf.backdrop || inf.poster || it.icon || it.cover, name, 720);
    this.backdrop.classList.toggle('blurred', !inf.backdrop);
    const bits = [];
    const y = inf.year || yearOf(it);
    if (y) bits.push(y);
    if (inf.duration) bits.push(fmtLength(inf.duration));
    if (inf.rating || it.rating) bits.push('★ ' + (inf.rating || it.rating).toFixed(1));
    if (inf.genre) bits.push(inf.genre);
    this.facts.textContent = bits.join('   ');
    this.plot.textContent = inf.plot || '';
    const cr = [];
    if (inf.director) cr.push('Director: ' + inf.director);
    if (inf.cast) cr.push('Cast: ' + inf.cast);
    this.credits.textContent = cr.join('\n');
  }

  button(label, ico, fn, primary) {
    const b = h('button.btn' + (primary ? '.primary' : ''), { type: 'button' }, icon(ico), h('span', { text: label }));
    b.addEventListener('click', fn);
    return b;
  }

  favButton() {
    const fav = Session.lib.isFav(this.type, this.item.id);
    return this.button(fav ? 'In favorites' : 'Favorite', fav ? 'starOn' : 'star', () => {
      toast(Session.lib.toggleFav(this.type, this.item.id) ? 'Added to favorites' : 'Removed from favorites');
      this.paintButtons();
    });
  }
}

export class MoviePage extends DetailPage {
  constructor(item) {
    super(item, 'vod');
  }

  build() {
    this.buildHead();
  }

  enter(params) {
    this.paintHead();
    this.paintButtons();
    if (params !== true) this.load();
  }

  async load() {
    if (Session.pl.type !== 'xtream') return;
    try {
      const j = await X.vodInfo(Session.pl, this.item.id);
      const i = (j && j.info && !Array.isArray(j.info) && j.info) || {};
      const md = (j && j.movie_data) || {};
      const bd = Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path || '';
      this.info = {
        plot: i.plot || i.description || '',
        cast: i.cast || i.actors || '',
        director: i.director || '',
        genre: i.genre || '',
        duration: +i.duration_secs || parseDur(i.duration),
        rating: parseFloat(i.rating) || this.item.rating || 0,
        year: (i.releasedate || i.release_date || '').slice(0, 4) || yearOf(this.item),
        backdrop: bd,
        poster: i.cover_big || i.movie_image || '',
        trailer: i.youtube_trailer || '',
      };
      if (md.container_extension && !this.item.ext) this.item.ext = md.container_extension;
      if (Nav.top() === this) {
        this.paintHead();
        this.paintButtons();
      }
    } catch (e) {
      /* the details are optional */
    }
  }

  paintButtons() {
    const p = Session.lib.progress('m:' + this.item.id);
    const resume = p && !p.done && p.pos > 0 ? p.pos : 0;
    this.btns.innerHTML = '';
    this.btns.append(this.button(resume ? 'Resume ' + fmtPos(resume) : 'Play', 'play', () => this.play(resume), true));
    if (resume) this.btns.append(this.button('From start', 'restart', () => this.play(0)));
    this.btns.append(this.favButton());
    if (this.info.trailer) this.btns.append(this.button('Trailer', 'film', () => trailer(this.info.trailer)));
  }

  play(start) {
    if (useExternal('vod')) return openExternal(movieSource(Session.pl, this.item), cleanTitle(this.item.name), start);
    Nav.push(new PlayerPage({ mode: 'vod', item: this.item, info: this.info, start }));
  }
}

function groupArray(arr) {
  const g = {};
  for (const e of arr) {
    const s = +e.season || 1;
    (g[s] || (g[s] = [])).push(e);
  }
  return g;
}

function cleanEpTitle(t, s) {
  if (!t) return '';
  let x = String(t);
  const m = /S\d{1,3}\s*E\d{1,4}\s*[-:.]?\s*(.*)$/i.exec(x);
  if (m) x = m[1];
  x = x.replace(new RegExp('^' + cleanTitle(s.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-:]?\\s*', 'i'), '').trim();
  if (!x || /^episode\s*\d+$/i.test(x)) return '';
  return x;
}

export class SeriesPage extends DetailPage {
  constructor(item) {
    super(item, 'series');
    this.seasons = [];
    this.eps = {};
    this.flat = [];
    this.season = null;
  }

  build() {
    this.buildHead();
    this.seasonBar = h('div.chips.seasons');
    this.epBox = h('div.eps', null, h('div.vs-empty', { text: 'Loading episodes' }));
    this.scroll.append(this.seasonBar, this.epBox);
  }

  enter(params) {
    this.paintHead();
    this.paintButtons();
    if (params !== true) this.load();
    else this.showSeason(this.season);
  }

  async load() {
    const pl = Session.pl;
    const s = this.item;
    if (pl.type === 'xtream') {
      try {
        const j = await X.seriesInfo(pl, s.id);
        const i = (j && j.info && !Array.isArray(j.info) && j.info) || {};
        const bd = Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path || '';
        this.info = { plot: i.plot || '', cast: i.cast || '', director: i.director || '', genre: i.genre || s.genre || '', rating: parseFloat(i.rating) || s.rating, year: (i.releaseDate || i.release_date || '').slice(0, 4) || yearOf(s), backdrop: bd, poster: i.cover || s.cover, trailer: i.youtube_trailer || '' };
        const raw = (j && j.episodes) || {};
        const groups = Array.isArray(raw) ? groupArray(raw) : raw;
        this.seasons = Object.keys(groups)
          .map((k) => +k)
          .filter((n) => !isNaN(n))
          .sort((a, b) => a - b);
        for (const sn of this.seasons) {
          this.eps[sn] = (groups[sn] || groups[String(sn)] || [])
            .map((e, idx) => ({
              id: String(e.id),
              ext: e.container_extension || 'mp4',
              season: sn,
              episode: +e.episode_num || idx + 1,
              title: cleanEpTitle(e.title, s),
              plot: (e.info && e.info.plot) || '',
              still: (e.info && e.info.movie_image) || '',
              dur: (e.info && +e.info.duration_secs) || 0,
            }))
            .sort((a, b) => a.episode - b.episode);
        }
      } catch (e) {
        this.epBox.innerHTML = '';
        this.epBox.appendChild(h('div.vs-empty', { text: 'Could not load the episodes. Check your connection and try again.' }));
        return;
      }
    } else {
      const sec = Session.catalog.get('series');
      const list = (sec && sec.episodes && sec.episodes.get(s.id)) || [];
      for (const e of list) (this.eps[e.season] || (this.eps[e.season] = [])).push({ id: e.url, url: e.url, extra: e.extra, season: e.season, episode: e.episode, title: e.title, still: e.icon, plot: '', dur: 0 });
      this.seasons = Object.keys(this.eps)
        .map(Number)
        .sort((a, b) => a - b);
      for (const sn of this.seasons) this.eps[sn].sort((a, b) => a.episode - b.episode);
    }
    this.flat = [];
    for (const sn of this.seasons) for (const e of this.eps[sn]) this.flat.push(e);
    if (Nav.top() !== this) return;
    this.paintHead();
    this.paintButtons();
    const r = this.resumeTarget();
    this.seasonBar.innerHTML = '';
    for (const sn of this.seasons) {
      const b = h('button.chip', { type: 'button', text: `Season ${sn}` });
      b.__sn = sn;
      b.addEventListener('click', () => this.showSeason(sn));
      this.seasonBar.appendChild(b);
    }
    this.showSeason(r ? r.ep.season : this.seasons[0]);
  }

  progressKey(ep) {
    return 'e:' + this.item.id + ':' + (ep.id || ep.url);
  }

  resumeTarget() {
    if (!this.flat.length) return null;
    const w = Session.lib.watching().find((x) => x.k === 's:' + this.item.id);
    if (w && w.ep) {
      const ep = this.flat.find((e) => (e.id || e.url) === w.ep.id) || this.flat.find((e) => e.season === w.ep.season && e.episode === w.ep.episode);
      if (ep) {
        const pr = Session.lib.progress(this.progressKey(ep));
        return { ep, pos: pr && !pr.done ? pr.pos : 0, started: true };
      }
    }
    return { ep: this.flat[0], pos: 0, started: false };
  }

  paintButtons() {
    this.btns.innerHTML = '';
    const r = this.resumeTarget();
    if (r) this.btns.append(this.button(`${r.pos ? 'Resume' : 'Play'} S${r.ep.season} E${r.ep.episode}`, 'play', () => this.play(r.ep, r.pos), true));
    this.btns.append(this.favButton());
    if (this.info.trailer) this.btns.append(this.button('Trailer', 'film', () => trailer(this.info.trailer)));
  }

  showSeason(sn) {
    if (sn == null) return;
    this.season = sn;
    for (const b of this.seasonBar.children) b.classList.toggle('on', b.__sn === sn);
    this.epBox.innerHTML = '';
    const list = this.eps[sn] || [];
    if (!list.length) this.epBox.appendChild(h('div.vs-empty', { text: 'No episodes available yet.' }));
    for (const ep of list) {
      const pr = Session.lib.progress(this.progressKey(ep));
      const still = art('still');
      setArt(still, ep.still || this.item.cover, `E${ep.episode}`, 320, 0);
      const bar = progressBar('ep-bar');
      if (pr && pr.dur) setProgress(bar, pr.done ? 1 : pr.pos / pr.dur);
      bar.style.display = pr ? '' : 'none';
      const row = h(
        'button.ep',
        { type: 'button' },
        h('div.ep-art', null, still, bar),
        h('div.ep-text', null, h('div.ep-title.bidi', null, h('b', { text: `E${ep.episode}` }), ' ', ep.title || `Episode ${ep.episode}`), ep.plot ? h('div.ep-plot.bidi', { text: ep.plot }) : null, ep.dur ? h('div.ep-dur', { text: fmtLength(ep.dur) }) : null)
      );
      row.addEventListener('click', () => this.play(ep, pr && !pr.done ? pr.pos : 0));
      this.epBox.appendChild(row);
    }
  }

  play(ep, start) {
    if (useExternal('vod')) return openExternal(episodeSource(Session.pl, ep), `${cleanTitle(this.item.name)} S${ep.season} E${ep.episode}`, start);
    Nav.push(new PlayerPage({ mode: 'episode', series: this.item, ep, episodes: this.flat, start: start || 0 }));
  }
}
