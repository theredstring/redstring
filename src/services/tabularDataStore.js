/**
 * Temporary in-memory storage for parsed tabular data.
 * File attachments are parsed client-side and stored here so that
 * wizard tools (via config passthrough) can access the full dataset.
 *
 * Designed for both in-app wizard and future UI import features.
 */

const store = new Map();

/**
 * Store parsed tabular data keyed by attachment ID.
 * @param {string} attachId
 * @param {import('./tabularParser.js').ParsedTabularData} parsedData
 */
export function storeTabularData(attachId, parsedData) {
  store.set(attachId, { data: parsedData, timestamp: Date.now() });
}

/**
 * Retrieve parsed data by attachment ID.
 * @param {string} attachId
 * @returns {import('./tabularParser.js').ParsedTabularData | null}
 */
export function getTabularData(attachId) {
  return store.get(attachId)?.data || null;
}

/**
 * Get parsed data by numeric index (for tools that use fileIndex).
 * @param {number} [index=0]
 * @returns {import('./tabularParser.js').ParsedTabularData | null}
 */
export function getTabularDataByIndex(index = 0) {
  const entries = [...store.values()];
  return entries[index]?.data || null;
}

/**
 * Get the first (most recent) tabular data entry.
 * @returns {import('./tabularParser.js').ParsedTabularData | null}
 */
export function getFirstTabularData() {
  return getTabularDataByIndex(0);
}

/**
 * Get all stored tabular data entries.
 * @returns {Array<{ attachId: string, data: import('./tabularParser.js').ParsedTabularData }>}
 */
export function getAllTabularData() {
  return [...store.entries()].map(([attachId, entry]) => ({
    attachId,
    data: entry.data,
  }));
}

/**
 * Clear all stored tabular data.
 */
export function clearTabularData() {
  store.clear();
}

/**
 * Remove stale entries older than the given TTL.
 * @param {number} [ttlMs=1800000] - Default 30 minutes
 */
export function pruneStaleData(ttlMs = 30 * 60 * 1000) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.timestamp > ttlMs) {
      store.delete(key);
    }
  }
}

/**
 * Get store size for debugging.
 * @returns {number}
 */
export function getStoreSize() {
  return store.size;
}

// Expose on window for tool access (tools run server-side but
// applyToolResultToStore runs client-side and may need this)
if (typeof window !== 'undefined') {
  window.__tabularDataStore = {
    get: getTabularData,
    getByIndex: getTabularDataByIndex,
    getFirst: getFirstTabularData,
    getAll: getAllTabularData,
    clear: clearTabularData,
  };
}
