// Phone app walk-through: setup, live TV, full-screen player, movies, series, search, settings.
// Run the dev host with WWW=build/mobile-assets/www and a fresh DATA folder.
import { launch, shot, sleep, waitFor, report } from './tv.mjs';

const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
const tap = async (sel, i = 0) => {
  await page.waitForSelector(sel, { visible: true, timeout: 15000 });
  const els = await page.$$(sel);
  await els[i].tap();
  await sleep(500);
};
const typeInto = async (sel, text) => {
  await page.focus(sel);
  await page.keyboard.type(text, { delay: 10 });
};
const back = async () => {
  await page.keyboard.press('Escape');
  await sleep(500);
};

await waitFor(page, () => document.querySelector('.setup .field'), 15000);
await sleep(600);
await shot(page, 'm-setup');
await typeInto('input[name=name]', 'Demo TV');
await typeInto('input[name=server]', '127.0.0.1:8091');
await typeInto('input[name=user]', 'demo');
await typeInto('input[name=pass]', 'demo123');
await shot(page, 'm-setup-filled');
await tap('.setup .btn.primary');
await waitFor(page, () => document.querySelector('.live .chrow .ch-name') && document.querySelector('.live .chrow .ch-name').textContent, 90000);
await sleep(2500);
await shot(page, 'm-live');
await tap('.live .chrow', 1);
await sleep(2500);
await shot(page, 'm-live-playing');
await tap('.live .chip', 4);
await sleep(1200);
await shot(page, 'm-live-cat');
// full screen
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await tap('.live .hole');
await sleep(1800);
await shot(page, 'm-player-live');
await tap('.player .pl-btn[aria-label=next]');
await sleep(1500);
await shot(page, 'm-player-zap');
await back();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(1200);
await shot(page, 'm-live-back');
// hold for the channel menu
const row = await page.$('.live .chrow');
const bb = await row.boundingBox();
await page.mouse.click(bb.x + 120, bb.y + 30, { button: 'right' });
await sleep(700);
await shot(page, 'm-live-menu');
await back();
// movies
await tap('.tab', 1);
await waitFor(page, () => [].some.call(document.querySelectorAll('.browse .pc-title'), (e) => e.textContent), 20000);
await sleep(2000);
await shot(page, 'm-movies');
await page.evaluate(() => (document.querySelector('.browse.on .vs').scrollTop = 4000));
await sleep(1500);
await shot(page, 'm-movies-scrolled');
await tap('.browse.on .vs-cell:not([style*="display: none"])', 2);
await sleep(1800);
await shot(page, 'm-movie');
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await tap('.detail .btn.primary');
await sleep(2500);
await shot(page, 'm-player-vod');
await back();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(800);
await back();
// series
await tap('.tab', 2);
await waitFor(page, () => [].some.call(document.querySelectorAll('.browse.on .pc-title'), (e) => e.textContent), 20000);
await sleep(1500);
await tap('.browse.on .vs-cell:not([style*="display: none"])', 0);
await waitFor(page, () => document.querySelector('.detail .ep'), 15000);
await sleep(1500);
await shot(page, 'm-series');
await page.evaluate(() => (document.querySelector('.detail .d-scroll').scrollTop = 420));
await sleep(500);
await shot(page, 'm-series-eps');
await back();
// search
await tap('.tab', 3);
await typeInto('.search-input', 'news');
await sleep(1200);
await shot(page, 'm-search');
// settings
await tap('.tab', 4);
await sleep(800);
await shot(page, 'm-settings');
await tap('.set-row', 0);
await sleep(600);
await shot(page, 'm-settings-pl');
await back();
report(errors);
await browser.close();
