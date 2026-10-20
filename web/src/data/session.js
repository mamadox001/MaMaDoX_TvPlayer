// The active playlist and everything loaded for it, plus playlist management
// and background synchronisation through native jobs.
import { Store, settings } from '../store.js';
import { Native, events, setNetUserAgent } from '../native.js';
import { Catalog } from './catalog.js';
import { Guide } from './epg.js';
import { Library } from './library.js';
import * as X from './xtream.js';
import { Emitter, uid, nowSec, parseQS } from '../util.js';

export const bus = new Emitter();

export const Session = {
  pl: null,
  catalog: null,
  guide: null,
  lib: null,
  /** unlocked adult content for this app session */
  unlocked: false,
};

function plData() {
  return Store.get('playlists', { list: [], active: null });
}

export const Playlists = {
  list() {
    return plData().list;
  },
  get(id) {
    return plData().list.find((p) => p.id === id) || null;
  },
  activeId() {
    return plData().active;
  },
  save() {
    Store.touch('playlists');
  },
  add(pl) {
    const d = plData();
    pl.id = pl.id || uid();
    pl.created = nowSec();
    pl.synced = pl.synced || {};
    pl.counts = pl.counts || {};
    d.list.push(pl);
    Store.set('playlists', d);
    return pl;
  },
  update(pl) {
    const d = plData();
    const i = d.list.findIndex((p) => p.id === pl.id);
    if (i >= 0) d.list[i] = pl;
    Store.set('playlists', d);
  },
  remove(id) {
    const d = plData();
    d.list = d.list.filter((p) => p.id !== id);
    if (d.active === id) d.active = d.list.length ? d.list[0].id : null;
    Store.set('playlists', d);
    Store.drop('lib-' + id);
    Native.remove('pl/' + id);
  },
  setActive(id) {
    const d = plData();
    d.active = id;
    Store.set('playlists', d);
  },
};

/** Makes a playlist the active one and prepares its catalogue. */
export function activate(pl) {
  if (!pl) {
    Session.pl = Session.catalog = Session.guide = Session.lib = null;
    bus.emit('playlist', null);
    return;
  }
  Playlists.setActive(pl.id);
  Session.pl = pl;
  Session.catalog = new Catalog(pl);
  Session.guide = new Guide(pl);
  Session.lib = new Library(pl.id);
  Session.unlocked = false;
  setNetUserAgent(pl.ua || settings().userAgent || '');
  bus.emit('playlist', pl);
}

// ------------------------------------------------------------------ jobs

const jobs = new Map();
events.on('job', (m) => {
  const j = jobs.get(m.id);
  if (!j) return;
  if (m.state === 'progress') j.progress && j.progress(m.stage, m.count);
  else {
    jobs.delete(m.id);
    if (m.state === 'done') j.resolve(m.result || {});
    else if (m.state === 'cancelled') j.reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
    else j.reject(new Error(m.message || 'Loading failed'));
  }
});

export function runJob(job, progress) {
  const id = 'j' + uid();
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, progress });
    Native.startJob(id, job);
  });
}

const running = new Map();

/**
 * Downloads catalogue sections (live, vod, series) for a playlist.
 * progress(stage, count) is called while loading.
 */
export function syncPlaylist(pl, sections, progress) {
  const key = pl.id + ':' + sections.join(',');
  if (running.has(key)) return running.get(key);
  let p;
  if (pl.type === 'xtream') {
    p = runJob({ type: 'xtream', pid: pl.id, base: pl.base, user: pl.user, pass: pl.pass, ua: pl.ua || settings().userAgent || '', sections }, progress).then((r) => {
      for (const s of sections) {
        pl.synced[s] = nowSec();
        pl.counts[s] = r[s] || 0;
      }
      return r;
    });
  } else {
    p = runJob({ type: 'm3u', pid: pl.id, url: pl.url, ua: pl.ua || settings().userAgent || '' }, progress).then((r) => {
      const t = nowSec();
      pl.synced.live = pl.synced.vod = pl.synced.series = t;
      pl.counts.live = r.live || 0;
      pl.counts.vod = r.vod || 0;
      pl.counts.series = r.series || 0;
      if (r.epg) pl.m3uEpg = r.epg;
      return r;
    });
  }
  p = p.then(
    (r) => {
      running.delete(key);
      Playlists.update(pl);
      if (Session.pl && Session.pl.id === pl.id) {
        for (const s of pl.type === 'xtream' ? sections : ['live', 'vod', 'series']) Session.catalog.invalidate(s);
        bus.emit('synced', pl.type === 'xtream' ? sections : ['live', 'vod', 'series']);
      }
      return r;
    },
    (e) => {
      running.delete(key);
      throw e;
    }
  );
  running.set(key, p);
  return p;
}

export function epgUrls(pl) {
  const raw = pl.epgUrl || (pl.type === 'm3u' ? pl.m3uEpg : '') || '';
  return raw.split(/[,\s]+/).filter((u) => /^https?:\/\//i.test(u));
}

/** Parses the XMLTV guide for playlists that use one. */
export function syncGuide(pl, progress) {
  const urls = epgUrls(pl);
  if (!urls.length) return Promise.resolve(null);
  const key = pl.id + ':epg';
  if (running.has(key)) return running.get(key);
  const p = runJob({ type: 'xmltv', pid: pl.id, urls, ua: pl.ua || settings().userAgent || '', hours: 36 }, progress).then(
    (r) => {
      running.delete(key);
      pl.synced.epg = nowSec();
      pl.counts.epg = r.programmes || 0;
      Playlists.update(pl);
      if (Session.pl && Session.pl.id === pl.id) {
        Session.guide.reset();
        bus.emit('guide');
      }
      return r;
    },
    (e) => {
      running.delete(key);
      throw e;
    }
  );
  running.set(key, p);
  return p;
}

export function isSyncing(pl) {
  for (const k of running.keys()) if (k.indexOf(pl.id + ':') === 0) return true;
  return false;
}

/** Refreshes account details (expiry, connections) for Xtream playlists. */
export async function refreshAccount(pl) {
  if (pl.type !== 'xtream') return null;
  const acc = await X.login(pl);
  pl.account = acc;
  Playlists.update(pl);
  bus.emit('account', pl);
  return acc;
}

/** Sections whose data is older than the refresh interval. */
export function staleSections(pl) {
  const hours = settings().refreshHours || 24;
  const limit = nowSec() - hours * 3600;
  const out = [];
  for (const s of ['live', 'vod', 'series']) if (!pl.synced[s] || pl.synced[s] < limit) out.push(s);
  return out;
}

// ------------------------------------------------------------------ stream sources

function m3uHeaders(item) {
  const x = parseQS(item.extra || '');
  const h = {};
  if (x.ua) h['User-Agent'] = x.ua;
  if (x.ref) h.Referer = x.ref;
  return { h, x };
}

function plHeaders(pl) {
  const ua = pl.ua || settings().userAgent;
  return ua ? { 'User-Agent': ua } : {};
}

export function liveSource(pl, ch, fmt) {
  if (pl.type === 'xtream') {
    const f = fmt || X.liveFormat(pl, settings().liveFormat);
    return { url: X.liveUrl(pl, ch, f), headers: plHeaders(pl), live: true, fmt: f };
  }
  const { h } = m3uHeaders(ch);
  return { url: ch.url, headers: Object.assign(plHeaders(pl), h), live: true };
}

export function movieSource(pl, m) {
  if (pl.type === 'xtream') return { url: X.vodUrl(pl, m), headers: plHeaders(pl), live: false };
  const { h } = m3uHeaders(m);
  return { url: m.url, headers: Object.assign(plHeaders(pl), h), live: false };
}

export function episodeSource(pl, ep) {
  if (pl.type === 'xtream') return { url: X.episodeUrl(pl, ep), headers: plHeaders(pl), live: false };
  const { h } = m3uHeaders(ep);
  return { url: ep.url, headers: Object.assign(plHeaders(pl), h), live: false };
}

export function canCatchup(pl, ch) {
  if (!ch || !ch.arch) return false;
  if (pl.type === 'xtream') return true;
  const x = parseQS(ch.extra || '');
  return !!(x.cu || x.cus || /\/live\/[^/]+\/[^/]+\/\d+/.test(ch.url));
}

/** Catch-up (time-shift) stream for a past programme; offsetSec skips into it. */
export function catchupSource(pl, ch, prog, offsetSec) {
  const off = offsetSec || 0;
  if (pl.type === 'xtream') return { url: X.catchupUrl(pl, ch, prog, off), headers: plHeaders(pl), live: false, catchup: true };
  const { h, x } = m3uHeaders(ch);
  const s0 = (prog.s0 != null ? prog.s0 : prog.start) + off;
  const e0 = prog.e0 != null ? prog.e0 : prog.stop;
  const dur = Math.max(60, e0 - s0);
  const now = nowSec();
  const d = new Date(s0 * 1000);
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  const fill = (tpl) =>
    tpl
      .replace(/\$?\{(utc|start|timestamp)\}/g, String(s0))
      .replace(/\$?\{(utcend|end)\}/g, String(e0))
      .replace(/\$?\{(lutc|now)\}/g, String(now))
      .replace(/\$?\{duration\}/g, String(dur))
      .replace(/\{duration:(\d+)\}/g, (m, div) => String(Math.ceil(dur / +div)))
      .replace(/\{offset:(\d+)\}/g, (m, div) => String(Math.floor((now - s0) / +div)))
      .replace(/\{Y\}/g, d.getUTCFullYear())
      .replace(/\{m\}/g, p2(d.getUTCMonth() + 1))
      .replace(/\{d\}/g, p2(d.getUTCDate()))
      .replace(/\{H\}/g, p2(d.getUTCHours()))
      .replace(/\{M\}/g, p2(d.getUTCMinutes()))
      .replace(/\{S\}/g, p2(d.getUTCSeconds()));
  const type = (x.cu || '').toLowerCase();
  let url = ch.url;
  const xc = /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(\.\w+)?$/.exec(ch.url);
  if (x.cus && (type === 'default' || type === '' || type === 'append')) {
    url = type === 'append' ? ch.url + fill(x.cus) : fill(x.cus);
  } else if (type === 'shift') {
    url = ch.url + (ch.url.indexOf('?') >= 0 ? '&' : '?') + `utc=${s0}&lutc=${now}`;
  } else if (type === 'flussonic' || type === 'fs' || type === 'flussonic-ts') {
    url = /\.m3u8/.test(ch.url) ? ch.url.replace(/\/[^/]*\.m3u8.*$/, `/index-${s0}-${dur}.m3u8`) : ch.url.replace(/\/[^/]*$/, `/timeshift_abs-${s0}.ts`);
  } else if (xc) {
    url = `${xc[1]}/timeshift/${xc[2]}/${xc[3]}/${Math.ceil(dur / 60)}/${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}:${p2(d.getUTCHours())}-${p2(d.getUTCMinutes())}/${xc[4]}.ts`;
  }
  return { url, headers: Object.assign(plHeaders(pl), h), live: false, catchup: true };
}
