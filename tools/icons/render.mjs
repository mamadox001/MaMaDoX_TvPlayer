// Renders launcher icons, the Android TV banner, the launch mark and the in-app logo SVG.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const RES = path.join(ROOT, 'android/res');
const TRI = fs.readFileSync(path.join(DIR, 'tri.txt'), 'utf8').trim();
const COLORS = ['#F4F0E6', '#FFC83A', '#48D6E0', '#5BD98C', '#D36BD9', '#FF5148', '#3B6FE0'];
const bars = COLORS.map((c, i) => `<rect x="${30 + i * (53 / 7)}" y="10" width="${53 / 7 + 0.4}" height="80" fill="${c}"/>`).join('');
export const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="22 10 68 80"><defs><clipPath id="t"><path d="${TRI}"/></clipPath></defs><g clip-path="url(#t)">${bars}</g></svg>`;
fs.mkdirSync(path.join(ROOT, 'web/assets'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'web/assets/mark.svg'), MARK);

const teko = fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource/teko/files/teko-latin-600-normal.woff2')).toString('base64');
const font = `@font-face{font-family:Teko;src:url(data:font/woff2;base64,${teko}) format('woff2');font-weight:600}`;

const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const page = await browser.newPage();
async function shot(html, w, h, out) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>${font}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
const icon = (s) => `<div style="width:${s}px;height:${s}px;border-radius:${s * 0.22}px;background:#0E1B2C;display:flex;align-items:center;justify-content:center;box-sizing:border-box;border:${Math.max(1, s * 0.02)}px solid #2B466E"><div style="width:${s * 0.62}px;height:${s * 0.73}px;margin-left:${s * 0.05}px">${MARK.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div>`;
for (const [d, s] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) await shot(icon(s), s, s, path.join(RES, `mipmap-${d}/ic_launcher.png`));
// Android TV banner 320x180dp -> xhdpi 640x360
const banner = `<div style="width:640px;height:360px;background:#0E1B2C;display:flex;align-items:center;padding-left:58px;box-sizing:border-box;position:relative;overflow:hidden">
  <div style="width:150px;height:176px">${MARK.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
  <div style="margin-left:26px;font-family:Teko;font-weight:600;color:#F4F0E6;line-height:.82;font-size:112px;letter-spacing:1px">IPTV<br>Player</div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:10px;display:flex">${COLORS.map((c) => `<i style="flex:1;background:${c}"></i>`).join('')}</div></div>`;
await shot(banner, 640, 360, path.join(RES, 'drawable-xhdpi/banner.png'));
// mark used on the native launch screen (behind the web splash)
await shot(`<div style="width:136px;height:160px">${MARK.replace('<svg ', '<svg width="100%" height="100%" ')}</div>`, 136, 160, path.join(RES, 'drawable-xhdpi/launch_mark.png'));
await browser.close();
console.log('icons rendered');
