// Add or edit a playlist on the phone: Xtream Codes login or an M3U link.
import { h, fmtCount } from '../../src/util.js';
import { Native } from '../../src/native.js';
import { Playlists, activate, syncPlaylist, syncGuide, epgUrls } from '../../src/data/session.js';
import * as X from '../../src/data/xtream.js';
import { Page, Nav, confirm, progress, toast } from '../ui.js';

function hostName(u) {
  const m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(u || '');
  return m ? m[1].replace(/^www\./, '') : 'My playlist';
}

export class SetupPage extends Page {
  /** opts: {first, edit, onDone} */
  constructor(opts) {
    super('setup');
    this.opts = opts || {};
    this.fullscreen = !!this.opts.first;
    const e = this.opts.edit;
    this.type = e ? e.type : 'xtream';
  }

  field(label, name, attrs) {
    const input = h('input.field', Object.assign({ name, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' }, attrs || {}));
    this.inputs[name] = input;
    return h('label.fl', null, h('span', { text: label }), input);
  }

  build() {
    const e = this.opts.edit || {};
    this.inputs = {};
    const seg = h('div.seg');
    const mk = (t, label) => {
      const b = h('button' + (this.type === t ? '.on' : ''), { type: 'button', text: label });
      b.addEventListener('click', () => {
        this.type = t;
        for (const x of seg.children) x.classList.toggle('on', x === b);
        this.xBox.style.display = t === 'xtream' ? '' : 'none';
        this.mBox.style.display = t === 'm3u' ? '' : 'none';
      });
      return b;
    };
    seg.append(mk('xtream', 'Xtream Codes'), mk('m3u', 'M3U link'));
    this.xBox = h('div', null, this.field('Server address', 'server', { inputmode: 'url', placeholder: 'http://example.com:8080' }), this.field('Username', 'user'), this.field('Password', 'pass', { type: 'password' }));
    this.mBox = h('div', null, this.field('Playlist link (M3U)', 'url', { inputmode: 'url', placeholder: 'http://…/playlist.m3u' }), this.field('TV guide link (XMLTV, optional)', 'epg', { inputmode: 'url', placeholder: 'http://…/guide.xml' }));
    this.xBox.style.display = this.type === 'xtream' ? '' : 'none';
    this.mBox.style.display = this.type === 'm3u' ? '' : 'none';
    const save = h('button.btn.primary.wide', { type: 'button', text: this.opts.edit ? 'Save playlist' : 'Add playlist' });
    save.addEventListener('click', () => this.submit());
    const head = this.opts.first
      ? h('div.welcome', null, h('div.brand-big', null, 'MaMaDoX', h('br'), 'TvPlayer'), h('p', { text: 'Add your IPTV subscription to start. The app does not include any channels.' }))
      : h('header.hd', null, h('button.ibtn.hd-back', { type: 'button', 'aria-label': 'Back', on: { click: () => Nav.back() } }, h('span', { text: '‹' })), h('h1', { text: this.opts.edit ? 'Edit playlist' : 'Add playlist' }));
    const form = h('div.form', null, this.field('Playlist name', 'name', { placeholder: 'My IPTV' }), seg, this.xBox, this.mBox, save);
    this.el.append(head, h('div.form-scroll', null, form));
    // fill in when editing
    const v = { name: e.name || '', server: e.base || '', user: e.user || '', pass: e.pass || '', url: e.url || '', epg: e.epgUrl || '' };
    for (const k in v) if (this.inputs[k]) this.inputs[k].value = v[k];
  }

  back() {
    return !!this.opts.first && !Playlists.list().length && (Nav.onExit && Nav.onExit(), true);
  }

  async submit() {
    const v = {};
    for (const k in this.inputs) v[k] = this.inputs[k].value.trim();
    const edit = this.opts.edit;
    let pl;
    if (this.type === 'xtream') {
      const n = X.normalizeServer(v.server);
      if (!n) return confirm('Enter the server address', 'It looks like http://example.com:8080. Your provider sends it with your username and password.');
      const user = v.user || n.user;
      const pass = v.pass || n.pass;
      if (!user || !pass) return confirm('Enter your username and password', 'Both come from your IPTV provider.');
      pl = Object.assign({}, edit || {}, { type: 'xtream', base: n.base, user, pass, name: v.name || hostName(n.base), epgUrl: '' });
    } else {
      let url = v.url;
      if (!url) return confirm('Enter the playlist link', 'It usually ends with .m3u or contains get.php.');
      if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      const xc = X.xtreamFromM3u(url);
      if (xc) pl = Object.assign({}, edit || {}, { type: 'xtream', base: xc.base, user: xc.user, pass: xc.pass, name: v.name || hostName(xc.base), epgUrl: v.epg, m3uFallback: url });
      else pl = Object.assign({}, edit || {}, { type: 'm3u', url, epgUrl: v.epg, name: v.name || hostName(url) });
    }
    pl.synced = {};
    pl.counts = {};
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    const box = progress(edit ? 'Updating playlist' : 'Adding playlist');
    try {
      if (pl.type === 'xtream') {
        box.set('Signing in');
        try {
          pl.account = await X.login(pl);
        } catch (e) {
          if (!pl.m3uFallback) throw e;
          pl = Object.assign({}, pl, { type: 'm3u', url: pl.m3uFallback });
          delete pl.account;
        }
      }
      if (!pl.id) pl.id = 'p' + Date.now().toString(36);
      const labels = { live: 'Loading channels', vod: 'Loading movies', series: 'Loading series', m3u: 'Reading the playlist' };
      await syncPlaylist(pl, ['live', 'vod', 'series'], (stage, n) => box.set(labels[stage.split(':')[0]] || 'Loading', n ? fmtCount(n) : ''));
      if (edit) Playlists.update(pl);
      else Playlists.add(pl);
      box.close();
      activate(pl);
      if (epgUrls(pl).length) syncGuide(pl).catch(() => {});
      const c = pl.counts;
      toast(`Loaded ${fmtCount(c.live || 0)} channels, ${fmtCount(c.vod || 0)} movies and ${fmtCount(c.series || 0)} series`, true);
      if (this.opts.onDone) this.opts.onDone(pl);
    } catch (e) {
      box.close();
      if (!edit && pl.id) Native.remove('pl/' + pl.id);
      confirm(pl.type === 'xtream' ? 'Could not sign in' : 'Could not load the playlist', e.message || String(e));
    }
  }
}
