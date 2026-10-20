// Persistent JSON documents saved by the host (atomic writes, debounced).
import { Native } from './native.js';

const cache = {};
const dirty = {};
let timer = 0;

export const Store = {
  get(name, def) {
    if (name in cache) return cache[name];
    let v = def;
    const txt = Native.readText(name + '.json');
    if (txt) {
      try {
        v = JSON.parse(txt);
      } catch (e) {
        v = def;
      }
    }
    if (v && def && typeof def === 'object' && !Array.isArray(def)) v = Object.assign({}, def, v);
    cache[name] = v;
    return v;
  },
  set(name, value) {
    cache[name] = value;
    dirty[name] = true;
    clearTimeout(timer);
    timer = setTimeout(Store.flush, 400);
  },
  /** Mark a document returned by get() as changed. */
  touch(name) {
    if (name in cache) Store.set(name, cache[name]);
  },
  flush() {
    clearTimeout(timer);
    for (const n in dirty) {
      try {
        Native.writeText(n + '.json', JSON.stringify(cache[n]));
      } catch (e) {
        console.error('save', n, e);
      }
      delete dirty[n];
    }
  },
  drop(name) {
    delete cache[name];
    delete dirty[name];
    Native.remove(name + '.json');
  },
};

export const DEFAULT_SETTINGS = {
  liveFormat: 'auto', // auto | m3u8 | ts
  openLiveFullscreen: false,
  homePreview: true,
  autoplayNext: true,
  aspect: 'fit',
  externalPlayer: 'off', // off | vod | all
  clock12: false,
  epgShift: 0,
  showNowInList: true,
  motion: 'auto', // auto | full | reduced
  accent: 'signal',
  pin: '',
  lockAdult: true,
  trustAll: false,
  userAgent: '',
  refreshHours: 24,
  startOn: 'home', // home | live | last
  hideEmptyCats: true,
};

export function settings() {
  return Store.get('settings', DEFAULT_SETTINGS);
}

export function saveSettings() {
  Store.touch('settings');
}
