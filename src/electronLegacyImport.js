/**
 * Desktop app: pull the storage left behind at the old file:// origin into
 * this origin (app://redstring), once, before any store reads it.
 *
 * The main process exports it (electron/legacyMigration.cjs) and hands it over
 * through window.electron.migration. secureStore ciphertexts, which only the
 * old origin's key can open, arrive decrypted as `rsplain:v1:<secret>` in the
 * same place; secureStore moves those into window.electron.secrets (the OS
 * keychain) on first read and scrubs them from localStorage.
 *
 * Only keys and records this origin does not already have are written, so a
 * retry after a partial run can never overwrite something newer. Main writes
 * its "done" marker only after complete({ ok: true }).
 *
 * Inert outside Electron and on every launch after the migration.
 */

const T = '__rsMigrationType';

function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const VIEW_CTORS = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
  ...(typeof BigInt64Array !== 'undefined' ? { BigInt64Array, BigUint64Array } : {})
};

/** Inverse of the encoder in electron/legacyMigration.cjs (legacyExportInPage). */
export function decodeLegacyValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decodeLegacyValue);
  const tag = value[T];
  if (tag === undefined) {
    const obj = {};
    for (const k of Object.keys(value)) obj[k] = decodeLegacyValue(value[k]);
    return obj;
  }
  switch (tag) {
    case 'undefined': return undefined;
    case 'number': return value.v === '-0' ? -0 : Number(value.v);
    case 'bigint': return BigInt(value.v);
    case 'Date': return new Date(value.v);
    case 'RegExp': return new RegExp(value.source, value.flags);
    case 'ArrayBuffer': return fromB64(value.b64).buffer;
    case 'View': {
      const bytes = fromB64(value.b64);
      if (value.ctor === 'DataView') return new DataView(bytes.buffer);
      const Ctor = VIEW_CTORS[value.ctor] || Uint8Array;
      return new Ctor(bytes.buffer, 0, bytes.byteLength / (Ctor.BYTES_PER_ELEMENT || 1));
    }
    case 'Blob': return new Blob([fromB64(value.b64)], { type: value.type || '' });
    case 'File':
      return typeof File !== 'undefined'
        ? new File([fromB64(value.b64)], value.name || 'file', { type: value.type || '', lastModified: value.lastModified })
        : new Blob([fromB64(value.b64)], { type: value.type || '' });
    case 'Map': return new Map(value.entries.map(([k, v]) => [decodeLegacyValue(k), decodeLegacyValue(v)]));
    case 'Set': return new Set(value.items.map(decodeLegacyValue));
    case 'Escaped': {
      const obj = {};
      for (const k of Object.keys(value.v)) obj[k] = decodeLegacyValue(value.v[k]);
      return obj;
    }
    default:
      throw new Error(`Unknown legacy value type: ${tag}`);
  }
}

const idbRequest = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function existingDatabases(idb) {
  if (typeof idb.databases !== 'function') return null;
  const list = await idb.databases();
  return new Map(list.filter((d) => d && d.name).map((d) => [d.name, d.version]));
}

function openDatabase(idb, name, version, legacyStores) {
  return new Promise((resolve, reject) => {
    const r = version ? idb.open(name, version) : idb.open(name);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of legacyStores || []) {
        if (db.objectStoreNames.contains(s.name)) continue;
        const opts = {};
        if (s.keyPath !== null && s.keyPath !== undefined) opts.keyPath = s.keyPath;
        if (s.autoIncrement) opts.autoIncrement = true;
        const store = db.createObjectStore(s.name, opts);
        for (const ix of s.indexes || []) {
          store.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry });
        }
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error(`IndexedDB ${name} blocked`));
  });
}

// add() refuses an existing key: exactly "fill missing". The ConstraintError is
// expected, so it's swallowed without aborting the transaction.
function fillStore(db, storeMeta) {
  return new Promise((resolve, reject) => {
    let added = 0;
    let existed = 0;
    let invalid = 0;
    const tx = db.transaction(storeMeta.name, 'readwrite');
    const store = tx.objectStore(storeMeta.name);
    const inline = store.keyPath !== null && store.keyPath !== undefined;
    for (const [rawKey, rawValue] of storeMeta.records || []) {
      let r;
      try {
        const key = decodeLegacyValue(rawKey);
        const value = decodeLegacyValue(rawValue);
        r = inline ? store.add(value) : store.add(value, key);
      } catch {
        // A record this schema can't hold (DataError). The legacy copy stays
        // where it was; don't let one record sink the whole import.
        invalid++;
        continue;
      }
      r.onsuccess = () => { added++; };
      r.onerror = (event) => {
        if (r.error && r.error.name === 'ConstraintError') {
          existed++;
          event.preventDefault();
          event.stopPropagation();
        }
      };
    }
    tx.oncomplete = () => resolve({ added, existed, invalid });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error(`transaction aborted for ${storeMeta.name}`));
  });
}

/**
 * Write a handed-over legacy payload into this origin. Pure with respect to
 * its arguments (storage objects injected) so it can be tested.
 */
export async function applyLegacyState(payload, { localStorage: ls, indexedDB: idb }) {
  const counts = { localStorageAdded: 0, localStorageExisting: 0, recordsAdded: 0, recordsExisting: 0, storesSkipped: 0 };

  for (const [key, value] of payload.localStorage || []) {
    if (typeof key !== 'string' || typeof value !== 'string') continue;
    if (ls.getItem(key) !== null) { counts.localStorageExisting++; continue; }
    ls.setItem(key, value);
    counts.localStorageAdded++;
  }

  const dbs = payload.databases || [];
  if (dbs.length === 0) return counts;
  const present = await existingDatabases(idb);
  for (const legacy of dbs) {
    const exists = present ? present.has(legacy.name) : false;
    // A database that doesn't exist yet is created at the legacy version with
    // the legacy schema, so the app's own open(name, version) finds exactly
    // what it expects. An existing one is only filled, never re-versioned.
    const db = await openDatabase(idb, legacy.name, exists ? undefined : legacy.version, exists ? null : legacy.stores);
    try {
      for (const storeMeta of legacy.stores || []) {
        if (!db.objectStoreNames.contains(storeMeta.name)) { counts.storesSkipped++; continue; }
        if (!storeMeta.records || storeMeta.records.length === 0) continue;
        const r = await fillStore(db, storeMeta);
        counts.recordsAdded += r.added;
        counts.recordsExisting += r.existed;
        counts.recordsInvalid = (counts.recordsInvalid || 0) + r.invalid;
      }
    } finally {
      db.close();
    }
  }
  return counts;
}

/**
 * Entry point used by src/main.jsx. Never throws: a failed import is reported
 * to main (which then keeps the legacy data and retries next launch) and the
 * app boots regardless.
 */
export async function importLegacyOriginState() {
  const api = typeof window !== 'undefined' ? window.electron?.migration : null;
  if (!api || typeof api.takeLegacyState !== 'function') return null;
  let payload;
  try {
    payload = await api.takeLegacyState();
  } catch (err) {
    console.error('[LegacyImport] Could not fetch legacy state:', err);
    return null;
  }
  if (!payload) return null;
  try {
    const counts = await applyLegacyState(payload, { localStorage: window.localStorage, indexedDB: window.indexedDB });
    console.log('[LegacyImport] Imported legacy file:// storage:', counts);
    await api.complete({ ok: true, counts });
    return counts;
  } catch (err) {
    console.error('[LegacyImport] Import failed — legacy data kept, will retry next launch:', err);
    try { await api.complete({ ok: false, error: String(err?.message || err) }); } catch { /* ignore */ }
    return null;
  }
}
