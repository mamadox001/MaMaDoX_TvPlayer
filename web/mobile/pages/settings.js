// Settings on the phone: playlists, playback, parental control, storage, about.
import { h, fmtCount, fmtDate, plural, nowSec } from '../../src/util.js';
import { icon } from '../../src/ui/widgets.js';
import { Native } from '../../src/native.js';
import { settings, saveSettings } from '../../src/store.js';
import { Playlists, Session, activate, syncPlaylist, syncGuide, epgUrls, refreshAccount } from '../../src/data/session.js';
import { Page, Nav, sheet, confirm, progress, toast } from '../ui.js';
import { checkPin, createPin } from '../access.js';
import { SetupPage } from './setup.js';

const FMT = { auto: 'Automatic', m3u8: 'HLS (.m3u8)', ts: 'MPEG-TS (.ts)' };
const EXT = { off: 'Built-in player', vod: 'Other app for movies and series', all: 'Other app for everything' };
const EVERY = { 6: 'Every 6 hours', 12: 'Every 12 hours', 24: 'Every day', 72: 'Every 3 days', 168: 'Every week' };

function ago(t) {
  if (!t) return 'never';
  const d = nowSec() - t;
  if (d < 3600) return plural(Math.max(1, Math.round(d / 60)), 'minute') + ' ago';
  if (d < 86400) return plural(Math.round(d / 3600), 'hour') + ' ago';
  return plural(Math.round(d / 86400), 'day') + ' ago';
}

const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1) + ' MB';

export class SettingsPage extends Page {
  constructor(app) {
    super('settings');
    this.app = app;
  }

  build() {
    this.body = h('div.set-scroll');
    this.el.append(h('header.hd', null, h('h1', { text: 'Settings' })), this.body);
  }

  enter() {
    this.paint();
  }

  row(label, sub, value, action, ico) {
    const r = h('button.set-row', { type: 'button' }, ico ? icon(ico) : null, h('span.set-text', null, h('span.set-label', { text: label }), sub ? h('span.set-sub', { text: sub }) : null), value != null ? h('span.set-value', { text: value }) : null);
    r.addEventListener('click', action);
    return r;
  }

  group(title, rows) {
    return h('section.set-group', null, h('h2', { text: title }), h('div.set-card', null, rows));
  }

  paint() {
    const s = settings();
    const act = Playlists.activeId();
    const pls = Playlists.list().map((pl) => {
      const c = pl.counts || {};
      const sub = `${pl.type === 'xtream' ? 'Xtream Codes' : 'M3U'}  ·  ${fmtCount(c.live || 0)} channels, ${fmtCount(c.vod || 0)} movies, ${fmtCount(c.series || 0)} series`;
      const r = this.row(pl.name, sub, pl.id === act ? 'In use' : null, () => this.plMenu(pl), pl.id === act ? 'check' : 'list');
      if (pl.id === act) r.classList.add('active');
      return r;
    });
    pls.push(this.row('Add a playlist', 'Xtream Codes login or M3U link', null, () => this.add(), 'plus'));
    const info = window.__device || {};
    this.body.innerHTML = '';
    this.body.append(
      this.group('Playlists', pls),
      this.group('Playback', [
        this.row('Live stream format', 'Automatic tries the other format when a channel does not start.', FMT[s.liveFormat], () => this.choose('Live stream format', 'liveFormat', FMT), 'live'),
        this.row('Video player', 'Use VLC, MX Player or another app for formats this phone cannot play.', EXT[s.externalPlayer], () => this.choose('Video player', 'externalPlayer', EXT), 'external'),
        this.row('Play the next episode automatically', null, s.autoplayNext ? 'On' : 'Off', () => this.flip('autoplayNext'), 'next'),
      ]),
      this.group('TV guide', [
        this.row('Guide time shift', 'Move programme times if they look early or late.', s.epgShift ? `${s.epgShift > 0 ? '+' : ''}${s.epgShift} h` : 'None', () => this.shift(), 'history'),
        this.row('Clock', null, s.clock12 ? '12-hour' : '24-hour', () => this.flip('clock12'), 'history'),
      ]),
      this.group('Parental control', [
        this.row('Lock adult categories', 'They need the PIN to open and stay out of search.', s.lockAdult ? 'On' : 'Off', () => this.lockAdult(), 'lock'),
        this.row(s.pin ? 'Change PIN' : 'Create a PIN', null, null, () => this.changePin(), 'lock'),
      ]),
      this.group('Storage and network', [
        this.row('Update playlists', 'Reload channels, movies and series when they are older than this.', EVERY[s.refreshHours] || `${s.refreshHours} h`, () => this.choose('Update playlists', 'refreshHours', EVERY, true), 'refresh'),
        this.row('Clear image cache', 'Posters and logos are kept on the phone so they load fast.', null, () => this.clearImages(), 'trash'),
        this.row('Allow all certificates', 'Only turn on if a secure (https) server fails to connect.', s.trustAll ? 'On' : 'Off', () => this.flip('trustAll'), 'lock'),
      ]),
      this.group('About', [
        this.row('MaMaDoX TvPlayer', 'Plays the streams of your own IPTV subscription. This app does not provide any channels.', `Version ${info.version || '1.0'}`, () => {}, 'info'),
        this.row('Device', [info.maker, info.model].filter(Boolean).join(' ') || 'Unknown', info.release ? `Android ${info.release}` : '', () => {}, 'phone'),
      ])
    );
  }

  set(key, value) {
    settings()[key] = value;
    saveSettings();
    if (this.app.applySettings) this.app.applySettings();
    this.paint();
  }

  flip(key) {
    this.set(key, !settings()[key]);
  }

  choose(title, key, options, numeric) {
    const s = settings();
    sheet(
      title,
      Object.keys(options).map((k) => ({ label: options[k], on: String(s[key]) === k, action: () => this.set(key, numeric ? +k : k) }))
    );
  }

  shift() {
    const opts = {};
    for (let i = -6; i <= 6; i++) opts[i] = i ? `${i > 0 ? '+' : ''}${i} hours` : 'None';
    this.choose('Guide time shift', 'epgShift', opts, true);
    if (Session.guide) Session.guide.reset();
  }

  async lockAdult() {
    if (!(await checkPin('Enter your PIN to change this'))) return;
    this.flip('lockAdult');
  }

  async changePin() {
    if (!(await checkPin('Enter your current PIN'))) return;
    if (await createPin()) toast('PIN saved');
    this.paint();
  }

  clearImages() {
    const c = Native.cacheInfo();
    confirm('Clear image cache', c.images ? `Frees ${mb(c.images)}. Images download again when needed.` : 'Images download again when needed.', [
      { label: 'Clear', value: 1 },
      { label: 'Cancel', value: 0 },
    ]).then((v) => {
      if (v) {
        Native.clearImageCache();
        toast('Image cache cleared');
      }
    });
  }

  add() {
    Nav.push(
      new SetupPage({
        onDone: () => {
          Nav.pop();
          this.app.restart();
        },
      })
    );
  }

  plMenu(pl) {
    const active = pl.id === Playlists.activeId();
    const items = [];
    if (!active)
      items.push({
        label: 'Use this playlist',
        icon: 'check',
        action: () => {
          activate(pl);
          this.app.restart();
        },
      });
    items.push({ label: 'Update now', sub: `Last updated ${ago(pl.synced && pl.synced.live)}`, icon: 'refresh', action: () => this.update(pl) });
    if (epgUrls(pl).length) items.push({ label: 'Update the TV guide', sub: `Last updated ${ago(pl.synced && pl.synced.epg)}`, icon: 'guide', action: () => this.updateGuide(pl) });
    if (pl.type === 'xtream') items.push({ label: 'Account details', sub: 'Expiry date and connections', icon: 'user', action: () => this.account(pl) });
    items.push({
      label: 'Edit',
      icon: 'edit',
      action: () =>
        Nav.push(
          new SetupPage({
            edit: pl,
            onDone: () => {
              Nav.pop();
              this.app.restart();
            },
          })
        ),
    });
    items.push({ label: 'Remove', icon: 'trash', danger: true, action: () => this.remove(pl) });
    sheet(pl.name, items);
  }

  async update(pl) {
    const box = progress('Updating ' + pl.name);
    const labels = { live: 'Loading channels', vod: 'Loading movies', series: 'Loading series', m3u: 'Reading the playlist' };
    try {
      await syncPlaylist(pl, ['live', 'vod', 'series'], (st, n) => box.set(labels[st.split(':')[0]] || 'Loading', n ? fmtCount(n) : ''));
      box.close();
      toast('Playlist updated');
    } catch (e) {
      box.close();
      confirm('Update failed', e.message || String(e));
    }
    this.paint();
  }

  async updateGuide(pl) {
    const box = progress('Updating the TV guide');
    try {
      await syncGuide(pl, (st, n) => box.set('Reading programmes', n ? fmtCount(n) : ''));
      box.close();
      toast('TV guide updated');
    } catch (e) {
      box.close();
      confirm('Could not update the guide', e.message || String(e));
    }
  }

  async account(pl) {
    let acc = pl.account;
    try {
      acc = await refreshAccount(pl);
    } catch (e) {
      /* show what we have */
    }
    acc = acc || {};
    const days = acc.exp ? Math.floor((acc.exp - nowSec()) / 86400) : null;
    const lines = [
      `Status: ${acc.status || 'Unknown'}`,
      `Expires: ${acc.exp ? fmtDate(acc.exp, true) + (days != null && days >= 0 ? ` (${plural(days, 'day')} left)` : '') : 'Never'}`,
      `Connections: ${acc.maxCons ? `${acc.activeCons} in use of ${acc.maxCons}` : 'Unknown'}`,
    ];
    confirm(pl.name, lines.join('\n'));
  }

  async remove(pl) {
    const v = await confirm('Remove ' + pl.name + '?', 'Its channels, favorites and watch history are deleted from this phone.', [
      { label: 'Remove', value: 1, danger: true },
      { label: 'Keep it', value: 0 },
    ]);
    if (!v) return;
    const wasActive = pl.id === Playlists.activeId();
    Playlists.remove(pl.id);
    if (wasActive) {
      const next = Playlists.list()[0] || null;
      activate(next);
      this.app.restart();
    } else this.paint();
  }
}
