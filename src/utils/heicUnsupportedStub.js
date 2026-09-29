/**
 * Stand-in for `heic-to` in the iOS/Android (Capacitor) build.
 *
 * heic-to bundles libheif, which is LGPL-3.0; the store builds leave it out
 * (vite.config.js aliases `heic-to` to this file in mode 'capacitor'). The
 * native WebViews decode HEIC themselves where the OS supports it, so the
 * fast path in `loadImageFileAsDataUrl` (src/utils.js) handles phone photos;
 * this only runs when that native decode failed, and says so plainly.
 *
 * Same exports as heic-to, so the dynamic import in src/utils.js needs no
 * platform branch.
 */

export const HEIC_UNSUPPORTED_MESSAGE = 'HEIC images are not supported in this build';

const unsupported = () => {
  const error = new Error(HEIC_UNSUPPORTED_MESSAGE);
  error.code = 'HEIC_UNSUPPORTED';
  return error;
};

/** heic-to's isHeic: answered from the type/extension only (no decoder here). */
export async function isHeic(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return type === 'image/heic' || type === 'image/heif' || /\.(heic|heif)$/.test(name);
}

export async function heicTo() {
  throw unsupported();
}

export default { heicTo, isHeic };
