// What to play on the phone: stream sources, HLS/MPEG-TS fallback, external players.
import { Video } from '../src/player/video.js';
import { Session, liveSource, movieSource, episodeSource, catchupSource } from '../src/data/session.js';
import { settings } from '../src/store.js';
import { Native } from '../src/native.js';
import { cleanTitle } from '../src/util.js';
import { toast } from './ui.js';

export function useExternal(kind) {
  const e = settings().externalPlayer;
  return e === 'all' || (e === 'vod' && kind !== 'live');
}

export function openExternal(src, title, startMs) {
  const ok = Native.openExternal({ url: src.url, title, ua: (src.headers && src.headers['User-Agent']) || '', position: startMs || 0 });
  if (!ok) toast('No other video player is installed. Install VLC or MX Player from the Play Store.', true);
  return ok;
}

export function playChannel(ch, placement, opts) {
  opts = opts || {};
  const src = liveSource(Session.pl, ch, opts.fmt);
  Video.open(src, { kind: 'live', ch, fmt: src.fmt, triedAlt: !!opts.triedAlt }, placement, { muted: !!opts.muted, aspect: settings().aspect });
  if (Session.lib && !opts.noRecent) Session.lib.addRecent(ch.id);
}

export function catchupSrc(ch, prog, offsetSec) {
  return catchupSource(Session.pl, ch, prog, offsetSec || 0);
}

export function playCatchup(ch, prog, offsetSec) {
  Video.open(catchupSrc(ch, prog, offsetSec), { kind: 'catchup', ch, prog, offset: offsetSec || 0 }, 'full', { aspect: settings().aspect });
}

export function playMovie(m, startMs, info) {
  Video.open(movieSource(Session.pl, m), { kind: 'vod', item: m, info: info || null }, 'full', { start: startMs || 0, aspect: settings().aspect });
}

export function playEpisode(series, ep, startMs) {
  Video.open(episodeSource(Session.pl, ep), { kind: 'episode', item: series, ep }, 'full', { start: startMs || 0, aspect: settings().aspect });
}

export function sourceFor(p) {
  const pl = Session.pl;
  if (p.mode === 'live') return liveSource(pl, p.ch);
  if (p.mode === 'catchup') return catchupSrc(p.ch, p.prog, p.offset);
  if (p.mode === 'vod') return movieSource(pl, p.item);
  return episodeSource(pl, p.ep);
}

export function titleFor(p) {
  if (p.mode === 'live') return p.ch.name;
  if (p.mode === 'catchup') return `${p.ch.name}: ${p.prog.title}`;
  if (p.mode === 'vod') return cleanTitle(p.item.name);
  return `${cleanTitle(p.series.name)} S${p.ep.season} E${p.ep.episode}`;
}

// Xtream live: when one stream format fails, try the other one once.
Video.on('error', () => {
  const c = Video.cur;
  if (!c || c.meta.kind !== 'live' || c.meta.triedAlt) return;
  const pl = Session.pl;
  if (!pl || pl.type !== 'xtream' || settings().liveFormat !== 'auto') return;
  const alt = c.meta.fmt === 'm3u8' ? 'ts' : 'm3u8';
  playChannel(c.meta.ch, 'keep', { fmt: alt, triedAlt: true, muted: !!c.opts.muted, noRecent: true });
});

/** True while the fallback above is about to retry (the error is not final yet). */
export function willRetry() {
  const c = Video.cur;
  return !!(c && c.meta.kind === 'live' && !c.meta.triedAlt && Session.pl && Session.pl.type === 'xtream' && settings().liveFormat === 'auto');
}
