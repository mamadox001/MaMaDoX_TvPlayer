import { launch, key, shot, sleep, waitFor, report } from './tv.mjs';

const { browser, page, errors } = await launch();
await waitFor(page, () => document.querySelector('.home .nav-item'), 15000);
await sleep(2500);
await shot(page, 'home-images');
await key(page, 'ok'); // Live TV
await waitFor(page, () => document.querySelector('.live .chrow .ch-name'), 8000);
await sleep(1800);
await shot(page, 'live-initial');
await key(page, 'down', 3);
await sleep(1500);
await shot(page, 'live-focus');
await key(page, 'left');
await key(page, 'down', 4);
await sleep(800);
await shot(page, 'live-cats');
await key(page, 'ok');
await key(page, 'down', 2);
await key(page, 'ok'); // play in preview
await sleep(2500);
await shot(page, 'live-preview');
await key(page, 'right'); // programmes
await sleep(400);
await key(page, 'up', 2);
await sleep(400);
await shot(page, 'live-progs');
await key(page, 'left');
await key(page, 'ok'); // fullscreen
await sleep(1500);
await shot(page, 'player-banner');
await key(page, 'down'); // zap
await sleep(1200);
await shot(page, 'player-zap');
await key(page, 'ok'); // channel list overlay
await sleep(900);
await shot(page, 'player-list');
await key(page, 'right'); // next category
await sleep(800);
await shot(page, 'player-list-cat');
await key(page, 'back');
await key(page, 'okLong'); // options menu
await sleep(700);
await shot(page, 'player-options');
await key(page, 'back');
await key(page, '1');
await key(page, '2');
await sleep(300);
await shot(page, 'player-number');
await sleep(2200);
await key(page, 'back'); // banner hide or exit
await key(page, 'back');
await sleep(900);
await shot(page, 'live-back');
report(errors);
await browser.close();
