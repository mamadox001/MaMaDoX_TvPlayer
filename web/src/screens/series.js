// Series details: story, seasons and episodes, resume where you left off.
import { h, cleanTitle, yearOf, fmtLength, esc } from '../util.js';
import { App, Screen } from '../ui/app.js';
import { VList } from '../ui/list.js';
import { icon, art, setArt, button, setButton, progressBar, setProgress } from '../ui/widgets.js';
import { Session } from '../data/session.js';
import * as X from '../data/xtream.js';
import { imgUrl, Native } from '../native.js';
import { watch } from './player.js';

export class SeriesScreen extends Screen {
  constructor(opts) {
    super('details.series-dt');
    this.opts = opts || {};
    this.zone = 'btns';
    this.bi = 0;
    this.si = 0;
    this.seasons = [];
    this.eps = {};
  }

  build() {
    this.backdrop = h('div.dt-backdrop', null, h('img.dt-bg', { alt: '' }));
    this.title = h('h2.dt-title.bidi');
    this.meta = h('div.dt-meta');
    this.plot = h('p.dt-plot.bidi');
    this.btnBox = h('div.dt-btns');
    this.seasonBar = h('div.season-bar');
    this.epList = new VList({
      rowH: 156,
      height: Math.max(312, App.height - 640),
      margin: 1,
      cls: 'ep-list',
      create: () => h('div.eprow', null, art('ep-still'), h('div.ep-text', null, h('div.ep-head', null, h('span.ep-num'), h('span.ep-title.bidi')), h('div.ep-plot.bidi'), h('div.ep-foot', null, h('span.ep-dur'), progressBar('pbar-signal.ep-prog')))),
      bind: (el, i) => this.bindEp(el, i),
    });
    this.lower = h('div.dt-lower', null, this.seasonBar, this.epList.el);
    this.el.append(this.backdrop, h('div.dt-shade'), h('div.dt-body', null, this.title, this.meta, this.plot, this.btnBox), this.lower);
  }

  async enter(params, back) {
    const sec = await Session.catalog.ensure('series');
    this.item = sec.byId.get(this.opts.id);
    if (!this.item) {
      App.toast('This series is no longer in the playlist');
      App.pop();
      return;
    }
    if (!back) {
      this.renderHead();
      await this.load();
      if (this.opts.play && this.flat.length) {
        const r = this.resumeTarget();
        if (r) this.playEp(r.ep, r.pos);
      }
    } else {
      this.buildButtons();
      this.epList.refresh();
      // jump to the episode that was just watched
      const r = this.resumeTarget();
      if (r) this.selectEpisode(r.ep);
    }
  }

  async load() {
    const pl = Session.pl;
    const s = this.item;
    this.info = {};
    if (pl.type === 'xtream') {
      try {
        const j = await X.seriesInfo(pl, s.id);
        const i = (j && j.info && !Array.isArray(j.info) && j.info) || {};
        const bd = Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path || '';
        this.info = { plot: i.plot || '', cast: i.cast || '', director: i.director || '', genre: i.genre || s.genre || '', rating: parseFloat(i.rating) || s.rating, year: (i.releaseDate || i.release_date || '').slice(0, 4) || yearOf(s), backdrop: bd, cover: i.cover || s.cover, trailer: i.youtube_trailer || '', runtime: +i.episode_run_time || 0 };
        const epsRaw = (j && j.episodes) || {};
        const groups = Array.isArray(epsRaw) ? groupArray(epsRaw) : epsRaw;
        const seasonInfo = {};
        for (const se of (j && j.seasons) || []) seasonInfo[se.season_number] = se;
        this.seasons = Object.keys(groups)
          .map((k) => +k)
          .filter((n) => !isNaN(n))
          .sort((a, b) => a - b);
        this.eps = {};
        for (const sn of this.seasons) {
          this.eps[sn] = (groups[sn] || groups[String(sn)] || []).map((e, idx) => ({
            id: String(e.id),
            ext: e.container_extension || 'mp4',
            season: sn,
            episode: +e.episode_num || idx + 1,
            title: cleanEpTitle(e.title, s, sn, +e.episode_num || idx + 1),
            plot: (e.info && e.info.plot) || '',
            still: (e.info && e.info.movie_image) || '',
            dur: (e.info && (+e.info.duration_secs || 0)) || 0,
            info: e.info || {},
          })).sort((a, b) => a.episode - b.episode);
        }
        this.seasonNames = {};
        for (const sn of this.seasons) this.seasonNames[sn] = (seasonInfo[sn] && seasonInfo[sn].name) || `Season ${sn}`;
      } catch (e) {
        this.plot.textContent = 'Could not load the episodes. Check your connection and try again.';
      }
    } else {
      const sec = Session.catalog.get('series');
      const list = (sec.episodes && sec.episodes.get(s.id)) || [];
      this.eps = {};
      for (const e of list) (this.eps[e.season] || (this.eps[e.season] = [])).push({ id: e.url, url: e.url, extra: e.extra, season: e.season, episode: e.episode, title: e.title, still: e.icon, plot: '', dur: 0 });
      this.seasons = Object.keys(this.eps)
        .map(Number)
        .sort((a, b) => a - b);
      for (const sn of this.seasons) this.eps[sn].sort((a, b) => a.episode - b.episode);
      this.seasonNames = {};
      for (const sn of this.seasons) this.seasonNames[sn] = `Season ${sn}`;
    }
    this.flat = [];
    for (const sn of this.seasons) for (const e of this.eps[sn]) this.flat.push(e);
    if (App.top() !== this) return;
    this.renderHead();
    const r = this.resumeTarget();
    this.si = r ? Math.max(0, this.seasons.indexOf(r.ep.season)) : 0;
    this.renderSeasons();
    this.showSeason(r ? this.eps[r.ep.season].indexOf(r.ep) : 0);
    this.buildButtons();
  }

  renderHead() {
    const s = this.item;
    const inf = this.info || {};
    this.title.textContent = cleanTitle(s.name);
    const bits = [];
    const y = inf.year || yearOf(s);
    if (y) bits.push(`<span class="mt-year">${esc(y)}</span>`);
    if (this.seasons.length) bits.push(`<span class="mt-text">${this.seasons.length} season${this.seasons.length === 1 ? '' : 's'}</span>`);
    const r = inf.rating || s.rating;
    if (r) bits.push(`<span class="mt-rate">${icon('starOn').outerHTML}${(+r).toFixed(1)}</span>`);
    const g = inf.genre || s.genre;
    if (g) g.split(/\s*[,/|]\s*/).slice(0, 3).forEach((x) => x && bits.push(`<span class="mt-chip">${esc(x)}</span>`));
    this.meta.innerHTML = bits.join('');
    this.plot.textContent = inf.plot || '';
    const img = this.backdrop.firstChild;
    const url = imgUrl(inf.backdrop || inf.cover || s.cover, 1280);
    if (url && img.__src !== url) {
      img.__src = url;
      img.onload = () => this.backdrop.classList.add('loaded');
      img.src = url;
    }
    this.el.classList.toggle('poster-bg', !inf.backdrop);
  }

  renderSeasons() {
    this.seasonBar.innerHTML = '';
    this.seasonEls = this.seasons.map((sn) => {
      const e = h('div.season', { text: this.seasonNames[sn] });
      this.seasonBar.appendChild(e);
      return e;
    });
    if (!this.seasons.length) this.seasonBar.appendChild(h('div.season-empty', { text: 'No episodes available yet.' }));
  }

  showSeason(index) {
    const sn = this.seasons[this.si];
    this.list = sn != null ? this.eps[sn] : [];
    this.epList.setCount(this.list.length, Math.max(0, index || 0));
    this.paint();
  }

  selectEpisode(ep) {
    const si = this.seasons.indexOf(ep.season);
    if (si < 0) return;
    if (si !== this.si) {
      this.si = si;
      this.showSeason(this.eps[ep.season].indexOf(ep));
    } else this.epList.setIndex(this.eps[ep.season].indexOf(ep), false);
  }

  progressKey(ep) {
    return 'e:' + this.item.id + ':' + (ep.id || ep.url);
  }

  bindEp(el, i) {
    const ep = this.list[i];
    if (!ep) return;
    setArt(el.children[0], ep.still || (this.info && this.info.cover) || this.item.cover, `E${ep.episode}`, 256, 80);
    const t = el.children[1];
    t.children[0].children[0].textContent = `E${ep.episode}`;
    t.children[0].children[1].textContent = ep.title || `Episode ${ep.episode}`;
    t.children[1].textContent = ep.plot || '';
    const dur = ep.dur || (this.info && this.info.runtime ? this.info.runtime * 60 : 0);
    t.children[2].children[0].textContent = dur ? fmtLength(dur) : '';
    const pr = Session.lib.progress(this.progressKey(ep));
    const bar = t.children[2].children[1];
    if (pr && (pr.pos || pr.done)) {
      setProgress(bar, pr.done ? 1 : pr.pos / pr.dur);
      bar.style.display = '';
    } else bar.style.display = 'none';
    el.classList.toggle('is-watched', !!(pr && pr.done));
  }

  /** The episode to continue with and where. */
  resumeTarget() {
    if (!this.flat || !this.flat.length) return null;
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

  buildButtons() {
    const r = this.resumeTarget();
    const fav = Session.lib.isFav('series', this.item.id);
    this.btns = [];
    if (r) this.btns.push({ id: 'play', label: `${r.started ? (r.pos ? 'Resume' : 'Play') : 'Play'} S${r.ep.season} E${r.ep.episode}`, icon: 'play' });
    if (this.info && this.info.trailer) this.btns.push({ id: 'trailer', label: 'Trailer', icon: 'film' });
    this.btns.push({ id: 'fav', label: fav ? 'In favorites' : 'Add to favorites', icon: fav ? 'starOn' : 'star' });
    this.btnBox.innerHTML = '';
    this.btnEls = this.btns.map((b) => {
      const e = button(b.label, b.icon);
      this.btnBox.appendChild(e);
      return e;
    });
    this.bi = Math.min(this.bi, this.btns.length - 1);
    this.paint();
  }

  paint() {
    if (this.btnEls) this.btnEls.forEach((b, i) => b.classList.toggle('is-focused', this.zone === 'btns' && i === this.bi));
    if (this.seasonEls) this.seasonEls.forEach((e, i) => {
      e.classList.toggle('is-current', i === this.si);
      e.classList.toggle('is-focused', this.zone === 'seasons' && i === this.si);
    });
    this.epList.setActive(this.zone === 'eps');
    this.el.classList.toggle('lower-mode', this.zone !== 'btns');
  }

  playEp(ep, start) {
    watch({ mode: 'episode', series: this.item, ep, start: start || 0, episodes: this.flat });
  }

  act(id) {
    if (id === 'play') {
      const r = this.resumeTarget();
      if (r) this.playEp(r.ep, r.pos);
    } else if (id === 'trailer') {
      const t = this.info.trailer;
      if (!Native.openUrl(/^https?:/.test(t) ? t : 'https://www.youtube.com/watch?v=' + t)) App.toast('Install YouTube to watch trailers');
    } else if (id === 'fav') {
      const on = Session.lib.toggleFav('series', this.item.id);
      App.toast(on ? 'Added to favorites' : 'Removed from favorites');
      const i = this.btns.findIndex((b) => b.id === 'fav');
      setButton(this.btnEls[i], on ? 'In favorites' : 'Add to favorites', on ? 'starOn' : 'star');
      this.paint();
    }
  }

  key(ev) {
    const k = ev.key;
    if (this.zone === 'btns') {
      if (k === 'left') this.bi = Math.max(0, this.bi - 1);
      else if (k === 'right') this.bi = Math.min(this.btns.length - 1, this.bi + 1);
      else if (k === 'down') {
        if (this.seasons.length) this.zone = this.seasons.length > 1 ? 'seasons' : 'eps';
      } else if (k === 'ok') return this.act(this.btns[this.bi].id), true;
      else if (k === 'up') return true;
      else return false;
      this.paint();
      return true;
    }
    if (this.zone === 'seasons') {
      if (k === 'left' && this.si > 0) {
        this.si--;
        this.showSeason(0);
      } else if (k === 'right' && this.si < this.seasons.length - 1) {
        this.si++;
        this.showSeason(0);
      } else if (k === 'down' || k === 'ok') this.zone = 'eps';
      else if (k === 'up') this.zone = 'btns';
      else if (k === 'left' || k === 'right') return true;
      else return false;
      this.paint();
      return true;
    }
    if (this.zone === 'eps') {
      const l = this.epList;
      if (k === 'up') {
        if (!l.move(-1)) this.zone = this.seasons.length > 1 ? 'seasons' : 'btns';
      } else if (k === 'down') l.move(1);
      else if (k === 'left') {
        if (this.si > 0) {
          this.si--;
          this.showSeason(0);
        }
      } else if (k === 'right') {
        if (this.si < this.seasons.length - 1) {
          this.si++;
          this.showSeason(0);
        }
      } else if (k === 'ok') {
        const ep = this.list[l.index];
        if (ep) {
          const pr = Session.lib.progress(this.progressKey(ep));
          this.playEp(ep, pr && !pr.done ? pr.pos : 0);
        }
        return true;
      } else return false;
      this.paint();
      return true;
    }
    return false;
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

/** "Show - S01E02 - The Return" -> "The Return" */
function cleanEpTitle(t, s, sn, en) {
  if (!t) return '';
  let x = String(t);
  const m = /S\d{1,3}\s*E\d{1,4}\s*[-:.]?\s*(.*)$/i.exec(x);
  if (m) x = m[1];
  x = x.replace(new RegExp('^' + cleanTitle(s.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-:]?\\s*', 'i'), '').trim();
  if (!x || /^episode\s*\d+$/i.test(x)) return '';
  return x;
}
