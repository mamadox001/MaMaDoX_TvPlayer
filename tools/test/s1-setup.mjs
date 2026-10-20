import { launch, key, type, shot, sleep, waitFor, report } from './tv.mjs';

const { browser, page, errors } = await launch();
await sleep(500);
await shot(page, 'splash');
await waitFor(page, () => document.querySelector('.setup'), 8000);
await sleep(600);
await shot(page, 'setup-empty');
// name
await key(page, 'ok');
await type(page, 'Demo TV');
await shot(page, 'setup-typing');
await key(page, 'back');
await key(page, 'down');
// server
await key(page, 'ok');
await type(page, '127.0.0.1:8091');
await key(page, 'back');
await key(page, 'down');
await key(page, 'ok');
await type(page, 'demo');
await key(page, 'back');
await key(page, 'down');
await key(page, 'ok');
await type(page, 'demo123');
await key(page, 'back');
await key(page, 'down');
await shot(page, 'setup-filled');
await key(page, 'ok');
await sleep(700);
await shot(page, 'setup-loading');
await waitFor(page, () => document.querySelector('.home') && !document.querySelector('.ov-load'), 30000);
await sleep(2500);
await shot(page, 'home');
report(errors);
await browser.close();
