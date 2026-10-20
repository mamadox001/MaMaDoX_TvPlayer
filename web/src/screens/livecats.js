// Live TV categories with the built-in ones (all, favourites, recent) first.
import { Session } from '../data/session.js';
import { settings } from '../store.js';
import { itemLocked, isLocked } from './access.js';

export function liveCats(live) {
  const lib = Session.lib;
  const hidden = new Set(lib.d.hidden.live);
  const cats = [];
  cats.push({
    id: '__all',
    name: 'All channels',
    icon: 'tv',
    get list() {
      if (!this._l) this._l = live.items.filter((c) => !hidden.has(c.cat) && !itemLocked(c));
      return this._l;
    },
  });
  cats.push({
    id: '__fav',
    name: 'Favorites',
    icon: 'starOn',
    special: 'fav',
    get list() {
      if (!this._l) this._l = lib.favs('live').map((id) => live.byId.get(id)).filter((c) => c && !itemLocked(c));
      return this._l;
    },
  });
  cats.push({
    id: '__recent',
    name: 'Recently watched',
    icon: 'history',
    special: 'recent',
    get list() {
      if (!this._l) this._l = lib.recent().map((id) => live.byId.get(id)).filter((c) => c && !itemLocked(c));
      return this._l;
    },
  });
  const hideEmpty = settings().hideEmptyCats;
  for (const c of live.cats) {
    if (hidden.has(c.id)) continue;
    if (hideEmpty && !c.items.length) continue;
    cats.push({
      id: c.id,
      name: c.name,
      cat: c,
      adult: c.adult,
      count: c.items.length,
      get list() {
        if (!this._l) this._l = c.items.map((i) => live.items[i]);
        return this._l;
      },
    });
  }
  return cats;
}

export function catCount(c) {
  if (c.count != null) return c.count;
  return c.list.length;
}

export function catLocked(c) {
  return !!c.cat && isLocked(c.cat);
}

/** Where a channel lives: prefers the given category, then its own, then All. */
export function locate(cats, ch, preferId) {
  if (preferId) {
    const ci = cats.findIndex((c) => c.id === preferId);
    if (ci >= 0 && !catLocked(cats[ci])) {
      const i = cats[ci].list.indexOf(ch);
      if (i >= 0) return [ci, i];
    }
  }
  const own = cats.findIndex((c) => c.id === ch.cat);
  if (own >= 0 && !catLocked(cats[own])) {
    const i = cats[own].list.indexOf(ch);
    if (i >= 0) return [own, i];
  }
  const i = cats[0].list.indexOf(ch);
  return [0, Math.max(0, i)];
}
