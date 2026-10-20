// In-memory catalogue for the active playlist, loaded from the compact files the
// native sync jobs write (see android/core/*Sync.java for the format).
import { fileUrl } from '../native.js';
import { norm } from '../util.js';

export const ADULT_RE = /(^|[^a-z])(adults?|xxx|18\s*\+|\+\s*18|porn\w*|erotic\w*|sexy?)([^a-z]|$)/i;

export class Section {
  constructor(kind) {
    this.kind = kind;
    this.cats = [];
    this.items = [];
    this.byId = new Map();
    this.catById = new Map();
    this.episodes = null;
    this.loaded = false;
    this.stamp = 0;
  }
  /** Most recently added (movies) or updated (series). */
  recent(limit) {
    const key = this.kind === 'vod' ? 'added' : 'modified';
    if (!this._recent) {
      const withDate = this.items.filter((it) => it[key] > 0);
      withDate.sort((a, b) => b[key] - a[key]);
      this._recent = withDate.slice(0, 300);
    }
    return this._recent.slice(0, limit || 300);
  }
}

function parse(text, sec) {
  const cats = new Map();
  const order = [];
  const items = sec.items;
  const episodes = sec.kind === 'series' ? new Map() : null;
  let pos = 0;
  const len = text.length;
  while (pos < len) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = len;
    if (end > pos + 1) {
      const f = text.substring(pos, end).split('\t');
      switch (f[0]) {
        case 'L':
          items.push({ type: 'live', id: f[1], num: f[2], name: f[3] || 'Channel', logo: f[4], cat: f[5], epg: f[6], arch: +f[7] || 0, adult: f[8] === '1', url: f[9] || '', extra: f[10] || '' });
          break;
        case 'M':
          items.push({ type: 'vod', id: f[1], name: f[2] || 'Untitled', icon: f[3], cat: f[4], rating: +f[5] || 0, added: +f[6] || 0, ext: f[7] || '', year: f[8] || '', adult: f[9] === '1', url: f[10] || '', extra: f[11] || '' });
          break;
        case 'S':
          items.push({ type: 'series', id: f[1], name: f[2] || 'Untitled', cover: f[3], cat: f[4], rating: +f[5] || 0, modified: +f[6] || 0, year: f[7] || '', genre: f[8] || '' });
          break;
        case 'E': {
          let l = episodes.get(f[1]);
          if (!l) episodes.set(f[1], (l = []));
          l.push({ season: +f[2] || 1, episode: +f[3] || l.length + 1, title: f[4] || '', url: f[5], icon: f[6] || '', extra: f[7] || '' });
          break;
        }
        case 'C':
          if (!cats.has(f[1])) {
            const c = { id: f[1], name: f[2] || 'Untitled', items: [], adult: ADULT_RE.test(f[2] || '') };
            cats.set(f[1], c);
            order.push(c);
          }
          break;
        case 'H':
          sec.source = f[2];
          sec.stamp = +f[3] || 0;
          break;
      }
    }
    pos = end + 1;
  }
  let unc = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    it.i = i;
    let c = cats.get(it.cat);
    if (!c) {
      if (!unc) unc = { id: '__unc', name: 'Uncategorized', items: [], adult: false };
      c = unc;
      it.cat = unc.id;
    }
    c.items.push(i);
    if (!sec.byId.has(it.id)) sec.byId.set(it.id, it);
  }
  if (unc) {
    cats.set(unc.id, unc);
    order.push(unc);
  }
  for (const c of order) {
    if (!c.adult && c.items.length && items[c.items[0]].adult) {
      let all = true;
      for (const i of c.items) {
        if (!items[i].adult) {
          all = false;
          break;
        }
      }
      c.adult = all;
    }
    if (c.adult) for (const i of c.items) items[i].adult = true;
  }
  sec.cats = order;
  sec.catById = cats;
  sec.episodes = episodes;
}

export async function loadSection(pid, kind) {
  const sec = new Section(kind);
  let res;
  try {
    res = await fetch(fileUrl(`pl/${pid}/${kind}.tsv`), { cache: 'no-store' });
  } catch (e) {
    return sec;
  }
  if (!res.ok) return sec;
  const text = await res.text();
  parse(text, sec);
  sec.loaded = true;
  return sec;
}

export class Catalog {
  constructor(pl) {
    this.pl = pl;
    this.sec = {};
    this.pending = {};
  }
  get(kind) {
    return this.sec[kind] || null;
  }
  ensure(kind) {
    if (this.sec[kind]) return Promise.resolve(this.sec[kind]);
    if (!this.pending[kind]) {
      this.pending[kind] = loadSection(this.pl.id, kind).then((s) => {
        this.sec[kind] = s;
        delete this.pending[kind];
        return s;
      });
    }
    return this.pending[kind];
  }
  invalidate(kind) {
    delete this.sec[kind];
  }
}

/**
 * Searches item names; every word must match. Items whose name starts with the
 * query come first, then word starts, then any position.
 */
export function search(sec, q, limit, allow) {
  const nq = norm(q);
  if (!nq || !sec) return [];
  const words = nq.split(' ');
  const a = [];
  const b = [];
  const c = [];
  const items = sec.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (allow && !allow(it)) continue;
    let k = it.k;
    if (k === undefined) k = it.k = norm(it.name);
    let ok = true;
    for (const w of words) {
      if (k.indexOf(w) < 0) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const p = k.indexOf(words[0]);
    if (p === 0) a.push(it);
    else if (k.charCodeAt(p - 1) === 32) b.push(it);
    else c.push(it);
    if (a.length >= limit) break;
  }
  return a.concat(b, c).slice(0, limit);
}
