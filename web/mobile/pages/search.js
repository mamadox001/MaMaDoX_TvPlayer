// Search channels, movies and series on the phone as you type (or by voice).
import { h, cleanTitle, debounce } from '../../src/util.js';
import { art, setArt, icon } from '../../src/ui/widgets.js';
import { Native, events } from '../../src/native.js';
import { Session } from '../../src/data/session.js';
import { search } from '../../src/data/catalog.js';
import { Page, Nav, toast } from '../ui.js';
import { itemLocked } from '../access.js';
import { MoviePage, SeriesPage } from './details.js';

export class SearchPage extends Page {
  constructor(onChannel) {
    super('search');
    this.onChannel = onChannel;
  }

  build() {
    this.input = h('input.search-input', { type: 'search', placeholder: 'Channels, movies, series', autocomplete: 'off', enterkeyhint: 'search' });
    const mic = h('button.ibtn', { type: 'button', 'aria-label': 'Voice search' }, icon('mic'));
    mic.addEventListener('click', () => {
      if (!Native.voiceSearch()) toast('Voice search is not available on this phone');
    });
    this.results = h('div.results');
    this.hint = h('div.vs-empty', { text: 'Type a name to search everything in your playlist.' });
    this.el.append(h('header.hd.search-hd', null, h('div.search-box', null, icon('search'), this.input, mic)), h('div.results-scroll', null, this.hint, this.results));
    this.runLater = debounce(() => this.run(), 250);
    this.input.addEventListener('input', () => this.runLater());
    this.offVoice = events.on('voice', (m) => {
      if (m.text) {
        this.input.value = m.text;
        this.run();
      }
    });
  }

  enter(back) {
    const c = Session.catalog;
    if (c) Promise.all([c.ensure('live'), c.ensure('vod'), c.ensure('series')]).then(() => this.input.value && this.run());
    if (back === false && !this.input.value) setTimeout(() => this.input.focus(), 300);
  }

  run() {
    const q = this.input.value.trim();
    const c = Session.catalog;
    this.results.innerHTML = '';
    if (!q || !c) {
      this.hint.textContent = 'Type a name to search everything in your playlist.';
      this.hint.style.display = '';
      return;
    }
    const allow = (it) => !itemLocked(it);
    const live = c.get('live');
    const vod = c.get('vod');
    const ser = c.get('series');
    const groups = [
      ['live', 'Channels', live ? search(live, q, 30, allow) : []],
      ['vod', 'Movies', vod ? search(vod, q, 30, allow) : []],
      ['series', 'Series', ser ? search(ser, q, 30, allow) : []],
    ].filter((g) => g[2].length);
    this.hint.style.display = groups.length ? 'none' : '';
    this.hint.textContent = `Nothing found for "${q}"`;
    for (const [kind, title, items] of groups) {
      const row = h('div.sr-row');
      for (const it of items) {
        const name = kind === 'live' ? it.name : cleanTitle(it.name);
        const a = art(kind === 'live' ? 'sr-logo' : 'sr-poster');
        setArt(a, kind === 'live' ? it.logo : it.icon || it.cover, name, kind === 'live' ? 160 : 220, 0);
        const card = h('button.sr-card.' + kind, { type: 'button' }, a, h('span.sr-name.bidi', { text: name }));
        card.addEventListener('click', () => {
          if (kind === 'live') this.onChannel(it);
          else Nav.push(kind === 'vod' ? new MoviePage(it) : new SeriesPage(it));
        });
        row.appendChild(card);
      }
      this.results.append(h('h2.sr-title', null, title, h('span', { text: String(items.length) })), row);
    }
  }

  destroy() {
    this.offVoice();
  }
}
