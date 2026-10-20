import { launch, key, shot, sleep, waitFor, report } from './tv.mjs';

const { browser, page, errors } = await launch();
await waitFor(page, () => document.querySelector('.home .nav-item'), 15000);
await sleep(1500);
await key(page, 'right'); // Movies
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.browse .pcard .pcard-title'), 10000);
await sleep(1800);
await shot(page, 'movies-grid');
await key(page, 'right', 2);
await key(page, 'down');
await sleep(1200);
await shot(page, 'movies-focus');
await key(page, 'left', 3); // back to categories
await key(page, 'down', 4);
await sleep(1000);
await shot(page, 'movies-cats');
await key(page, 'ok');
await key(page, 'ok'); // open movie details
await waitFor(page, () => document.querySelector('.details .dt-title') && document.querySelector('.details .dt-title').textContent, 8000);
await sleep(2200);
await shot(page, 'movie-details');
await key(page, 'ok'); // play
await sleep(2500);
await shot(page, 'vod-osd');
await key(page, 'right', 3);
await sleep(300);
await shot(page, 'vod-seeking');
await sleep(1500);
await key(page, 'down');
await key(page, 'right', 2);
await sleep(300);
await shot(page, 'vod-controls');
await key(page, 'ok'); // audio menu (index 3)
await sleep(700);
await shot(page, 'vod-audio');
await key(page, 'back');
await sleep(5000);
await shot(page, 'vod-hidden');
await key(page, 'back');
await sleep(800);
await shot(page, 'movie-resume');
await key(page, 'back');
await key(page, 'back');
await sleep(800);
// series (walk to the start of the menu first: Back behaviour decides where focus is)
await key(page, 'left', 6);
await key(page, 'right', 2);
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.browse .pcard .pcard-title'), 10000);
await sleep(1500);
await key(page, 'ok');
await waitFor(page, () => document.querySelector('.series-dt .eprow .ep-title'), 10000);
await sleep(2000);
await shot(page, 'series-details');
await key(page, 'down');
await sleep(300);
await key(page, 'right');
await sleep(500);
await shot(page, 'series-seasons');
await key(page, 'down');
await key(page, 'down');
await sleep(700);
await shot(page, 'series-episodes');
await key(page, 'ok');
await sleep(2500);
await shot(page, 'episode-osd');
await key(page, 'back');
await key(page, 'back');
await sleep(1000);
await shot(page, 'series-after');
report(errors);
await browser.close();
