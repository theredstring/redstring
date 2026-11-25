/**
 * Where to get Redstring on other devices: the desktop builds (the website's
 * download section) and the two phone stores. Shown in Settings > About and
 * the Help menu.
 *
 * Never inside the phone apps themselves: they are built from this same code,
 * and an iOS app that points at Google Play does not pass review.
 */

import { isElectron, isCapacitor } from './fileAccessAdapter.js';
import { DESKTOP_DOWNLOAD_URL } from './desktopDownload.js';

export const APP_STORE_URL = 'https://apps.apple.com/app/redstring-webs-within-webs/id6836573179';
export const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=io.redstring.app';

/** The browser and the desktop app; never the phone apps. */
export const canOfferAppDownloads = () => {
  if (typeof window === 'undefined') return false;
  return !isCapacitor();
};

/**
 * The rows to offer here. The desktop app leaves out the desktop row: it is
 * already what they are running.
 */
export const getAppDownloadLinks = () => {
  if (!canOfferAppDownloads()) return [];
  const links = [];
  if (!isElectron()) {
    links.push({
      id: 'desktop',
      label: 'Desktop',
      description: 'Mac, Windows and Linux.',
      url: DESKTOP_DOWNLOAD_URL
    });
  }
  links.push(
    { id: 'ios', label: 'iPhone and iPad', description: 'On the App Store.', url: APP_STORE_URL },
    { id: 'android', label: 'Android', description: 'On Google Play.', url: GOOGLE_PLAY_URL }
  );
  return links;
};

/** The website's download section, which lists every build and both stores. */
export const ALL_DOWNLOADS_URL = DESKTOP_DOWNLOAD_URL;

export { DESKTOP_DOWNLOAD_URL };
