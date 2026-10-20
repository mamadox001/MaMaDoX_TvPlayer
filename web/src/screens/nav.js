// Screens register here so they can open each other without import cycles.
import { App } from '../ui/app.js';

const reg = {};

export function register(name, factory) {
  reg[name] = factory;
}

export function create(name, opts) {
  return reg[name](opts || {});
}

/** Push a screen by name. */
export function go(name, opts, params) {
  App.push(create(name, opts), params);
}

export function replaceWith(name, opts, params) {
  App.replace(create(name, opts), params);
}
