/**
 * The Druid's run as the panel shows it, kept per universe on this device, so
 * closing the app, reloading, or opening another universe and coming back
 * finds it as it was, until it is cleared.
 *
 * What the Druid knows lives in the universe itself (its memory on its
 * Things, its loop state on Home); this keeps only what the panel shows of
 * it: the moments, what was said either way, its through line. That is a
 * log, not part of the universe, so it stays out of the file.
 *
 * Kept in IndexedDB, one record per entry: a moment is written once, as it
 * happens, rather than the whole run every moment. Where there is no
 * IndexedDB (tests, the headless host), `memoryRecord` stands in.
 */

const DB_NAME = 'redstring-druid';
const DB_VERSION = 1;
const RUNS = 'runs'; // universe → { throughLine, held, stats }
const ENTRIES = 'entries'; // [universe, seq] → an entry of the stream

const range = (universe, from = 0, to = Number.MAX_SAFE_INTEGER) => IDBKeyRange.bound([universe, from], [universe, to]);
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const finished = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

/** The record in IndexedDB. */
export function idbRecord(idb = globalThis.indexedDB) {
  let opened = null;
  const db = () => (opened ||= new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(RUNS)) d.createObjectStore(RUNS);
      if (!d.objectStoreNames.contains(ENTRIES)) d.createObjectStore(ENTRIES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opened = null; reject(req.error); };
  }));
  // One write at a time, in order: a moment never lands before the one it follows.
  let queue = Promise.resolve();
  const inTurn = (fn) => (queue = queue.then(fn, fn));

  return {
    async load(universe) {
      const d = await db();
      const tx = d.transaction([RUNS, ENTRIES], 'readonly');
      const [run, entries] = await Promise.all([done(tx.objectStore(RUNS).get(universe)), done(tx.objectStore(ENTRIES).getAll(range(universe)))]);
      return run || entries.length ? { ...(run || {}), stream: entries } : null;
    },
    /** Write entries (new, or changed) and the run's header; drop entries before `keepFrom`. */
    write(universe, { run, entries = [], keepFrom = 0 }) {
      return inTurn(async () => {
        const d = await db();
        const tx = d.transaction([RUNS, ENTRIES], 'readwrite');
        if (run) tx.objectStore(RUNS).put(run, universe);
        const store = tx.objectStore(ENTRIES);
        for (const e of entries) store.put(e, [universe, e.seq]);
        if (keepFrom > 0) store.delete(range(universe, 0, keepFrom - 1));
        await finished(tx);
      });
    },
    clear(universe) {
      return inTurn(async () => {
        const d = await db();
        const tx = d.transaction([RUNS, ENTRIES], 'readwrite');
        tx.objectStore(RUNS).delete(universe);
        tx.objectStore(ENTRIES).delete(range(universe));
        await finished(tx);
      });
    }
  };
}

/** The same record in memory: for tests and where there is no IndexedDB. */
export function memoryRecord() {
  const runs = new Map();
  const copy = (x) => JSON.parse(JSON.stringify(x));
  return {
    async load(universe) {
      const r = runs.get(universe);
      if (!r) return null;
      return { ...copy(r.run || {}), stream: [...r.entries.values()].sort((a, b) => a.seq - b.seq).map(copy) };
    },
    async write(universe, { run, entries = [], keepFrom = 0 }) {
      const r = runs.get(universe) || { run: null, entries: new Map() };
      if (run) r.run = copy(run);
      for (const e of entries) r.entries.set(e.seq, copy(e));
      for (const seq of [...r.entries.keys()]) if (seq < keepFrom) r.entries.delete(seq);
      runs.set(universe, r);
    },
    async clear(universe) { runs.delete(universe); }
  };
}

/** The record this device has: IndexedDB where there is one. */
export function deviceRecord() {
  return globalThis.indexedDB && globalThis.IDBKeyRange ? idbRecord() : memoryRecord();
}
