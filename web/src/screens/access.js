// Parental control: adult categories stay locked behind a PIN.
import { askPin, confirm } from '../ui/dialogs.js';
import { settings, saveSettings } from '../store.js';
import { Session } from '../data/session.js';
import { App } from '../ui/app.js';

export function isLocked(cat) {
  return !!(cat && cat.adult && settings().lockAdult && !Session.unlocked);
}

export function itemLocked(it) {
  return !!(it && it.adult && settings().lockAdult && !Session.unlocked);
}

/** Asks for the PIN (creating one the first time). Resolves true when unlocked. */
export async function unlock() {
  if (Session.unlocked) return true;
  const s = settings();
  if (!s.pin) {
    const go = await confirm('Create a PIN', 'Adult categories are locked. Create a 4-digit PIN to open them. You can change it later in Settings.', [
      { label: 'Create PIN', value: 1 },
      { label: 'Not now', value: 0 },
    ]);
    if (!go) return false;
    const a = await askPin('Choose a PIN');
    if (!a) return false;
    const b = await askPin('Enter it again');
    if (a !== b) {
      App.toast('The PINs did not match. Try again.', 'error');
      return false;
    }
    s.pin = a;
    saveSettings();
    Session.unlocked = true;
    return true;
  }
  const p = await askPin('Enter your PIN', 'Adult categories are locked.');
  if (p == null) return false;
  if (p !== s.pin) {
    App.toast('Wrong PIN', 'error');
    return false;
  }
  Session.unlocked = true;
  return true;
}

/** Verify the PIN before changing protected settings. */
export async function checkPin(title) {
  const s = settings();
  if (!s.pin) return true;
  const p = await askPin(title || 'Enter your PIN');
  if (p == null) return false;
  if (p !== s.pin) {
    App.toast('Wrong PIN', 'error');
    return false;
  }
  return true;
}
