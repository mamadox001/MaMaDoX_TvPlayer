// Playlist loading for the desktop app: the same TSV files the Android parsers write
// (see android/core), produced in Node.
'use strict';
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const sax = require('sax');

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MaMaDoXTvPlayer/1.0';

class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.cancelled = true;
  }
}

function describe(e) {
  const m = (e && e.message) || String(e);
  if (/ECONNREFUSED/.test(m)) return 'The server refused the connection. Check the address and port.';
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'Server not found. Check the address.';
  if (/ETIMEDOUT|timeout/i.test(m)) return 'The server took too long to respond.';
  if (/ECONNRESET|socket hang up/.test(m)) return 'The connection was interrupted. Try again.';
  if (/certificate|SSL|TLS/i.test(m)) return 'The secure connection failed. Turn on "Allow all certificates" in Settings.';
  return m;
}

const opts = { trustAll: false, ua: '' };

/** GET with redirects and gzip; resolves {code, type, finalUrl, stream}. */
function get(url, ua, headers, timeout, hop) {
  hop = hop || 0;
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(new Error('Invalid link: ' + url));
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('Unsupported link: ' + u.protocol));
    const mod = u.protocol === 'https:' ? https : http;
    const h = Object.assign({ 'User-Agent': ua || opts.ua || DEFAULT_UA, Accept: '*/*', 'Accept-Encoding': 'gzip' }, headers || {});
    const req = mod.get(u, { headers: h, timeout: timeout || 30000, rejectUnauthorized: !opts.trustAll }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hop < 8) {
        r.resume();
        return resolve(get(new URL(r.headers.location, u).toString(), ua, headers, timeout, hop + 1));
      }
      const gz = /gzip/i.test(r.headers['content-encoding'] || '');
      resolve({ code: r.statusCode, type: r.headers['content-type'] || '', finalUrl: url, stream: gz ? r.pipe(zlib.createGunzip()) : r, raw: r });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function readAll(stream, max) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    stream.on('data', (d) => {
      n += d.length;
      if (max && n > max) {
        stream.destroy();
        reject(new Error('Response too large'));
      } else parts.push(d);
    });
    stream.on('end', () => resolve(Buffer.concat(parts)));
    stream.on('error', reject);
  });
}

// ------------------------------------------------------------------ tsv helpers

const clean = (s) => (s == null ? '' : String(s).replace(/[\t\r\n]/g, ' ').trim());
function clip(s, max) {
  s = clean(s);
  if (s.length <= max) return s;
  let cut = s.lastIndexOf(' ', max);
  if (cut < (max * 2) / 3) cut = max;
  return s.slice(0, cut).trim() + '…';
}
const row = (...f) => f.map((v) => (v == null ? '' : v)).join('\t') + '\n';

function normName(s) {
  if (!s) return '';
  let t = s.toLowerCase().trim().normalize('NFD').replace(/\p{M}+/gu, '');
  t = t.replace(/ʜ/g, 'h').replace(/ᴅ/g, 'd');
  t = t.replace(/^(?:\|[^|]{1,8}\|\s*|[a-z]{2,4}\s*[:|]\s*|[a-z]{2,3}\s+-\s+)/, '');
  t = t.replace(/\b(?:uhd|fhd|hd|sd|4k|8k|hevc|h\.?26[45]|1080[pi]?|720p|2160p|50fps|60fps|backup|vip|raw|hdr)\b/g, ' ');
  return t.replace(/[^\p{L}\p{N}+]+/gu, '');
}

function commit(dir, name, text) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, name + '.tmp');
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, path.join(dir, name));
}

// ------------------------------------------------------------------ xtream

const api = (base, user, pass, action) => `${base}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}${action ? '&action=' + action : ''}`;

async function getJson(url, ua) {
  const r = await get(url, ua, null, 120000);
  const body = (await readAll(r.stream)).toString('utf8');
  if (r.code >= 400) throw new Error('The server answered ' + r.code);
  const t = body.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch (e) {
    try {
      return JSON.parse(t.replace(/,\s*([}\]])/g, '$1'));
    } catch (e2) {
      throw new Error(/^</.test(t) ? 'The server sent a web page instead of data. Check the server address.' : 'The server sent data the app could not read.');
    }
  }
}

const records = (j) => (Array.isArray(j) ? j : j && typeof j === 'object' ? Object.values(j) : []).filter((x) => x && typeof x === 'object');
const toInt = (s) => {
  const v = parseFloat(s);
  return isNaN(v) ? 0 : Math.trunc(v);
};
function rating(r10, r5) {
  let v = parseFloat(r10);
  if (!(v > 0)) v = parseFloat(r5) * 2;
  if (!(v > 0) || v > 10.01) return '';
  return String(Math.round(v * 10) / 10);
}

async function xtreamSection(base, user, pass, ua, section, dir, progress, cancel) {
  const acts = { live: ['get_live_categories', 'get_live_streams'], vod: ['get_vod_categories', 'get_vod_streams'], series: ['get_series_categories', 'get_series'] }[section];
  if (!acts) throw new Error('Unknown section ' + section);
  let out = row('H', '2', 'xtream', Date.now());
  progress(section + ':categories', 0);
  for (const c of records(await getJson(api(base, user, pass, acts[0]), ua))) {
    if (c.category_id != null && String(c.category_id) !== '') out += row('C', clean(c.category_id), clean(c.category_name));
  }
  if (cancel()) throw new Cancelled();
  progress(section, 0);
  const list = records(await getJson(api(base, user, pass, acts[1]), ua));
  let n = 0;
  const parts = [out];
  for (const s of list) {
    if (section === 'live') {
      if (s.stream_id == null) continue;
      const days = toInt(s.tv_archive) > 0 ? Math.max(1, toInt(s.tv_archive_duration)) : 0;
      parts.push(row('L', clean(s.stream_id), clean(s.num), clean(s.name), clean(s.stream_icon), clean(s.category_id), clean(s.epg_channel_id), days, toInt(s.is_adult) > 0 ? '1' : '0', '', ''));
    } else if (section === 'vod') {
      if (s.stream_id == null) continue;
      parts.push(row('M', clean(s.stream_id), clean(s.name), clean(s.stream_icon), clean(s.category_id), rating(s.rating, s.rating_5based), clean(s.added), clean(s.container_extension), clean(s.year), toInt(s.is_adult) > 0 ? '1' : '0', '', ''));
    } else {
      if (s.series_id == null) continue;
      let year = '';
      const d = String(s.releaseDate || s.release_date || '');
      if (d.length >= 4) year = d.slice(0, 4);
      if (String(s.year || '').length >= 4) year = String(s.year).slice(0, 4);
      parts.push(row('S', clean(s.series_id), clean(s.name), clean(s.cover), clean(s.category_id), rating(s.rating, s.rating_5based), clean(s.last_modified), year, clip(s.genre, 60)));
    }
    n++;
    if ((n & 2047) === 0) progress(section, n);
  }
  commit(dir, section + '.tsv', parts.join(''));
  progress(section, n);
  return n;
}

// ------------------------------------------------------------------ m3u

const VIDEO_EXT = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'divx', '3gp', 'ogv', 'vob']);
const SXE = /^(.*?)[\s._\-:|([]*\b[Ss](\d{1,3})[\s._-]*[EeXx](\d{1,4})(?!\d)(.*)$/;
const SEASON_WORDS = /^(.*?)[\s._\-:|]*(?:season|saison|temporada|staffel|stagione)\s*(\d{1,3})[\s._\-:|,]*(?:episode|[eé]pisode|episodio|folge|ep\.?|e)\s*(\d{1,4})(.*)$/i;

function fnv(s) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return (h & 0x7fffffffffffffffn).toString(36);
}

function parseAttrs(line, start, out) {
  let i = start;
  const n = line.length;
  while (i < n && /[-.\d ]/.test(line[i])) {
    if (line[i] === ' ' && i > start) break;
    i++;
  }
  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === ',') return line.slice(i + 1);
    const ks = i;
    while (i < n && line[i] !== '=' && line[i] !== ' ' && line[i] !== ',') i++;
    const key = line.slice(ks, i).toLowerCase();
    if (i < n && line[i] === '=') {
      i++;
      let val;
      if (line[i] === '"' || line[i] === "'") {
        const q = line[i++];
        let end = line.indexOf(q, i);
        if (end < 0) end = n;
        val = line.slice(i, end);
        i = Math.min(n, end + 1);
      } else {
        const vs = i;
        while (i < n && line[i] !== ' ' && line[i] !== ',') i++;
        val = line.slice(vs, i);
      }
      if (key && !(key in out)) out[key] = val;
    } else if (!key) i++;
  }
  return '';
}

const first = (...v) => {
  for (const x of v) if (x != null && String(x).trim()) return String(x).trim();
  return '';
};
const trimSep = (s) => (s || '').replace(/^[ ._\-:|([]+/, '').replace(/[ ._\-:|)\]]+$/, '').replace(/[._]/g, ' ').trim();
const yearOf = (name) => {
  let y = '';
  const re = /[([]((?:19|20)\d\d)[)\]]/g;
  let m;
  while ((m = re.exec(name))) y = m[1];
  return y;
};
function extOf(lowerUrl) {
  const p = lowerUrl.split('?')[0];
  const slash = p.lastIndexOf('/');
  const dot = p.lastIndexOf('.');
  return dot > slash && dot < p.length - 1 ? p.slice(dot + 1) : '';
}

async function m3u(url, ua, dir, progress, cancel) {
  const r = await get(url, ua, null, 180000);
  if (r.code === 401 || r.code === 403) throw new Error(`The server refused the playlist link (${r.code}). Check the link or your subscription.`);
  if (r.code >= 400) throw new Error(`The server answered ${r.code} for the playlist link.`);
  let buf = await readAll(r.stream);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const lines = buf.toString('utf8').split(/\r?\n/);
  const res = { live: 0, vod: 0, series: 0, episodes: 0, epg: '' };
  const now = Date.now();
  const L = [row('H', '2', 'm3u', now)];
  const V = [row('H', '2', 'm3u', now)];
  const S = [row('H', '2', 'm3u', now)];
  const liveCats = new Map();
  const vodCats = new Map();
  const serCats = new Map();
  const shows = new Map();
  const used = new Set();
  const epCounter = new Map();
  const catId = (cats, group, prefix) => {
    const g = group || 'Uncategorized';
    if (!cats.has(g)) cats.set(g, prefix + (cats.size + 1));
    return cats.get(g);
  };
  const unique = (base) => {
    let id = base;
    let n = 2;
    while (used.has(id)) id = base + '~' + n++;
    used.add(id);
    return id;
  };
  let e = null;
  let pendingGroup = '';
  let pendingUa = '';
  let pendingRef = '';
  let total = 0;
  let sawHeader = false;
  for (let ln = 0; ln < lines.length; ln++) {
    let line = lines[ln].trim();
    if (!line) continue;
    if (ln < 2 && line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    if (line[0] === '#') {
      const up = line.slice(0, 12).toUpperCase();
      if (up.startsWith('#EXTM3U')) {
        sawHeader = true;
        const a = {};
        parseAttrs(line, 7, a);
        const epg = first(a['url-tvg'], a['x-tvg-url'], a['tvg-url']);
        if (epg && !res.epg) res.epg = epg;
      } else if (up.startsWith('#EXTINF')) {
        const a = {};
        const colon = line.indexOf(':');
        const title = parseAttrs(line, colon < 0 ? 7 : colon + 1, a);
        e = {
          name: (title || '').trim(),
          tvgId: (a['tvg-id'] || '').trim(),
          tvgName: (a['tvg-name'] || '').trim(),
          logo: first(a['tvg-logo'], a.logo, a['tvg-logo-small']),
          group: (a['group-title'] || '').trim() || pendingGroup,
          chno: first(a['tvg-chno'], a['channel-number'], a['tvg-num']),
          catchup: first(a.catchup, a['catchup-type']),
          catchupSource: (a['catchup-source'] || '').trim(),
          catchupDays: first(a['catchup-days'], a.timeshift, a['tvg-rec']),
          ua: first(a['user-agent'], a['http-user-agent']),
          ref: first(a.referrer, a['http-referrer'], a.referer),
        };
      } else if (up.startsWith('#EXTGRP')) {
        const g = line.slice(line.indexOf(':') + 1).trim();
        if (e && !e.group) e.group = g;
        else if (!e) pendingGroup = g;
      } else if (up.startsWith('#EXTVLCOPT')) {
        const opt = line.slice(line.indexOf(':') + 1).trim();
        const eq = opt.indexOf('=');
        if (eq > 0) {
          const k = opt.slice(0, eq).trim().toLowerCase();
          const v = opt.slice(eq + 1).trim();
          if (k === 'http-user-agent') e ? (e.ua = v) : (pendingUa = v);
          else if (k === 'http-referrer' || k === 'http-referer') e ? (e.ref = v) : (pendingRef = v);
        }
      }
      continue;
    }
    if (!e) {
      if (!sawHeader && ln === 0 && line.indexOf('://') < 0) continue;
      e = { name: '', tvgId: '', tvgName: '', logo: '', group: pendingGroup, chno: '', catchup: '', catchupSource: '', catchupDays: '', ua: '', ref: '' };
    }
    if (!e.ua) e.ua = pendingUa;
    if (!e.ref) e.ref = pendingRef;
    let u = line;
    const pipe = u.indexOf('|');
    if (pipe > 0) {
      for (const kv of u.slice(pipe + 1).split('&')) {
        const eq = kv.indexOf('=');
        if (eq <= 0) continue;
        const k = kv.slice(0, eq).trim().toLowerCase();
        let v = kv.slice(eq + 1).trim();
        try {
          v = decodeURIComponent(v);
        } catch (x) {
          /* keep */
        }
        if (k === 'user-agent') e.ua = v;
        else if (k === 'referer' || k === 'referrer') e.ref = v;
      }
      u = u.slice(0, pipe).trim();
    }
    e.url = u;
    if (!e.name) e.name = e.tvgName || u.split('?')[0].split('/').pop() || u;
    // classify
    const lower = u.toLowerCase();
    const ext = extOf(lower);
    const seriesPath = lower.includes('/series/');
    const moviePath = lower.includes('/movie/') || lower.includes('/movies/') || lower.includes('/vod/');
    const videoFile = VIDEO_EXT.has(ext);
    const ex = [];
    if (e.ua) ex.push('ua=' + encodeURIComponent(e.ua));
    if (e.ref) ex.push('ref=' + encodeURIComponent(e.ref));
    if (e.catchup) ex.push('cu=' + encodeURIComponent(e.catchup));
    if (e.catchupSource) ex.push('cus=' + encodeURIComponent(e.catchupSource));
    const extra = ex.join('&');
    let m = null;
    if (seriesPath || (videoFile && !moviePath)) m = SXE.exec(e.name) || SEASON_WORDS.exec(e.name);
    if (seriesPath || m) {
      let showName;
      let season;
      let episode;
      let title;
      if (m) {
        showName = trimSep(m[1]);
        season = parseInt(m[2], 10) || 1;
        episode = parseInt(m[3], 10) || 1;
        title = trimSep(m[4]);
      } else {
        showName = e.name;
        season = 1;
        const c = epCounter.get(e.group + '|' + showName);
        episode = c ? c + 1 : 1;
        title = '';
      }
      if (!showName) showName = e.group || 'Series';
      const cat = catId(serCats, e.group, 's');
      const key = cat + '|' + normName(showName);
      let sh = shows.get(key);
      if (!sh) shows.set(key, (sh = { id: unique('s' + fnv(key)), name: showName, cover: e.logo, cat }));
      if (!sh.cover) sh.cover = e.logo;
      epCounter.set(e.group + '|' + showName, episode);
      S.push(row('E', sh.id, season, episode, clean(title), clean(u), clean(e.logo), extra));
      res.episodes++;
    } else if (moviePath || videoFile) {
      const cat = catId(vodCats, e.group, 'v');
      V.push(row('M', unique('m' + fnv(e.name + '|' + e.group)), clean(e.name), clean(e.logo), cat, '', '', ext.length > 5 ? '' : ext, yearOf(e.name), '0', clean(u), extra));
      res.vod++;
    } else {
      const cat = catId(liveCats, e.group, 'g');
      const id = unique('c' + fnv(e.tvgId + '|' + e.name + '|' + e.group));
      res.live++;
      let days = 0;
      if (e.catchup || e.catchupDays) days = Math.min(parseInt(e.catchupDays, 10) > 0 ? parseInt(e.catchupDays, 10) : e.catchup ? 1 : 0, 30);
      L.push(row('L', id, clean(e.chno || String(res.live)), clean(e.name), clean(e.logo), cat, clean(e.tvgId), days, '0', clean(u), extra));
    }
    e = null;
    pendingGroup = pendingUa = pendingRef = '';
    total++;
    if ((total & 4095) === 0) {
      if (cancel()) throw new Cancelled();
      progress('m3u', total);
    }
  }
  for (const sh of shows.values()) S.push(row('S', sh.id, clean(sh.name), clean(sh.cover), sh.cat, '', '', yearOf(sh.name), ''));
  for (const [g, id] of liveCats) L.push(row('C', id, clean(g)));
  for (const [g, id] of vodCats) V.push(row('C', id, clean(g)));
  for (const [g, id] of serCats) S.push(row('C', id, clean(g)));
  res.series = shows.size;
  if (!res.live && !res.vod && !res.episodes) throw new Error('This link did not return a playlist with any channels.');
  commit(dir, 'live.tsv', L.join(''));
  commit(dir, 'vod.tsv', V.join(''));
  commit(dir, 'series.tsv', S.join(''));
  progress('m3u', total);
  return res;
}

// ------------------------------------------------------------------ xmltv

function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function parseTime(s) {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-])?(\d\d)?(\d\d)?/.exec((s || '').trim());
  if (!m) return -1;
  let t = daysFromCivil(+m[1], +m[2], +m[3]) * 86400 + +m[4] * 3600 + +m[5] * 60 + (+m[6] || 0);
  if (m[7] && m[8]) t -= (m[7] === '-' ? -1 : 1) * (+m[8] * 3600 + (+m[9] || 0) * 60);
  return t;
}

async function xmltv(urls, ua, dir, hours, progress, cancel) {
  const wantedIds = new Map();
  const wantedNames = new Map();
  const liveTsv = path.join(dir, 'live.tsv');
  if (!fs.existsSync(liveTsv)) throw new Error('Load the channel list first.');
  for (const line of fs.readFileSync(liveTsv, 'utf8').split('\n')) {
    if (!line.startsWith('L\t')) continue;
    const f = line.split('\t');
    const arch = parseInt(f[7], 10) || 0;
    const epg = (f[6] || '').trim().toLowerCase();
    if (epg) wantedIds.set(epg, Math.max(wantedIds.get(epg) || 0, arch));
    const n = normName(f[3]);
    if (n) {
      if (!wantedNames.has(n)) wantedNames.set(n, []);
      wantedNames.get(n).push([f[1], arch]);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const future = now + hours * 3600;
  const kept = new Map();
  const progs = new Map();
  const idx = [row('H', '2', 'xmltv', Date.now())];
  let count = 0;
  let okSources = 0;
  let lastError = null;
  for (const url of urls) {
    try {
      const r = await get(url.trim(), ua, null, 300000);
      if (r.code >= 400) throw new Error('Guide server answered ' + r.code);
      let stream = r.stream;
      // gzip files served without a content-encoding header
      const peek = await new Promise((resolve) => stream.once('readable', () => resolve(stream.read(2))));
      const gz = peek && peek[0] === 0x1f && peek[1] === 0x8b;
      const pass = new (require('stream').PassThrough)();
      if (peek) pass.write(peek);
      stream.pipe(pass);
      stream = gz ? pass.pipe(zlib.createGunzip()) : pass;
      await new Promise((resolve, reject) => {
        const p = sax.createStream(false, { lowercase: true, trim: false });
        let cur = null;
        let field = null;
        let text = '';
        let seen = 0;
        p.on('opentag', (n) => {
          const a = n.attributes;
          if (n.name === 'programme') {
            seen++;
            if ((seen & 8191) === 0) {
              if (cancel()) return p.emit('error', new Cancelled());
              progress('epg', count);
            }
            const key = String(a.channel || '').trim().toLowerCase();
            let arch = kept.get(key);
            if (arch === undefined) {
              arch = wantedIds.get(key);
              if (arch === undefined) return (cur = null);
              kept.set(key, arch);
            }
            const start = parseTime(a.start);
            let stop = parseTime(a.stop);
            if (start < 0) return (cur = null);
            if (stop <= start) stop = start + 1800;
            if (stop < now - Math.max(3 * 3600, arch * 86400) || start > future) return (cur = null);
            cur = { kind: 'p', key, start, stop, title: '', desc: '' };
          } else if (n.name === 'channel') {
            cur = { kind: 'c', key: String(a.id || '').trim().toLowerCase(), names: [], icon: '' };
          } else if (cur) {
            if (cur.kind === 'p' && (n.name === 'title' || n.name === 'desc')) {
              field = n.name;
              text = '';
            } else if (cur.kind === 'c' && n.name === 'display-name') {
              field = 'name';
              text = '';
            } else if (cur.kind === 'c' && n.name === 'icon' && !cur.icon) cur.icon = a.src || '';
          }
        });
        p.on('text', (t) => {
          if (field && text.length < 4000) text += t;
        });
        p.on('cdata', (t) => {
          if (field && text.length < 4000) text += t;
        });
        p.on('closetag', (name) => {
          if (field && (name === 'title' || name === 'desc' || name === 'display-name')) {
            if (field === 'name') cur.names.push(text.trim());
            else if (field === 'title' && !cur.title) cur.title = text.trim();
            else if (field === 'desc' && !cur.desc) cur.desc = text.trim();
            field = null;
          } else if (name === 'programme' && cur && cur.kind === 'p') {
            const k = clean(cur.key);
            if (!progs.has(k)) progs.set(k, []);
            progs.get(k).push([cur.start, row('P', k, cur.start, cur.stop, clip(cur.title, 120), clip(cur.desc, 220))]);
            count++;
            cur = null;
          } else if (name === 'channel' && cur && cur.kind === 'c') {
            const key = cur.key;
            let best = wantedIds.has(key) ? wantedIds.get(key) : -1;
            const dot = key.indexOf('.');
            cur.names.push(dot > 0 ? key.slice(0, dot) : key);
            for (const nm of cur.names) {
              const nn = normName(nm);
              const chans = wantedNames.get(nn);
              if (!chans) continue;
              for (const c of chans) {
                idx.push(row('X', c[0], clean(key)));
                best = Math.max(best, c[1]);
              }
              wantedNames.delete(nn);
            }
            if (best >= 0) {
              kept.set(key, Math.max(kept.has(key) ? kept.get(key) : 0, best));
              if (cur.icon) idx.push(row('I', clean(key), clean(cur.icon)));
            }
            cur = null;
          }
        });
        p.on('error', function (err) {
          if (err && err.cancelled) return reject(err);
          // be lenient with broken XML: keep going
          this._parser.error = null;
          this._parser.resume();
        });
        p.on('end', resolve);
        stream.on('error', reject);
        stream.pipe(p);
      });
      okSources++;
    } catch (e) {
      if (e && e.cancelled) throw e;
      lastError = describe(e);
    }
  }
  if (!okSources) throw new Error(lastError || 'No guide link to load');
  progress('epg:index', count);
  const out = [];
  let off = 0;
  let total = 0;
  for (const [k, list] of progs) {
    list.sort((a, b) => a[0] - b[0]);
    let n = 0;
    let len = 0;
    let last = null;
    for (const [st, line] of list) {
      if (st === last) continue;
      last = st;
      out.push(line);
      len += Buffer.byteLength(line);
      n++;
    }
    idx.push(row('K', k, off, len, n));
    off += len;
    total += n;
  }
  commit(dir, 'epg.tsv', out.join(''));
  commit(dir, 'epg.idx', idx.join(''));
  return { programmes: total, channels: kept.size };
}

/** Runs one job (same JSON as the Android bridge); emits job events through emit(). */
async function runJob(id, job, files, emit, cancelFlag) {
  const cancel = () => cancelFlag.cancelled;
  let last = 0;
  const progress = (stage, count) => {
    const t = Date.now();
    if (t - last < 250) return;
    last = t;
    emit({ t: 'job', id, state: 'progress', stage, count });
  };
  try {
    const pid = String(job.pid || '').replace(/[^A-Za-z0-9_-]/g, '');
    const dir = path.join(files, 'pl', pid);
    fs.mkdirSync(dir, { recursive: true });
    const ua = job.ua || '';
    let result = {};
    if (job.type === 'xtream') {
      for (const s of job.sections) result[s] = await xtreamSection(job.base, job.user, job.pass, ua, s, dir, progress, cancel);
    } else if (job.type === 'm3u') {
      result = await m3u(job.url, ua, dir, progress, cancel);
    } else if (job.type === 'xmltv') {
      result = await xmltv(job.urls, ua, dir, job.hours || 30, progress, cancel);
    } else throw new Error('Unknown job ' + job.type);
    emit({ t: 'job', id, state: 'done', result });
  } catch (e) {
    if (e && e.cancelled) emit({ t: 'job', id, state: 'cancelled' });
    else emit({ t: 'job', id, state: 'error', message: describe(e) });
  }
}

module.exports = { runJob, get, readAll, describe, opts, DEFAULT_UA };
