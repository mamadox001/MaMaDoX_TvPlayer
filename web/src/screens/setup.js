// Add or edit a playlist: Xtream Codes login or an M3U link, typed with the
// on-screen keyboard, the TV's own keyboard, or sent from a phone.
import { h, fmtCount } from '../util.js';
import { App, Screen } from '../ui/app.js';
import { Keyboard } from '../ui/keyboard.js';
import { icon, topbar } from '../ui/widgets.js';
import { confirm, progress } from '../ui/dialogs.js';
import { Native, events } from '../native.js';
import { setPassthrough } from '../keys.js';
import { Playlists, activate, syncPlaylist, syncGuide, epgUrls } from '../data/session.js';
import * as X from '../data/xtream.js';
import qrcode from 'qrcode-generator';

const FIELDS = {
  xtream: [
    { k: 'name', label: 'Playlist name', ph: 'My IPTV', mode: 'text' },
    { k: 'server', label: 'Server address', ph: 'http://example.com:8080', mode: 'url' },
    { k: 'user', label: 'Username', ph: '', mode: 'text' },
    { k: 'pass', label: 'Password', ph: '', mode: 'text' },
  ],
  m3u: [
    { k: 'name', label: 'Playlist name', ph: 'My IPTV', mode: 'text' },
    { k: 'url', label: 'Playlist link (M3U)', ph: 'http://example.com/playlist.m3u', mode: 'url' },
    { k: 'epg', label: 'TV guide link (XMLTV, optional)', ph: 'Leave empty to use the link inside the playlist', mode: 'url' },
  ],
};

export class SetupScreen extends Screen {
  constructor(opts) {
    super('setup');
    this.opts = opts || {};
    const pl = this.opts.edit;
    this.type = pl ? pl.type : 'xtream';
    this.values = pl
      ? { name: pl.name || '', server: pl.base || '', user: pl.user || '', pass: pl.pass || '', url: pl.url || '', epg: pl.epgUrl || '' }
      : { name: '', server: '', user: '', pass: '', url: '', epg: '' };
    this.zone = 'fields';
    this.fi = pl ? 1 : 0;
    this.ai = 0;
    this.editing = false;
    this.systemIme = false;
  }

  build() {
    const pl = this.opts.edit;
    this.el.append(topbar(pl ? 'Edit playlist' : this.opts.first ? 'Welcome' : 'Add a playlist', pl ? pl.name : 'Sign in with the details from your IPTV provider.'));
    this.tabs = [h('div.tab', null, icon('user'), h('span', { text: 'Xtream Codes' })), h('div.tab', null, icon('list'), h('span', { text: 'M3U link' }))];
    this.tabBar = h('div.tabs', null, this.tabs);
    this.form = h('div.setup-fields');
    this.actions = [h('div.btn.btn-wide', null, icon(pl ? 'check' : 'plus'), h('span', { text: pl ? 'Save changes' : 'Add playlist' }))];
    if (!this.opts.first) this.actions.push(h('div.btn', { text: 'Cancel' }));
    this.imeBtn = h('div.ime-toggle', null, icon('edit'), h('span', { text: '' }));
    this.left = h('div.setup-left', null, this.tabBar, this.form, h('div.setup-actions', null, this.actions), this.imeBtn);
    // right side: keyboard while typing, phone setup otherwise
    this.kbd = new Keyboard({ mode: 'url', onChange: (v) => this.setValue(v), onDone: () => this.stopEdit(true) });
    this.kbdBox = h('div.setup-kbd', null, h('div.kbd-title'), this.kbd.el);
    this.qrBox = h('div.qr');
    this.phoneUrl = h('div.phone-url');
    this.phone = h('div.phone', null, h('div.phone-head', null, icon('phone'), h('span', { text: 'Type it on your phone instead' })), h('div.phone-body', null, this.qrBox, h('div.phone-steps', null, h('p', { text: 'Connect your phone to the same Wi-Fi as this TV, scan the code or open this address:' }), this.phoneUrl, h('p.phone-small', { text: 'Fill in the form on your phone and press Send. The details appear here for you to check.' }))));
    this.right = h('div.setup-right', null, this.phone, this.kbdBox);
    this.el.append(h('div.setup-body', null, this.left, this.right));
    this.renderFields();
    this.paint();
    this.offPhone = events.on('phone', (m) => this.fromPhone(m.data || {}));
  }

  enter() {
    const url = Native.phoneSetup(true);
    if (url) {
      this.phoneUrl.textContent = url;
      try {
        const q = qrcode(0, 'M');
        q.addData(url);
        q.make();
        this.qrBox.innerHTML = q.createSvgTag({ cellSize: 7, margin: 2, scalable: true });
      } catch (e) {
        this.qrBox.textContent = '';
      }
      this.phone.style.display = '';
    } else {
      this.phone.classList.add('is-off');
      this.phoneUrl.textContent = 'Connect the TV to your network to use this.';
    }
  }

  leave() {
    Native.phoneSetup(false);
    this.endSystemIme();
  }

  destroy() {
    if (this.offPhone) this.offPhone();
    super.destroy();
  }

  get fields() {
    return FIELDS[this.type];
  }

  renderFields() {
    this.form.innerHTML = '';
    this.fieldEls = this.fields.map((f) => {
      const input = h('input.field-native', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
      const el = h('div.field', null, h('div.field-label', { text: f.label }), h('div.field-value'), input);
      el.__input = input;
      this.form.appendChild(el);
      return el;
    });
    this.fieldEls.forEach((el, i) => this.paintField(i));
  }

  paintField(i) {
    const f = this.fields[i];
    const el = this.fieldEls[i];
    const v = this.values[f.k];
    const val = el.children[1];
    val.textContent = v || f.ph || '';
    val.classList.toggle('empty', !v);
  }

  paint() {
    this.tabs.forEach((t, i) => {
      t.classList.toggle('is-current', (i === 0) === (this.type === 'xtream'));
      t.classList.toggle('is-focused', this.zone === 'tabs' && (i === 0) === (this.type === 'xtream'));
    });
    this.fieldEls.forEach((el, i) => {
      el.classList.toggle('is-focused', this.zone === 'fields' && i === this.fi && !this.editing);
      el.classList.toggle('is-editing', this.editing && i === this.fi);
    });
    this.actions.forEach((b, i) => b.classList.toggle('is-focused', this.zone === 'actions' && i === this.ai));
    this.imeBtn.classList.toggle('is-focused', this.zone === 'ime');
    this.imeBtn.lastChild.textContent = this.systemIme ? 'Typing with the TV keyboard. Switch to the on-screen keyboard' : 'Use the TV keyboard instead';
    this.right.classList.toggle('typing', this.editing && !this.systemIme);
    this.kbd.setActive(this.editing && !this.systemIme);
    if (this.editing) this.kbdBox.firstChild.textContent = this.fields[this.fi].label;
  }

  setValue(v) {
    this.values[this.fields[this.fi].k] = v;
    this.paintField(this.fi);
  }

  startEdit() {
    const f = this.fields[this.fi];
    if (this.systemIme) return this.startSystemIme();
    this.editing = true;
    this.kbd.o.mode = f.mode;
    this.kbd.render();
    this.kbd.setValue(this.values[f.k]);
    this.kbd.row = 1;
    this.kbd.col = 0;
    this.paint();
  }

  stopEdit(advance) {
    this.editing = false;
    if (advance) {
      if (this.fi < this.fields.length - 1) this.fi++;
      else {
        this.zone = 'actions';
        this.ai = 0;
      }
    }
    this.paint();
  }

  startSystemIme() {
    const el = this.fieldEls[this.fi];
    const input = el.__input;
    input.value = this.values[this.fields[this.fi].k] || '';
    input.style.opacity = '1';
    input.style.color = 'var(--paper)';
    el.children[1].style.visibility = 'hidden';
    el.classList.add('is-editing');
    setPassthrough(true);
    Native.setKeyPassthrough(true);
    input.focus();
    this.imeInput = input;
    input.oninput = () => this.setValue(input.value);
  }

  endSystemIme() {
    const input = this.imeInput;
    if (!input) return;
    this.imeInput = null;
    this.setValue(input.value);
    input.blur();
    input.style.opacity = '';
    input.style.color = '';
    input.oninput = null;
    input.parentNode.children[1].style.visibility = '';
    setPassthrough(false);
    Native.setKeyPassthrough(false);
    this.paint();
  }

  fromPhone(d) {
    const type = d.type === 'm3u' ? 'm3u' : 'xtream';
    this.type = type;
    this.values.name = d.name || this.values.name;
    if (type === 'xtream') {
      this.values.server = d.server || '';
      this.values.user = d.user || '';
      this.values.pass = d.pass || '';
    } else {
      this.values.url = d.url || '';
      this.values.epg = d.epg || '';
    }
    this.editing = false;
    this.renderFields();
    this.zone = 'actions';
    this.ai = 0;
    this.paint();
    App.toast('Received from your phone. Check the details, then add the playlist.', 'long');
  }

  key(ev) {
    if (this.imeInput) {
      if (ev.key === 'ok' || ev.key === 'back' || ev.key === 'down' || ev.key === 'up') {
        this.endSystemIme();
        if (ev.key === 'ok' || ev.key === 'down') this.stopEdit(true);
      }
      return true;
    }
    if (this.editing) {
      if (ev.key === 'back') {
        this.stopEdit(false);
        return true;
      }
      if (this.kbd.key(ev)) return true;
      if (ev.key === 'left' || ev.key === 'up') {
        this.stopEdit(false);
        return true;
      }
      return true;
    }
    const k = ev.key;
    if (this.zone === 'tabs') {
      if (k === 'left' || k === 'right') {
        const t = k === 'left' ? 'xtream' : 'm3u';
        if (t !== this.type) {
          this.type = t;
          this.renderFields();
        }
      } else if (k === 'down') {
        this.zone = 'fields';
        this.fi = 0;
      } else if (k === 'ok') {
        this.type = this.type === 'xtream' ? 'm3u' : 'xtream';
        this.renderFields();
      } else return false;
      this.paint();
      return true;
    }
    if (this.zone === 'fields') {
      if (k === 'up') {
        if (this.fi > 0) this.fi--;
        else this.zone = this.opts.edit ? 'fields' : 'tabs';
      } else if (k === 'down') {
        if (this.fi < this.fields.length - 1) this.fi++;
        else this.zone = 'actions';
      } else if (k === 'ok' || k === 'right') {
        this.startEdit();
        return true;
      } else if (k === 'char' || k === 'digit') {
        this.startEdit();
        if (!this.systemIme) this.kbd.key(ev);
        return true;
      } else return false;
      this.paint();
      return true;
    }
    if (this.zone === 'actions') {
      if (k === 'up') {
        this.zone = 'fields';
        this.fi = this.fields.length - 1;
      } else if (k === 'down') this.zone = 'ime';
      else if (k === 'left') this.ai = Math.max(0, this.ai - 1);
      else if (k === 'right') this.ai = Math.min(this.actions.length - 1, this.ai + 1);
      else if (k === 'ok') {
        if (this.ai === 0) this.submit();
        else App.pop();
        return true;
      } else return false;
      this.paint();
      return true;
    }
    if (this.zone === 'ime') {
      if (k === 'up') this.zone = 'actions';
      else if (k === 'ok') this.systemIme = !this.systemIme;
      else return false;
      this.paint();
      return true;
    }
    return false;
  }

  async submit() {
    const v = this.values;
    const edit = this.opts.edit;
    let pl;
    if (this.type === 'xtream') {
      const n = X.normalizeServer(v.server);
      if (!n) return this.fail('Enter the server address', 'It looks like http://example.com:8080. Your provider sends it with your username and password.', 1);
      const user = v.user || n.user;
      const pass = v.pass || n.pass;
      if (!user || !pass) return this.fail('Enter your username and password', 'Both come from your IPTV provider.', user ? 3 : 2);
      pl = Object.assign({}, edit || {}, { type: 'xtream', base: n.base, user, pass, name: v.name || hostName(n.base), epgUrl: '' });
    } else {
      let url = (v.url || '').trim();
      if (!url) return this.fail('Enter the playlist link', 'It usually ends with .m3u or contains get.php.', 1);
      if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      const xc = X.xtreamFromM3u(url);
      if (xc) {
        // Xtream panel export: sign in with the API for movies, series and the guide
        pl = Object.assign({}, edit || {}, { type: 'xtream', base: xc.base, user: xc.user, pass: xc.pass, name: v.name || hostName(xc.base), epgUrl: (v.epg || '').trim(), m3uFallback: url });
      } else {
        pl = Object.assign({}, edit || {}, { type: 'm3u', url, epgUrl: (v.epg || '').trim(), name: v.name || hostName(url) });
      }
    }
    pl.synced = {};
    pl.counts = {};
    const box = progress(edit ? 'Updating playlist' : 'Adding playlist');
    try {
      if (pl.type === 'xtream') {
        box.set('Signing in');
        try {
          pl.account = await X.login(pl);
        } catch (e) {
          if (pl.m3uFallback) {
            // the panel does not offer the API: read the M3U file instead
            pl = Object.assign({}, pl, { type: 'm3u', url: pl.m3uFallback });
            delete pl.account;
          } else throw e;
        }
      }
      if (!pl.id) pl.id = 'p' + Date.now().toString(36);
      const labels = { live: 'Loading channels', vod: 'Loading movies', series: 'Loading series', m3u: 'Reading the playlist' };
      await syncPlaylist(pl, ['live', 'vod', 'series'], (stage, n) => {
        const s = stage.split(':')[0];
        box.set(labels[s] || 'Loading', n ? fmtCount(n) : '');
      });
      if (edit) Playlists.update(pl);
      else Playlists.add(pl);
      box.close();
      activate(pl);
      if (epgUrls(pl).length) syncGuide(pl).catch(() => {});
      const c = pl.counts;
      App.toast(`Loaded ${fmtCount(c.live || 0)} channels, ${fmtCount(c.vod || 0)} movies and ${fmtCount(c.series || 0)} series`, 'long');
      if (this.opts.onDone) this.opts.onDone(pl);
    } catch (e) {
      box.close();
      if (!edit && pl.id) Native.remove('pl/' + pl.id);
      this.fail(pl.type === 'xtream' ? 'Could not sign in' : 'Could not load the playlist', e.message || String(e), -1);
    }
  }

  fail(title, msg, field) {
    confirm(title, msg, [{ label: 'Edit details', value: 1 }]).then(() => {
      if (field >= 0) {
        this.zone = 'fields';
        this.fi = Math.min(field, this.fields.length - 1);
      }
      this.paint();
    });
  }
}

function hostName(u) {
  const m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(u || '');
  return m ? m[1].replace(/^www\./, '') : 'My playlist';
}

export function isFirstRun() {
  return !Playlists.list().length;
}
