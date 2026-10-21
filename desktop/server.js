// Local helper for the desktop app: serves the interface and plays the role of the
// Android host (storage, playlist jobs, network proxy, image cache) over HTTP on 127.0.0.1.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const sync = require('./sync');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function start({ www, data, version, onExit, onMode, onOpenUrl, port }) {
  const files = path.join(data, 'files');
  const imgDir = path.join(data, 'img');
  fs.mkdirSync(files, { recursive: true });
  fs.mkdirSync(imgDir, { recursive: true });
  const clients = new Set();
  const queued = [];
  const emit = (o) => {
    const line = `data: ${JSON.stringify(o)}\n\n`;
    if (!clients.size) queued.push(line);
    for (const c of clients) c.write(line);
  };
  const safe = (base, rel) => {
    const p = path.resolve(base, rel || '');
    return p.startsWith(path.resolve(base) + path.sep) ? p : null;
  };
  const jobs = new Map();
  const dirSize = (d) => {
    let t = 0;
    try {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) t += f.isDirectory() ? dirSize(path.join(d, f.name)) : fs.statSync(path.join(d, f.name)).size;
    } catch (e) {
      /* missing */
    }
    return t;
  };

  const bridge = {
    info: () =>
      JSON.stringify({ version, build: 'desktop', sdk: 0, release: os.release(), model: os.type() + ' ' + os.arch(), maker: 'PC', width: 1920, height: 1080, density: 1, lowRam: false, memoryClass: 512, totalMem: os.totalmem(), cores: os.cpus().length, webview: 'Chromium ' + process.versions.chrome, desktop: true }),
    ready: () => null,
    exitApp: () => (onExit(), null),
    log: (s) => (console.log('page:', s), null),
    setKeyPassthrough: () => null,
    setOption: (k, v) => {
      if (k === 'trustAll') sync.opts.trustAll = v === 'true';
      else if (k === 'userAgent') sync.opts.ua = v || '';
      return null;
    },
    setOrientation: (m) => (onMode(m), null),
    readText: (name) => {
      const f = safe(files, name);
      return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    },
    writeText: (name, text) => {
      const f = safe(files, name);
      if (!f) return false;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.w', text);
      fs.renameSync(f + '.w', f);
      return true;
    },
    remove: (name) => {
      const f = safe(files, name);
      if (f) fs.rmSync(f, { recursive: true, force: true });
      return true;
    },
    fileInfo: (name) => {
      const f = safe(files, name);
      const ok = !!f && fs.existsSync(f);
      return JSON.stringify({ exists: ok, size: ok ? fs.statSync(f).size : 0, modified: ok ? fs.statSync(f).mtimeMs : 0 });
    },
    cacheInfo: () => JSON.stringify({ images: dirSize(imgDir), data: dirSize(path.join(files, 'pl')) }),
    clearImageCache: () => {
      fs.rmSync(imgDir, { recursive: true, force: true });
      fs.mkdirSync(imgDir, { recursive: true });
      return null;
    },
    startJob: (id, json) => {
      const flag = { cancelled: false };
      jobs.set(id, flag);
      sync.runJob(id, JSON.parse(json), files, emit, flag).finally(() => jobs.delete(id));
      return null;
    },
    cancelJob: (id) => {
      const f = jobs.get(id);
      if (f) f.cancelled = true;
      return null;
    },
    openExternal: () => false,
    openUrl: (u) => (onOpenUrl(u), true),
    voiceSearch: () => false,
    phoneSetup: () => '',
  };

  async function proxy(res, url, headers, timeout) {
    try {
      const r = await sync.get(url, headers['User-Agent'], headers, timeout);
      const code = r.code >= 300 && r.code < 400 ? 502 : r.code;
      res.writeHead(code, { 'Content-Type': r.type || 'application/octet-stream', 'X-Final-Url': r.finalUrl, 'Cache-Control': 'no-store' });
      r.stream.pipe(res);
    } catch (e) {
      const msg = sync.describe(e);
      res.writeHead(502, { 'X-Net-Error': encodeURI(msg), 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ __netError: msg }));
    }
  }

  const imgWait = new Map();
  async function image(res, src) {
    const key = crypto.createHash('md5').update(src).digest('hex');
    const f = path.join(imgDir, key);
    if (fs.existsSync(f)) {
      res.writeHead(200, { 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(f).pipe(res);
    }
    try {
      if (!imgWait.has(key))
        imgWait.set(
          key,
          (async () => {
            const r = await sync.get(src, null, null, 15000);
            if (r.code >= 400) throw new Error('http ' + r.code);
            const b = await sync.readAll(r.stream, 12 << 20);
            fs.mkdirSync(imgDir, { recursive: true });
            fs.writeFileSync(f + '.tmp', b);
            fs.renameSync(f + '.tmp', f);
            return b;
          })().finally(() => setTimeout(() => imgWait.delete(key), 1000))
        );
      const b = await imgWait.get(key);
      res.writeHead(200, { 'Cache-Control': 'max-age=86400' });
      res.end(b);
    } catch (e) {
      res.writeHead(404);
      res.end();
    }
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    if (p === '/__bridge/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': hi\n\n');
      clients.add(res);
      while (queued.length) res.write(queued.shift());
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/__bridge/call') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        let result = null;
        try {
          const { method, args } = JSON.parse(body);
          const fn = bridge[method];
          result = fn ? fn(...(args || [])) : null;
        } catch (e) {
          console.error(e);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: result === undefined ? null : result }));
      });
      return;
    }
    if (p === '/net') {
      const h = {};
      if (u.searchParams.get('ua')) h['User-Agent'] = u.searchParams.get('ua');
      if (u.searchParams.get('ref')) h.Referer = u.searchParams.get('ref');
      return proxy(res, u.searchParams.get('u'), h, +u.searchParams.get('t') || 30000);
    }
    if (p === '/img') return image(res, u.searchParams.get('u') || '');
    if (p.startsWith('/files/')) {
      const f = safe(files, decodeURIComponent(p.slice(7)));
      if (!f || !fs.existsSync(f)) {
        res.writeHead(404);
        return res.end();
      }
      const o = u.searchParams.get('o');
      const n = u.searchParams.get('n');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      if (o != null && n != null) {
        const fd = fs.openSync(f, 'r');
        const b = Buffer.alloc(Math.min(+n, 4 << 20));
        const got = fs.readSync(fd, b, 0, b.length, +o);
        fs.closeSync(fd);
        return res.end(b.subarray(0, got));
      }
      return fs.createReadStream(f).pipe(res);
    }
    const f = safe(www, p === '/' ? 'index.html' : p.slice(1));
    if (!f || !fs.existsSync(f)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(port || 0, '127.0.0.1', () => resolve(server.address().port)));
}

module.exports = { start };
