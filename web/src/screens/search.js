// Search across channels, movies and series as you type (or speak).
import { h, cleanTitle, debounce, plural } from '../util.js';
import { App, Screen } from '../ui/app.js';
import { HRow } from '../ui/list.js';
import { Keyboard } from '../ui/keyboard.js';
import { icon, art, setArt, topbar } from '../ui/widgets.js';
import { Session } from '../data/session.js';
import { search } from '../data/catalog.js';
import { Native, events } from '../native.js';
import { itemLocked } from './access.js';
import { go } from './nav.js';
import { watch } from './player.js';

export class SearchScreen extends Screen {
  constructor(opts) {
    super('search');
    this.opts = opts || {};
    this.zone = 'kbd';
    this.ri = 0;
    this.q = '';
    this.sections = [];
  }

  build() {
    this.el.append(topbar('Search', 'Channels, movies and series'));
    this.query = h('div.sq-text.bidi');
    this.kbd = new Keyboard({
      mode: 'search',
      onChange: (v) => {
        this.q = v;
        this.paintQuery();
        this.runLater();
      },
      onVoice: () => this.voice(),
    });
    this.hint = h('div.sr-hint', { text: 'Start typing a name. Results appear as you type.' });
    this.results = h('div.sr-rows');
    this.el.append(h('div.sr-body', null, h('div.sr-left', null, h('div.sq', null, icon('search'), this.query), this.kbd.el), h('div.sr-right', null, this.hint, this.results)));
    this.runLater = debounce(() => this.run(), 220);
    this.offVoice = events.on('voice', (m) => {
      if (m.text) {
        this.q = m.text;
        this.kbd.setValue(m.text);
        this.paintQuery();
        this.run();
      }
    });
    this.paintQuery();
  }

  destroy() {
    this.offVoice();
    super.destroy();
  }

  enter(params, back) {
    const c = Session.catalog;
    Promise.all([c.ensure('live'), c.ensure('vod'), c.ensure('series')]).then(() => {
      if (this.q) this.run();
    });
    if (back) this.sections.forEach((s) => s.row.setCount(s.items.length, s.row.index));
    this.paint();
  }

  voice() {
    if (!Native.voiceSearch()) App.toast('Voice search is not available on this device');
  }

  paintQuery() {
    this.query.textContent = this.q;
    this.query.classList.toggle('empty', !this.q);
  }

  run() {
    const q = this.q.trim();
    const c = Session.catalog;
    const allow = (it) => !itemLocked(it);
    const defs = [];
    if (q.length >= 1) {
      const live = c.get('live');
      const vod = c.get('vod');
      const ser = c.get('series');
      if (live) defs.push({ kind: 'live', title: 'Channels', items: search(live, q, 40, allow) });
      if (vod) defs.push({ kind: 'vod', title: 'Movies', items: search(vod, q, 40, allow) });
      if (ser) defs.push({ kind: 'series', title: 'Series', items: search(ser, q, 40, allow) });
    }
    this.results.innerHTML = '';
    this.sections = defs.filter((d) => d.items.length);
    for (const d of this.sections) {
      const live = d.kind === 'live';
      d.row = new HRow({
        width: 1100,
        cardW: live ? 210 : 156,
        gap: 20,
        peek: 1,
        create: () => (live ? h('div.card-ch', null, art('logo.ch-tile.sr-tile'), h('div.card-title.ellip.bidi')) : h('div.card-poster', null, art('poster-art.sr-poster'), h('div.card-title.ellip.bidi'))),
        bind: (el, i) => {
          const it = d.items[i];
          if (live) {
            setArt(el.children[0], it.logo, it.name, 210, 40);
            el.children[1].textContent = it.name;
          } else {
            setArt(el.children[0], it.icon || it.cover, cleanTitle(it.name), 156, 40);
            el.children[1].textContent = cleanTitle(it.name);
          }
        },
      });
      d.block = h('div.sr-block.sr-' + d.kind, null, h('div.row-title', null, d.title, h('span.row-n', { text: String(d.items.length >= 40 ? '40+' : d.items.length) })), d.row.el);
      this.results.appendChild(d.block);
      d.row.setCount(d.items.length, 0);
    }
    this.ri = Math.min(this.ri, Math.max(0, this.sections.length - 1));
    if (!this.sections.length && this.zone === 'rows') this.zone = 'kbd';
    this.hint.textContent = !q ? 'Start typing a name. Results appear as you type.' : this.sections.length ? '' : `Nothing found for "${q}"`;
    this.hint.style.display = this.hint.textContent ? '' : 'none';
    this.paint();
  }

  paint() {
    this.kbd.setActive(this.zone === 'kbd');
    this.sections.forEach((s, i) => {
      s.row.setActive(this.zone === 'rows' && i === this.ri);
      s.block.classList.toggle('is-current', this.zone === 'rows' && i === this.ri);
    });
    const blk = this.sections[this.ri] && this.sections[this.ri].block;
    const y = this.zone === 'rows' && blk && this.ri > 0 ? blk.offsetTop : 0;
    this.results.style.transform = `translate3d(0,${-y}px,0)`;
  }

  open(d, it) {
    if (d.kind === 'live') watch({ mode: 'live', ch: it, list: d.items });
    else if (d.kind === 'vod') go('movie', { id: it.id });
    else go('seriesInfo', { id: it.id });
  }

  key(ev) {
    const k = ev.key;
    if (this.zone === 'kbd') {
      if (this.kbd.key(ev)) return true;
      if (k === 'right' && this.sections.length) {
        this.zone = 'rows';
        this.paint();
        return true;
      }
      if (k === 'back' && this.q) {
        this.q = '';
        this.kbd.setValue('');
        this.paintQuery();
        this.run();
        return true;
      }
      return k === 'left' || k === 'up' || k === 'down';
    }
    const s = this.sections[this.ri];
    if (!s) {
      this.zone = 'kbd';
      this.paint();
      return true;
    }
    if (k === 'left') {
      if (!s.row.move(-1)) this.zone = 'kbd';
    } else if (k === 'right') s.row.move(1);
    else if (k === 'up') {
      if (this.ri > 0) this.ri--;
    } else if (k === 'down') {
      if (this.ri < this.sections.length - 1) this.ri++;
    } else if (k === 'ok') {
      this.open(s, s.items[s.row.index]);
      return true;
    } else if (k === 'back') this.zone = 'kbd';
    else if (k === 'char' || k === 'del' || k === 'digit') {
      this.zone = 'kbd';
      this.kbd.key(ev);
    } else return false;
    this.paint();
    return true;
  }
}

