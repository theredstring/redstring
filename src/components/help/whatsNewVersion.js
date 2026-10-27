import { getStorageKey } from '../../utils/storageUtils.js';

/**
 * Which version What's New treats as this app's, and whether this launch is the
 * first since an update.
 *
 * Settings › Debug can stand the app in for another version ("Preview as
 * Version"), so a release can be rehearsed, its changelog entry and note
 * included, before it is tagged.
 */

export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '0.0.0';

const SEEN_KEY = 'redstring-whats-new-seen';
const PREVIEW_KEY = 'redstring-whats-new-preview';
const WELCOME_KEY = 'redstring-welcome-seen';

const read = (key) => {
  try { return localStorage.getItem(getStorageKey(key)); } catch { return null; }
};
const write = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(getStorageKey(key));
    else localStorage.setItem(getStorageKey(key), value);
  } catch { }
};

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

export const isVersion = (v) => VERSION.test(String(v || '').trim());

/**
 * Semver order, prereleases included: 0.15.9 < 1.0.0-rc.1 < 1.0.0. A version
 * that can't be read sorts below every one that can.
 */
export function compareVersions(a, b) {
  const pa = VERSION.exec(String(a || '').trim());
  const pb = VERSION.exec(String(b || '').trim());
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return Math.sign(d);
  }
  if (!pa[4] || !pb[4]) return (pa[4] ? -1 : 0) - (pb[4] ? -1 : 0);
  const xa = pa[4].split('.');
  const xb = pb[4].split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb) {
      const d = Number(xa[i]) - Number(xb[i]);
      if (d) return Math.sign(d);
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (xa[i] !== xb[i]) {
      return xa[i] < xb[i] ? -1 : 1;
    }
  }
  return 0;
}

export const getPreviewVersion = () => {
  const v = read(PREVIEW_KEY);
  return isVersion(v) ? v.trim() : null;
};

/** The version this app is, or is standing in for. */
export const getEffectiveVersion = () => getPreviewVersion() || APP_VERSION;

export const markWhatsNewSeen = (version) => write(SEEN_KEY, version);

/**
 * Open What's New on this launch? Only when this device has opened an older
 * version before. A first install records the version and stays out of
 * onboarding's way; so does going back a version.
 *
 * A device that had Redstring before What's New existed has no record yet, so
 * it counts as updated if it has been through onboarding.
 */
export function shouldShowWhatsNewOnLaunch(version = getEffectiveVersion()) {
  const seen = read(SEEN_KEY);
  if (!seen) {
    let welcomed = read(WELCOME_KEY) === 'true';
    try { welcomed ||= localStorage.getItem(WELCOME_KEY) === 'true'; } catch { }
    return welcomed;
  }
  return compareVersions(version, seen) > 0;
}

/** Settings › Debug: launch as if this device had just updated. */
export function replayUpdateLaunch() {
  write(SEEN_KEY, '0.0.0');
  window.location.reload();
}

/**
 * Settings › Debug: stand in for `version` and launch as if updating to it from
 * this build. Null stops standing in; the next launch records the real version
 * without opening anything, since it is older than the preview.
 */
export function previewAsVersion(version) {
  if (version) {
    write(PREVIEW_KEY, version.trim());
    write(SEEN_KEY, APP_VERSION);
  } else {
    write(PREVIEW_KEY, null);
  }
  window.location.reload();
}
