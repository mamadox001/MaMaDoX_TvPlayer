// Xtream Codes API client.
import { netJson } from '../native.js';
import { qs } from '../util.js';

const enc = encodeURIComponent;

/**
 * Accepts what people paste: "host:8080", "http://host:8080/", a get.php or
 * player_api.php link with credentials, etc.
 */
export function normalizeServer(input) {
  let s = String(input || '').trim().replace(/\s+/g, '');
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  const m = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(s);
  if (!m) return null;
  const params = {};
  if (m[4]) {
    for (const kv of m[4].slice(1).split('&')) {
      const i = kv.indexOf('=');
      if (i > 0) {
        try {
          params[decodeURIComponent(kv.slice(0, i)).toLowerCase()] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
        } catch (e) {
          params[kv.slice(0, i).toLowerCase()] = kv.slice(i + 1);
        }
      }
    }
  }
  let path = m[3].replace(/\/(get|player_api|xmltv|panel_api|c)\.php$/i, '').replace(/\/+$/, '');
  if (/^\/(live|movie|series)\//i.test(path)) path = '';
  return { base: `${m[1].toLowerCase()}://${m[2]}${path}`, user: params.username || '', pass: params.password || '' };
}

/** Is this M3U link actually an Xtream Codes panel export? */
export function xtreamFromM3u(url) {
  if (!/get\.php\?/i.test(url || '') || !/username=/i.test(url) || !/password=/i.test(url)) return null;
  const n = normalizeServer(url);
  return n && n.user && n.pass ? n : null;
}

export function api(pl, action, params, timeout) {
  const url = `${pl.base}/player_api.php?` + qs(Object.assign({ username: pl.user, password: pl.pass }, action ? { action } : {}, params || {}));
  return netJson(url, { ua: pl.ua, timeout: timeout || 30000 });
}

export async function login(pl) {
  const j = await api(pl, '', null, 20000);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('This server did not answer like an Xtream Codes server. Check the address and port.');
  const ui = j.user_info;
  if (!ui || typeof ui !== 'object') throw new Error('This server did not answer like an Xtream Codes server. Check the address and port.');
  if (ui.auth === 0 || ui.auth === '0' || ui.auth === false) throw new Error('The server did not accept this username and password.');
  return accountFrom(ui, j.server_info || {});
}

export function accountFrom(ui, si) {
  const num = (v) => {
    const n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  };
  let tzOffset = 0; // server local time minus UTC, in seconds
  if (si.time_now && si.timestamp_now) {
    const t = parseLocal(si.time_now, 0);
    if (t) tzOffset = Math.round((t - num(si.timestamp_now)) / 900) * 900;
  }
  return {
    status: ui.status || '',
    exp: num(ui.exp_date),
    trial: ui.is_trial === '1' || ui.is_trial === 1,
    maxCons: num(ui.max_connections),
    activeCons: num(ui.active_cons),
    created: num(ui.created_at),
    formats: Array.isArray(ui.allowed_output_formats) ? ui.allowed_output_formats : [],
    message: ui.message || '',
    tz: si.timezone || '',
    tzOffset,
    checked: Math.floor(Date.now() / 1000),
  };
}

/** "2026-10-20 21:00:00" read as if it were UTC, shifted by offset seconds. */
export function parseLocal(s, offset) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?/.exec(s || '');
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000 - (offset || 0);
}

function userPass(pl) {
  return `${enc(pl.user)}/${enc(pl.pass)}`;
}

export function liveFormat(pl, setting) {
  if (setting === 'ts' || setting === 'm3u8') return setting;
  const f = (pl.account && pl.account.formats) || [];
  // HLS is the most reliable format for the Android media player
  if (!f.length || f.indexOf('m3u8') >= 0) return 'm3u8';
  return 'ts';
}

export const liveUrl = (pl, ch, fmt) => `${pl.base}/live/${userPass(pl)}/${ch.id}.${fmt}`;
export const vodUrl = (pl, m) => `${pl.base}/movie/${userPass(pl)}/${m.id}.${m.ext || 'mp4'}`;
export const episodeUrl = (pl, ep) => `${pl.base}/series/${userPass(pl)}/${ep.id}.${ep.ext || 'mp4'}`;

/** Catch-up stream for a past programme. */
export function catchupUrl(pl, ch, prog, offsetSec) {
  const tz = (pl.account && pl.account.tzOffset) || 0;
  const s0 = prog.s0 != null ? prog.s0 : prog.start;
  const e0 = prog.e0 != null ? prog.e0 : prog.stop;
  const start = s0 + (offsetSec || 0);
  const d = new Date((start + tz) * 1000);
  const p = (n) => (n < 10 ? '0' : '') + n;
  const startStr = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}:${p(d.getUTCHours())}-${p(d.getUTCMinutes())}`;
  const dur = Math.max(1, Math.ceil((e0 - start) / 60));
  return `${pl.base}/timeshift/${userPass(pl)}/${dur}/${startStr}/${ch.id}.ts`;
}

export const vodInfo = (pl, id) => api(pl, 'get_vod_info', { vod_id: id });
export const seriesInfo = (pl, id) => api(pl, 'get_series_info', { series_id: id });
export const shortEpg = (pl, id, limit) => api(pl, 'get_short_epg', { stream_id: id, limit: limit || 6 }, 15000);
export const fullEpg = (pl, id) => api(pl, 'get_simple_data_table', { stream_id: id }, 20000);
