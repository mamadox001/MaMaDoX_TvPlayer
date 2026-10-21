// One interface to the Android host (window.AndroidNative) or, in a desktop
// browser, to the development server that emulates it.
import { Emitter } from './util.js';

const A = window.AndroidNative;
export const isAndroid = !!A;
export const events = new Emitter();

window.__native = (msg) => {
  if (msg && msg.t) events.emit(msg.t, msg);
};

function devCall(method, args) {
  const x = new XMLHttpRequest();
  x.open('POST', '/__bridge/call', false);
  x.setRequestHeader('Content-Type', 'application/json');
  try {
    x.send(JSON.stringify({ method, args }));
    return JSON.parse(x.responseText).result;
  } catch (e) {
    return null;
  }
}

if (!A && window.EventSource) {
  const es = new EventSource('/__bridge/events');
  es.onmessage = (e) => {
    try {
      window.__native(JSON.parse(e.data));
    } catch (err) {
      /* ignore */
    }
  };
}

function call(method, ...args) {
  if (A) {
    try {
      return A[method](...args);
    } catch (e) {
      console.error('native', method, e);
      return null;
    }
  }
  return devCall(method, args);
}

const parse = (s, d) => {
  if (s == null || s === '') return d;
  try {
    return JSON.parse(s);
  } catch (e) {
    return d;
  }
};

// ------------------------------------------------------------------ dev player
// In a desktop browser a <video> element behind the transparent UI stands in for
// the native player and produces the same events.
class DevPlayer {
  constructor() {
    this.v = null;
    this.session = 0;
    this.live = false;
    this.state = 'idle';
  }
  ensure() {
    if (this.v) return;
    const v = (this.v = document.createElement('video'));
    v.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;background:#000;object-fit:contain;z-index:0';
    v.playsInline = true;
    document.body.insertBefore(v, document.body.firstChild);
    const ev = (e, extra) => window.__native(Object.assign({ t: 'player', ev: e, session: this.session }, extra || {}));
    const st = (s) => {
      this.state = s;
      ev('state', { state: s, buffering: false });
    };
    v.addEventListener('loadedmetadata', () => {
      if (this.start && !this.live) v.currentTime = this.start / 1000;
      ev('size', { w: v.videoWidth, h: v.videoHeight });
      ev('prepared', { dur: this.live ? 0 : v.duration * 1000, tracks: [{ index: 1, kind: 'audio', lang: 'en', selected: true }, { index: 2, kind: 'audio', lang: 'fr', selected: false }] });
    });
    v.addEventListener('playing', () => st('playing'));
    v.addEventListener('pause', () => {
      if (this.state !== 'idle' && !v.ended) st('paused');
    });
    v.addEventListener('waiting', () => ev('state', { state: this.state, buffering: true }));
    v.addEventListener('ended', () => st(this.live ? 'error' : 'ended'));
    v.addEventListener('error', () => {
      if (this.state === 'idle') return;
      ev('error', { what: 1, extra: -1004, message: 'dev error' });
      st('error');
    });
  }
  cmd(c) {
    this.ensure();
    const v = this.v;
    switch (c.cmd) {
      case 'open':
        this.session = c.session;
        this.live = !!c.live;
        this.start = c.start || 0;
        if (c.rect !== undefined) this.rect(c.rect);
        v.muted = !!c.muted;
        this.load(c.url, !!c.live);
        this.state = 'preparing';
        window.__native({ t: 'player', ev: 'state', session: this.session, state: 'preparing' });
        v.play().catch(() => {});
        break;
      case 'stop':
        this.state = 'idle';
        this.teardown();
        v.removeAttribute('src');
        v.load();
        window.__native({ t: 'player', ev: 'state', session: this.session, state: 'idle' });
        break;
      case 'pause':
        v.pause();
        break;
      case 'resume':
        v.play().catch(() => {});
        break;
      case 'toggle':
        if (v.paused) v.play().catch(() => {});
        else v.pause();
        break;
      case 'seek':
        v.currentTime = c.ms / 1000;
        setTimeout(() => window.__native({ t: 'player', ev: 'seeked', session: this.session }), 50);
        break;
      case 'rect':
        this.rect(c.rect);
        break;
      case 'volume':
        v.volume = c.v;
        v.muted = c.v === 0;
        break;
      case 'aspect':
        v.style.objectFit = c.mode === 'fill' || c.mode === 'zoom' ? 'cover' : c.mode === 'stretch' ? 'fill' : 'contain';
        break;
    }
  }
  /** Desktop app: HLS through hls.js and MPEG-TS through mpegts.js when they are loaded. */
  load(url, live) {
    const v = this.v;
    this.teardown();
    const bare = url.split('?')[0].toLowerCase();
    const hlsUrl = /\.m3u8?$/.test(bare);
    const tsUrl = /\.ts$/.test(bare) || (live && !hlsUrl && !/\.(mp4|mkv|webm|mov|m4v|mp3|aac)$/.test(bare));
    const fail = () => {
      if (this.state === 'idle') return;
      window.__native({ t: 'player', ev: 'error', session: this.session, what: 1, extra: -1004, message: 'stream error' });
      this.state = 'error';
      window.__native({ t: 'player', ev: 'state', session: this.session, state: 'error' });
    };
    const H = window.Hls;
    const M = window.mpegts;
    if (hlsUrl && H && H.isSupported()) {
      const hls = (this.hls = new H({ lowLatencyMode: false, backBufferLength: 30 }));
      hls.on(H.Events.ERROR, (e, d) => {
        if (!d.fatal) return;
        if (d.type === H.ErrorTypes.MEDIA_ERROR && !this.recovered) {
          this.recovered = true;
          hls.recoverMediaError();
        } else fail();
      });
      this.recovered = false;
      hls.loadSource(url);
      hls.attachMedia(v);
    } else if (tsUrl && M && M.isSupported()) {
      const p = (this.ts = M.createPlayer({ type: 'mpegts', isLive: live, url }, { enableStashBuffer: true, liveBufferLatencyChasing: false, statisticsInfoReportInterval: 2000000000 }));
      p.on(M.Events.ERROR, fail);
      p.attachMediaElement(v);
      p.load();
    } else {
      v.src = url;
      v.loop = live && /\.webm$/.test(bare);
    }
  }
  teardown() {
    if (this.hls) this.hls.destroy();
    if (this.ts) {
      const p = this.ts;
      try {
        p.pause();
        p.unload();
        p.detachMediaElement();
      } catch (e) {
        /* already stopped */
      }
      // mpegts.js still finishes pending network callbacks: destroy it once they are done
      setTimeout(() => {
        try {
          p.destroy();
        } catch (e) {
          /* already gone */
        }
      }, 4000);
    }
    this.hls = this.ts = null;
  }
  rect(r) {
    const s = this.v.style;
    if (!r) {
      s.left = '0';
      s.top = '0';
      s.width = '100vw';
      s.height = '100vh';
      return;
    }
    const d = window.devicePixelRatio || 1;
    s.left = r[0] / d + 'px';
    s.top = r[1] / d + 'px';
    s.width = r[2] / d + 'px';
    s.height = r[3] / d + 'px';
  }
  status() {
    const v = this.v;
    if (!v) return { state: 'idle' };
    return { session: this.session, state: this.state, pos: Math.floor(v.currentTime * 1000), dur: this.live ? 0 : Math.floor((v.duration || 0) * 1000), w: v.videoWidth, h: v.videoHeight, live: this.live };
  }
}
const devPlayer = A ? null : new DevPlayer();

export const Native = {
  info: () => parse(call('info'), {}),
  ready: () => call('ready'),
  exit: () => call('exitApp'),
  log: (s) => call('log', String(s)),
  readText: (name) => call('readText', name),
  writeText: (name, text) => call('writeText', name, text),
  remove: (name) => call('remove', name),
  fileInfo: (name) => parse(call('fileInfo', name), { exists: false }),
  cacheInfo: () => parse(call('cacheInfo'), {}),
  clearImageCache: () => call('clearImageCache'),
  setOption: (k, v) => call('setOption', k, String(v)),
  setKeyPassthrough: (on) => call('setKeyPassthrough', !!on),
  startJob: (id, job) => call('startJob', id, JSON.stringify(job)),
  cancelJob: (id) => call('cancelJob', id),
  player: (cmd) => (A ? call('player', JSON.stringify(cmd)) : devPlayer.cmd(cmd)),
  playerStatus: () => (A ? parse(call('playerStatus'), { state: 'idle' }) : devPlayer.status()),
  playerTracks: () => (A ? parse(call('playerTracks'), []) : window.__desktop ? [] : [{ index: 1, kind: 'audio', lang: 'en', selected: true }, { index: 2, kind: 'audio', lang: 'fr', selected: false }]),
  openExternal: (o) => !!call('openExternal', JSON.stringify(o)),
  openUrl: (u) => !!call('openUrl', u),
  voiceSearch: () => !!call('voiceSearch'),
  /** Phone only: 'portrait', 'landscape' or 'auto'. */
  setOrientation: (m) => call('setOrientation', m),
  phoneSetup: (start) => call('phoneSetup', !!start) || '',
};

/** URL of a file written by native jobs. */
export function fileUrl(rel, slice) {
  let u = '/files/' + rel.split('/').map(encodeURIComponent).join('/');
  if (slice) u += `?o=${slice[0]}&n=${slice[1]}`;
  return u;
}

/** URL through the native image cache, resized to width w. */
export function imgUrl(src, w) {
  if (!src || !/^https?:\/\//i.test(src)) return '';
  // TMDB serves any size: ask for a small one directly
  const t = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)(original|w\d+|w\d+_and_h\d+_[a-z]+)(\/.*)$/.exec(src);
  if (t) src = t[1] + (w <= 200 ? 'w185' : w <= 342 ? 'w342' : w <= 500 ? 'w500' : 'w780') + t[3];
  return '/img?u=' + encodeURIComponent(src) + (w ? '&w=' + w : '');
}

let netUa = '';
export function setNetUserAgent(ua) {
  netUa = ua || '';
}

export class NetError extends Error {
  constructor(msg, status) {
    super(msg);
    this.status = status || 0;
  }
}

/** GET through the native proxy (no CORS limits, custom user agent). */
export async function netFetch(url, opts = {}) {
  const ua = opts.ua || netUa;
  const q = '/net?u=' + encodeURIComponent(url) + (ua ? '&ua=' + encodeURIComponent(ua) : '') + (opts.timeout ? '&t=' + opts.timeout : '') + (opts.referer ? '&ref=' + encodeURIComponent(opts.referer) : '');
  let res;
  try {
    res = await fetch(q, { cache: 'no-store', signal: opts.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new NetError('No connection to the app service.');
  }
  const err = res.headers.get('X-Net-Error');
  if (err) {
    let msg = err;
    try {
      msg = decodeURIComponent(err);
    } catch (e) {
      /* plain text */
    }
    throw new NetError(msg, 0);
  }
  if (!res.ok) throw new NetError(`The server answered ${res.status}.`, res.status);
  return res;
}

export async function netJson(url, opts) {
  const res = await netFetch(url, opts);
  const text = await res.text();
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch (e) {
    if (/^\s*</.test(t)) throw new NetError('The server sent a web page instead of data. Check the server address.');
    throw new NetError('The server sent data the app could not read.');
  }
}
