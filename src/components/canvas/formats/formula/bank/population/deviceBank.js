/**
 * The formula bank this device updated for itself (Settings → Data → Formula
 * Bank → Update from Wikidata), kept in IndexedDB: the bank, its report, what its sections are missing, and
 * the disciplines its classes were traced to, so the next update need not
 * trace them again. Without it, the app uses the bank it shipped with.
 *
 * Best-effort, like the other device stores: a private window or storage
 * refused means the shipped bank, never an error.
 */

const DB_NAME = 'redstring-formula-bank';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise = null;
function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

async function run(mode, action) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result ?? null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** @param {'bank'|'report'|'known'|'classes'} key */
export const readDeviceBank = (key) => run('readonly', store => store.get(key));

/** Keep an updated bank, its report, what its sections are missing and its traced classes. Resolves true once kept. */
export async function writeDeviceBank({ bank, report, known, classes }) {
  const kept = await run('readwrite', (store) => {
    store.put(bank, 'bank');
    store.put(report, 'report');
    store.put(known, 'known');
    return store.put(classes, 'classes');
  });
  return kept !== null;
}

/** Forget the updated bank (the traced classes stay, to speed the next update). */
export const clearDeviceBank = () => run('readwrite', (store) => {
  store.delete('bank');
  store.delete('known');
  return store.delete('report');
});
