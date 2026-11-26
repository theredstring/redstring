/**
 * The desktop-app offer, shared by the RedstringMenu entry and the file-access
 * prompt, so both answer "should this browser be told about the desktop build
 * at all?" from one place rather than each carrying its own device gate.
 */

import { isElectron, isCapacitor } from './fileAccessAdapter.js';
import { getDeviceInfo } from './deviceDetection.js';
import { openExternalUrl } from './safeUrl.js';

export const DESKTOP_DOWNLOAD_URL = 'https://redstring.net/#download';

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

export const openDesktopDownload = () => {
  openExternalUrl(DESKTOP_DOWNLOAD_URL);
};
