/**
 * The desktop-app nudge, shared by the RedstringMenu entry and the canvas pill.
 *
 * Both surfaces answer the same two questions — "should this browser be told
 * about the desktop build at all?" and "has this person already dealt with the
 * prompt?" — so they answer them from one place rather than each carrying its
 * own copy of the device gate.
 */

import { isElectron, isCapacitor } from './fileAccessAdapter.js';
import { getDeviceInfo } from './deviceDetection.js';
import { getStorageKey } from './storageUtils.js';

export const DESKTOP_DOWNLOAD_URL = 'https://redstring.net/#download';

const DISMISSED_KEY = 'redstring_desktop_download_dismissed';

/**
 * Whether the desktop build is worth offering here: only in a plain browser, on
 * hardware that can actually run it. The packaged shells already ARE the app,
 * and a phone or tablet has no use for a .dmg.
 */
export const canOfferDesktopDownload = () => {
  if (typeof window === 'undefined') return false;
  if (isElectron() || isCapacitor()) return false;
  const { isMobile, isTablet } = getDeviceInfo();
  return !isMobile && !isTablet;
};

/**
 * True once the pill has been dismissed or acted on. A storage failure reads as
 * "not dismissed": a private window showing the nudge again is a smaller cost
 * than never showing it to someone who has never seen it.
 */
export const isDesktopDownloadDismissed = () => {
  try {
    return localStorage.getItem(getStorageKey(DISMISSED_KEY)) === 'true';
  } catch {
    return false;
  }
};

export const dismissDesktopDownload = () => {
  try {
    localStorage.setItem(getStorageKey(DISMISSED_KEY), 'true');
  } catch {
    // Nothing to persist to. The caller still hides the pill for this session.
  }
};

export const openDesktopDownload = () => {
  window.open(DESKTOP_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
};
