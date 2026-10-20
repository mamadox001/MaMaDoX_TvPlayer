import './polyfills.js';
import './styles/app.css';
import { wait, setClock12, nowSec } from './util.js';
import { App } from './ui/app.js';
import { Video } from './player/video.js';
import { Native, events, isAndroid } from './native.js';
import { Store, settings } from './store.js';
import { refreshClocks } from './ui/widgets.js';
import { progress } from './ui/dialogs.js';
import { Playlists, activate, Session, syncPlaylist, syncGuide, staleSections, refreshAccount, epgUrls } from './data/session.js';
import { register, go } from './screens/nav.js';
import { splash } from './screens/splash.js';
import { SetupScreen } from './screens/setup.js';
import { HomeScreen } from './screens/home.js';
import { LiveScreen } from './screens/live.js';
import { PlayerScreen, watch } from './screens/player.js';
import { GuideScreen } from './screens/guide.js';
import { BrowseScreen } from './screens/browse.js';
import { MovieScreen } from './screens/movie.js';
import { SeriesScreen } from './screens/series.js';
import { SearchScreen } from './screens/search.js';
import { SettingsScreen } from './screens/settings.js';

register('home', () => new HomeScreen());
register('setup', (o) => new SetupScreen(o));
register('live', (o) => new LiveScreen(o));
register('player', (o) => new PlayerScreen(o));
register('guide', (o) => new GuideScreen(o));
register('browse', (o) => new BrowseScreen(o));
register('movie', (o) => new MovieScreen(o));
register('seriesInfo', (o) => new SeriesScreen(o));
register('search', (o) => new SearchScreen(o));
register('settings', (o) => new SettingsScreen(o));
window.__watch = watch;

export function applySettings() {
  const s = settings();
  const info = window.__device || {};
  setClock12(s.clock12);
  refreshClocks();
  const root = document.documentElement;
  root.className = root.className.replace(/\baccent-\w+/g, '').trim();
  if (s.accent && s.accent !== 'signal') root.classList.add('accent-' + s.accent);
  const weak = info.lowRam || (info.memoryClass && info.memoryClass < 128) || (info.totalMem && info.totalMem < 1.6e9) || (info.cores && info.cores <= 2);
  App.setMotion(s.motion === 'full' || (s.motion === 'auto' && !weak));
  Native.setOption('trustAll', !!s.trustAll);
  Native.setOption('userAgent', s.userAgent || '');
}
window.__applySettings = applySettings;
window.__startHome = () => startHome();

export function startHome() {
  App.reset(new HomeScreen());
  const s = settings();
  if (s.startOn === 'live') go('live', {});
  else if (s.startOn === 'last' && Session.lib && Session.lib.lastChannel) {
    const live = Session.catalog.get('live');
    const ch = live && live.byId.get(Session.lib.lastChannel);
    if (ch) go('player', { mode: 'live', ch });
  }
}

/** Keeps data fresh without getting in the way. */
async function backgroundRefresh(pl) {
  await wait(4000);
  if (Session.pl !== pl) return;
  if (pl.type === 'xtream' && (!pl.account || nowSec() - (pl.account.checked || 0) > 3600)) {
    try {
      await refreshAccount(pl);
    } catch (e) {
      /* offline: keep the old details */
    }
  }
  const stale = staleSections(pl);
  if (stale.length) {
    try {
      await syncPlaylist(pl, pl.type === 'xtream' ? stale : ['live', 'vod', 'series']);
    } catch (e) {
      App.toast('Could not refresh the playlist. Showing the last saved copy.');
    }
  }
  if (epgUrls(pl).length && (!pl.synced.epg || nowSec() - pl.synced.epg > 12 * 3600)) syncGuide(pl).catch(() => {});
}

/** Loads a playlist that has no saved data yet (for example after an update). */
async function firstLoad(pl) {
  const box = progress('Loading your playlist');
  const labels = { live: 'Loading channels', vod: 'Loading movies', series: 'Loading series', m3u: 'Reading the playlist' };
  try {
    await syncPlaylist(pl, ['live', 'vod', 'series'], (stage, n) => box.set(labels[stage.split(':')[0]] || 'Loading', n ? String(n) : ''));
    box.close();
    if (epgUrls(pl).length) syncGuide(pl).catch(() => {});
    return true;
  } catch (e) {
    box.close();
    App.toast(e.message || 'Could not load the playlist', 'long');
    return false;
  }
}

let backAt = 0;
App.onRootBack = () => {
  const t = Date.now();
  if (t - backAt < 2200) {
    Store.flush();
    Video.stop();
    Native.exit();
    return;
  }
  backAt = t;
  App.toast('Press Back again to exit');
};

App.globalKey = (ev) => {
  if (!Session.pl) return false;
  if (ev.key === 'guide') {
    if (!(App.top() instanceof GuideScreen)) go('guide', {});
    return true;
  }
  if (ev.key === 'search') {
    if (!(App.top() instanceof SearchScreen)) go('search', {});
    return true;
  }
  return false;
};

events.on('lifecycle', (m) => {
  if (m.state === 'background') {
    const top = App.top();
    if (top && top.leave && top instanceof PlayerScreen) top.saveProgress(true);
    Store.flush();
    if (Video.cur) {
      App.__resumeVideo = { meta: Video.cur.meta, placement: Video.placement };
      Video.cur = null;
      Video.state = 'idle';
    }
  } else if (m.state === 'resume') {
    const r = App.__resumeVideo;
    App.__resumeVideo = null;
    const top = App.top();
    if (!r || !top) return;
    if (top instanceof PlayerScreen) top.retry();
    else if (r.meta.kind === 'live' && top.video()) {
      import('./player/playback.js').then((p) => p.playChannel(r.meta.ch, top.video(), { noRecent: true, muted: top instanceof HomeScreen }));
    }
  }
});

events.on('memory', () => {
  if (Session.guide) {
    Session.guide.short.clear();
    Session.guide.slices.clear();
  }
});

async function boot() {
  const root = document.getElementById('app');
  if (!isAndroid) document.body.classList.add('dev');
  App.init(root);
  Video.init(root, () => App.scale);
  window.__device = Native.info() || {};
  applySettings();
  Native.player({ cmd: 'stop' });
  const sp = splash(root);
  requestAnimationFrame(() => requestAnimationFrame(() => Native.ready()));
  const t0 = Date.now();
  const pl = Playlists.get(Playlists.activeId()) || Playlists.list()[0] || null;
  if (pl) {
    activate(pl);
    await Session.catalog.ensure('live');
  }
  await wait(Math.max(0, 1250 - (Date.now() - t0)));
  sp.done();
  if (!pl) {
    App.reset(new SetupScreen({ first: true, onDone: () => startHome() }));
    return;
  }
  if (!Session.catalog.get('live').loaded) {
    const ok = await firstLoad(pl);
    if (!ok) {
      App.reset(new SetupScreen({ edit: pl, onDone: () => startHome() }));
      return;
    }
  }
  startHome();
  backgroundRefresh(pl);
}

// Last resort: an unexpected failure while starting shows a way out instead of a frozen splash.
function fatal(e) {
  console.error('start failed: ' + ((e && e.stack) || e));
  const box = document.createElement('div');
  box.className = 'fatal';
  box.innerHTML = '<div class="fatal-title">IPTV Player could not start</div><div class="fatal-msg">Press OK to try again, or Back to close. If this keeps happening, update Android System WebView from the Play Store.</div>';
  document.body.appendChild(box);
  window.__key = (name, type) => {
    if (type !== 'up') return;
    if (name === 'ok') location.reload();
    else if (name === 'back') Native.exit();
  };
  Native.ready();
}

if (!window.__old) {
  try {
    boot().catch(fatal);
  } catch (e) {
    fatal(e);
  }
}
