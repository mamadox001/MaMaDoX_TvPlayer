// Per-playlist favourites, recently watched channels, playback progress and
// category visibility.
import { Store } from '../store.js';
import { nowSec } from '../util.js';

const DEF = () => ({
  fav: { live: [], vod: [], series: [] },
  recent: [],
  progress: {},
  watching: [],
  hidden: { live: [], vod: [], series: [] },
  lastChannel: null,
  lastCat: { live: null, vod: null, series: null },
});

export class Library {
  constructor(pid) {
    this.name = 'lib-' + pid;
    this.d = Store.get(this.name, DEF());
    const def = DEF();
    for (const k in def) if (this.d[k] == null) this.d[k] = def[k];
    for (const k of ['live', 'vod', 'series']) {
      if (!this.d.fav[k]) this.d.fav[k] = [];
      if (!this.d.hidden[k]) this.d.hidden[k] = [];
    }
    this._favSets = {};
  }
  save() {
    this._favSets = {};
    Store.set(this.name, this.d);
  }

  // favourites
  favSet(type) {
    return this._favSets[type] || (this._favSets[type] = new Set(this.d.fav[type]));
  }
  isFav(type, id) {
    return this.favSet(type).has(id);
  }
  toggleFav(type, id) {
    const l = this.d.fav[type];
    const i = l.indexOf(id);
    if (i >= 0) l.splice(i, 1);
    else l.unshift(id);
    this.save();
    return i < 0;
  }
  favs(type) {
    return this.d.fav[type];
  }
  moveFav(type, id, delta) {
    const l = this.d.fav[type];
    const i = l.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= l.length) return false;
    l.splice(i, 1);
    l.splice(j, 0, id);
    this.save();
    return true;
  }

  // recently watched channels
  addRecent(id) {
    const r = this.d.recent;
    const i = r.indexOf(id);
    if (i >= 0) r.splice(i, 1);
    r.unshift(id);
    if (r.length > 40) r.length = 40;
    this.d.lastChannel = id;
    this.save();
  }
  recent() {
    return this.d.recent;
  }
  get lastChannel() {
    return this.d.lastChannel;
  }

  // playback progress: key 'm:<id>' (movie) or 'e:<seriesId>:<episodeId>'
  progress(key) {
    return this.d.progress[key] || null;
  }
  setProgress(key, pos, dur, entry) {
    if (!dur || dur < 60000) return;
    const done = pos > dur * 0.93 || dur - pos < 90000;
    this.d.progress[key] = { pos: done ? 0 : Math.floor(pos), dur: Math.floor(dur), done, t: nowSec() };
    // continue watching list
    if (entry) {
      const w = this.d.watching;
      const i = w.findIndex((x) => x.k === entry.k);
      if (i >= 0) w.splice(i, 1);
      if (!done || entry.nextEp) w.unshift(Object.assign({}, entry, { t: nowSec(), pos: done ? 0 : pos, dur, done }));
      if (w.length > 40) w.length = 40;
    }
    // keep the progress map bounded
    const keys = Object.keys(this.d.progress);
    if (keys.length > 1500) {
      keys.sort((a, b) => this.d.progress[a].t - this.d.progress[b].t);
      for (const k of keys.slice(0, keys.length - 1200)) delete this.d.progress[k];
    }
    this.save();
  }
  watching() {
    return this.d.watching;
  }
  removeWatching(k) {
    const w = this.d.watching;
    const i = w.findIndex((x) => x.k === k);
    if (i >= 0) {
      w.splice(i, 1);
      this.save();
    }
  }

  // categories
  isHidden(type, catId) {
    return this.d.hidden[type].indexOf(catId) >= 0;
  }
  setHidden(type, catId, hidden) {
    const l = this.d.hidden[type];
    const i = l.indexOf(catId);
    if (hidden && i < 0) l.push(catId);
    if (!hidden && i >= 0) l.splice(i, 1);
    this.save();
  }
  lastCat(type) {
    return this.d.lastCat[type];
  }
  setLastCat(type, id) {
    if (this.d.lastCat[type] !== id) {
      this.d.lastCat[type] = id;
      this.save();
    }
  }
}
