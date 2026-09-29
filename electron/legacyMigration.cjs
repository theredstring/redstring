// One-time move of renderer storage from the old file:// origin to
// app://redstring (contract C-5).
//
// Chromium keys localStorage and IndexedDB by origin, so the first launch that
// loads app://redstring sees empty storage: API keys, GitHub connection, the
// universe list, onboarding state. This module carries it across, losslessly:
//
//   1. main reads the old origin's localStorage straight from disk
//      (`<profile>/Local Storage/leveldb`, electron/leveldbReader.cjs). A page
//      can't: with the grantFileProtocolExtraPrivileges fuse off, file:// is an
//      opaque origin and Chromium denies it localStorage.
//   2. main opens a hidden window on a tiny file:// page (same partition as the
//      app) and runs legacyExportInPage() there with executeJavaScript. It dumps
//      the IndexedDB databases the app uses (IndexedDB is still reachable) and
//      decrypts the secureStore ciphertexts (`rsenc:v1:…`) found in step 1 with
//      the old origin's AES key — the only place that key can be used.
//   3. main hands the new origin the localStorage entries with each ciphertext
//      replaced, in the same place, by `rsplain:v1:<plaintext>` (A5's contract:
//      secureStore / persistentAuth / apiKeyManager move those into
//      window.electron.secrets on first read and scrub them), plus the
//      IndexedDB dump. src/main.jsx writes only keys/records it doesn't already
//      have, before any store initialises, and reports back. Only then does
//      main write the marker.
//
// Legacy data is never deleted, so a failed run simply retries next launch;
// "fill missing only" makes every retry safe.
//
// Everything here except runLegacyExport() is pure and unit-tested.

const path = require('node:path');
const fs = require('node:fs');
const { readChromiumLocalStorage } = require('./leveldbReader.cjs');

const SECRET_MARKER = 'rsenc:v1:';
const PLAIN_HANDOFF_PREFIX = 'rsplain:v1:';
const CIPHERTEXT_RE = /rsenc:v1:[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/g;
const LEGACY_ORIGIN = 'file://';

// IndexedDB databases that are not carried over:
//   redstring-secure        — the old origin's AES key (non-extractable; the
//                             secrets it protected are decrypted instead)
//   redstring-label-sprites — a render cache, rebuilt on demand
const SKIP_DATABASES = ['redstring-secure', 'redstring-label-sprites'];

// ── Runs inside the legacy file:// page ─────────────────────────
// Self-contained: it is stringified and executed with executeJavaScript, so it
// may not reference anything outside its own body. Returns a JSON string.
async function legacyExportInPage(options) {
  const MARKER = 'rsenc:v1:';
  const skip = new Set((options && options.skipDatabases) || []);
  const ciphertexts = (options && options.ciphertexts) || [];
  const out = {
    version: 1,
    decrypted: [],
    undecryptable: 0,
    databases: [],
    skippedRecords: 0,
    errors: []
  };

  const toB64 = (bytes) => {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  };
  const fromB64 = (b64) => {
    const bin = atob(b64);
    const outBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) outBytes[i] = bin.charCodeAt(i);
    return outBytes;
  };
  const T = '__rsMigrationType';
  const UNSUPPORTED = {};

  // Structured-clone values → JSON-safe tagged values (decoded by
  // src/electronLegacyImport.js). Returns UNSUPPORTED for values that cannot
  // leave the origin (CryptoKey, file-system handles, …).
  async function encode(value, depth) {
    if (depth > 200) return UNSUPPORTED;
    if (value === undefined) return { [T]: 'undefined' };
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (Number.isFinite(value) && !Object.is(value, -0)) return value;
      return { [T]: 'number', v: Object.is(value, -0) ? '-0' : String(value) };
    }
    if (typeof value === 'bigint') return { [T]: 'bigint', v: value.toString() };
    if (typeof value !== 'object') return UNSUPPORTED;
    if (value instanceof Date) return { [T]: 'Date', v: value.getTime() };
    if (value instanceof RegExp) return { [T]: 'RegExp', source: value.source, flags: value.flags };
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      const bytes = new Uint8Array(await value.arrayBuffer());
      const isFile = typeof File !== 'undefined' && value instanceof File;
      return { [T]: isFile ? 'File' : 'Blob', type: value.type, name: isFile ? value.name : undefined, lastModified: isFile ? value.lastModified : undefined, b64: toB64(bytes) };
    }
    if (value instanceof ArrayBuffer) return { [T]: 'ArrayBuffer', b64: toB64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { [T]: 'View', ctor: value.constructor && value.constructor.name, b64: toB64(bytes) };
    }
    if (value instanceof Map) {
      const entries = [];
      for (const [k, v] of value) {
        const ek = await encode(k, depth + 1);
        const ev = await encode(v, depth + 1);
        if (ek === UNSUPPORTED || ev === UNSUPPORTED) return UNSUPPORTED;
        entries.push([ek, ev]);
      }
      return { [T]: 'Map', entries };
    }
    if (value instanceof Set) {
      const items = [];
      for (const v of value) {
        const ev = await encode(v, depth + 1);
        if (ev === UNSUPPORTED) return UNSUPPORTED;
        items.push(ev);
      }
      return { [T]: 'Set', items };
    }
    if (Array.isArray(value)) {
      const arr = [];
      for (const v of value) {
        const ev = await encode(v, depth + 1);
        if (ev === UNSUPPORTED) return UNSUPPORTED;
        arr.push(ev);
      }
      return arr;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return UNSUPPORTED;
    const obj = {};
    for (const k of Object.keys(value)) {
      const ev = await encode(value[k], depth + 1);
      if (ev === UNSUPPORTED) return UNSUPPORTED;
      obj[k] = ev;
    }
    if (Object.prototype.hasOwnProperty.call(obj, T)) return { [T]: 'Escaped', v: obj };
    return obj;
  }

  const req = (r) => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  // 1. Decrypt the secureStore ciphertexts main found in localStorage.
  if (ciphertexts.length > 0) {
    let key = null;
    try {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('redstring-secure');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      if (db.objectStoreNames.contains('keys')) {
        key = await req(db.transaction('keys', 'readonly').objectStore('keys').get('secret-store-aes-key'));
      }
      db.close();
    } catch (err) {
      out.errors.push('secure key: ' + (err && err.message ? err.message : String(err)));
    }
    for (const ct of ciphertexts) {
      if (!key || typeof ct !== 'string' || !ct.startsWith(MARKER)) { out.undecryptable++; continue; }
      try {
        const [ivB64, ctB64] = ct.slice(MARKER.length).split('.');
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64));
        out.decrypted.push([ct, new TextDecoder().decode(pt)]);
      } catch {
        out.undecryptable++;
      }
    }
  }

  // 2. IndexedDB
  let names = [];
  try {
    const list = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    names = list.map((d) => d && d.name).filter((n) => typeof n === 'string' && !skip.has(n));
  } catch (err) {
    out.errors.push('indexedDB.databases: ' + (err && err.message ? err.message : String(err)));
  }
  for (const name of names) {
    let db;
    try {
      db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('blocked'));
      });
      const dbOut = { name, version: db.version, stores: [] };
      for (const storeName of Array.from(db.objectStoreNames)) {
        const store = db.transaction(storeName, 'readonly').objectStore(storeName);
        const meta = {
          name: storeName,
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          indexes: Array.from(store.indexNames).map((indexName) => {
            const idx = store.index(indexName);
            return { name: indexName, keyPath: idx.keyPath, unique: idx.unique, multiEntry: idx.multiEntry };
          }),
          records: []
        };
        // getAll + getAllKeys in one transaction: one snapshot, no await
        // between requests that would let the transaction auto-commit.
        const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
        for (let i = 0; i < keys.length; i++) {
          const k = await encode(keys[i], 0);
          const v = await encode(values[i], 0);
          if (k === UNSUPPORTED || v === UNSUPPORTED) { out.skippedRecords++; continue; }
          meta.records.push([k, v]);
        }
        dbOut.stores.push(meta);
      }
      out.databases.push(dbOut);
    } catch (err) {
      out.errors.push('db ' + name + ': ' + (err && err.message ? err.message : String(err)));
    } finally {
      try { if (db) db.close(); } catch { /* ignore */ }
    }
  }

  return JSON.stringify(out);
}

function buildLegacyExportScript(options = {}) {
  const opts = { skipDatabases: SKIP_DATABASES, ciphertexts: [], ...options };
  return `(${legacyExportInPage.toString()})(${JSON.stringify(opts)})`;
}

// Every distinct secureStore ciphertext in a set of localStorage values.
function findCiphertexts(localStorageEntries) {
  const found = new Set();
  for (const [, value] of localStorageEntries || []) {
    if (typeof value !== 'string' || value.indexOf(SECRET_MARKER) === -1) continue;
    for (const m of value.matchAll(CIPHERTEXT_RE)) found.add(m[0]);
  }
  return [...found];
}

// Replace ciphertexts inside one localStorage value. A value that IS the
// ciphertext becomes `rsplain:v1:<plaintext>`; inside JSON the replacement is
// made on the parsed strings, so a plaintext with quotes or backslashes can't
// break the document.
function replaceInValue(value, plainFor) {
  if (typeof value !== 'string' || value.indexOf(SECRET_MARKER) === -1) return value;
  const whole = plainFor.get(value);
  if (whole !== undefined) return PLAIN_HANDOFF_PREFIX + whole;
  const swapString = (s) => {
    const exact = plainFor.get(s);
    if (exact !== undefined) return PLAIN_HANDOFF_PREFIX + exact;
    return s.replace(CIPHERTEXT_RE, (ct) => (plainFor.has(ct) ? PLAIN_HANDOFF_PREFIX + plainFor.get(ct) : ct));
  };
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return swapString(value);
  }
  const walk = (node) => {
    if (typeof node === 'string') return swapString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const outObj = {};
      for (const k of Object.keys(node)) outObj[k] = walk(node[k]);
      return outObj;
    }
    return node;
  };
  return JSON.stringify(walk(parsed));
}

function planSecretHandoff({ localStorageEntries, decrypted }) {
  const plainFor = new Map();
  for (const [ciphertext, plaintext] of decrypted || []) {
    if (typeof ciphertext === 'string' && ciphertext.startsWith(SECRET_MARKER) && typeof plaintext === 'string') {
      plainFor.set(ciphertext, plaintext);
    }
  }
  const entries = (localStorageEntries || []).map(([k, v]) => [k, plainFor.size ? replaceInValue(v, plainFor) : v]);
  return { entries, secretsHandedOff: plainFor.size };
}

// What the new origin receives.
function buildHandoffPayload({ localStorageEntries, exported }) {
  const plan = planSecretHandoff({ localStorageEntries, decrypted: exported.decrypted });
  const databases = exported.databases || [];
  const recordCount = databases.reduce(
    (n, db) => n + (db.stores || []).reduce((m, s) => m + (s.records || []).length, 0), 0);
  return {
    payload: {
      version: 1,
      localStorage: plan.entries,
      databases
    },
    summary: {
      localStorageKeys: plan.entries.length,
      databases: databases.length,
      records: recordCount,
      secretsHandedOff: plan.secretsHandedOff,
      undecryptable: exported.undecryptable || 0,
      skippedRecords: exported.skippedRecords || 0,
      errors: exported.errors || []
    },
    isEmpty: plan.entries.length === 0 && databases.length === 0
  };
}

// Where Chromium keeps a session's storage: the default session in userData,
// a `persist:<name>` partition under Partitions/.
function profileDirFor(userDataDir, partition) {
  if (!partition) return userDataDir;
  const name = String(partition).replace(/^persist:/, '');
  const exact = path.join(userDataDir, 'Partitions', name);
  if (fs.existsSync(exact)) return exact;
  const lower = path.join(userDataDir, 'Partitions', name.toLowerCase());
  return fs.existsSync(lower) ? lower : exact;
}

// The whole export: localStorage from disk, then IndexedDB + decryption in a
// hidden window on the legacy origin. Must run before any window of this
// session touches localStorage (Chromium then owns the database).
async function runLegacyExport({ BrowserWindow, pagePath, partition, userDataDir, timeoutMs = 60000 }) {
  const leveldbDir = path.join(profileDirFor(userDataDir, partition), 'Local Storage', 'leveldb');
  const localStorageEntries = readChromiumLocalStorage(leveldbDir, LEGACY_ORIGIN);
  const ciphertexts = findCiphertexts(localStorageEntries);

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  let timer = null;
  try {
    await win.loadFile(pagePath);
    const json = await Promise.race([
      win.webContents.executeJavaScript(buildLegacyExportScript({ ciphertexts }), true),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('legacy export timed out')), timeoutMs); })
    ]);
    return { localStorageEntries, exported: JSON.parse(json) };
  } finally {
    if (timer) clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = {
  PLAIN_HANDOFF_PREFIX,
  SKIP_DATABASES,
  LEGACY_ORIGIN,
  legacyExportInPage,
  buildLegacyExportScript,
  findCiphertexts,
  planSecretHandoff,
  buildHandoffPayload,
  profileDirFor,
  runLegacyExport
};
