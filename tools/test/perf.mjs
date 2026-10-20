import { launch, key, sleep, waitFor } from './tv.mjs';

const { browser, page, errors } = await launch();
const cdp = await page.target().createCDPSession();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
const t0 = Date.now();
await waitFor(page, () => document.querySelector('.home .nav-item'), 30000);
console.log('boot to Home (6x slower CPU):', Date.now() - t0, 'ms');
await sleep(3000);
const mem = async (label) => {
  const m = await page.evaluate(() => ({ heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1, nodes: document.getElementsByTagName('*').length }));
  console.log(`${label.padEnd(28)} heap ${m.heap} MB, DOM ${m.nodes} nodes`);
};
await mem('home (all catalogues)');
// parse cost of the big movie list, measured inside the page
const parse = await page.evaluate(async () => {
  const r = await fetch('/files/pl/' + JSON.parse(window.AndroidNative ? '' : '{}') + '', {}).catch(() => null);
  return null;
});
// key latency: time from keydown to the next two frames, while holding down in a long list
async function keyCost(name, n) {
  const res = await page.evaluate(async (name, n) => {
    const times = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      window.__key(name, 'down', i ? 1 : 0);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      times.push(performance.now() - t);
      await new Promise((r) => setTimeout(r, 45));
    }
    times.sort((a, b) => a - b);
    return { median: times[Math.floor(n / 2)].toFixed(1), p90: times[Math.floor(n * 0.9)].toFixed(1), max: times[n - 1].toFixed(1) };
  }, name, n);
  return res;
}
await key(page, 'ok'); // live
await waitFor(page, () => document.querySelector('.live .chrow .ch-name'), 15000);
await sleep(2000);
await mem('live tv');
console.log('channel list, held down x40:', JSON.stringify(await keyCost('down', 40)));
await key(page, 'left');
console.log('categories, held down x20:', JSON.stringify(await keyCost('down', 20)));
await key(page, 'back');
await sleep(800);
await key(page, 'right');
const t1 = Date.now();
await key(page, 'ok'); // movies
try {
  await waitFor(page, () => [].some.call(document.querySelectorAll('.browse .pcard .pcard-title'), (e) => e.textContent), 20000);
} catch (e) {
  const { shot } = await import('./tv.mjs');
  console.log('STUCK', await shot(page, 'perf-stuck'), await page.evaluate(() => [document.querySelector('.screen:not(.is-hidden)') && document.querySelector('.screen:not(.is-hidden)').className, document.querySelectorAll('.screen').length].join(' | ')));
  console.log(errors);
  process.exit(1);
}
console.log('open Movies (22,000 titles):', Date.now() - t1, 'ms');
await sleep(1500);
await mem('movies grid');
console.log('poster grid, held down x30:', JSON.stringify(await keyCost('down', 30)));
console.log('poster grid, right x30:', JSON.stringify(await keyCost('right', 30)));
await key(page, 'back');
await sleep(600);
await key(page, 'right', 2);
const t2 = Date.now();
await key(page, 'ok'); // guide
await waitFor(page, () => document.querySelectorAll('.guide .gp:not(.gp-wait)').length > 10, 20000);
console.log('open TV guide with data:', Date.now() - t2, 'ms');
await mem('tv guide');
console.log('guide, down x20:', JSON.stringify(await keyCost('down', 20)));
console.log('guide, right x20:', JSON.stringify(await keyCost('right', 20)));
// search on the whole catalogue
await key(page, 'back');
await sleep(500);
await key(page, 'right');
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.search .kbd'), 5000);
const ts = await page.evaluate(async () => {
  const t = performance.now();
  for (const c of 'night') window.__key('char:' + c, 'down', 0);
  await new Promise((r) => setTimeout(r, 400));
  return performance.now() - t;
});
console.log('search "night" incl. 220 ms debounce:', ts.toFixed(0), 'ms;', await page.evaluate(() => document.querySelectorAll('.search .hcard').length), 'cards');
console.log(errors.length ? errors : 'no page errors');
await browser.close();
