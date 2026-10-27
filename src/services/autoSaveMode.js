/**
 * When Redstring saves on its own (Settings → Data → Autosave). A preference
 * of this device, not of the universe: it isn't written to the file.
 *
 * - 'auto' (Automatic): saves on its own while the universe's file is under
 *   AUTO_SAVE_MAX_BYTES. Past it, a save rewrites a file big enough that doing
 *   it after every edit gets in the way, so it waits for the user to save.
 *   Size is measured in bytes, not Things: the save worker reuses the pieces
 *   that didn't change, so what a save costs is rewriting the file.
 * - 'always': saves on its own whatever the size.
 * - 'off' (Never): saves only when the user saves.
 *
 * When autosave is off, SaveCoordinator still notices every change (so the
 * indicator can offer Save, and closing asks first) but writes nothing until
 * saveNow().
 */

export const AUTO_SAVE_MODES = ['auto', 'always', 'off'];
export const DEFAULT_AUTO_SAVE_MODE = 'auto';

// File bytes under which Automatic saves on its own.
export const AUTO_SAVE_MAX_BYTES = 100 * 1024 * 1024;

const STORAGE_KEY = 'redstring_auto_save_mode';

const readStored = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return AUTO_SAVE_MODES.includes(saved) ? saved : DEFAULT_AUTO_SAVE_MODE;
  } catch {
    return DEFAULT_AUTO_SAVE_MODE;
  }
};

let mode = readStored();
const listeners = new Set();

/** @returns {'auto'|'always'|'off'} */
export const getAutoSaveMode = () => mode;

/** @param {'auto'|'always'|'off'} next */
export function setAutoSaveMode(next) {
  if (!AUTO_SAVE_MODES.includes(next) || next === mode) return;
  mode = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* kept for this session */ }
  for (const listener of listeners) {
    try { listener(next); } catch (error) { console.warn('[autoSaveMode] listener failed:', error); }
  }
}

/** @returns {Function} unsubscribe */
export function subscribeAutoSaveMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether a universe of this size saves on its own in this mode.
 *
 * @param {'auto'|'always'|'off'} saveMode
 * @param {{bytes?: number}} size - the file's bytes (0 if not known yet)
 */
export function autoSaves(saveMode, { bytes = 0 } = {}) {
  if (saveMode === 'always') return true;
  if (saveMode === 'off') return false;
  return bytes < AUTO_SAVE_MAX_BYTES;
}

/** Tests only. */
export function __resetAutoSaveMode() {
  mode = readStored();
  listeners.clear();
}
