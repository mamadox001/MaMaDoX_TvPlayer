// Bundles the TV interface into android/assets/www (used by the APK and the dev server).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'android/assets/www');
const dev = process.argv.includes('--dev');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
const build = Date.now().toString(36);
const result = await esbuild.build({
  entryPoints: [path.join(ROOT, 'web/src/main.js')],
  bundle: true,
  outfile: path.join(OUT, 'app.js'),
  format: 'iife',
  target: ['chrome53'],
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  loader: { '.svg': 'text' },
  external: ['fonts/*'],
  logLevel: 'warning',
  metafile: true,
  legalComments: 'none',
});
const F = path.join(ROOT, 'node_modules/@fontsource');
const fonts = {
  'atk-400.woff2': 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff2',
  'atk-700.woff2': 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-700-normal.woff2',
  'atk-ext-400.woff2': 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-400-normal.woff2',
  'atk-ext-700.woff2': 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-700-normal.woff2',
  'teko-500.woff2': 'teko/files/teko-latin-500-normal.woff2',
  'teko-600.woff2': 'teko/files/teko-latin-600-normal.woff2',
};
for (const [to, from] of Object.entries(fonts)) fs.copyFileSync(path.join(F, from), path.join(OUT, 'fonts', to));
fs.writeFileSync(path.join(OUT, 'index.html'), fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace(/__BUILD__/g, build));
let total = 0;
for (const f of fs.readdirSync(OUT, { recursive: true })) {
  const p = path.join(OUT, f);
  if (fs.statSync(p).isFile()) total += fs.statSync(p).size;
}
console.log(`web build ${build}: app.js ${(fs.statSync(path.join(OUT, 'app.js')).size / 1024).toFixed(0)} KB, app.css ${(fs.statSync(path.join(OUT, 'app.css')).size / 1024).toFixed(0)} KB, total ${(total / 1024).toFixed(0)} KB`);
