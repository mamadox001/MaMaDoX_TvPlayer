// Remote control input. The Android host forwards every key via window.__key;
// in a browser the keyboard is mapped to the same names.
// Emits {key, repeat, ch, digit}. OK distinguishes a press from a long press.

let handler = null;
let passthrough = false;
let okTimer = 0;
let okDown = false;
let okLongFired = false;
let lastRepeatAt = 0;
const LONG_MS = 560;

export function setKeyHandler(fn) {
  handler = fn;
}

/** While a system text field is active, typing keys go to the field. */
export function setPassthrough(on) {
  passthrough = !!on;
}

function emit(ev) {
  if (!handler) return;
  if (ev.repeat) {
    const t = performance.now();
    if (t - lastRepeatAt < 42) return; // coalesce fast key repeat
    lastRepeatAt = t;
  }
  try {
    handler(ev);
  } catch (e) {
    console.error(e);
  }
}

function onName(name, type, repeat) {
  if (name === 'ok') {
    if (type === 'down') {
      if (repeat > 0 || okDown) return;
      okDown = true;
      okLongFired = false;
      clearTimeout(okTimer);
      okTimer = setTimeout(() => {
        okLongFired = true;
        emit({ key: 'okLong' });
      }, LONG_MS);
    } else if (type === 'up') {
      clearTimeout(okTimer);
      if (okDown && !okLongFired) emit({ key: 'ok' });
      okDown = false;
    }
    return;
  }
  if (type !== 'down') return;
  if (name.indexOf('digit:') === 0) return emit({ key: 'digit', digit: +name.slice(6), repeat: repeat > 0 });
  if (name.indexOf('char:') === 0) return emit({ key: 'char', ch: name.slice(5), repeat: repeat > 0 });
  emit({ key: name, repeat: repeat > 0 });
}

// Android host entry point
window.__key = (name, type, repeat) => onName(name, type, repeat || 0);

const DOM = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Up: 'up', Down: 'down', Left: 'left', Right: 'right',
  Enter: 'ok', ' ': null, Escape: 'back', Esc: 'back', GoBack: 'back', BrowserBack: 'back', Backspace: 'del',
  ContextMenu: 'menu', F2: 'menu', F3: 'info', Info: 'info', MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause',
  MediaStop: 'stop', MediaFastForward: 'ff', MediaRewind: 'rew', MediaTrackNext: 'next', MediaTrackPrevious: 'prev',
  ChannelUp: 'chup', ChannelDown: 'chdown', PageUp: 'pgup', PageDown: 'pgdown', F4: 'guide', Guide: 'guide', F6: 'red', F7: 'green', F8: 'yellow', F9: 'blue',
  Home: 'home', End: 'end', Tab: 'tab', Delete: 'del',
};
const CODES = { 10009: 'back', 461: 'back', 415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rew', 427: 'chup', 428: 'chdown', 457: 'info', 458: 'guide', 403: 'red', 404: 'green', 405: 'yellow', 406: 'blue' };

document.addEventListener('keydown', (e) => {
  if (passthrough) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      onName(e.key === 'Enter' ? 'ok' : e.key === 'Escape' ? 'back' : e.key === 'ArrowUp' ? 'up' : 'down', 'down', 0);
      if (e.key === 'Enter') onName('ok', 'up', 0);
    }
    return;
  }
  let name = DOM[e.key];
  if (name === undefined) name = CODES[e.keyCode];
  if (!name && e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    name = /[0-9]/.test(e.key) ? 'digit:' + e.key : 'char:' + e.key;
  }
  if (!name) return;
  e.preventDefault();
  onName(name, 'down', e.repeat ? 1 : 0);
});

document.addEventListener('keyup', (e) => {
  if (passthrough) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    onName('ok', 'up', 0);
  }
});
