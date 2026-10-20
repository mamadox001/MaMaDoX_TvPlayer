import { launch, key, type, shot, sleep, waitFor, report } from './tv.mjs';

const emit = (obj) => fetch('http://127.0.0.1:8090/__emit', { method: 'POST', body: JSON.stringify(obj) });
const { browser, page, errors } = await launch();
await waitFor(page, () => document.querySelector('.home .nav-item'), 15000);
await sleep(1200);
// settings > add playlist
await key(page, 'right', 5);
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.settings .orow'), 5000);
await key(page, 'right');
await key(page, 'down');
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.setup .phone-url'), 5000);
await sleep(600);
await emit({ t: 'phone', data: { type: 'm3u', name: 'Plain M3U', url: 'http://127.0.0.1:8091/plain.m3u', epg: '' } });
await sleep(800);
await shot(page, 'setup-from-phone');
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.home') && !document.querySelector('.ov-load'), 30000);
await sleep(4000); // guide parses in the background
await shot(page, 'home-m3u');
await key(page, 'ok'); // live
await waitFor(page, () => document.querySelector('.live .chrow .ch-name'), 8000);
await sleep(2500);
await shot(page, 'live-m3u');
await key(page, 'down');
await sleep(1500);
await key(page, 'right');
await sleep(500);
await shot(page, 'live-m3u-catchup');
await key(page, 'back');
await key(page, 'back');
await sleep(600);
// switch back to Demo TV
await key(page, 'right', 5);
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.settings .orow'), 5000);
await key(page, 'right');
await key(page, 'ok');
await sleep(500);
await key(page, 'ok'); // Use this playlist
await waitFor(page, () => document.querySelector('.home .brand-pl') && document.querySelector('.home .brand-pl').textContent === 'Demo TV', 8000);
await sleep(1500);
// locked adult category
await key(page, 'left', 5);
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.live .crow .crow-name'), 8000);
await sleep(800);
await key(page, 'left');
const idx = await page.evaluate(() => {
  const s = window.__app_live_cats || null;
  return s;
});
// walk down to the adult category by name
for (let i = 0; i < 60; i++) {
  const cur = await page.evaluate(() => {
    const f = document.querySelector('.live-cats .crow.is-focused .crow-name');
    return f ? f.textContent : '';
  });
  if (/Adult/.test(cur)) break;
  await key(page, 'down', 1, 60);
}
await sleep(500);
await shot(page, 'live-locked');
await key(page, 'ok');
await sleep(600);
await shot(page, 'pin-create-ask');
await key(page, 'ok');
await sleep(400);
for (const d of '1234') await key(page, d, 1, 80);
await sleep(500);
await shot(page, 'pin-repeat');
for (const d of '1234') await key(page, d, 1, 80);
await sleep(900);
await shot(page, 'live-unlocked');
// dead channel 14 in full screen
await key(page, 'left');
await key(page, 'up', 60, 30);
await key(page, 'ok');
await key(page, 'ok');
await sleep(1500);
await key(page, 'ok');
await sleep(1200);
await key(page, '1');
await key(page, '4');
await sleep(9000);
await shot(page, 'dead-channel');
await key(page, 'back');
await key(page, 'back');
await sleep(600);
await key(page, 'back');
await sleep(400);
// wrong password
await key(page, 'right', 5);
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.settings .orow'), 5000);
await key(page, 'right');
await key(page, 'down', 2);
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.setup .field'), 5000);
await key(page, 'ok');
await type(page, 'Bad');
await key(page, 'back');
await key(page, 'down');
await key(page, 'ok');
await type(page, '127.0.0.1:8091');
await key(page, 'back');
await key(page, 'down');
await key(page, 'ok');
await type(page, 'demo');
await key(page, 'back');
await key(page, 'down');
await key(page, 'ok');
await type(page, 'wrong');
await key(page, 'back');
await key(page, 'down');
await key(page, 'ok');
await sleep(2500);
await shot(page, 'wrong-password');
await key(page, 'ok');
await key(page, 'up');
await key(page, 'ok');
await type(page, ':1');
await key(page, 'back');
await key(page, 'down', 2);
await key(page, 'ok');
await sleep(3500);
await shot(page, 'unreachable');
report(errors);
await browser.close();
