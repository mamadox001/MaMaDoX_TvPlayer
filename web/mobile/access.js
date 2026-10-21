// Parental control on the phone: adult categories stay locked behind a PIN.
import { settings, saveSettings } from '../src/store.js';
import { Session } from '../src/data/session.js';
import { askPin, confirm, toast } from './ui.js';

export const isLocked = (cat) => !!(cat && cat.adult && settings().lockAdult && !Session.unlocked);
export const itemLocked = (it) => !!(it && it.adult && settings().lockAdult && !Session.unlocked);

export async function createPin() {
  const a = await askPin('Choose a 4-digit PIN');
  if (!a) return false;
  const b = await askPin('Enter it again');
  if (a !== b) {
    toast('The PINs did not match. Try again.');
    return false;
  }
  settings().pin = a;
  saveSettings();
  return true;
}

export async function unlock() {
  if (Session.unlocked) return true;
  if (!settings().pin) {
    const go = await confirm('Create a PIN', 'Adult categories are locked. Create a PIN to open them. You can change it in Settings.', [
      { label: 'Create PIN', value: 1 },
      { label: 'Not now', value: 0 },
    ]);
    if (!go || !(await createPin())) return false;
    Session.unlocked = true;
    return true;
  }
  const p = await askPin('Enter your PIN', 'Adult categories are locked.');
  if (p == null) return false;
  if (p !== settings().pin) {
    toast('Wrong PIN');
    return false;
  }
  Session.unlocked = true;
  return true;
}

export async function checkPin(title) {
  if (!settings().pin) return true;
  const p = await askPin(title || 'Enter your PIN');
  if (p == null) return false;
  if (p !== settings().pin) {
    toast('Wrong PIN');
    return false;
  }
  return true;
}
