/**
 * Content-addressed image references.
 *
 * WHY THIS EXISTS
 * ---------------
 * A user-uploaded image lives in the store as a base64 data URL on the node
 * prototype. That is fine on local disk — a `.redstring` with a photo in it is
 * merely large — but it is actively broken over git: `exportToRedstring` +
 * `JSON.stringify` produce ONE file, so every autosave re-uploads every image
 * and git stores a brand-new multi-megabyte blob per commit.
 *
 * The remedy is to stop fighting git. Git is already a content-addressed blob
 * store; this module supplies the addressing. Full-resolution image bytes move
 * to `universes/<folder>/images/<sha256>.<ext>` and the prototype keeps a short
 * `imageRef` string instead. Blobs are immutable, so they are written once and
 * never touched again, identical images across prototypes collapse to a single
 * blob, and a merge conflict banks a 71-character ref rather than a second copy
 * of the base64.
 *
 * WHAT STAYS INLINE
 * -----------------
 * Only `imageSrc` (the full-resolution original) is externalized.
 * `thumbnailSrc` — 500px, tens of KB — deliberately stays in the JSON, because
 * it is what the canvas renders. Keeping it inline means the canvas still draws
 * every node with zero network, and it means an OLDER build reading a
 * de-inlined file still renders a correct canvas rather than a field of
 * imageless nodes. It degrades on the panel's large view only.
 *
 * @see src/services/imageBlobStore.js — the read side (ref → blob URL)
 * @see GitSyncEngine._externalizeImages — the write side
 */

/** Ref format: `sha256:` + 64 lowercase hex chars. */
const REF_PATTERN = /^sha256:[0-9a-f]{64}$/;

/**
 * MIME → file extension for the image types the app can produce.
 *
 * Uploads are normalized upstream (`loadImageFileAsDataUrl` transcodes HEIC to
 * JPEG), so this list covers what can actually reach us. Anything unrecognized
 * falls back to `.bin`: the extension is cosmetic — the ref, not the path
 * suffix, is what identifies the blob — but a sensible one keeps the repo
 * browsable on github.com, which matters for a format meant to be inspected by
 * hand.
 */
const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg'
};

const EXT_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml'
};

/** True for a well-formed `sha256:<hex>` ref. */
export const isImageRef = (value) =>
  typeof value === 'string' && REF_PATTERN.test(value);

/** True for a base64 data URL — the inline form we externalize away from. */
export const isDataUrl = (value) =>
  typeof value === 'string' && value.startsWith('data:');

/** `image/jpeg` → `jpg`. Unknown types get `bin` (see MIME_TO_EXT). */
export const extForMime = (mime) =>
  MIME_TO_EXT[String(mime || '').toLowerCase().split(';')[0].trim()] || 'bin';

/** `jpg` → `image/jpeg`. Used when handing fetched bytes back to the browser. */
export const mimeForExt = (ext) =>
  EXT_TO_MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';

/**
 * Repo path for a ref's blob, beside the universe's `.redstring` file.
 *
 * @param {string} ref - `sha256:<hex>`
 * @param {string} universeFolder - e.g. `default`
 * @param {string} [ext='bin'] - cosmetic extension
 * @returns {string|null} path, or null if the ref is malformed
 */
export const refToBlobPath = (ref, universeFolder, ext = 'bin') => {
  if (!isImageRef(ref)) return null;
  const hex = ref.slice('sha256:'.length);
  return `universes/${universeFolder}/images/${hex}.${ext}`;
};

/**
 * Recover the extension recorded alongside a ref, if the caller stored one.
 * Refs are self-describing about identity but not about type, so the
 * externalizer records `imageRefExt` next to the ref; this is the fallback for
 * files that predate it or lost it.
 */
export const blobPathCandidates = (ref, universeFolder, knownExt = null) => {
  if (!isImageRef(ref)) return [];
  if (knownExt) return [refToBlobPath(ref, universeFolder, knownExt)];
  // No recorded extension: try the plausible ones. Cheap — a miss is a 404 and
  // uploads always record an extension, so this only runs for hand-edited files.
  return ['jpg', 'png', 'webp', 'gif', 'avif', 'svg', 'bin']
    .map((ext) => refToBlobPath(ref, universeFolder, ext));
};

/**
 * Split a base64 data URL into its MIME type and raw bytes.
 *
 * @param {string} dataUrl
 * @returns {{ mime: string, bytes: Uint8Array }|null} null if not a parseable
 *   base64 data URL (percent-encoded data URLs are not image payloads and are
 *   left alone rather than mangled)
 */
export const parseDataUrl = (dataUrl) => {
  if (!isDataUrl(dataUrl)) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;

  const header = dataUrl.slice(5, comma); // between "data:" and ","
  if (!/;base64$/i.test(header)) return null;

  const mime = header.slice(0, -';base64'.length) || 'application/octet-stream';
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  } catch {
    // Truncated or corrupt base64 — treat as un-externalizable and leave inline.
    return null;
  }
};

// ── SHA-256 ────────────────────────────────────────────────────────────────
// WebCrypto is the fast path, but `crypto.subtle` is only exposed in a secure
// context — and the packaged Electron app loads the renderer over file://,
// which is not guaranteed to qualify. Without a fallback, externalization
// would silently no-op on the desktop build: images would stay inline, every
// autosave would keep re-uploading them, and nothing would say why. So there
// is a plain-JS implementation behind it. Verified against the standard NIST
// vectors in test/formats/imageRefs.test.js.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** Plain-JS SHA-256. Returns lowercase hex. */
const sha256Fallback = (bytes) => {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);

  // Pad: 0x80, then zeros, then the 64-bit big-endian bit length.
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array((((bytes.length + 9) >> 6) + 1) << 6);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  // Length is written as two 32-bit halves; a JS number holds the low 53 bits
  // exactly, which is far past any image we could hold in memory anyway.
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(withPad.length - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < withPad.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, '0');
  return hex;
};

/**
 * SHA-256 of a byte array, lowercase hex.
 *
 * Never returns null for valid input: WebCrypto where available, the plain-JS
 * implementation above otherwise. The signature still permits null so callers
 * keep their "cannot externalize, keep it inline" branch — degrading to inline
 * is wasteful but lossless, which is the only acceptable failure mode for the
 * user's own photographs.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<string|null>}
 */
export const sha256Hex = async (bytes) => {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      // Copy into a fresh ArrayBuffer: a Uint8Array view over a larger pooled
      // buffer would otherwise hash the whole buffer, not the view.
      const digest = await subtle.digest('SHA-256', bytes.slice().buffer);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fall through to the JS implementation rather than giving up.
    }
  }
  try {
    return sha256Fallback(bytes);
  } catch {
    return null;
  }
};

/**
 * Compute the content address of an inline image.
 *
 * @param {string} dataUrl - base64 data URL
 * @returns {Promise<{ ref: string, bytes: Uint8Array, mime: string, ext: string }|null>}
 *   null when the value is not an externalizable data URL, or when hashing is
 *   unavailable — in both cases the caller keeps the image inline.
 */
export const computeImageRef = async (dataUrl) => {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;

  const hex = await sha256Hex(parsed.bytes);
  if (!hex) return null;

  return {
    ref: `sha256:${hex}`,
    bytes: parsed.bytes,
    mime: parsed.mime,
    ext: extForMime(parsed.mime)
  };
};
