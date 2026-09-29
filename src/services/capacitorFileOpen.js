/**
 * iOS: open a .redstring handed to the app from outside.
 *
 * Info.plist declares the `com.redstring.redstring` document type, so Files,
 * Mail and AirDrop offer "Open in Redstring". iOS delivers the document as a
 * URL, at cold launch (`App.getLaunchUrl`) or while running (`appUrlOpen`).
 * AppDelegate.swift copies a security-scoped document into the app's temporary
 * folder before Capacitor sees it, so the URL that arrives here is always
 * readable by @capacitor/filesystem.
 *
 * Only `file:` URLs ending in `.redstring` are handled; anything else (custom
 * schemes, web links) is ignored. The size is checked before reading (25 MB,
 * the native git-read cap), and the text goes through the ordinary import,
 * which sanitizes it and always creates a NEW universe.
 *
 * Android has no VIEW intent filter for .redstring yet, so this never fires
 * there.
 */

import { GIT_READ_CAP_NATIVE_BYTES } from './gitNativeProvider.js';

export const OPEN_FILE_CAP_BYTES = GIT_READ_CAP_NATIVE_BYTES;

/** True for a local file URL naming a .redstring document. */
export function isOpenableUniverseUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'file:') return false;
  let path;
  try { path = decodeURIComponent(parsed.pathname); } catch { return false; }
  return /\.redstring$/i.test(path);
}

export function fileNameFromUrl(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    return path.split('/').filter(Boolean).pop() || 'Opened.redstring';
  } catch {
    return 'Opened.redstring';
  }
}

/**
 * Read an opened document, refusing oversized files before loading them.
 * @param {string} url
 * @param {{ Filesystem: object, Encoding: object }} fsModule - @capacitor/filesystem
 * @returns {Promise<{ text: string, fileName: string }>}
 */
export async function readOpenedUniverseFile(url, { Filesystem, Encoding }) {
  const fileName = fileNameFromUrl(url);
  const info = await Filesystem.stat({ path: url });
  const size = Number(info?.size);
  if (Number.isFinite(size) && size > OPEN_FILE_CAP_BYTES) {
    const mb = (n) => Math.round(n / (1024 * 1024));
    const error = new Error(`${fileName} is ${mb(size)} MB, over the ${mb(OPEN_FILE_CAP_BYTES)} MB this device can open.`);
    error.code = 'FILE_TOO_LARGE';
    throw error;
  }
  const result = await Filesystem.readFile({ path: url, encoding: Encoding.UTF8 });
  const text = typeof result?.data === 'string' ? result.data : '';
  // stat can be missing a size; check what actually arrived as well.
  if (text.length > OPEN_FILE_CAP_BYTES) {
    const error = new Error(`${fileName} is too large for this device to open.`);
    error.code = 'FILE_TOO_LARGE';
    throw error;
  }
  return { text, fileName };
}

/**
 * Handle one incoming URL. Ignores what isn't ours; reports failures through
 * `notify` instead of throwing (this runs from native event callbacks).
 */
export async function handleOpenedUrl(url, { importText, notify = () => {}, fsModule } = {}) {
  if (!isOpenableUniverseUrl(url)) return { handled: false };
  try {
    const fs = fsModule || await import('@capacitor/filesystem');
    const { text, fileName } = await readOpenedUniverseFile(url, fs);
    const result = await importText(text, fileName);
    return { handled: true, ...result };
  } catch (error) {
    console.warn('[CapacitorFileOpen] Could not open', fileNameFromUrl(url), error?.message || error);
    notify('error', `Couldn't open ${fileNameFromUrl(url)}: ${error?.message || error}`);
    return { handled: true, error };
  }
}

/**
 * Listen for documents opened into the app. The launch URL and the first
 * `appUrlOpen` can name the same file; each URL is handled once per session.
 * @returns {Promise<() => void>} cleanup
 */
export async function registerCapacitorFileOpen({ importText, notify, appModule } = {}) {
  const { App } = appModule || await import('@capacitor/app');
  const seen = new Set();
  const handle = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    handleOpenedUrl(url, { importText, notify });
  };

  const listener = await App.addListener('appUrlOpen', (event) => handle(event?.url));
  try {
    const launch = await App.getLaunchUrl();
    handle(launch?.url);
  } catch { /* no launch URL */ }

  return () => { try { listener?.remove?.(); } catch { /* already removed */ } };
}
