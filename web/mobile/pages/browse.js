// Movies or series on the phone: categories as chips over a poster grid.
import { h, cleanTitle, yearOf } from '../../src/util.js';
import { art, setArt, icon, progressBar, setProgress } from '../../src/ui/widgets.js';
import { Session, bus } from '../../src/data/session.js';
import { settings } from '../../src/store.js';
import { Page, Nav, VScroll, chips, sheet, toast, ibtn } from '../ui.js';
import { isLocked, itemLocked, unlock } from '../access.js';
import { MoviePage, SeriesPage } from './details.js';

const SORTS = [
  ['default', 'Server order'],
  ['new', 'Newest first'],
  ['az', 'A to Z'],
  ['rating', 'Top rated'],
];

export class BrowsePage extends Page {
  /** kind: 'vod' | 'series' */
  constructor(kind) {
    super('browse');
    this.kind = kind;
    this.cats = [];
    this.catId = null;
    this.list = [];
    this.sort = 'default';
  }

  build() {
    const title = this.kind === 'vod' ? 'Movies' : 'Series';
    this.count = h('span.hd-count');
    this.el.append(h('header.hd', null, h('h1', { text: title }), this.count, ibtn('list', null, () => this.sortMenu())));
    this.chips = chips((id) => this.pick(id));
    this.vs = new VScroll({
      cls: 'grid',
      cols: (w) => Math.max(3, Math.floor(w / (window.__desktop ? 170 : 128))),
      rowH: (cw) => cw * 1.5 + 44,
      gap: 10,
      pad: 12,
      create: () => h('div.pcard', null, art('poster'), progressBar('pc-bar'), h('span.pc-rate'), h('div.pc-title.bidi')),
      bind: (el, i) => this.bindCard(el, i),
      onTap: (i) => this.open(this.list[i]),
      onHold: (i) => this.menu(this.list[i]),
    });
    this.el.append(this.chips.el, this.vs.el);
    this.offs = [bus.on('synced', (s) => s.indexOf(this.kind) >= 0 && this.reload())];
  }

  async reload() {
    const sec = await Session.catalog.ensure(this.kind);
    this.sec = sec;
    const lib = Session.lib;
    const hidden = new Set(lib.d.hidden[this.kind]);
    const type = this.kind;
    const cats = [];
    const lazy = (o, fn) => Object.defineProperty(o, 'list', { get() { return this._l || (this._l = fn()); } });
    cats.push(lazy({ id: '__all', name: 'All' }, () => sec.items.filter((it) => !hidden.has(it.cat) && !itemLocked(it))));
    cats.push(lazy({ id: '__new', name: 'Recently added', keepOrder: true }, () => sec.recent(300).filter((it) => !itemLocked(it))));
    cats.push(lazy({ id: '__fav', name: 'Favorites', special: 'fav', keepOrder: true }, () => lib.favs(type).map((id) => sec.byId.get(id)).filter((it) => it && !itemLocked(it))));
    cats.push(
      lazy({ id: '__cont', name: 'Continue watching', special: 'cont', keepOrder: true }, () =>
        lib
          .watching()
          .filter((w) => w.type === type)
          .map((w) => sec.byId.get(w.id))
          .filter(Boolean)
      )
    );
    for (const c of sec.cats) {
      if (hidden.has(c.id) || (settings().hideEmptyCats && !c.items.length)) continue;
      cats.push(lazy({ id: c.id, name: c.name, cat: c }, () => c.items.map((i) => sec.items[i])));
    }
    this.cats = cats;
    const last = lib.lastCat(this.kind);
    if (!this.catId) this.catId = cats.some((c) => c.id === last && !(c.cat && isLocked(c.cat))) ? last : '__all';
    this.paintCats();
    this.show(this.catId, true);
  }

  paintCats() {
    this.chips.set(
      this.cats.map((c) => ({ id: c.id, label: c.name, lock: !!(c.cat && isLocked(c.cat)) })),
      this.catId
    );
  }

  async pick(id) {
    const c = this.cats.find((x) => x.id === id);
    if (!c) return;
    if (c.cat && isLocked(c.cat)) {
      if (!(await unlock())) return;
      for (const x of this.cats) x._l = null;
      this.paintCats();
    }
    this.show(id);
  }

  show(id, keep) {
    const c = this.cats.find((x) => x.id === id) || this.cats[0];
    if (!c) return;
    this.catId = c.id;
    this.chips.select(c.id);
    Session.lib.setLastCat(this.kind, c.id);
    if (c.special) c._l = null;
    let list = c.list;
    if (!c.keepOrder && this.sort !== 'default') {
      list = list.slice();
      const key = this.kind === 'vod' ? 'added' : 'modified';
      if (this.sort === 'new') list.sort((a, b) => (b[key] || 0) - (a[key] || 0));
      else if (this.sort === 'az') list.sort((a, b) => cleanTitle(a.name).localeCompare(cleanTitle(b.name)));
      else if (this.sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }
    this.list = list;
    this.count.textContent = list.length ? String(list.length) : '';
    this.vs.setEmpty(c.special === 'fav' ? 'No favorites yet. Touch and hold a poster to add it.' : c.special === 'cont' ? 'What you start watching appears here.' : 'Nothing in this category.');
    this.vs.setCount(list.length, keep);
  }

  enter(back) {
    if (!this.cats.length) this.reload();
    else if (back !== false) {
      const c = this.cats.find((x) => x.id === this.catId);
      if (c && c.special) this.show(c.id, true);
      else this.vs.refresh();
    } else this.vs.refresh();
  }

  resize() {
    this.vs.setCount(this.list.length, true);
  }

  bindCard(el, i) {
    const it = this.list[i];
    if (!it) return;
    const name = cleanTitle(it.name);
    setArt(el.children[0], it.icon || it.cover, name, Math.round(this.vs.colW * 2), 40);
    const p = this.kind === 'vod' ? Session.lib.progress('m:' + it.id) : null;
    el.children[1].style.display = p && !p.done && p.pos ? '' : 'none';
    if (p && p.dur) setProgress(el.children[1], p.pos / p.dur);
    el.children[2].textContent = it.rating ? it.rating.toFixed(1) : '';
    el.children[2].style.display = it.rating ? '' : 'none';
    el.children[3].textContent = name;
    el.classList.toggle('is-fav', Session.lib.isFav(this.kind, it.id));
  }

  open(it) {
    if (!it) return;
    Nav.push(this.kind === 'vod' ? new MoviePage(it) : new SeriesPage(it));
  }

  menu(it) {
    if (!it) return;
    const fav = Session.lib.isFav(this.kind, it.id);
    sheet(cleanTitle(it.name), [
      { label: 'Open', icon: 'info', action: () => this.open(it) },
      {
        label: fav ? 'Remove from favorites' : 'Add to favorites',
        icon: fav ? 'star' : 'starOn',
        action: () => {
          toast(Session.lib.toggleFav(this.kind, it.id) ? 'Added to favorites' : 'Removed from favorites');
          const c = this.cats.find((x) => x.id === this.catId);
          if (c && c.special === 'fav') this.show(c.id, true);
          else this.vs.refresh();
        },
      },
    ]);
  }

  sortMenu() {
    sheet(
      'Sort',
      SORTS.map(([id, label]) => ({
        label,
        on: this.sort === id,
        action: () => {
          this.sort = id;
          this.show(this.catId);
        },
      }))
    );
  }

  destroy() {
    this.offs.forEach((f) => f());
  }
}

export { yearOf, icon };
