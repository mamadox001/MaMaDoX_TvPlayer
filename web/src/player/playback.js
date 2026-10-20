// What to play and how: builds stream sources, falls back between HLS and MPEG-TS
// for live channels, hands off to an external player when asked.
import { Video } from './video.js';
import { Session, liveSource, movieSource, episodeSource, catchupSource } from '../data/session.js';
import { settings } from '../store.js';
import { Native } from '../native.js';
import { App } from '../ui/app.js';
import { cleanTitle } from '../util.js';

export function useExternal(kind) {
  const e = settings().externalPlayer;
  return e === 'all' || (e === 'vod' && kind !== 'live');
}

export function openExternal(src, title, startMs) {
  const ok = Native.openExternal({ url: src.url, title, ua: (src.headers && src.headers['User-Agent']) || '', position: startMs || 0 });
  if (!ok) App.toast('No external video player is installed. Install VLC or MX Player from the Play Store.', 'long');
  return ok;
}

/** Plays a live channel. placement: element, 'full' or 'keep'. */
export function playChannel(ch, placement, opts) {
  opts = opts || {};
  const pl = Session.pl;
  const src = liveSource(pl, ch, opts.fmt);
  if (useExternal('live') && !opts.internal) {
    if (Session.lib) Session.lib.addRecent(ch.id);
    return openExternal(src, ch.name);
  }
  Video.open(src, { kind: 'live', ch, fmt: src.fmt, triedAlt: !!opts.triedAlt }, placement, { muted: !!opts.muted, aspect: settings().aspect });
  if (Session.lib && !opts.noRecent) Session.lib.addRecent(ch.id);
  return true;
}

export function playCatchup(ch, prog, offsetSec, placement) {
  const src = catchupSource(Session.pl, ch, prog, offsetSec || 0);
  if (useExternal('vod')) return openExternal(src, `${ch.name}: ${prog.title}`);
  Video.open(src, { kind: 'catchup', ch, prog, offset: offsetSec || 0 }, placement || 'full', { aspect: settings().aspect });
  return true;
}

export function playMovie(m, startMs, info) {
  const src = movieSource(Session.pl, m);
  if (useExternal('vod')) return openExternal(src, cleanTitle(m.name), startMs);
  Video.open(src, { kind: 'vod', item: m, info: info || null }, 'full', { start: startMs || 0, aspect: settings().aspect });
  return true;
}

/** ep: {id, ext, url, season, episode, title, ...}; series: catalogue item */
export function playEpisode(series, ep, startMs, ctx) {
  const src = episodeSource(Session.pl, ep);
  if (useExternal('vod')) return openExternal(src, `${cleanTitle(series.name)} S${ep.season} E${ep.episode}`, startMs);
  Video.open(src, { kind: 'episode', item: series, ep, ctx: ctx || null }, 'full', { start: startMs || 0, aspect: settings().aspect });
  return true;
}

// Live streams on Xtream servers: when HLS fails try MPEG-TS once (and the other way round).
Video.on('error', () => {
  const c = Video.cur;
  if (!c || c.meta.kind !== 'live' || c.meta.triedAlt) return;
  const pl = Session.pl;
  if (!pl || pl.type !== 'xtream' || settings().liveFormat !== 'auto') return;
  const alt = c.meta.fmt === 'm3u8' ? 'ts' : 'm3u8';
  playChannel(c.meta.ch, 'keep', { fmt: alt, triedAlt: true, muted: !!c.opts.muted, noRecent: true });
});
