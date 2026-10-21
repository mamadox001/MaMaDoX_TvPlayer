// Runs the desktop helper without Electron, for testing in a normal browser.
// Usage: node desktop/run-local.js [dataDir]   then open the printed address.
const path = require('path');
require('./server')
  .start({ www: path.join(__dirname, 'www'), data: process.argv[2] || path.join(__dirname, '.data'), version: 'local', port: +process.env.PORT || 0, onExit() {}, onMode() {}, onOpenUrl() {} })
  .then((port) => console.log('desktop helper on http://127.0.0.1:' + port));
