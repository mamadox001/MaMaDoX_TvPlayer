// TV guide data. Xtream playlists ask the server per channel; M3U playlists (or any
// playlist with its own guide link) read slices of the parsed XMLTV file.
import { LRU, b64, nowSec } from '../util.js';
import * as X from './xtream.js';
import { fileUrl } from '../native.js';
import { settings } from '../store.js';

const SHORT_TTL = 15 * 60;
const FULL_TTL = 40 * 60;

export class Guide {
  constructor(pl) {
    this.pl = pl;
    this.short = new LRU(900);
    this.full = new LRU(220);
    this.slices = new LRU(400);
    this.xml = null;
    this.xmlLoading = null;
    this.queue = [];
    this.active = 0;
    this.inflight = new Map();
    this.listeners = new Set();
  }

  get mode() {
    return this.pl.type === 'xtream' && !this.pl.epgUrl ? 'xtream' : 'xmltv';
  }

  shift() {
    return (settings().epgShift || 0) * 3600;
  }

  /** Called whenever new guide data arrives: fn(channelId). */
  onUpdate(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify(id) {
    for (const fn of this.listeners) {
      try {
        fn(id);
      } catch (e) {
        console.error(e);
      }
    }
  }

  reset() {
    this.short.clear();
    this.full.clear();
    this.slices.clear();
    this.xml = null;
    this.xmlLoading = null;
  }

  /** Best data already in memory, or null. */
  cached(ch) {
    if (!ch) return null;
    if (this.mode === 'xtream') {
      const f = this.full.get(ch.id);
      if (f) return f.list;
      const s = this.short.get(ch.id);
      return s ? s.list : null;
    }
    const s = this.slices.get(ch.id);
    return s ? s.list : null;
  }

  /** {now, next, list, index} from memory (no network). */
  nowNext(ch, at) {
    const list = this.cached(ch);
    if (!list) return null;
    return pickNow(list, at || nowSec());
  }

  /** Loads (deduplicated, queued) guide data for a channel. */
  load(ch, full) {
    if (!ch) return Promise.resolve([]);
    if (this.mode === 'xtream') {
      if (!ch.epg && !full) {
        // channels without a guide id usually have nothing to show
        const s = this.short.get(ch.id);
        if (s) return Promise.resolve(s.list);
      }
      const t = nowSec();
      const f = this.full.get(ch.id);
      if (f && t - f.t < FULL_TTL) return Promise.resolve(f.list);
      if (!full) {
        const s = this.short.get(ch.id);
        if (s && t - s.t < SHORT_TTL && (s.list.length === 0 || s.list[s.list.length - 1].stop > t)) return Promise.resolve(s.list);
      }
      const key = (full ? 'f:' : 's:') + ch.id;
      return this._enqueue(key, () =>
        (full ? X.fullEpg(this.pl, ch.id) : X.shortEpg(this.pl, ch.id, 8)).then(
          (j) => {
            const list = parseXtream(j, this.shift(), (this.pl.account && this.pl.account.tzOffset) || 0, ch);
            (full ? this.full : this.short).set(ch.id, { t: nowSec(), list });
            this._notify(ch.id);
            return list;
          },
          () => {
            (full ? this.full : this.short).set(ch.id, { t: nowSec() - (full ? FULL_TTL : SHORT_TTL) + 60, list: [] });
            return [];
          }
        )
      );
    }
    const s = this.slices.get(ch.id);
    if (s) return Promise.resolve(s.list);
    return this._enqueue('x:' + ch.id, () =>
      this._loadXml(ch).then((list) => {
        this.slices.set(ch.id, { t: nowSec(), list });
        this._notify(ch.id);
        return list;
      })
    );
  }

  ensureIndex() {
    if (this.xml) return Promise.resolve(this.xml);
    if (!this.xmlLoading) {
      this.xmlLoading = fetch(fileUrl(`pl/${this.pl.id}/epg.idx`), { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : ''))
        .catch(() => '')
        .then((t) => {
          const keys = new Map();
          const xmap = new Map();
          const icons = new Map();
          for (const line of t.split('\n')) {
            const f = line.split('\t');
            if (f[0] === 'K') keys.set(f[1], [+f[2], +f[3]]);
            else if (f[0] === 'X') {
              if (!xmap.has(f[1])) xmap.set(f[1], f[2]);
            } else if (f[0] === 'I') icons.set(f[1], f[2]);
          }
          this.xml = { keys, xmap, icons, empty: keys.size === 0 };
          return this.xml;
        });
    }
    return this.xmlLoading;
  }

  keyFor(ch) {
    const x = this.xml;
    if (!x) return null;
    const e = (ch.epg || '').toLowerCase();
    if (e && x.keys.has(e)) return e;
    return x.xmap.get(ch.id) || null;
  }

  /** Logo advertised by the XMLTV guide, used when the playlist has none. */
  iconFor(ch) {
    const k = this.keyFor(ch);
    return k && this.xml ? this.xml.icons.get(k) || '' : '';
  }

  async _loadXml(ch) {
    await this.ensureIndex();
    const key = this.keyFor(ch);
    if (!key) return [];
    const sl = this.xml.keys.get(key);
    if (!sl) return [];
    let text = '';
    try {
      const r = await fetch(fileUrl(`pl/${this.pl.id}/epg.tsv`, sl), { cache: 'no-store' });
      if (r.ok) text = await r.text();
    } catch (e) {
      return [];
    }
    const shift = this.shift();
    const t = nowSec();
    const archDays = ch.arch || 0;
    const out = [];
    for (const line of text.split('\n')) {
      const f = line.split('\t');
      if (f[0] !== 'P') continue;
      const s0 = +f[2];
      const e0 = +f[3];
      out.push({ start: s0 + shift, stop: e0 + shift, s0, e0, title: f[4] || '', desc: f[5] || '', arch: archDays > 0 && e0 < t && e0 > t - archDays * 86400 });
    }
    return out;
  }

  _enqueue(key, fn) {
    const ex = this.inflight.get(key);
    if (ex) return ex;
    let job;
    const p = new Promise((res) => {
      job = { key, fn, res };
    });
    this.inflight.set(key, p);
    this.queue.push(job);
    if (this.queue.length > 48) {
      const dropped = this.queue.shift();
      this.inflight.delete(dropped.key);
      dropped.res([]);
    }
    this._pump();
    return p;
  }

  _pump() {
    while (this.active < 3 && this.queue.length) {
      const job = this.queue.pop(); // newest first: that is what is on screen
      this.active++;
      Promise.resolve()
        .then(job.fn)
        .then(
          (v) => job.res(v),
          () => job.res([])
        )
        .then(() => {
          this.active--;
          this.inflight.delete(job.key);
          this._pump();
        });
    }
  }
}

function parseXtream(j, shift, tz, ch) {
  const l = (j && j.epg_listings) || [];
  const out = [];
  const t = nowSec();
  for (const p of l) {
    let s = parseInt(p.start_timestamp, 10);
    let e = parseInt(p.stop_timestamp || p.end_timestamp, 10);
    if (!s) s = X.parseLocal(p.start, tz);
    if (!e) e = X.parseLocal(p.end || p.stop, tz);
    if (!s) continue;
    if (!e || e <= s) e = s + 1800;
    const arch = p.has_archive == 1 || (ch && ch.arch > 0 && e < t && e > t - ch.arch * 86400 && p.has_archive === undefined);
    out.push({ start: s + shift, stop: e + shift, s0: s, e0: e, title: b64(p.title), desc: b64(p.description), arch: !!arch });
  }
  out.sort((a, b) => a.start - b.start);
  const dedup = [];
  for (const p of out) if (!dedup.length || dedup[dedup.length - 1].start !== p.start) dedup.push(p);
  return dedup;
}

export function pickNow(list, at) {
  let i = -1;
  for (let k = 0; k < list.length; k++) {
    if (list[k].start <= at && list[k].stop > at) {
      i = k;
      break;
    }
    if (list[k].start > at) break;
  }
  if (i < 0) {
    // nothing airing: next upcoming
    let n = -1;
    for (let k = 0; k < list.length; k++) if (list[k].start > at) {
      n = k;
      break;
    }
    return { now: null, next: n >= 0 ? list[n] : null, index: n, list };
  }
  return { now: list[i], next: list[i + 1] || null, index: i, list };
}

export function progressOf(p, at) {
  if (!p) return 0;
  const t = at || nowSec();
  return Math.max(0, Math.min(1, (t - p.start) / Math.max(1, p.stop - p.start)));
}
