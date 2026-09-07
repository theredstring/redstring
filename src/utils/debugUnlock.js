/**
 * Whether the Debug page in Settings is showing.
 *
 * Shared because two places set it: five taps on About inside Settings, and the
 * right-click menu on the header logo, which is where the old "Show Debug Menu"
 * switch lived. A flag two surfaces write is a flag that drifts if each keeps
 * its own copy of the key.
 *
 * Not in debugConfig: that holds what debugging DOES, and this only says whether
 * the page holding those switches is visible. It also has to survive
 * `debugConfig.reset()`, which the page itself offers.
 */

import { getStorageKey } from './storageUtils.js';

const KEY = 'redstring_debug_settings_unlocked';

export const isDebugSettingsUnlocked = () => {
  try {
    return localStorage.getItem(getStorageKey(KEY)) === 'true';
  } catch {
    return false;
  }
};

export const setDebugSettingsUnlocked = (unlocked) => {
  try {
    if (unlocked) localStorage.setItem(getStorageKey(KEY), 'true');
    else localStorage.removeItem(getStorageKey(KEY));
  } catch {
    // Callers hold their own render state; a private window that refuses
    // storage should still get the page, just not across reloads.
  }
};
