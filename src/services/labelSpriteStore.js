/**
 * Durable backing for the connection-label sprite cache.
 *
 * WHY, AND WHY NOT SHIPPED ASSETS
 *
 * The obvious version of this idea is to precompute the sprites and ship them
 * with the app. That does not work, for three reasons worth recording so the
 * idea is not re-attempted from scratch:
 *
 *   1. A whole-label sprite is keyed on the label's TEXT, which comes from the
 *      user's own connection-type names. There is nothing to precompute.
 *   2. Per-glyph sprites escape that, but their key is
 *      character x layer x colour x fontSize x ringWidth x scale. One glyph at
 *      the default size is roughly 2-4KB of PNG, so a single colour at a single
 *      scale across the alphabet and three layers is already megabytes. The
 *      colours are user-chosen and the sizes continuous.
 *   3. Baking a colourless atlas and tinting at draw time would fix (2), but
 *      SVG can only tint a bitmap through a <mask> or a filter, and either adds
 *      a compositing pass per label — trading a one-time cost for a permanent
 *      per-frame one, which is the exact trade this whole path exists to undo.
 *
 * What DOES work is letting the app build its own asset set and keep it. A
 * user's connection types, colours and text size are stable across sessions, so
 * the first launch bakes and every launch after reads. Same outcome as shipping
 * assets, without needing to know anything at build time.
 *
 * Recolouring is not the problem it first looks like: colour is per connection
 * TYPE, so changing one invalidates a handful of entries that re-bake in idle
 * time. The continuous inputs — font size, ring width — are the ones that
 * generate churn, and only while a slider is actually moving.
 *
 * EVERYTHING HERE IS BEST-EFFORT. A private window, a browser with storage
 * disabled, a quota refusal: all of them mean "bake it again", never an error
 * the canvas has to care about. Nothing awaits this module.
 */

const DB_NAME = 'redstring-label-sprites';
const DB_VERSION = 1;
const STORE = 'sprites';

/**
 * Bump to invalidate every persisted sprite.
 *
 * The cache key covers the inputs that vary at runtime, but NOT the things a
 * code change can alter underneath it: the font family, the padding rule, the
 * layer order, the baseline correction. Change any of those and old bitmaps are
 * silently wrong — they will not miss, because the key still matches. This is
 * the manual invalidation for that, and it belongs to the RENDERING, so it
 * moves when labelSpriteCache's drawing changes.
 */
const SCHEMA = 'v1';

/**
 * How many sprites to keep on disk.
 *
 * Deliberately larger than the in-memory cap: memory holds what is on screen
 * now, this holds what the user has needed lately across sessions, and reading
 * one back is far cheaper than baking it. Pruned oldest-first on load, which is
 * the one moment the whole set is already in hand.
 */
const MAX_PERSISTED = 4000;

/** Writes are batched — one transaction per flush rather than one per bake. */
const FLUSH_DELAY_MS = 1500;

let dbPromise = null;
let unavailable = typeof indexedDB === 'undefined';

const writeBuffer = new Map();
let flushTimer = null;

function openDb() {
  if (unavailable) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (_) {
      unavailable = true;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { unavailable = true; resolve(null); };
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** Namespaced so a SCHEMA bump orphans the old rows instead of reading them. */
const rowKey = (key) => `${SCHEMA}|${key}`;

/**
 * Everything worth restoring, newest first, already pruned to MAX_PERSISTED.
 *
 * Rows from a previous SCHEMA are deleted on the way past — this is the only
 * pass that sees the whole store, so it is the cheapest place to do it.
 *
 * @returns {Promise<Array<[string, object]>>} `[cacheKey, sprite]` pairs
 */
export function loadPersistedSprites() {
  return openDb().then((db) => {
    if (!db) return [];
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORE, 'readwrite');
      } catch (_) {
        resolve([]);
        return;
      }
      const store = tx.objectStore(STORE);
      const rows = [];
      const stale = [];
      const prefix = `${SCHEMA}|`;

      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const k = String(cursor.key);
          if (k.startsWith(prefix)) rows.push({ key: k.slice(prefix.length), value: cursor.value });
          else stale.push(cursor.key);
          cursor.continue();
          return;
        }

        stale.forEach((k) => { try { store.delete(k); } catch (_) { /* best effort */ } });
        rows.sort((a, b) => (b.value?.t || 0) - (a.value?.t || 0));
        rows.slice(MAX_PERSISTED).forEach((r) => {
          try { store.delete(rowKey(r.key)); } catch (_) { /* best effort */ }
        });

        resolve(
          rows.slice(0, MAX_PERSISTED)
            .filter((r) => r.value && typeof r.value.href === 'string')
            .map((r) => {
              const { t, ...sprite } = r.value;
              return [r.key, sprite];
            })
        );
      };
      req.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    });
  }).catch(() => []);
}

function flushWrites() {
  flushTimer = null;
  if (writeBuffer.size === 0) return;
  const batch = Array.from(writeBuffer);
  writeBuffer.clear();

  openDb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const t = Date.now();
      batch.forEach(([key, sprite]) => {
        try { store.put({ ...sprite, t }, rowKey(key)); } catch (_) { /* quota, etc. */ }
      });
      // A refused transaction is not worth retrying: the sprite is already in
      // memory for this session and will be offered again next time.
      tx.onerror = () => {};
      tx.onabort = () => {};
    } catch (_) { /* best effort */ }
  }).catch(() => {});
}

/**
 * Remember a freshly baked sprite. Returns immediately; the write is batched.
 */
export function persistSprite(key, sprite) {
  if (unavailable || !key || !sprite?.href) return;
  writeBuffer.set(key, sprite);
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flushWrites, FLUSH_DELAY_MS);
}

/** Drop every persisted sprite, this schema and any older one. */
export function purgePersistedSprites() {
  writeBuffer.clear();
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  return openDb().then((db) => {
    if (!db) return;
    try {
      db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
    } catch (_) { /* best effort */ }
  }).catch(() => {});
}
