// Controls the single native video surface. A screen says where video belongs:
// a "hole" element in its layout, full screen, or nowhere.
import { Native, events } from '../native.js';
import { Emitter } from '../util.js';

export const Video = {
  session: 0,
  state: 'idle',
  buffering: false,
  cur: null,
  placement: null,
  w: 0,
  h: 0,
  tracks: [],
  ev: new Emitter(),
  root: null,
  scale: () => 1,
  _rect: null,

  init(root, scaleFn) {
    this.root = root;
    this.scale = scaleFn;
  },

  on(e, fn) {
    return this.ev.on(e, fn);
  },

  get active() {
    return !!this.cur && this.state !== 'idle';
  },

  /** src: {url, headers, live}; meta: what is playing; opts: {start, muted, aspect} */
  open(src, meta, placement, opts) {
    opts = opts || {};
    this.session++;
    this.cur = { src, meta: meta || {}, opts };
    this.state = 'preparing';
    this.buffering = true;
    this.w = this.h = 0;
    this.tracks = [];
    this.placement = placement === 'keep' ? this.placement : placement;
    const rect = this._rectFor(this.placement);
    this._rect = rect;
    Native.player({
      cmd: 'open',
      session: this.session,
      url: src.url,
      live: !!src.live,
      start: Math.floor(opts.start || 0),
      headers: src.headers || {},
      muted: !!opts.muted,
      rect,
      aspect: opts.aspect || 'fit',
    });
    this.ev.emit('open', this.cur);
    this.ev.emit('state', this.state);
  },

  stop() {
    if (!this.cur && this.state === 'idle') return;
    const was = this.cur;
    this.cur = null;
    this.state = 'idle';
    this.buffering = false;
    Native.player({ cmd: 'stop' });
    this.ev.emit('stop', was);
    this.ev.emit('state', 'idle');
  },

  /** placement: null (stop), 'keep', 'full', or an element */
  place(p) {
    if (p === 'keep') return;
    if (p == null) {
      if (this.cur) this.stop();
      this.placement = null;
      return;
    }
    this.placement = p;
    if (!this.cur) return;
    const rect = this._rectFor(p);
    if (rect === undefined) return;
    const key = rect ? rect.join(',') : 'full';
    const old = this._rect ? this._rect.join(',') : 'full';
    if (key === old) return;
    this._rect = rect;
    Native.player({ cmd: 'rect', rect });
    this.ev.emit('placed', p);
  },

  _rectFor(p) {
    if (!p || p === 'full') return null;
    let x = 0;
    let y = 0;
    let e = p;
    while (e && e !== this.root) {
      x += e.offsetLeft;
      y += e.offsetTop;
      e = e.offsetParent;
    }
    if (!e || !p.offsetWidth) return undefined;
    const s = this.scale() * (window.devicePixelRatio || 1);
    return [Math.round(x * s), Math.round(y * s), Math.round(p.offsetWidth * s), Math.round(p.offsetHeight * s)];
  },

  pause() {
    Native.player({ cmd: 'pause' });
  },
  resume() {
    Native.player({ cmd: 'resume' });
  },
  toggle() {
    Native.player({ cmd: 'toggle' });
  },
  seek(ms) {
    Native.player({ cmd: 'seek', ms: Math.max(0, Math.floor(ms)) });
  },
  volume(v) {
    Native.player({ cmd: 'volume', v });
  },
  aspect(mode) {
    Native.player({ cmd: 'aspect', mode });
  },
  track(index, on) {
    Native.player({ cmd: 'track', index, on: on !== false });
  },
  status() {
    return Native.playerStatus() || { state: 'idle' };
  },
  loadTracks() {
    this.tracks = Native.playerTracks() || [];
    return this.tracks;
  },
};

events.on('player', (m) => {
  if (m.session !== Video.session) return;
  switch (m.ev) {
    case 'state':
      if (!Video.cur && m.state !== 'idle') return;
      Video.state = m.state;
      Video.buffering = !!m.buffering || m.state === 'preparing' || m.state === 'reconnecting';
      Video.ev.emit('state', m.state);
      break;
    case 'prepared':
      Video.tracks = m.tracks || [];
      Video.ev.emit('prepared', m);
      break;
    case 'size':
      Video.w = m.w;
      Video.h = m.h;
      Video.ev.emit('size', m);
      break;
    case 'firstframe':
      Video.buffering = false;
      Video.ev.emit('firstframe');
      Video.ev.emit('state', Video.state);
      break;
    case 'error':
      Video.ev.emit('error', m);
      break;
    case 'seeked':
      Video.ev.emit('seeked');
      break;
    case 'text':
      Video.ev.emit('text', m.text || '');
      break;
  }
});
