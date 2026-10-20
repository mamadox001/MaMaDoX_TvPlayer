// Movies or series: categories on the left, a poster wall on the right.
import { h, plural, cleanTitle, yearOf, fmtCount } from '../util.js';
import { App, Screen } from '../ui/app.js';
import { VList, VGrid } from '../ui/list.js';
import { icon, iconSvg, art, setArt, topbar, progressBar, setProgress } from '../ui/widgets.js';
import { Menu, pick } from '../ui/dialogs.js';
import { Session, bus } from '../data/session.js';
import { settings } from '../store.js';
import { isLocked, unlock, itemLocked } from './access.js';
import { go } from './nav.js';

const STAR = iconSvg('starOn');

const SORTS = [
  { value: 'server', label: 'As listed by the provider' },
  { value: 'name', label: 'Name, A to Z' },
  { value: 'new', label: 'Newest first' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'year', label: 'Release year' },
];

export class BrowseScreen extends Screen {
  constructor(opts) {
    super('browse');
    this.kind = opts.kind === 'series' ? 'series' : 'vod';
    this.zone = 'grid';
    this.ci = 0;
    this.cats = [];
    this.items = [];
    this.sort = 'server';
  }

  get label() {
    return this.kind === 'vod' ? 'Movies' : 'Series';
  }

  build() {
    this.bar = topbar(this.label, '');
    this.el.append(this.bar);
    const H = App.height - 200;
    this.catList = new VList({
      rowH: 68,
      height: H,
      cls: 'br-cats',
      create: () => h('div.crow', null, h('span.crow-ic'), h('span.crow-name.bidi'), h('span.crow-n')),
      bind: (el, i) => {
        const c = this.cats[i];
        const locked = c.cat && isLocked(c.cat);
        const ic = el.children[0];
        ic.innerHTML = '';
        if (c.icon || locked) ic.appendChild(icon(locked ? 'lock' : c.icon));
        el.children[1].textContent = c.name;
        el.children[2].textContent = locked ? '' : c.count != null ? String(c.count) : '';
        el.classList.toggle('is-current', i === this.ci);
        el.classList.toggle('is-locked', !!locked);
      },
      onFocus: (i) => this.onCatFocus(i),
    });
    this.iTitle = h('div.br-title.bidi');
    this.iMeta = h('div.br-meta');
    this.info = h('div.br-info', null, this.iTitle, this.iMeta);
    this.grid = new VGrid({
      cols: 7,
      cellW: 196,
      cellH: 334,
      height: App.height - 300,
      cls: 'br-grid',
      create: () => h('div.pcard', null, art('poster-art'), h('div.pcard-rate'), progressBar('pbar-signal.pcard-prog'), h('div.pcard-title.ellip.bidi')),
      bind: (el, i) => this.bindCard(el, i),
      onFocus: (i) => this.paintInfo(i),
    });
    this.empty = h('div.br-empty');
    this.el.append(h('div.br-body', null, h('div.br-left', null, this.catList.el), h('div.br-right', null, this.info, this.grid.el, this.empty)));
    this.offs = [bus.on('synced', (s) => s.indexOf(this.kind) >= 0 && this.load())];
  }

  destroy() {
    for (const f of this.offs) f();
    clearTimeout(this.catTimer);
    super.destroy();
  }

  async enter(params, back) {
    if (!back || !this.sec) await this.load();
    else {
      this.grid.refresh();
      this.catList.refresh();
    }
    this.paint();
  }

  async load() {
    this.bar.setSub('Loading');
    this.sec = await Session.catalog.ensure(this.kind);
    this.buildCats();
    const last = Session.lib.lastCat(this.kind);
    let ci = last ? this.cats.findIndex((c) => c.id === last) : -1;
    if (ci < 0 || (this.cats[ci].cat && isLocked(this.cats[ci].cat))) ci = 0;
    this.ci = ci;
    this.catList.setCount(this.cats.length, ci);
    this.setItems(0);
    if (!this.sec.items.length) {
      this.zone = 'cats';
      this.empty.textContent = this.kind === 'vod' ? 'This playlist has no movies.' : 'This playlist has no series.';
      this.empty.classList.add('show');
    }
    this.paint();
  }

  buildCats() {
    const sec = this.sec;
    const lib = Session.lib;
    const hidden = new Set(lib.d.hidden[this.kind]);
    const visible = (it) => !hidden.has(it.cat) && !itemLocked(it);
    const cats = [];
    const all = sec.items.filter(visible);
    cats.push({ id: '__all', name: this.kind === 'vod' ? 'All movies' : 'All series', icon: this.kind === 'vod' ? 'film' : 'series', list: all, count: all.length });
    const rec = sec.recent(300).filter(visible);
    if (rec.length) cats.push({ id: '__new', name: this.kind === 'vod' ? 'Recently added' : 'Recently updated', icon: 'history', list: rec, count: rec.length, keepOrder: true });
    const fav = lib.favs(this.kind).map((id) => sec.byId.get(id)).filter(Boolean);
    cats.push({ id: '__fav', name: 'Favorites', icon: 'starOn', list: fav, count: fav.length, keepOrder: true, special: 'fav' });
    const watching = lib.watching().filter((w) => w.type === this.kind).map((w) => sec.byId.get(w.id)).filter(Boolean);
    if (watching.length) cats.push({ id: '__cw', name: 'Continue watching', icon: 'play', list: watching, count: watching.length, keepOrder: true });
    const hideEmpty = settings().hideEmptyCats;
    for (const c of sec.cats) {
      if (hidden.has(c.id) || (hideEmpty && !c.items.length)) continue;
      cats.push({
        id: c.id,
        name: c.name,
        cat: c,
        count: c.items.length,
        get list() {
          if (!this._l) this._l = c.items.map((i) => sec.items[i]);
          return this._l;
        },
      });
    }
    this.cats = cats;
  }

  setItems(index) {
    const c = this.cats[this.ci];
    const locked = c.cat && isLocked(c.cat);
    let list = locked ? [] : c.list;
    if (!c.keepOrder && this.sort !== 'server') list = sorted(list, this.sort, this.kind);
    this.items = list;
    this.grid.setCount(list.length, index || 0);
    this.empty.classList.toggle('show', !list.length);
    if (locked) this.empty.innerHTML = '<b>This category is locked.</b><br>Press OK to enter your PIN.';
    else if (!list.length) this.empty.textContent = c.special === 'fav' ? 'No favorites yet. Long-press OK on a poster to add it.' : 'Nothing in this category.';
    this.bar.setSub(`${c.name}${locked ? '' : ', ' + fmtCount(list.length)}${this.sort !== 'server' && !c.keepOrder ? ', ' + SORTS.find((s) => s.value === this.sort).label.toLowerCase() : ''}`);
    this.paintInfo(this.grid.index);
  }

  onCatFocus(i) {
    if (this.zone !== 'cats' || i === this.ci) return;
    const old = this.ci;
    this.ci = i;
    this.catList.refreshRow(old);
    this.catList.refreshRow(i);
    clearTimeout(this.catTimer);
    this.catTimer = setTimeout(() => this.flushCat(), 150);
  }

  flushCat() {
    if (!this.catTimer) return;
    clearTimeout(this.catTimer);
    this.catTimer = 0;
    this.setItems(0);
  }

  bindCard(el, i) {
    const it = this.items[i];
    if (!it) return;
    const name = cleanTitle(it.name);
    setArt(el.children[0], it.icon || it.cover, name, 172, 90);
    const r = el.children[1];
    r.textContent = it.rating ? it.rating.toFixed(1) : '';
    r.style.display = it.rating ? '' : 'none';
    const key = this.kind === 'vod' ? 'm:' + it.id : null;
    const pr = key ? Session.lib.progress(key) : null;
    const bar = el.children[2];
    if (pr && pr.pos && pr.dur) {
      setProgress(bar, pr.pos / pr.dur);
      bar.style.display = '';
    } else bar.style.display = 'none';
    el.children[3].textContent = name;
    el.classList.toggle('is-fav', Session.lib.isFav(this.kind, it.id));
  }

  paintInfo(i) {
    const it = this.items[i];
    if (!it) {
      this.iTitle.textContent = '';
      this.iMeta.innerHTML = '';
      return;
    }
    this.iTitle.textContent = cleanTitle(it.name);
    const bits = [];
    const y = yearOf(it);
    if (y) bits.push(`<span class="mt-year">${y}</span>`);
    if (it.rating) bits.push(`<span class="mt-rate"><span class="ico">${STAR}</span>${it.rating.toFixed(1)}</span>`);
    if (it.genre) bits.push(`<span class="mt-text">${escapeHtml(it.genre)}</span>`);
    if (Session.lib.isFav(this.kind, it.id)) bits.push(`<span class="mt-fav"><span class="ico">${STAR}</span>Favorite</span>`);
    const html = bits.join('');
    if (html !== this._meta) {
      this._meta = html;
      this.iMeta.innerHTML = html;
    }
  }

  paint() {
    this.catList.setActive(this.zone === 'cats');
    this.grid.setActive(this.zone === 'grid');
  }

  open(it) {
    if (!it) return;
    if (this.kind === 'vod') go('movie', { id: it.id });
    else go('seriesInfo', { id: it.id });
  }

  itemMenu(it) {
    const lib = Session.lib;
    const fav = lib.isFav(this.kind, it.id);
    const items = [
      { label: 'Open details', icon: 'info', action: () => this.open(it) },
      { label: fav ? 'Remove from favorites' : 'Add to favorites', icon: fav ? 'starOn' : 'star', action: () => {
        lib.toggleFav(this.kind, it.id);
        if (this.cats[this.ci].special === 'fav') {
          this.buildCats();
          this.setItems(Math.min(this.grid.index, this.cats[this.ci].list.length - 1));
        } else this.grid.refresh();
        this.paintInfo(this.grid.index);
      } },
      { label: 'Sort', value: SORTS.find((s) => s.value === this.sort).label, icon: 'list', action: () => this.sortMenu() },
    ];
    new Menu(cleanTitle(it.name), items).open();
  }

  sortMenu() {
    pick('Sort', SORTS, this.sort).then((v) => {
      if (!v || v === this.sort) return;
      this.sort = v;
      this.setItems(0);
    });
  }

  async enterCat() {
    this.flushCat();
    const c = this.cats[this.ci];
    if (c.cat && isLocked(c.cat)) {
      if (!(await unlock())) return;
      this.buildCats();
      this.catList.refresh();
      this.setItems(0);
    }
    if (this.items.length) {
      this.zone = 'grid';
      Session.lib.setLastCat(this.kind, c.id);
      this.paint();
    }
  }

  key(ev) {
    const k = ev.key;
    if (this.zone === 'cats') {
      const l = this.catList;
      if (k === 'up') l.move(-1);
      else if (k === 'down') l.move(1);
      else if (k === 'pgup' || k === 'chup') l.page(-1);
      else if (k === 'pgdown' || k === 'chdown') l.page(1);
      else if (k === 'right' || k === 'ok') this.enterCat();
      else if (k === 'menu') this.sortMenu();
      else return false;
      return true;
    }
    const g = this.grid;
    if (k === 'left') {
      if (!g.move(-1, 0)) {
        this.zone = 'cats';
        this.paint();
      }
    } else if (k === 'right') g.move(1, 0);
    else if (k === 'up') g.move(0, -1);
    else if (k === 'down') g.move(0, 1);
    else if (k === 'pgup' || k === 'chup') g.page(-1);
    else if (k === 'pgdown' || k === 'chdown') g.page(1);
    else if (k === 'ok') this.open(this.items[g.index]);
    else if (k === 'okLong' || k === 'menu') {
      const it = this.items[g.index];
      if (it) this.itemMenu(it);
    } else return false;
    return true;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function sorted(list, sort, kind) {
  const a = list.slice();
  if (sort === 'name') {
    a.forEach((it) => {
      if (it._sn === undefined) it._sn = cleanTitle(it.name).toLowerCase().replace(/^(the|a|an|le|la|les|el|los)\s+/, '');
    });
    a.sort((x, y) => (x._sn < y._sn ? -1 : x._sn > y._sn ? 1 : 0));
  } else if (sort === 'new') {
    const k = kind === 'vod' ? 'added' : 'modified';
    a.sort((x, y) => (y[k] || 0) - (x[k] || 0));
  } else if (sort === 'rating') a.sort((x, y) => (y.rating || 0) - (x.rating || 0));
  else if (sort === 'year') a.sort((x, y) => (+yearOf(y) || 0) - (+yearOf(x) || 0));
  return a;
}

