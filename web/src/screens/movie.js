// Movie details: artwork, story, cast, and play / resume.
import { h, cleanTitle, yearOf, fmtLength, fmtPos, esc } from '../util.js';
import { App, Screen } from '../ui/app.js';
import { icon, art, setArt, button, setButton } from '../ui/widgets.js';
import { Session } from '../data/session.js';
import * as X from '../data/xtream.js';
import { imgUrl, Native } from '../native.js';
import { watch } from './player.js';

export class MovieScreen extends Screen {
  constructor(opts) {
    super('details');
    this.opts = opts || {};
    this.bi = 0;
    this.info = null;
  }

  build() {
    this.backdrop = h('div.dt-backdrop', null, h('img.dt-bg', { alt: '' }));
    this.poster = art('poster-art.dt-poster');
    this.title = h('h2.dt-title.bidi');
    this.meta = h('div.dt-meta');
    this.plot = h('p.dt-plot.bidi');
    this.credits = h('div.dt-credits.bidi');
    this.btnBox = h('div.dt-btns');
    this.el.append(this.backdrop, h('div.dt-shade'), h('div.dt-body', null, this.title, this.meta, this.plot, this.credits, this.btnBox), this.poster);
  }

  async enter(params, back) {
    const vod = await Session.catalog.ensure('vod');
    this.item = vod.byId.get(this.opts.id);
    if (!this.item) {
      App.toast('This movie is no longer in the playlist');
      App.pop();
      return;
    }
    this.render();
    if (!back) {
      this.load();
      if (this.opts.play) {
        const pr = Session.lib.progress('m:' + this.item.id);
        this.play(this.opts.resume && pr ? pr.pos : 0);
      }
    }
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
        country: i.country || '',
        ext: md.container_extension || '',
      };
      if (this.info.ext && !this.item.ext) this.item.ext = this.info.ext;
      if (App.top() === this) this.render();
    } catch (e) {
      /* details are optional */
    }
  }

  render() {
    const it = this.item;
    const inf = this.info || {};
    this.title.textContent = cleanTitle(it.name);
    const bits = [];
    const y = inf.year || yearOf(it);
    if (y) bits.push(`<span class="mt-year">${esc(y)}</span>`);
    if (inf.duration) bits.push(`<span class="mt-text">${fmtLength(inf.duration)}</span>`);
    const r = inf.rating || it.rating;
    if (r) bits.push(`<span class="mt-rate">${icon('starOn').outerHTML}${(+r).toFixed(1)}</span>`);
    if (inf.genre) inf.genre.split(/\s*[,/|]\s*/).slice(0, 3).forEach((g) => g && bits.push(`<span class="mt-chip">${esc(g)}</span>`));
    this.meta.innerHTML = bits.join('');
    this.plot.textContent = inf.plot || (this.info ? '' : Session.pl.type === 'xtream' ? 'Loading details' : '');
    const cr = [];
    if (inf.director) cr.push(`<span class="cr-k">Director</span> ${esc(inf.director)}`);
    if (inf.cast) cr.push(`<span class="cr-k">Cast</span> ${esc(inf.cast.split(',').slice(0, 5).join(','))}`);
    this.credits.innerHTML = cr.join('<br>');
    const bd = inf.backdrop;
    const img = this.backdrop.firstChild;
    const url = imgUrl(bd, 1280);
    if (url && img.__src !== url) {
      img.__src = url;
      img.onload = () => this.backdrop.classList.add('loaded');
      img.src = url;
    }
    this.el.classList.toggle('has-backdrop', !!bd);
    setArt(this.poster, inf.poster || it.icon, cleanTitle(it.name), 360);
    this.buildButtons();
  }

  buildButtons() {
    const pr = Session.lib.progress('m:' + this.item.id);
    const fav = Session.lib.isFav('vod', this.item.id);
    this.btns = [];
    if (pr && pr.pos > 30000 && !pr.done) {
      this.btns.push({ id: 'resume', label: `Resume from ${fmtPos(pr.pos)}`, icon: 'play' });
      this.btns.push({ id: 'start', label: 'Start over', icon: 'restart' });
    } else this.btns.push({ id: 'play', label: pr && pr.done ? 'Watch again' : 'Play', icon: 'play' });
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
    this.btnEls.forEach((b, i) => b.classList.toggle('is-focused', i === this.bi));
  }

  play(start) {
    watch({ mode: 'vod', item: this.item, start: start || 0, info: this.info });
  }

  act(id) {
    const pr = Session.lib.progress('m:' + this.item.id);
    if (id === 'resume') this.play(pr ? pr.pos : 0);
    else if (id === 'start' || id === 'play') this.play(0);
    else if (id === 'trailer') {
      const t = this.info.trailer;
      const ok = Native.openUrl(/^https?:/.test(t) ? t : 'https://www.youtube.com/watch?v=' + t);
      if (!ok) App.toast('Install YouTube to watch trailers');
    } else if (id === 'fav') {
      const on = Session.lib.toggleFav('vod', this.item.id);
      App.toast(on ? 'Added to favorites' : 'Removed from favorites');
      const i = this.btns.findIndex((b) => b.id === 'fav');
      this.btns[i].label = on ? 'In favorites' : 'Add to favorites';
      setButton(this.btnEls[i], this.btns[i].label, on ? 'starOn' : 'star');
      this.paint();
    }
  }

  key(ev) {
    const k = ev.key;
    if (k === 'left') this.bi = Math.max(0, this.bi - 1);
    else if (k === 'right') this.bi = Math.min(this.btns.length - 1, this.bi + 1);
    else if (k === 'ok') return this.act(this.btns[this.bi].id), true;
    else if (k === 'play' || k === 'playpause') return this.act(this.btns[0].id), true;
    else if (k === 'up' || k === 'down') return true;
    else return false;
    this.paint();
    return true;
  }
}

function parseDur(s) {
  const m = /^(\d+):(\d\d)(?::(\d\d))?$/.exec(s || '');
  if (!m) return 0;
  return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
}
