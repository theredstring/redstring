/**
 * Earlier copies of a universe's file, kept on this device (Settings → Data →
 * Backups; restored from History → Backups).
 *
 * A backup is taken after a save lands, at most once every BACKUP_INTERVAL_MS
 * per universe, so a stretch of work leaves a copy every ten minutes rather
 * than one per autosave. Kept: the newest KEEP_RECENT, plus the last copy of
 * each day for KEEP_DAYS days. Nothing is dropped for age alone below
 * KEEP_RECENT, so a universe left alone for a month still has its last ten.
 *
 * Where they live:
 * - Electron: a folder per universe that main owns (electron/backupStore.cjs),
 *   cloned from the file just saved. The universe file stays one file
 *   wherever the user keeps it; nothing is written beside it.
 * - Everywhere else: IndexedDB, from the bytes just saved. A file bigger than
 *   BROWSER_MAX_BYTES is not copied, since browser storage is small and can
 *   be evicted.
 *
 * Only universes saved to a file go through here. A repository already keeps
 * every version (History → Git).
 *
 * The on/off switch is a preference of this device, not of the universe.
 */

export const BACKUP_MODES = ['on', 'off'];
export const DEFAULT_BACKUP_MODE = 'on';

export const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
export const KEEP_RECENT = 10;
export const KEEP_DAYS = 14;
export const BROWSER_MAX_BYTES = 50 * 1024 * 1024;

const STORAGE_KEY = 'redstring_backups';
const DB_NAME = 'RedstringUniverseBackups';
const DB_STORE = 'backups';
const DAY_MS = 24 * 60 * 60 * 1000;

// ── The switch ─────────────────────────────────────────────────────

const readStored = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return BACKUP_MODES.includes(saved) ? saved : DEFAULT_BACKUP_MODE;
  } catch {
    return DEFAULT_BACKUP_MODE;
  }
};

let mode = readStored();
const listeners = new Set();

/** @returns {'on'|'off'} */
export const getBackupMode = () => mode;

/** @param {'on'|'off'} next */
export function setBackupMode(next) {
  if (!BACKUP_MODES.includes(next) || next === mode) return;
  mode = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* kept for this session */ }
  for (const listener of listeners) {
    try { listener(next); } catch (error) { console.warn('[universeBackups] listener failed:', error); }
  }
}

/** @returns {Function} unsubscribe */
export function subscribeBackupMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Which to keep ──────────────────────────────────────────────────

const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * The backups the policy lets go: everything but the newest KEEP_RECENT and
 * the last of each day within KEEP_DAYS.
 *
 * @param {{id: string, at: number}[]} entries - in any order
 * @param {number} [now]
 * @returns {{id: string, at: number}[]}
 */
export function backupsToDrop(entries, now = Date.now()) {
  const newestFirst = [...entries].sort((a, b) => b.at - a.at);
  const keep = new Set(newestFirst.slice(0, KEEP_RECENT).map((e) => e.id));
  const daysSeen = new Set();
  for (const entry of newestFirst) {
    if (now - entry.at > KEEP_DAYS * DAY_MS) break;
    const day = localDay(entry.at);
    if (daysSeen.has(day)) continue;
    daysSeen.add(day);
    keep.add(entry.id);
  }
  return newestFirst.filter((e) => !keep.has(e.id));
}

/** Whether a universe whose newest backup is `newestAt` is due another. */
export const isBackupDue = (newestAt, now = Date.now()) =>
  !newestAt || now - newestAt >= BACKUP_INTERVAL_MS;

// ── Where they live ────────────────────────────────────────────────

const electronBackups = () => (typeof window !== 'undefined' ? window.electron?.backups : null) || null;

const toBytes = (content) => {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  if (Object.prototype.toString.call(content) === '[object Uint8Array]') return content;
  throw new TypeError('Backup content must be text or bytes');
};

// 20261009T143200123Z, the same ids Electron uses.
const idFromTime = (ms) => new Date(ms).toISOString().replace(/[-:.]/g, '');

let dbPromise = null;
const openDb = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(DB_STORE, { keyPath: 'key' });
        store.createIndex('slug', 'slug', { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
};

const idb = async (mode, run) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DB_STORE], mode);
    let result;
    Promise.resolve(run(tx.objectStore(DB_STORE))).then((value) => { result = value; }, reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const browserStore = {
  async create(slug, { content }) {
    const bytes = toBytes(content);
    if (bytes.length > BROWSER_MAX_BYTES) return null;
    const at = Date.now();
    const id = idFromTime(at);
    const entry = { id, at, size: bytes.length };
    await idb('readwrite', (store) => {
      store.put({ key: `${slug}|${id}`, slug, ...entry, blob: new Blob([bytes]) });
    });
    return entry;
  },
  async list(slug) {
    const rows = await idb('readonly', (store) => request(store.index('slug').getAll(slug)));
    return (rows || [])
      .map(({ id, at, size }) => ({ id, at, size }))
      .sort((a, b) => b.at - a.at);
  },
  async read(slug, id) {
    const row = await idb('readonly', (store) => request(store.get(`${slug}|${id}`)));
    if (!row) throw new Error('That backup is gone');
    return new Uint8Array(await row.blob.arrayBuffer());
  },
  async remove(slug, id) {
    await idb('readwrite', (store) => { store.delete(`${slug}|${id}`); });
  },
  async usage() {
    const rows = await idb('readonly', (store) => request(store.getAll()));
    return {
      bytes: (rows || []).reduce((sum, row) => sum + (row.size || 0), 0),
      count: (rows || []).length
    };
  },
  async clear() {
    await idb('readwrite', (store) => { store.clear(); });
  }
};

const electronStore = (api) => ({
  create: (slug, { filePath, content }) => (
    typeof filePath === 'string' && filePath
      ? api.snapshot(slug, filePath)
      : api.write(slug, toBytes(content))
  ),
  list: (slug) => api.list(slug),
  read: (slug, id) => api.read(slug, id),
  remove: (slug, id) => api.remove(slug, id),
  usage: () => api.usage(),
  clear: () => api.clear()
});

const store = () => {
  const api = electronBackups();
  return api ? electronStore(api) : browserStore;
};

// ── Taking them ────────────────────────────────────────────────────

// Newest backup time per universe, learned from the first listing.
const newestAt = new Map();
const inFlight = new Map();

const prune = async (slug) => {
  const s = store();
  for (const entry of backupsToDrop(await s.list(slug))) {
    await s.remove(slug, entry.id);
  }
};

const take = async (slug, source) => {
  const entry = await store().create(slug, source);
  if (entry) newestAt.set(slug, entry.at);
  await prune(slug).catch((error) => console.warn('[universeBackups] Could not drop old backups:', error));
  return entry;
};

/**
 * A universe file was just written. Take a backup if one is due. Never throws
 * and never holds up the save: a backup that fails is logged and skipped.
 *
 * @param {string} slug
 * @param {{filePath?: string|null, content?: string|Uint8Array}} source -
 *   the path of the file just written (Electron), or the bytes written
 * @returns {Promise<Object|null>} the new backup, or null
 */
export async function noteUniverseSaved(slug, source) {
  if (!slug || mode !== 'on' || inFlight.has(slug)) return null;
  const run = (async () => {
    try {
      if (!newestAt.has(slug)) {
        const existing = await store().list(slug);
        newestAt.set(slug, existing[0]?.at || 0);
      }
      if (!isBackupDue(newestAt.get(slug))) return null;
      return await take(slug, source);
    } catch (error) {
      console.warn('[universeBackups] Backup skipped:', error?.message || error);
      return null;
    } finally {
      inFlight.delete(slug);
    }
  })();
  inFlight.set(slug, run);
  return run;
}

/**
 * Take a backup now, whatever the switch and the interval say: before a
 * restore replaces what is open. Throws if it could not be kept.
 */
export async function backUpNow(slug, source) {
  await inFlight.get(slug)?.catch(() => {});
  const entry = await take(slug, source);
  if (!entry) throw new Error('This universe is too big to back up in browser storage');
  return entry;
}

// ── Reading them ───────────────────────────────────────────────────

/** @returns {Promise<{id: string, at: number, size: number}[]>} newest first */
export const listBackups = (slug) => store().list(slug);

/** @returns {Promise<Uint8Array>} the backup's file */
export const readBackup = (slug, id) => store().read(slug, id);

/** @returns {Promise<{bytes: number, count: number}>} across every universe */
export const backupUsage = () => store().usage();

/** Every universe's backups, gone. */
export async function deleteAllBackups() {
  await store().clear();
  newestAt.clear();
}

/** Electron only: whether the backups folder can be shown in the file manager. */
export const canRevealBackups = () => !!electronBackups()?.reveal;

export const revealBackups = (slug = null) => electronBackups()?.reveal(slug);

/** Tests only. */
export function __resetUniverseBackups() {
  mode = readStored();
  listeners.clear();
  newestAt.clear();
  inFlight.clear();
  dbPromise = null;
}
