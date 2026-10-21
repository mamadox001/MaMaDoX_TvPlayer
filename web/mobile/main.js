// MaMaDoX TvPlayer for phones: start-up, tabs, Back handling and background refresh.
import '../src/polyfills.js';
import './style.css';
import { wait, setClock12, nowSec } from '../src/util.js';
import { Video } from '../src/player/video.js';
import { Native, events, isAndroid } from '../src/native.js';
import { Store, settings } from '../src/store.js';
import { Playlists, activate, Session, syncPlaylist, syncGuide, staleSections, refreshAccount, epgUrls } from '../src/data/session.js';
import { Nav, toast, progress } from './ui.js';
import { LivePage } from './pages/live.js';
import { BrowsePage } from './pages/browse.js';
import { SearchPage } from './pages/search.js';
import { SettingsPage } from './pages/settings.js';
import { SetupPage } from './pages/setup.js';
import { PlayerPage } from './pages/player.js';

const app = {
  applySettings() {
    const s = settings();
    setClock12(s.clock12);
    Native.setOption('trustAll', !!s.trustAll);
    Native.setOption('userAgent', s.userAgent || '');
  },
  /** Rebuilds the tabs for the active playlist (after switching or adding one). */
  restart() {
    for (const id in Nav.tabPages) {
      const p = Nav.tabPages[id];
      p.leave();
      if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
      if (p.destroy) p.destroy();
    }
    Nav.tabPages = {};
    Nav.tab = null;
    Video.stop();
    if (!Session.pl) return firstRun();
    Nav.show('live');
    backgroundRefresh(Session.pl);
  },
};

function playFromSearch(ch) {
  Nav.show('live');
  const live = Nav.tabPages.live;
  setTimeout(() => live.tap(ch), 50);
}

const TABS = [
  { id: 'live', label: 'Live TV', icon: 'tv', make: () => new LivePage() },
  { id: 'vod', label: 'Movies', icon: 'film', make: () => new BrowsePage('vod') },
  { id: 'series', label: 'Series', icon: 'series', make: () => new BrowsePage('series') },
  { id: 'search', label: 'Search', icon: 'search', make: () => new SearchPage(playFromSearch) },
  { id: 'settings', label: 'Settings', icon: 'settings', make: () => new SettingsPage(app) },
];

function firstRun() {
  Nav.reset(
    new SetupPage({
      first: true,
      onDone: () => {
        Nav.pop();
        app.restart();
      },
    })
  );
}

async function backgroundRefresh(pl) {
  await wait(4000);
  if (Session.pl !== pl) return;
  if (pl.type === 'xtream' && (!pl.account || nowSec() - (pl.account.checked || 0) > 3600)) {
    try {
      await refreshAccount(pl);
    } catch (e) {
      /* offline */
    }
  }
  const stale = staleSections(pl);
  if (stale.length) {
    try {
      await syncPlaylist(pl, pl.type === 'xtream' ? stale : ['live', 'vod', 'series']);
    } catch (e) {
      toast('Could not refresh the playlist. Showing the last saved copy.');
    }
  }
  if (epgUrls(pl).length && (!pl.synced.epg || nowSec() - pl.synced.epg > 12 * 3600)) syncGuide(pl).catch(() => {});
}

async function firstLoad(pl) {
  const box = progress('Loading your playlist');
  const labels = { live: 'Loading channels', vod: 'Loading movies', series: 'Loading series', m3u: 'Reading the playlist' };
  try {
    await syncPlaylist(pl, ['live', 'vod', 'series'], (st, n) => box.set(labels[st.split(':')[0]] || 'Loading', n ? String(n) : ''));
    box.close();
    if (epgUrls(pl).length) syncGuide(pl).catch(() => {});
    return true;
  } catch (e) {
    box.close();
    toast(e.message || 'Could not load the playlist', true);
    return false;
  }
}

let backAt = 0;
Nav.onExit = () => {
  const t = Date.now();
  if (t - backAt < 2200) {
    Store.flush();
    Video.stop();
    Native.exit();
    return;
  }
  backAt = t;
  toast('Press Back again to exit');
};

// The Android host sends the Back button here.
window.__key = (name, type) => {
  if (type === 'down' && name === 'back') Nav.back();
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !window.AndroidNative) Nav.back();
});

events.on('lifecycle', (m) => {
  const top = Nav.top();
  if (m.state === 'background') {
    if (top instanceof PlayerPage) top.saveProgress();
    Store.flush();
    if (Video.cur) {
      app.resume = Video.cur.meta;
      Video.cur = null;
      Video.state = 'idle';
    }
  } else if (m.state === 'resume') {
    const r = app.resume;
    app.resume = null;
    if (!r || !top) return;
    if (top instanceof PlayerPage) top.start();
    else if (r.kind === 'live' && top instanceof LivePage) top.tap(r.ch);
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
  Video.init(root, () => 1);
  Nav.init(root, TABS);
  window.__device = Native.info() || {};
  app.applySettings();
  Native.player({ cmd: 'stop' });
  Native.setOrientation('portrait');
  const pl = Playlists.get(Playlists.activeId()) || Playlists.list()[0] || null;
  if (!pl) {
    firstRun();
    Native.ready();
    return;
  }
  activate(pl);
  await Session.catalog.ensure('live');
  Native.ready();
  if (!Session.catalog.get('live').loaded && !(await firstLoad(pl))) {
    Nav.reset(new SetupPage({ edit: pl, first: true, onDone: () => (Nav.pop(), app.restart()) }));
    return;
  }
  Nav.show('live');
  backgroundRefresh(pl);
}

boot().catch((e) => {
  console.error('start failed', e);
  Native.ready();
});
