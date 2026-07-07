/**
 * secureStore — encryption-at-rest for secrets kept in browser localStorage.
 *
 * Replaces plaintext / trivially-reversible ("base64 of reversed string")
 * storage of API keys and GitHub tokens. Values are encrypted with AES-256-GCM
 * using a **non-extractable** key held in IndexedDB, so the key material can't
 * be read out by script and the ciphertext can't be decoded by casually
 * inspecting localStorage or the on-disk store (notably in Electron, where
 * localStorage is a plaintext file in the app's user-data directory).
 *
 * Threat-model honesty: this does NOT defeat an active XSS running in the app's
 * own origin — such code can call decrypt just like the app does. It raises the
 * bar against passive disclosure (disk access, casual inspection, extensions
 * reading storage) and removes the "fake encryption" footgun.
 *
 * Migration is lossless and lockout-proof: encrypted values carry a marker
 * prefix. Any value WITHOUT the marker is treated as legacy plaintext and
 * returned as-is by decryptSecret(), so existing users keep working and get
 * upgraded to ciphertext on the next write.
 */

const DB_NAME = 'redstring-secure';
const DB_STORE = 'keys';
const KEY_ID = 'secret-store-aes-key';
const MARKER = 'rsenc:v1:';

let cryptoKeyPromise = null;
let inMemoryKey = null; // session fallback when IndexedDB is unavailable

function getSubtle() {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  return c && c.subtle ? c.subtle : null;
}

function toB64(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function idb() {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      try { req.result.createObjectStore(DB_STORE); } catch { /* exists */ }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function idbGet(db, id) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbPut(db, id, value) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const req = tx.objectStore(DB_STORE).put(value, id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

// Resolve a persistent non-extractable AES-GCM key. Prefers IndexedDB (survives
// reloads); falls back to a session-only in-memory key when IndexedDB is absent
// (e.g. tests) so encryption still functions within the session.
async function getCryptoKey() {
  if (cryptoKeyPromise) return cryptoKeyPromise;
  cryptoKeyPromise = (async () => {
    const subtle = getSubtle();
    if (!subtle) throw new Error('WebCrypto subtle unavailable');

    const db = await idb();
    if (db) {
      const existing = await idbGet(db, KEY_ID);
      if (existing) return existing;
      const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await idbPut(db, KEY_ID, key);
      return key;
    }

    if (!inMemoryKey) {
      inMemoryKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    return inMemoryKey;
  })();
  return cryptoKeyPromise;
}

/** True if a stored value is in the encrypted format produced by encryptSecret. */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(MARKER);
}

/**
 * Encrypt a secret for storage. On any failure (no WebCrypto, etc.) returns the
 * plaintext unmarked so callers still function — it simply won't be encrypted.
 * @param {string} plaintext
 * @returns {Promise<string>}
 */
export async function encryptSecret(plaintext) {
  if (plaintext == null) return plaintext;
  const text = String(plaintext);
  try {
    const subtle = getSubtle();
    if (!subtle) return text;
    const key = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return `${MARKER}${toB64(iv)}.${toB64(ct)}`;
  } catch (err) {
    console.warn('[secureStore] Encryption unavailable, storing value unencrypted:', err?.message || err);
    return text;
  }
}

/**
 * Decrypt a stored value. Unmarked values are legacy plaintext and returned
 * as-is (lockout-proof migration). Returns null only if a MARKED value fails to
 * decrypt (corrupt / key rotated).
 * @param {string} stored
 * @returns {Promise<string|null>}
 */
export async function decryptSecret(stored) {
  if (!isEncrypted(stored)) return stored;
  try {
    const subtle = getSubtle();
    if (!subtle) return null;
    const key = await getCryptoKey();
    const body = stored.slice(MARKER.length);
    const [ivB64, ctB64] = body.split('.');
    const iv = fromB64(ivB64);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, fromB64(ctB64));
    return new TextDecoder().decode(pt);
  } catch (err) {
    console.warn('[secureStore] Failed to decrypt stored secret:', err?.message || err);
    return null;
  }
}
