// Development host: serves the built UI and emulates the Android bridge so the
// interface can be driven in a desktop browser. Sync jobs run the real Java parsers.
// Usage: PORT=8090 DATA=/tmp/iptvdata node tools/dev/server.mjs
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const WWW = process.env.WWW ? path.resolve(process.env.WWW) : path.join(ROOT, 'android/assets/www');
const PORT = +(process.env.PORT || 8090);
const DATA = process.env.DATA || path.join(DIR, 'data');
fs.mkdirSync(DATA, { recursive: true });
const CP = [path.join(DIR, 'cls'), '/usr/share/java/kxml2.jar'].join(':');

const clients = new Set();
const log = [];
function emit(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const c of clients) c.write(line);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.tsv': 'text/plain; charset=utf-8', '.idx': 'text/plain; charset=utf-8' };

function safe(base, rel) {
  const p = path.resolve(base, rel);
  return p.startsWith(base + path.sep) ? p : null;
}

function upstream(url, headers, res, hop = 0) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    res.writeHead(502, { 'X-Net-Error': 'Invalid link' });
    return res.end('{}');
  }
  const mod = u.protocol === 'https:' ? https : http;
  const req = mod.get(u, { headers: Object.assign({ 'Accept-Encoding': 'gzip' }, headers), timeout: 20000 }, (r) => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hop < 8) {
      r.resume();
      return upstream(new URL(r.headers.location, u).toString(), headers, res, hop + 1);
    }
    const h = { 'Content-Type': r.headers['content-type'] || 'application/octet-stream', 'X-Final-Url': url, 'Cache-Control': 'no-store' };
    res.writeHead(r.statusCode >= 300 && r.statusCode < 400 ? 502 : r.statusCode, h);
    (r.headers['content-encoding'] === 'gzip' ? r.pipe(zlib.createGunzip()) : r).pipe(res);
  });
  req.on('timeout', () => req.destroy(new Error('The server took too long to respond.')));
  req.on('error', (e) => {
    if (res.headersSent) return res.end();
    const msg = /ECONNREFUSED/.test(e.message) ? 'The server refused the connection. Check the address and port.' : /ENOTFOUND|EAI_AGAIN/.test(e.message) ? 'Server not found. Check the address.' : e.message;
    res.writeHead(502, { 'X-Net-Error': msg, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ __netError: msg }));
  });
}

const jobs = new Map();
function startJob(id, json) {
  const p = spawn('java', ['-Xmx96m', '-cp', CP, 'com.iptvplayer.dev.DevMain', 'job', DATA, json]);
  jobs.set(id, p);
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.startsWith('EVENT ')) {
        const ev = JSON.parse(line.slice(6));
        emit(Object.assign({ t: 'job', id }, ev));
      }
    }
  });
  p.stderr.on('data', (d) => {
    const s = String(d);
    if (!/JAVA_TOOL_OPTIONS/.test(s)) process.stderr.write('[job] ' + s);
  });
  p.on('close', () => jobs.delete(id));
}

const bridge = {
  info: () => JSON.stringify({ version: '1.0.0-dev', build: 'dev', sdk: 34, release: '14', model: 'Browser', maker: 'Dev', width: 1920, height: 1080, density: 1, lowRam: false, memoryClass: 256, totalMem: 4e9, cores: 8, webview: 'desktop browser' }),
  ready: () => null,
  exitApp: () => (emit({ t: 'dev', ev: 'exit' }), null),
  log: (s) => (log.push(s), null),
  setKeyPassthrough: () => null,
  setOption: () => null,
  readText: (name) => {
    const f = safe(DATA, name);
    return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  },
  writeText: (name, text) => {
    const f = safe(DATA, name);
    if (!f) return false;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    return true;
  },
  remove: (name) => {
    const f = safe(DATA, name);
    if (f) fs.rmSync(f, { recursive: true, force: true });
    return true;
  },
  fileInfo: (name) => {
    const f = safe(DATA, name);
    const ok = f && fs.existsSync(f);
    return JSON.stringify({ exists: !!ok, size: ok ? fs.statSync(f).size : 0, modified: ok ? fs.statSync(f).mtimeMs : 0 });
  },
  cacheInfo: () => JSON.stringify({ images: 12345678, data: 0 }),
  clearImageCache: () => null,
  startJob: (id, json) => (startJob(id, json), null),
  cancelJob: (id) => {
    const p = jobs.get(id);
    if (p) p.kill();
    emit({ t: 'job', id, state: 'cancelled' });
    return null;
  },
  openExternal: (json) => (emit({ t: 'dev', ev: 'external', json }), true),
  openUrl: (u) => (emit({ t: 'dev', ev: 'url', u }), true),
  voiceSearch: () => false,
  phoneSetup: (start) => (start ? `http://192.168.1.50:8723` : ''),
};

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  if (p === '/__bridge/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': hi\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/__bridge/call' || p === '/__emit') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (p === '/__emit') {
        emit(JSON.parse(body));
        res.end('{}');
        return;
      }
      const { method, args } = JSON.parse(body);
      const fn = bridge[method];
      let result = null;
      try {
        result = fn ? fn(...(args || [])) : null;
      } catch (e) {
        console.error(method, e);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });
    return;
  }
  if (p === '/__log') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(log));
  }
  if (p === '/net') {
    const h = {};
    if (u.searchParams.get('ua')) h['User-Agent'] = u.searchParams.get('ua');
    if (u.searchParams.get('ref')) h.Referer = u.searchParams.get('ref');
    return upstream(u.searchParams.get('u'), h, res);
  }
  if (p === '/img') return upstream(u.searchParams.get('u'), {}, res);
  if (p.startsWith('/files/')) {
    const f = safe(DATA, decodeURIComponent(p.slice(7)));
    if (!f || !fs.existsSync(f)) {
      res.writeHead(404);
      return res.end();
    }
    const o = u.searchParams.get('o'), n = u.searchParams.get('n');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    if (o != null && n != null) {
      const fd = fs.openSync(f, 'r');
      const b = Buffer.alloc(+n);
      fs.readSync(fd, b, 0, +n, +o);
      fs.closeSync(fd);
      return res.end(b);
    }
    return fs.createReadStream(f).pipe(res);
  }
  const f = safe(WWW, p === '/' ? 'index.html' : p.slice(1));
  if (!f || !fs.existsSync(f)) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`dev host on http://127.0.0.1:${PORT} (data ${DATA})`));
