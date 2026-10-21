// Settings: playlists, playback, guide, categories, look, parental control, storage.
import { h, fmtDate, fmtCount, plural, nowSec } from '../util.js';
import { App, Screen } from '../ui/app.js';
import { VList } from '../ui/list.js';
import { icon, topbar } from '../ui/widgets.js';
import { Menu, pick, confirm, askPin, progress } from '../ui/dialogs.js';
import { settings, saveSettings, Store } from '../store.js';
import { Native } from '../native.js';
import { Session, Playlists, activate, syncPlaylist, syncGuide, refreshAccount, epgUrls, isSyncing } from '../data/session.js';
import { checkPin } from './access.js';
import { go } from './nav.js';
import { SetupScreen } from './setup.js';

const onOff = (v) => (v ? 'On' : 'Off');
const AGENTS = [
  { value: '', label: 'Default' },
  { value: 'VLC/3.0.20 LibVLC/3.0.20', label: 'VLC' },
  { value: 'IPTVSmartersPlayer', label: 'IPTV Smarters' },
  { value: 'TiviMate/4.7.0 (Android 11)', label: 'TiviMate' },
  { value: 'okhttp/4.12.0', label: 'OkHttp' },
];

function ago(t) {
  if (!t) return 'never';
  const s = nowSec() - t;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(t);
}

function mb(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(bytes > 1e8 ? 0 : 1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export class SettingsScreen extends Screen {
  constructor(opts) {
    super('settings');
    this.opts = opts || {};
    this.zone = 'sections';
    this.si = 0;
    this.rows = [];
  }

  build() {
    this.el.append(topbar('Settings', ''));
    this.sections = [
      { id: 'playlists', label: 'Playlists', icon: 'list' },
      { id: 'player', label: 'Player', icon: 'play' },
      { id: 'live', label: 'Live TV', icon: 'tv' },
      { id: 'guide', label: 'TV guide', icon: 'guide' },
      { id: 'cats', label: 'Categories', icon: 'eye' },
      { id: 'look', label: 'Appearance', icon: 'settings' },
      { id: 'parental', label: 'Parental control', icon: 'lock' },
      { id: 'storage', label: 'Storage and network', icon: 'refresh' },
      { id: 'about', label: 'About', icon: 'info' },
    ];
    const H = App.height - 200;
    this.secList = new VList({
      rowH: 76,
      height: H,
      cls: 'st-secs',
      create: () => h('div.crow.st-sec', null, h('span.crow-ic'), h('span.crow-name')),
      bind: (el, i) => {
        const s = this.sections[i];
        el.children[0].innerHTML = '';
        el.children[0].appendChild(icon(s.icon));
        el.children[1].textContent = s.label;
        el.classList.toggle('is-current', i === this.si);
      },
      onFocus: (i) => {
        if (this.zone !== 'sections' || i === this.si) return;
        const old = this.si;
        this.si = i;
        this.secList.refreshRow(old);
        this.secList.refreshRow(i);
        this.fill(0);
      },
    });
    this.optList = new VList({
      rowH: 112,
      height: H,
      margin: 1,
      cls: 'st-opts',
      create: () => h('div.orow', null, h('span.orow-ic'), h('div.orow-text', null, h('div.orow-label'), h('div.orow-sub')), h('div.orow-val')),
      bind: (el, i) => {
        const r = this.rows[i];
        if (!r) return;
        el.children[0].innerHTML = '';
        if (r.icon) el.children[0].appendChild(icon(r.icon));
        el.children[1].children[0].textContent = r.label;
        el.children[1].children[1].textContent = r.sub || '';
        el.children[2].textContent = r.value || '';
        el.classList.toggle('is-active-pl', !!r.active);
        el.classList.toggle('is-danger', !!r.danger);
      },
    });
    this.el.append(h('div.st-body', null, h('div.st-left', null, this.secList.el), h('div.st-right', null, this.optList.el)));
  }

  enter(params, back) {
    this.secList.setCount(this.sections.length, this.si);
    this.fill(back ? this.optList.index : 0);
    this.paint();
  }

  paint() {
    this.secList.setActive(this.zone === 'sections');
    this.optList.setActive(this.zone === 'opts');
  }

  fill(index) {
    const id = this.sections[this.si].id;
    this.rows = this['rows_' + id]();
    this.optList.setCount(this.rows.length, Math.min(index || 0, Math.max(0, this.rows.length - 1)));
  }

  refresh() {
    this.fill(this.optList.index);
  }

  set(key, value) {
    settings()[key] = value;
    saveSettings();
    if (window.__applySettings) window.__applySettings();
    this.refresh();
  }

  choose(title, key, options) {
    pick(title, options, settings()[key]).then((v) => {
      if (v !== undefined) this.set(key, v);
    });
  }

  // ------------------------------------------------------------ sections

  rows_playlists() {
    const act = Playlists.activeId();
    const rows = Playlists.list().map((pl) => {
      const c = pl.counts || {};
      const host = pl.type === 'xtream' ? pl.base : pl.url;
      const h = (/^[a-z]+:\/\/([^/?#]+)/i.exec(host || '') || [])[1] || '';
      return {
        label: pl.name,
        sub: `${pl.type === 'xtream' ? 'Xtream Codes' : 'M3U'}, ${h}. ${fmtCount(c.live || 0)} channels, ${fmtCount(c.vod || 0)} movies, ${fmtCount(c.series || 0)} series. Updated ${ago(pl.synced && pl.synced.live)}${isSyncing(pl) ? ', updating now' : ''}.`,
        value: pl.id === act ? 'In use' : '',
        active: pl.id === act,
        icon: pl.type === 'xtream' ? 'user' : 'list',
        action: () => this.playlistMenu(pl),
      };
    });
    rows.push({ label: 'Add a playlist', sub: 'Xtream Codes login or M3U link', icon: 'plus', action: () => this.addPlaylist() });
    return rows;
  }

  rows_player() {
    const s = settings();
    const ext = { off: 'Built-in player', vod: 'Another app for movies and series', all: 'Another app for everything' };
    const asp = { fit: 'Fit to screen', fill: 'Fill screen (crop)', zoom: 'Zoom', stretch: 'Stretch', '16:9': '16:9', '4:3': '4:3' };
    const fmt = { auto: 'Automatic', m3u8: 'HLS (.m3u8)', ts: 'MPEG-TS (.ts)' };
    return [
      { label: 'Live stream format', sub: 'Automatic picks what your server supports and switches if a channel does not start. Xtream Codes only.', value: fmt[s.liveFormat], icon: 'live', action: () => this.choose('Live stream format', 'liveFormat', [{ value: 'auto', label: 'Automatic', sub: 'Recommended' }, { value: 'm3u8', label: 'HLS (.m3u8)' }, { value: 'ts', label: 'MPEG-TS (.ts)' }]) },
      { label: 'Picture', sub: 'How video fills the screen. Change it any time with Menu during playback.', value: asp[s.aspect], icon: 'aspect', action: () => this.choose('Picture', 'aspect', Object.keys(asp).map((k) => ({ value: k, label: asp[k] }))) },
      { label: 'Play the next episode automatically', sub: 'Starts the next episode 10 seconds after one ends.', value: onOff(s.autoplayNext), icon: 'next', action: () => this.set('autoplayNext', !s.autoplayNext) },
      { label: 'Video player', sub: 'Use VLC, MX Player or another installed app instead of the built-in player.', value: ext[s.externalPlayer], icon: 'external', action: () => this.choose('Video player', 'externalPlayer', [{ value: 'off', label: ext.off }, { value: 'vod', label: ext.vod }, { value: 'all', label: ext.all }]) },
    ];
  }

  rows_live() {
    const s = settings();
    const start = { home: 'Home', live: 'Live TV', last: 'Last channel' };
    return [
      { label: 'Open channels in full screen', sub: 'Off: the first OK plays in the preview window, the second goes full screen.', value: onOff(s.openLiveFullscreen), icon: 'tv', action: () => this.set('openLiveFullscreen', !s.openLiveFullscreen) },
      { label: 'Preview on Home', sub: 'Plays your last channel without sound at the top of Home.', value: onOff(s.homePreview), icon: 'play', action: () => this.set('homePreview', !s.homePreview) },
      { label: 'Show what is on in channel lists', sub: 'Loads the current programme for the channels on screen.', value: onOff(s.showNowInList), icon: 'guide', action: () => this.set('showNowInList', !s.showNowInList) },
      { label: 'When the app opens', sub: 'Where MaMaDoX TvPlayer starts.', value: start[s.startOn], icon: 'history', action: () => this.choose('When the app opens', 'startOn', [{ value: 'home', label: 'Home' }, { value: 'live', label: 'Live TV' }, { value: 'last', label: 'Last channel, full screen' }]) },
      { label: 'Hide empty categories', value: onOff(s.hideEmptyCats), icon: 'eyeOff', action: () => this.set('hideEmptyCats', !s.hideEmptyCats) },
    ];
  }

  rows_guide() {
    const s = settings();
    const pl = Session.pl;
    const rows = [];
    const urls = pl ? epgUrls(pl) : [];
    if (pl) {
      rows.push({
        label: 'Guide source',
        sub: urls.length ? urls.join(', ') : pl.type === 'xtream' ? 'Your provider, loaded per channel when needed.' : 'This playlist has no guide link. Add one with Edit playlist.',
        value: urls.length ? 'XMLTV link' : pl.type === 'xtream' ? 'Provider' : 'None',
        icon: 'guide',
        action: () => this.editPlaylist(pl),
      });
      if (urls.length) rows.push({ label: 'Update the guide now', sub: `Last updated ${ago(pl.synced && pl.synced.epg)}${pl.counts && pl.counts.epg ? `, ${fmtCount(pl.counts.epg)} programmes` : ''}.`, icon: 'refresh', action: () => this.updateGuide(pl) });
    }
    rows.push({ label: 'Guide time shift', sub: 'Move all programme times if they look early or late.', value: s.epgShift ? `${s.epgShift > 0 ? '+' : ''}${s.epgShift} h` : 'None', icon: 'history', action: () => {
      const opts = [];
      for (let i = -12; i <= 12; i++) opts.push({ value: i, label: i ? `${i > 0 ? '+' : ''}${i} hour${Math.abs(i) === 1 ? '' : 's'}` : 'None' });
      pick('Guide time shift', opts, s.epgShift).then((v) => {
        if (v === undefined) return;
        this.set('epgShift', v);
        if (Session.guide) Session.guide.reset();
      });
    } });
    rows.push({ label: 'Clock', value: s.clock12 ? '12-hour' : '24-hour', icon: 'history', action: () => this.set('clock12', !s.clock12) });
    return rows;
  }

  rows_cats() {
    const pl = Session.pl;
    if (!pl) return [{ label: 'Add a playlist first', icon: 'info', action: () => false }];
    const lib = Session.lib;
    const mk = (kind, label) => ({
      label,
      sub: (() => {
        const n = lib.d.hidden[kind].length;
        return n ? `${plural(n, 'category', 'categories')} hidden` : 'All categories shown';
      })(),
      icon: kind === 'live' ? 'tv' : kind === 'vod' ? 'film' : 'series',
      action: () => this.catMenu(kind, label),
    });
    return [mk('live', 'Live TV categories'), mk('vod', 'Movie categories'), mk('series', 'Series categories')];
  }

  rows_look() {
    const s = settings();
    const accents = { signal: 'Signal yellow', phosphor: 'Phosphor cyan', tally: 'Coral', go: 'Mint', paper: 'Paper white' };
    const motion = { auto: 'Automatic', full: 'Full', reduced: 'Reduced' };
    return [
      { label: 'Highlight color', sub: 'The color that shows where you are.', value: accents[s.accent], icon: 'eye', action: () => this.choose('Highlight color', 'accent', Object.keys(accents).map((k) => ({ value: k, label: accents[k] }))) },
      { label: 'Animations', sub: 'Reduced keeps things snappy on slower TV boxes. Automatic decides from your device.', value: motion[s.motion], icon: 'speed', action: () => this.choose('Animations', 'motion', [{ value: 'auto', label: 'Automatic' }, { value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }]) },
    ];
  }

  rows_parental() {
    const s = settings();
    return [
      { label: 'Lock adult categories', sub: 'Categories for adults need the PIN to open, and are left out of search and All.', value: onOff(s.lockAdult), icon: 'lock', action: async () => {
        if (s.lockAdult && !(await checkPin('Enter your PIN to unlock'))) return;
        this.set('lockAdult', !s.lockAdult);
      } },
      { label: s.pin ? 'Change PIN' : 'Set a PIN', sub: s.pin ? 'Four digits, asked for locked categories.' : 'Choose four digits to protect locked categories.', icon: 'lock', action: () => this.changePin() },
    ];
  }

  rows_storage() {
    const s = settings();
    const c = Native.cacheInfo() || {};
    const every = { 6: 'Every 6 hours', 12: 'Every 12 hours', 24: 'Every day', 72: 'Every 3 days', 168: 'Every week' };
    return [
      { label: 'Update playlists', sub: 'Channels, movies and series are reloaded in the background when they are older than this.', value: every[s.refreshHours] || `${s.refreshHours} h`, icon: 'refresh', action: () => this.choose('Update playlists', 'refreshHours', Object.keys(every).map((k) => ({ value: +k, label: every[k] }))) },
      { label: 'Clear image cache', sub: 'Posters and logos are kept on the TV so they load instantly.', value: c.images != null ? mb(c.images) : '', icon: 'trash', action: () => {
        Native.clearImageCache();
        App.toast('Image cache cleared');
        setTimeout(() => this.refresh(), 800);
      } },
      { label: 'Clear watch history', sub: 'Removes Continue watching, recently watched channels and resume points for this playlist.', icon: 'history', action: () => this.clearHistory() },
      { label: 'Network identity', sub: 'Some providers only accept certain apps. Change this if channels or the login fail.', value: (AGENTS.find((a) => a.value === s.userAgent) || { label: 'Custom' }).label, icon: 'user', action: () => this.choose('Network identity', 'userAgent', AGENTS) },
      { label: 'Allow all certificates', sub: 'Lets older TVs connect to HTTPS servers they do not trust. Only turn on if a secure server fails.', value: onOff(s.trustAll), icon: 'lock', action: () => this.set('trustAll', !s.trustAll) },
    ];
  }

  rows_about() {
    const i = Native.info() || {};
    return [
      { label: 'MaMaDoX TvPlayer', sub: 'Plays the streams of your own IPTV subscription. This app does not provide any channels.', value: `Version ${i.version || '1.0'}`, icon: 'info', action: () => false },
      { label: 'Device', sub: [i.maker, i.model].filter(Boolean).join(' ') || 'Unknown', value: i.release ? `Android ${i.release}` : '', icon: 'tv', action: () => false },
      { label: 'Screen', value: i.width ? `${i.width} x ${i.height}` : '', sub: i.totalMem ? `${(i.totalMem / 1073741824).toFixed(1)} GB memory, ${i.cores || '?'} cores` : '', icon: 'aspect', action: () => false },
      { label: 'Web engine', sub: i.webview || navigator.userAgent.replace(/^.*(Chrome\/[\d.]+).*$/, '$1'), icon: 'settings', action: () => false },
    ];
  }

  // ------------------------------------------------------------ actions

  addPlaylist() {
    App.push(new SetupScreen({ onDone: () => {
      if (window.__startHome) window.__startHome();
    } }));
  }

  editPlaylist(pl) {
    App.push(new SetupScreen({ edit: pl, onDone: (np) => {
      if (Playlists.activeId() === np.id) activate(np);
      App.pop();
      this.refresh();
    } }));
  }

  playlistMenu(pl) {
    const items = [];
    const active = Playlists.activeId() === pl.id;
    if (!active) items.push({ label: 'Use this playlist', icon: 'check', action: () => this.switchTo(pl) });
    items.push({ label: 'Update now', sub: 'Reload channels, movies and series', icon: 'refresh', action: () => this.updatePlaylist(pl) });
    items.push({ label: 'Edit', sub: 'Name, address, login or links', icon: 'edit', action: () => this.editPlaylist(pl) });
    if (pl.type === 'xtream') items.push({ label: 'Account details', sub: 'Expiry date and connections', icon: 'user', action: () => this.account(pl) });
    items.push({ label: 'Remove', icon: 'trash', danger: true, action: () => this.removePlaylist(pl) });
    new Menu(pl.name, items).open();
  }

  switchTo(pl) {
    activate(pl);
    App.toast(`Now using ${pl.name}`);
    if (window.__startHome) window.__startHome();
  }

  async updatePlaylist(pl) {
    const box = progress(`Updating ${pl.name}`);
    const labels = { live: 'Loading channels', vod: 'Loading movies', series: 'Loading series', m3u: 'Reading the playlist' };
    try {
      if (pl.type === 'xtream') {
        box.set('Signing in');
        await refreshAccount(pl);
      }
      await syncPlaylist(pl, ['live', 'vod', 'series'], (stage, n) => box.set(labels[stage.split(':')[0]] || 'Loading', n ? fmtCount(n) : ''));
      box.close();
      App.toast(`${pl.name} is up to date`);
      if (epgUrls(pl).length) syncGuide(pl).catch(() => {});
    } catch (e) {
      box.close();
      confirm('Update failed', e.message || String(e), [{ label: 'OK', value: 1 }]);
    }
    this.refresh();
  }

  async updateGuide(pl) {
    const box = progress('Updating the TV guide');
    try {
      const r = await syncGuide(pl, (stage, n) => box.set(stage === 'epg:index' ? 'Organising programmes' : 'Reading the guide', n ? fmtCount(n) : ''));
      box.close();
      App.toast(r ? `Guide updated: ${fmtCount(r.programmes || 0)} programmes for ${fmtCount(r.channels || 0)} channels` : 'No guide link for this playlist', 'long');
    } catch (e) {
      box.close();
      confirm('Could not update the guide', e.message || String(e), [{ label: 'OK', value: 1 }]);
    }
    this.refresh();
  }

  async account(pl) {
    let acc = pl.account;
    try {
      acc = await refreshAccount(pl);
    } catch (e) {
      if (!acc) {
        App.toast(e.message || 'Could not reach the server', 'error');
        return;
      }
    }
    const days = acc.exp ? Math.ceil((acc.exp - nowSec()) / 86400) : null;
    const items = [
      { label: 'Status', value: acc.status || 'Unknown' },
      { label: 'Expires', value: acc.exp ? `${fmtDate(acc.exp, true)}${days != null && days >= 0 ? ` (${plural(days, 'day')} left)` : ''}` : 'Never' },
      { label: 'Connections', value: acc.maxCons ? `${acc.activeCons} in use of ${acc.maxCons}` : 'Unknown' },
      { label: 'Trial', value: acc.trial ? 'Yes' : 'No' },
      { label: 'Created', value: acc.created ? fmtDate(acc.created, true) : '' },
      { label: 'Server time zone', value: acc.tz || '' },
      { label: 'Stream formats', value: (acc.formats || []).join(', ') },
    ].map((r) => Object.assign(r, { action: () => false }));
    new Menu('Account', items, { sub: pl.name, wide: true }).open();
  }

  async removePlaylist(pl) {
    const ok = await confirm(`Remove ${pl.name}?`, 'Its favorites and watch history on this TV are removed too.', [
      { label: 'Keep it', value: 0 },
      { label: 'Remove', value: 1, danger: true },
    ]);
    if (!ok) return;
    const wasActive = Playlists.activeId() === pl.id;
    Playlists.remove(pl.id);
    if (wasActive) {
      const next = Playlists.get(Playlists.activeId());
      activate(next);
      if (!next) {
        App.reset(new SetupScreen({ first: true, onDone: () => window.__startHome && window.__startHome() }));
        return;
      }
      if (window.__startHome) window.__startHome();
      return;
    }
    this.refresh();
  }

  async catMenu(kind, label) {
    const sec = await Session.catalog.ensure(kind);
    const lib = Session.lib;
    const items = sec.cats.map((c) => ({
      label: c.name,
      sub: plural(c.items.length, kind === 'live' ? 'channel' : kind === 'vod' ? 'movie' : 'series', kind === 'series' ? 'series' : undefined),
      checked: !lib.isHidden(kind, c.id),
      action: (it) => {
        const hide = !lib.isHidden(kind, c.id);
        lib.setHidden(kind, c.id, hide);
        it.checked = !hide;
        return false;
      },
    }));
    new Menu(label, items, { sub: 'OK shows or hides a category', wide: true, onClose: () => this.refresh() }).open();
  }

  async changePin() {
    const s = settings();
    if (s.pin && !(await checkPin('Enter your current PIN'))) return;
    const a = await askPin('Choose a new PIN');
    if (!a) return;
    const b = await askPin('Enter it again');
    if (a !== b) {
      App.toast('The PINs did not match', 'error');
      return;
    }
    this.set('pin', a);
    App.toast('PIN saved');
  }

  async clearHistory() {
    const ok = await confirm('Clear watch history?', 'Continue watching, recently watched channels and resume points for this playlist are removed.', [
      { label: 'Cancel', value: 0 },
      { label: 'Clear', value: 1, danger: true },
    ]);
    if (!ok || !Session.lib) return;
    const d = Session.lib.d;
    d.recent = [];
    d.watching = [];
    d.progress = {};
    d.lastChannel = null;
    Session.lib.save();
    Store.flush();
    App.toast('Watch history cleared');
  }

  key(ev) {
    const k = ev.key;
    if (this.zone === 'sections') {
      if (k === 'up') this.secList.move(-1);
      else if (k === 'down') this.secList.move(1);
      else if (k === 'right' || k === 'ok') {
        this.zone = 'opts';
        this.paint();
      } else return false;
      return true;
    }
    if (k === 'up') this.optList.move(-1);
    else if (k === 'down') this.optList.move(1);
    else if (k === 'left' || k === 'back') {
      this.zone = 'sections';
      this.paint();
    } else if (k === 'ok') {
      const r = this.rows[this.optList.index];
      if (r && r.action) {
        const res = r.action();
        if (res !== false && !(res && res.then)) this.refresh();
      }
    } else return false;
    return true;
  }
}

