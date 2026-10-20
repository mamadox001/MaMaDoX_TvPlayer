// Drives the TV interface in headless Chromium like a remote control.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

export const SHOTS = process.env.SHOTS || path.resolve('shots');
fs.mkdirSync(SHOTS, { recursive: true });

const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ok: 'Enter', back: 'Escape', menu: 'F2', info: 'F3', guide: 'F4', pgup: 'PageUp', pgdown: 'PageDown', del: 'Backspace' };

export async function launch(opts = {}) {
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args, '--autoplay-policy=no-user-gesture-required', '--disable-features=PrivateNetworkAccessRespectPreflightResults'],
    headless: true,
    defaultViewport: opts.viewport || { width: 960, height: 540, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|ERR_ABORTED|net::ERR|404/.test(m.text())) errors.push('console: ' + m.text());
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!/\/img\?|test\.webm|\/live\/|\/movie\/|\/series\/|\/timeshift\//.test(u) && !/ERR_ABORTED/.test(r.failure().errorText)) errors.push('requestfailed: ' + u + ' ' + r.failure().errorText);
  });
  await page.goto(opts.url || 'http://127.0.0.1:8090/', { waitUntil: 'domcontentloaded' });
  return { browser, page, errors };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function key(page, name, times = 1, gap = 140) {
  for (let i = 0; i < times; i++) {
    if (name === 'okLong') {
      await page.keyboard.down('Enter');
      await sleep(750);
      await page.keyboard.up('Enter');
    } else if (/^[0-9]$/.test(name)) await page.keyboard.press(name);
    else await page.keyboard.press(KEYS[name] || name);
    await sleep(gap);
  }
}

export async function type(page, text) {
  for (const ch of text) {
    await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    await sleep(25);
  }
}

let n = 0;
export async function shot(page, name) {
  n++;
  const f = path.join(SHOTS, `${String(n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f });
  return f;
}

export async function waitFor(page, fn, timeout = 15000, arg) {
  await page.waitForFunction(fn, { timeout, polling: 100 }, arg);
}

export function report(errors) {
  if (errors.length) {
    console.log('ERRORS:');
    for (const e of errors) console.log('  ' + e);
  } else console.log('no page errors');
}
