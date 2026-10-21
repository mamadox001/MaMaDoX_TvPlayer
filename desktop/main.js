// MaMaDoX TvPlayer for Windows: one window showing the player interface, served by the
// local helper in server.js.
'use strict';
const { app, BrowserWindow, session, shell, Menu } = require('electron');
const path = require('path');
const server = require('./server');
const sync = require('./sync');

let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const port = await server.start({
    www: path.join(__dirname, 'www'),
    data: app.getPath('userData'),
    version: app.getVersion(),
    onExit: () => app.quit(),
    onMode: (m) => win && win.setFullScreen(m === 'landscape'),
    onOpenUrl: (u) => /^https?:/.test(u) && shell.openExternal(u),
  });
  // Streams are played by the page itself: send the playlist's identity with them.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
    if (!/^http:\/\/127\.0\.0\.1:/.test(d.url)) d.requestHeaders['User-Agent'] = sync.opts.ua || sync.DEFAULT_UA;
    cb({ requestHeaders: d.requestHeaders });
  });
  session.defaultSession.setCertificateVerifyProc((req, cb) => cb(sync.opts.trustAll ? 0 : -3));
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0E1B2C',
    title: 'MaMaDoX TvPlayer',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { webSecurity: false, contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.type === 'keyDown' && input.key === 'F12' && input.control) win.webContents.openDevTools({ mode: 'detach' });
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
});

app.on('window-all-closed', () => app.quit());
