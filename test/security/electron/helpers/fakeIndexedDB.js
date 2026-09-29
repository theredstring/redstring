// Minimal in-memory IndexedDB — only the surface the legacy export
// (electron/legacyMigration.cjs) and import (src/electronLegacyImport.js) use:
// databases(), open(name[, version]) with onupgradeneeded, object stores with
// in-line or out-of-line keys and indexes, get/getAll/getAllKeys/add, and
// transactions that complete asynchronously and abort on an unhandled error.
// Keys are compared by their JSON form, which is enough for these tests.

const keyId = (k) => JSON.stringify(k instanceof Date ? { d: k.getTime() } : k);

function later(fn) { setTimeout(fn, 0); }

function makeRequest() {
  return { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
}

function fireSuccess(req, result) {
  req.result = result;
  if (req.onsuccess) req.onsuccess({ target: req });
}

export function createFakeIndexedDB(initial = {}) {
  // name -> { version, stores: Map(name -> store) }
  const dbs = new Map();

  function makeStore(name, { keyPath = null, autoIncrement = false } = {}) {
    return { name, keyPath, autoIncrement, indexes: new Map(), records: new Map() };
  }

  function objectStoreNamesOf(db) {
    const names = [...db.stores.keys()];
    return Object.assign(names, { contains: (n) => db.stores.has(n) });
  }

  function makeConnection(db) {
    return {
      get version() { return db.version; },
      get objectStoreNames() { return objectStoreNamesOf(db); },
      createObjectStore(name, opts) {
        const s = makeStore(name, opts || {});
        db.stores.set(name, s);
        return storeApi(s, null);
      },
      transaction(storeNames, mode = 'readonly') {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        for (const n of names) if (!db.stores.has(n)) throw new Error(`NotFoundError: ${n}`);
        const tx = { mode, error: null, oncomplete: null, onerror: null, onabort: null, pending: 0, aborted: false, staged: [] };
        tx.objectStore = (n) => storeApi(db.stores.get(n), tx);
        later(() => {
          const finish = () => {
            if (tx.pending > 0) { later(finish); return; }
            if (tx.aborted) { if (tx.onabort) tx.onabort({ target: tx }); return; }
            for (const commit of tx.staged) commit();
            if (tx.oncomplete) tx.oncomplete({ target: tx });
          };
          finish();
        });
        return tx;
      },
      close() {}
    };
  }

  function storeApi(s, tx) {
    const run = (compute, stage) => {
      const req = makeRequest();
      if (tx) tx.pending++;
      later(() => {
        let result;
        let error = null;
        try { result = compute(); } catch (e) { error = e; }
        if (error) {
          req.error = error;
          let prevented = false;
          const event = { target: req, preventDefault: () => { prevented = true; }, stopPropagation: () => {} };
          if (req.onerror) req.onerror(event);
          if (!prevented && tx) { tx.aborted = true; tx.error = error; }
        } else {
          if (stage && tx) tx.staged.push(stage(result));
          fireSuccess(req, result);
        }
        if (tx) tx.pending--;
      });
      return req;
    };
    return {
      name: s.name,
      keyPath: s.keyPath,
      autoIncrement: s.autoIncrement,
      indexNames: Object.assign([...s.indexes.keys()], { contains: (n) => s.indexes.has(n) }),
      index: (n) => ({ name: n, ...s.indexes.get(n) }),
      createIndex(name, keyPath, opts = {}) {
        s.indexes.set(name, { keyPath, unique: !!opts.unique, multiEntry: !!opts.multiEntry });
      },
      get: (key) => run(() => s.records.get(keyId(key))?.value),
      getAll: () => run(() => [...s.records.values()].map((r) => r.value)),
      getAllKeys: () => run(() => [...s.records.values()].map((r) => r.key)),
      put: (value, key) => run(() => {
        const k = s.keyPath ? value[s.keyPath] : key;
        return k;
      }, (k) => () => s.records.set(keyId(k), { key: k, value })),
      add(value, key) {
        const inline = s.keyPath !== null && s.keyPath !== undefined;
        if (inline && key !== undefined) throw new Error('DataError: key given for in-line store');
        const k = inline ? value?.[s.keyPath] : key;
        if (k === undefined) throw new Error('DataError: no key');
        return run(() => {
          if (s.records.has(keyId(k))) {
            const e = new Error('Key already exists');
            e.name = 'ConstraintError';
            throw e;
          }
          return k;
        }, (key2) => () => s.records.set(keyId(key2), { key: key2, value }));
      }
    };
  }

  for (const [name, spec] of Object.entries(initial)) {
    const db = { version: spec.version || 1, stores: new Map() };
    for (const [storeName, st] of Object.entries(spec.stores || {})) {
      const s = makeStore(storeName, st);
      for (const ix of st.indexes || []) s.indexes.set(ix.name, { keyPath: ix.keyPath, unique: !!ix.unique, multiEntry: !!ix.multiEntry });
      for (const [k, v] of st.records || []) s.records.set(keyId(k), { key: k, value: v });
      db.stores.set(storeName, s);
    }
    dbs.set(name, db);
  }

  return {
    _dbs: dbs,
    databases: async () => [...dbs.entries()].map(([name, db]) => ({ name, version: db.version })),
    open(name, version) {
      const req = makeRequest();
      later(() => {
        let db = dbs.get(name);
        const oldVersion = db ? db.version : 0;
        const target = version === undefined ? (db ? db.version : 1) : version;
        if (db && target < db.version) {
          req.error = new Error('VersionError');
          if (req.onerror) req.onerror({ target: req });
          return;
        }
        if (!db) { db = { version: target, stores: new Map() }; dbs.set(name, db); }
        const conn = makeConnection(db);
        if (target > oldVersion) {
          db.version = target;
          req.result = conn;
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion, newVersion: target });
        }
        fireSuccess(req, conn);
      });
      return req;
    }
  };
}

export function createFakeLocalStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
}
