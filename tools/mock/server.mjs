// Mock IPTV provider: Xtream Codes API + M3U + XMLTV + streams + artwork.
// Usage: PORT=8091 SCALE=large node server.mjs
import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8091);
const SCALE = process.env.SCALE || 'large';
const HOST = process.env.HOSTNAME_PUBLIC || `127.0.0.1:${PORT}`;
const BASE = `http://${HOST}`;
const USER = 'demo', PASS = 'demo123';
const N = SCALE === 'small' ? { live: 400, vod: 1500, series: 300 } : { live: 3200, vod: 22000, series: 4200 };

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function h32(...a) { let h = 2166136261; for (const x of a.join('|')) { h ^= x.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const R = rng(42);
const pick = (arr, r = R) => arr[Math.floor(r() * arr.length)];

// ---------- live ----------
const liveCatDefs = [
  ['Sports', 'sport'], ['beIN-style Sports', 'sport'], ['News', 'news'], ['Morocco', 'gen'], ['Arabic', 'gen'], ['France', 'gen'],
  ['United Kingdom', 'gen'], ['Movies', 'movie'], ['Kids', 'kids'], ['Documentary', 'doc'], ['Music', 'music'], ['4K UHD', 'gen'],
  ['Religious', 'gen'], ['Spain', 'gen'], ['Italy', 'gen'], ['Germany', 'gen'], ['Turkey', 'gen'], ['USA', 'gen'],
  ['Canada', 'gen'], ['Netherlands', 'gen'], ['Portugal', 'gen'], ['Africa', 'gen'], ['Latino', 'gen'], ['India', 'gen'],
  ['Pakistan', 'gen'], ['Ex-Yu', 'gen'], ['Poland', 'gen'], ['Greece', 'gen'], ['Sweden', 'gen'], ['Brazil', 'gen'],
  ['Kurdish', 'gen'], ['Iran', 'gen'], ['Albania', 'gen'], ['Romania', 'gen'], ['PPV Events', 'sport'], ['Formula Racing', 'sport'],
  ['Adult 18+', 'adult'], ['Radio', 'music'], ['Weather', 'news'], ['Cooking', 'doc'],
];
const brands = ['Atlas', 'Medina', 'Sahara', 'Oasis', 'Kasbah', 'Riviera', 'Nova', 'Orbit', 'Dune', 'Cedar', 'Zenith', 'Pulse', 'Vertex', 'Horizon', 'Marina', 'Souk', 'Argan', 'Tafilalt', 'Rif', 'Agadir', 'Fes', 'Ifrane'];
const kindWords = { sport: ['Sport', 'Sports', 'Arena', 'Goal', 'Stadium'], news: ['News', 'Info', '24', 'Today'], gen: ['TV', 'One', 'Channel', 'Plus', 'Max'], movie: ['Cinema', 'Movies', 'Film', 'Classics'], kids: ['Kids', 'Junior', 'Toons'], doc: ['Docs', 'Discovery', 'Planet', 'History'], music: ['Music', 'Hits', 'Beats', 'FM'], adult: ['Late Night', 'After Dark'] };
const prefixes = { France: 'FR: ', 'United Kingdom': 'UK: ', Arabic: 'AR | ', Spain: 'ES: ', Italy: 'IT: ', Germany: 'DE: ', Turkey: 'TR: ', USA: 'US: ' };
const liveCats = liveCatDefs.map((c, i) => ({ id: String(i + 1), name: c[0], kind: c[1] }));
const channels = [];
for (let i = 0; i < N.live; i++) {
  const cat = i < 60 ? liveCats[i % 3] : liveCats[Math.floor(R() * liveCats.length)];
  const words = kindWords[cat.kind];
  const brand = pick(brands), word = pick(words);
  const qual = pick(['', '', ' HD', ' HD', ' FHD', ' 4K', ' SD', ' HEVC']);
  const n = R() < 0.4 ? ' ' + (1 + Math.floor(R() * 9)) : '';
  const base = `${brand} ${word}${n}`;
  const name = (prefixes[cat.name] || '') + base + qual + (cat.name === 'Arabic' && R() < 0.3 ? ' العربية' : '');
  channels.push({
    id: 1000 + i, num: i + 1, name, cat: cat.id, kind: cat.kind, adult: cat.kind === 'adult' ? 1 : 0,
    icon: R() < 0.9 ? `${BASE}/img/logos/${i % 48}.png` : '',
    epg: R() < 0.85 ? `${brand}${word}${n.trim()}.${cat.name.slice(0, 2).toLowerCase()}` : '',
    archive: R() < 0.25 ? pick([3, 5, 7]) : 0,
  });
}
// ---------- vod ----------
const vodCatNames = ['New Releases', 'Action', 'Comedy', 'Drama', 'Thriller', 'Horror', 'Sci-Fi', 'Family', 'Animation', 'Documentary', 'Romance', 'Arabic Movies', 'French Movies', 'Moroccan Cinema', 'Turkish Movies', 'Bollywood', 'Classics', 'War', 'Western', 'Crime', 'Mystery', 'Fantasy', 'Adventure', 'Music', 'Sports Films', 'Stand-up', 'Kids Movies', '4K Movies', 'Christmas', 'Collections'];
const vodCats = vodCatNames.map((n, i) => ({ id: String(100 + i), name: n }));
const tw1 = ['Last', 'Silent', 'Blue', 'Iron', 'Paper', 'Night', 'Golden', 'Hidden', 'Broken', 'Distant', 'Wild', 'Crimson', 'Northern', 'Lost', 'Final', 'Secret', 'Burning', 'Frozen', 'Electric', 'Velvet'];
const tw2 = ['Harbor', 'Signal', 'Medina', 'Ferry', 'Mountain', 'Orbit', 'Road', 'Wave', 'Lantern', 'Coast', 'Tide', 'Crown', 'Garden', 'Desert', 'Station', 'Bridge', 'Empire', 'River', 'Kingdom', 'Letter'];
const genres = ['Action', 'Drama', 'Comedy', 'Thriller', 'Adventure', 'Sci-Fi', 'Romance', 'Crime', 'Mystery', 'Family', 'Animation', 'Fantasy'];
const people = ['Lina Haddad', 'Omar Benali', 'Sara Idrissi', 'Youssef Amrani', 'Claire Martin', 'Jonas Weber', 'Mia Rossi', 'Karim Ziani', 'Nadia Fassi', 'Tom Hale', 'Ines Duarte', 'Rami Saleh'];
const movies = [];
const now0 = Math.floor(Date.now() / 1000);
for (let i = 0; i < N.vod; i++) {
  const t = `${pick(tw1)} ${pick(tw2)}${R() < 0.2 ? ' ' + (2 + Math.floor(R() * 3)) : ''}`;
  const year = 1975 + Math.floor(R() * 51);
  movies.push({
    id: 50000 + i, name: R() < 0.7 ? `${t} (${year})` : t, title: t, year, cat: i < 300 ? vodCats[0].id : pick(vodCats).id,
    icon: R() < 0.92 ? `${BASE}/img/posters/${i % 80}.jpg` : '', rating: R() < 0.85 ? (3 + R() * 6.5).toFixed(1) : '',
    added: now0 - Math.floor(R() * 86400 * 700), ext: pick(['mkv', 'mp4', 'mp4', 'avi']),
  });
}
// ---------- series ----------
const serCatNames = ['Trending', 'Drama Series', 'Comedy Series', 'Crime Series', 'Sci-Fi Series', 'Arabic Series', 'Turkish Series', 'Ramadan', 'Kids Series', 'Anime', 'Docuseries', 'Reality', 'French Series', 'Spanish Series', 'Mini-Series', 'Sitcoms', 'Thriller Series', 'Fantasy Series', 'Classic TV', 'Netflix-style Originals'];
const serCats = serCatNames.map((n, i) => ({ id: String(300 + i), name: n }));
const series = [];
for (let i = 0; i < N.series; i++) {
  const t = `The ${pick(tw1)} ${pick(tw2)}`;
  const year = 1995 + Math.floor(R() * 31);
  series.push({
    id: 9000 + i, name: R() < 0.5 ? `${t} (${year})` : t, title: t, year, cat: pick(serCats).id, cover: R() < 0.95 ? `${BASE}/img/posters/${(i * 7) % 80}.jpg` : '',
    rating: (4 + R() * 5.5).toFixed(1), genre: `${pick(genres)}, ${pick(genres)}`, modified: now0 - Math.floor(R() * 86400 * 400),
    seasons: 1 + Math.floor(R() * 5), eps: 6 + Math.floor(R() * 7),
  });
}

// ---------- EPG ----------
const progTitles = {
  sport: ['Botola Pro: Raja vs Wydad', 'Champions Night Live', 'Matchday Highlights', 'Golf Classics', 'Tennis: Quarter Final', 'Basketball Tonight', 'Studio Analysis', 'Grand Prix Qualifying', 'Boxing: Title Fight', 'Morning Sport Report'],
  news: ['Evening Bulletin', 'World Report', 'Business Today', 'Morning Briefing', 'Weather Watch', 'Debate Hour', 'Headlines', 'Special Report'],
  gen: ['Family Kitchen', 'The Big Quiz', 'Late Show', 'Travel Diaries', 'Daily Talk', 'Drama Hour', 'Home Makeover', 'Comedy Night', 'Village Stories'],
  movie: ['Feature: Desert Wind', 'Feature: Night Ferry', 'Feature: Iron Tide', 'Classic Cinema', 'Premiere: Silver Coast', 'Double Bill'],
  kids: ['Toon Time', 'Little Explorers', 'Robot Pals', 'Story Hour', 'Science Lab Kids', 'Cartoon Marathon'],
  doc: ['Planet Oceans', 'Ancient Empires', 'Wild Atlas', 'Engineering Marvels', 'Food Roads', 'Space Frontier'],
  music: ['Top 40 Countdown', 'Live Session', 'Classic Hits', 'Chill Mix', 'Concert Replay'],
  adult: ['Late Programme', 'Night Feature'],
};
function dayProgrammes(ch, day) { // day = epoch days
  const r = rng(h32(ch.id, day));
  const out = []; let t = day * 86400; const end = t + 86400;
  const titles = progTitles[ch.kind] || progTitles.gen;
  while (t < end) {
    const dur = pick([30, 30, 45, 60, 60, 90, 120], r) * 60;
    const stop = Math.min(end, t + dur);
    const title = pick(titles, r);
    out.push({ start: t, stop, title, desc: `${title}. ${pick(['Live coverage with expert commentary.', 'An episode full of surprises and memorable moments.', 'Recorded earlier today.', 'Repeat of a fan favourite.', 'Exclusive programme with special guests from across the region.'], r)}` });
    t = stop;
  }
  return out;
}
function programmes(ch, from, to) {
  const out = [];
  for (let d = Math.floor(from / 86400); d <= Math.floor(to / 86400); d++) for (const p of dayProgrammes(ch, d)) if (p.stop > from && p.start < to) out.push(p);
  return out;
}
const TZ_OFFSET = 3600; // pretend server time zone is UTC+1
const fmt = (ts) => { const d = new Date((ts + TZ_OFFSET) * 1000); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const xmlt = (ts) => { const d = new Date(ts * 1000); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- responses ----------
const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());
const J = (o) => JSON.stringify(o);
const chById = new Map(channels.map((c) => [c.id, c]));
const serById = new Map(series.map((s) => [s.id, s]));
const movById = new Map(movies.map((m) => [m.id, m]));

function liveStreamsJson(cat) {
  return J(channels.filter((c) => !cat || c.cat === cat).map((c) => ({ num: c.num, name: c.name, stream_type: 'live', stream_id: c.id, stream_icon: c.icon, epg_channel_id: c.epg || null, added: String(now0 - 86400 * 30), is_adult: c.adult, category_id: c.cat, category_ids: [+c.cat], custom_sid: '', tv_archive: c.archive ? 1 : 0, direct_source: '', tv_archive_duration: c.archive })));
}
function vodStreamsJson(cat) {
  return J(movies.filter((m) => !cat || m.cat === cat).map((m, i) => ({ num: i + 1, name: m.name, title: m.title, year: String(m.year), stream_type: 'movie', stream_id: m.id, stream_icon: m.icon, rating: m.rating, rating_5based: m.rating ? +(m.rating / 2).toFixed(1) : 0, added: String(m.added), is_adult: 0, category_id: m.cat, category_ids: [+m.cat], container_extension: m.ext, custom_sid: null, direct_source: '' })));
}
function seriesJson(cat) {
  return J(series.filter((s) => !cat || s.cat === cat).map((s, i) => ({ num: i + 1, name: s.name, title: s.title, year: String(s.year), stream_type: 'series', series_id: s.id, cover: s.cover, plot: 'A sweeping story of ambition and family.', cast: people.slice(0, 4).join(', '), director: people[5], genre: s.genre, releaseDate: `${s.year}-03-14`, release_date: `${s.year}-03-14`, last_modified: String(s.modified), rating: s.rating, rating_5based: +(s.rating / 2).toFixed(1), backdrop_path: [`${BASE}/img/backdrops/${s.id % 24}.jpg`], youtube_trailer: '', episode_run_time: '45', category_id: s.cat, category_ids: [+s.cat] })));
}
function account(user) {
  return { user_info: { username: user, password: PASS, message: 'Welcome to the demo server', auth: 1, status: 'Active', exp_date: String(now0 + 86400 * 23), is_trial: '0', active_cons: '0', created_at: String(now0 - 86400 * 300), max_connections: '2', allowed_output_formats: ['m3u8', 'ts', 'rtmp'] }, server_info: { url: '127.0.0.1', port: String(PORT), https_port: '', server_protocol: 'http', rtmp_port: '', timezone: 'Africa/Lagos', timestamp_now: Math.floor(Date.now() / 1000), time_now: fmt(Math.floor(Date.now() / 1000)), process: true } };
}
function epgListing(ch, from, to, withArchive) {
  const nowS = Math.floor(Date.now() / 1000);
  return programmes(ch, from, to).map((p, i) => ({ id: String(h32(ch.id, p.start)), epg_id: '1', title: b64(p.title), lang: 'en', start: fmt(p.start), end: fmt(p.stop), description: b64(p.desc), channel_id: ch.epg, start_timestamp: String(p.start), stop_timestamp: String(p.stop), ...(withArchive ? { now_playing: p.start <= nowS && p.stop > nowS ? 1 : 0, has_archive: ch.archive && p.stop < nowS ? 1 : 0 } : {}) }));
}
function vodInfo(m) {
  const r = rng(m.id);
  const dur = 80 * 60 + Math.floor(r() * 70 * 60);
  const hms = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  return { info: { tmdb_id: String(100000 + m.id), name: m.title, o_name: m.title, cover_big: m.icon, movie_image: m.icon, releasedate: `${m.year}-0${1 + (m.id % 9)}-1${m.id % 9}`, release_date: `${m.year}-05-12`, youtube_trailer: 'aqz-KE-bpKQ', director: pick(people, r), actors: [pick(people, r), pick(people, r), pick(people, r)].join(', '), cast: [pick(people, r), pick(people, r), pick(people, r), pick(people, r)].join(', '), description: 'A quiet harbour town is shaken when a stranger arrives with a map that should not exist. Old friendships are tested as the truth about the town’s past comes to light.', plot: 'A quiet harbour town is shaken when a stranger arrives with a map that should not exist. Old friendships are tested as the truth about the town’s past comes to light.', age: '', country: pick(['Morocco', 'France', 'United States', 'Spain', 'Egypt'], r), genre: `${pick(genres, r)}, ${pick(genres, r)}`, backdrop_path: [`${BASE}/img/backdrops/${m.id % 24}.jpg`], duration_secs: dur, duration: hms(dur), bitrate: 2400, rating: m.rating, video: { codec_name: 'h264', width: 1920, height: 1080 }, audio: { codec_name: 'aac', channels: 2 } }, movie_data: { stream_id: m.id, name: m.name, title: m.title, year: String(m.year), added: String(m.added), category_id: m.cat, category_ids: [+m.cat], container_extension: m.ext, custom_sid: '', direct_source: '' } };
}
function seriesInfo(s) {
  const seasons = [], episodes = {};
  for (let sn = 1; sn <= s.seasons; sn++) {
    seasons.push({ air_date: `${s.year + sn - 1}-09-01`, episode_count: s.eps, id: s.id * 10 + sn, name: `Season ${sn}`, overview: '', season_number: sn, vote_average: 7.4, cover: s.cover, cover_big: s.cover });
    episodes[sn] = [];
    for (let e = 1; e <= s.eps; e++) {
      const id = s.id * 1000 + sn * 50 + e;
      episodes[sn].push({ id: String(id), episode_num: e, title: `${s.title} - S${String(sn).padStart(2, '0')}E${String(e).padStart(2, '0')} - ${pick(tw1, rng(id))} ${pick(tw2, rng(id + 1))}`, container_extension: pick(['mp4', 'mkv'], rng(id)), info: { tmdb_id: id, releasedate: `${s.year + sn - 1}-09-${String(e).padStart(2, '0')}`, plot: 'The family gathers for an anniversary that nobody wanted, and an unexpected guest changes the evening.', duration_secs: 2400 + (id % 900), duration: '00:4' + (id % 9) + ':00', movie_image: `${BASE}/img/stills/${id % 30}.jpg`, rating: 7.1, season: sn }, custom_sid: '', added: String(s.modified), season: sn, direct_source: '' });
    }
  }
  return { seasons, info: { name: s.title, cover: s.cover, plot: 'Three siblings return to the family riad in Fes after their father disappears, and slowly discover the business he built was not what it seemed.', cast: people.slice(2, 7).join(', '), director: people[1], genre: s.genre, releaseDate: `${s.year}-03-14`, last_modified: String(s.modified), rating: s.rating, rating_5based: +(s.rating / 2).toFixed(1), backdrop_path: [`${BASE}/img/backdrops/${s.id % 24}.jpg`], youtube_trailer: '', episode_run_time: '45', category_id: s.cat }, episodes };
}
function m3uPlus(user, pass, output) {
  const ext = output === 'm3u8' || output === 'hls' ? 'm3u8' : 'ts';
  const lines = [`#EXTM3U url-tvg="${BASE}/xmltv.php?username=${user}&password=${pass}" x-tvg-url="${BASE}/xmltv.php?username=${user}&password=${pass}"`];
  const cn = Object.fromEntries(liveCats.map((c) => [c.id, c.name]));
  for (const c of channels) lines.push(`#EXTINF:-1 tvg-id="${c.epg}" tvg-name="${c.name}" tvg-logo="${c.icon}" group-title="${cn[c.cat]}"${c.archive ? ` catchup="xc" catchup-days="${c.archive}"` : ''},${c.name}`, `${BASE}/live/${user}/${pass}/${c.id}.${ext}`);
  const vn = Object.fromEntries(vodCats.map((c) => [c.id, c.name]));
  for (const m of movies.slice(0, 6000)) lines.push(`#EXTINF:-1 tvg-id="" tvg-name="${m.name}" tvg-logo="${m.icon}" group-title="${vn[m.cat]}",${m.name}`, `${BASE}/movie/${user}/${pass}/${m.id}.${m.ext}`);
  const sn = Object.fromEntries(serCats.map((c) => [c.id, c.name]));
  for (const s of series.slice(0, 600)) for (let a = 1; a <= s.seasons; a++) for (let e = 1; e <= s.eps; e++) lines.push(`#EXTINF:-1 tvg-id="" tvg-name="${s.title} S${String(a).padStart(2, '0')} E${String(e).padStart(2, '0')}" tvg-logo="${s.cover}" group-title="${sn[s.cat]}",${s.title} S${String(a).padStart(2, '0')} E${String(e).padStart(2, '0')}`, `${BASE}/series/${user}/${pass}/${s.id * 1000 + a * 50 + e}.mp4`);
  return lines.join('\n') + '\n';
}
function xmltv(list, idOf, nameOf) {
  const nowS = Math.floor(Date.now() / 1000);
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv generator-info-name="mock">\n'];
  for (const c of list) parts.push(`<channel id="${esc(idOf(c))}"><display-name>${esc(nameOf(c))}</display-name><icon src="${esc(c.icon)}"/></channel>\n`);
  for (const c of list) {
    const from = nowS - (c.archive ? c.archive * 86400 : 6 * 3600);
    for (const p of programmes(c, from, nowS + 2 * 86400)) parts.push(`<programme start="${xmlt(p.start)}" stop="${xmlt(p.stop)}" channel="${esc(idOf(c))}"><title lang="en">${esc(p.title)}</title><desc lang="en">${esc(p.desc)} &amp; more</desc><category>Misc</category></programme>\n`);
  }
  parts.push('</tv>\n');
  return parts.join('');
}
// a generic (non Xtream) playlist with EXTGRP / EXTVLCOPT / pipe headers / name-only EPG matching
const plain = channels.slice(0, 160);
function plainM3u() {
  const out = [`#EXTM3U x-tvg-url="${BASE}/plain-epg.xml.gz"`];
  plain.forEach((c, i) => {
    const grp = ['Sports', 'News', 'Family'][i % 3];
    if (i % 4 === 0) out.push(`#EXTINF:0 tvg-logo="${c.icon}",${c.name}`, `#EXTGRP:${grp}`, `#EXTVLCOPT:http-user-agent=MockAgent/1.0`, `${BASE}/live/${USER}/${PASS}/${c.id}.m3u8`);
    else if (i % 4 === 1) out.push(`#EXTINF:-1 tvg-chno="${200 + i}" group-title="${grp}" catchup="default" catchup-days="2" catchup-source="${BASE}/timeshift/${USER}/${PASS}/{duration:60}/{Y}-{m}-{d}:{H}-{M}/${c.id}.ts",${c.name}`, `${BASE}/live/${USER}/${PASS}/${c.id}.ts|User-Agent=PipeAgent%2F2.0&Referer=http%3A%2F%2Fexample.org%2F`);
    else out.push(`#EXTINF:-1 tvg-logo="${c.icon}" group-title="${grp}",${c.name}`, `${BASE}/live/${USER}/${PASS}/${c.id}.ts`);
  });
  out.push('#EXTINF:-1 group-title="Films",Night Ferry (2019)', `${BASE}/movie/${USER}/${PASS}/50001.mp4`);
  out.push('#EXTINF:-1 group-title="Shows",Blue Medina S01 E01', `${BASE}/series/${USER}/${PASS}/77001.mp4`);
  out.push('#EXTINF:-1 group-title="Shows",Blue Medina S01 E02 The Return', `${BASE}/series/${USER}/${PASS}/77002.mp4`);
  return out.join('\r\n') + '\r\n';
}

// ---------- server ----------
const send = (res, code, body, type = 'application/json; charset=utf-8', req = null) => {
  const headers = { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' };
  if (req && /gzip/.test(req.headers['accept-encoding'] || '') && body.length > 2048) {
    headers['Content-Encoding'] = 'gzip';
    body = zlib.gzipSync(body);
  }
  res.writeHead(code, headers);
  res.end(body);
};
function serveFile(req, res, file, type) {
  let stat;
  try { stat = fs.statSync(file); } catch { return send(res, 404, 'not found', 'text/plain'); }
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], stat.size - 1) : stat.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=3600' });
    fs.createReadStream(file).pipe(res);
  }
}
const stats = { requests: 0, byAction: {} };
http.createServer((req, res) => {
  const u = new URL(req.url, BASE);
  const p = u.pathname, q = u.searchParams;
  stats.requests++;
  if (process.env.LOG) console.log(req.method, req.url);
  const delay = +(process.env.DELAY || 0);
  setTimeout(() => {
    try {
      if (p === '/player_api.php') {
        const user = q.get('username'), pass = q.get('password');
        if (user !== USER || pass !== PASS) return send(res, 200, J({ user_info: { auth: 0 } }));
        const action = q.get('action') || '';
        stats.byAction[action] = (stats.byAction[action] || 0) + 1;
        const cat = q.get('category_id');
        switch (action) {
          case '': return send(res, 200, J(account(user)));
          case 'get_live_categories': return send(res, 200, J(liveCats.map((c) => ({ category_id: c.id, category_name: c.name, parent_id: 0 }))), undefined, req);
          case 'get_vod_categories': return send(res, 200, J(vodCats.map((c) => ({ category_id: c.id, category_name: c.name, parent_id: 0 }))), undefined, req);
          case 'get_series_categories': return send(res, 200, J(serCats.map((c) => ({ category_id: c.id, category_name: c.name, parent_id: 0 }))), undefined, req);
          case 'get_live_streams': return send(res, 200, cat ? liveStreamsJson(cat) : once('live', () => liveStreamsJson()), undefined, req);
          case 'get_vod_streams': return send(res, 200, cat ? vodStreamsJson(cat) : once('vod', () => vodStreamsJson()), undefined, req);
          case 'get_series': return send(res, 200, cat ? seriesJson(cat) : once('series', () => seriesJson()), undefined, req);
          case 'get_vod_info': { const m = movById.get(+q.get('vod_id')); return send(res, 200, J(m ? vodInfo(m) : { info: [], movie_data: [] })); }
          case 'get_series_info': { const s = serById.get(+q.get('series_id')); return send(res, 200, J(s ? seriesInfo(s) : { seasons: [], info: [], episodes: [] })); }
          case 'get_short_epg': {
            const c = chById.get(+q.get('stream_id')); const lim = +(q.get('limit') || 4); const nowS = Math.floor(Date.now() / 1000);
            if (!c || !c.epg) return send(res, 200, J({ epg_listings: [] }));
            return send(res, 200, J({ epg_listings: epgListing(c, nowS - 1, nowS + 86400, false).slice(0, lim) }));
          }
          case 'get_simple_data_table': {
            const c = chById.get(+q.get('stream_id')); const nowS = Math.floor(Date.now() / 1000);
            if (!c || !c.epg) return send(res, 200, J({ epg_listings: [] }));
            return send(res, 200, J({ epg_listings: epgListing(c, nowS - (c.archive ? c.archive * 86400 : 3 * 3600), nowS + 2 * 86400, true) }), undefined, req);
          }
          default: return send(res, 200, J([]));
        }
      }
      if (p === '/get.php') {
        if (q.get('username') !== USER || q.get('password') !== PASS) return send(res, 403, 'forbidden', 'text/plain');
        return send(res, 200, once('m3u' + q.get('output'), () => m3uPlus(USER, PASS, q.get('output'))), 'audio/x-mpegurl', req);
      }
      if (p === '/xmltv.php') {
        const body = once('xmltv', () => zlib.gzipSync(xmltv(channels.filter((c) => c.epg), (c) => c.epg, (c) => c.name)));
        res.writeHead(200, { 'Content-Type': 'application/xml', 'Content-Encoding': 'gzip' }); return res.end(body);
      }
      if (p === '/plain.m3u') return send(res, 200, plainM3u(), 'audio/x-mpegurl');
      if (p === '/plain-epg.xml.gz') {
        // different ids + display names that only match after normalisation
        const body = once('plainepg', () => zlib.gzipSync(xmltv(plain, (c) => 'ch' + c.id + '.tv', (c) => c.name.replace(/^(FR|UK|ES|IT|DE|TR|US): /, '').replace(/ (HD|FHD|SD|4K|HEVC)$/, ''))));
        res.writeHead(200, { 'Content-Type': 'application/gzip' }); return res.end(body);
      }
      if (!p.startsWith('/img/') && (/^\/(live|movie|series|timeshift)\//.test(p) || /^\/[^/]+\/[^/]+\/\d+(\.\w+)?$/.test(p))) {
        if (!p.includes(`/${USER}/${PASS}/`)) return send(res, 403, 'forbidden', 'text/plain');
        if (p.includes('/live/') && /\/1013\./.test(p)) return send(res, 404, 'offline', 'text/plain'); // a dead channel
        // REAL=1: real HLS and MPEG-TS (for the desktop app's hls.js / mpegts.js players)
        if (process.env.REAL && /\.m3u8$/.test(p)) return send(res, 200, fs.readFileSync(path.join(DIR, 'assets/hls/index.m3u8'), 'utf8').replace(/^seg/gm, '/hlsseg/seg'), 'application/vnd.apple.mpegurl');
        if (process.env.REAL && /\.ts$/.test(p)) return serveFile(req, res, path.join(DIR, 'assets/test.ts'), 'video/mp2t');
        return serveFile(req, res, path.join(DIR, 'assets/test.webm'), 'video/webm');
      }
      if (p.startsWith('/hlsseg/')) return serveFile(req, res, path.join(DIR, 'assets/hls', path.basename(p)), 'video/mp2t');
      if (p.startsWith('/img/')) {
        const f = path.join(DIR, 'assets', p.slice(5));
        if (!f.startsWith(path.join(DIR, 'assets'))) return send(res, 403, 'no', 'text/plain');
        return serveFile(req, res, f, f.endsWith('.png') ? 'image/png' : 'image/jpeg');
      }
      if (p === '/__stats') return send(res, 200, J(stats));
      send(res, 404, 'not found', 'text/plain');
    } catch (e) {
      console.error(e);
      send(res, 500, 'error', 'text/plain');
    }
  }, delay);
}).listen(PORT, () => console.log(`mock provider on ${BASE} (${SCALE}: ${N.live} live, ${N.vod} movies, ${N.series} series)`));
