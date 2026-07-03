/**
 * createHeadlessStore.js — boot the real Redstring Zustand store in Node.
 *
 * The store is a module singleton (a single `useGraphStore` instance is created
 * at module-evaluation time). Because it reads `localStorage` during that
 * evaluation, we MUST install the Node environment shim *before* the module is
 * imported — hence the dynamic `import()` below rather than a top-level import.
 *
 * v1 constraint: one store singleton per process ⇒ one universe per daemon
 * process. Multiple universes = multiple processes (the CLI can manage this),
 * or a future store-factory refactor.
 */

import { installNodeEnvironment } from './nodeEnvironment.js';

let cached = null;

/**
 * @param {object} [opts]
 * @param {boolean} [opts.persistPrefs=false] Persist UI prefs across restarts.
 * @returns {Promise<{ useGraphStore: import('zustand').StoreApi<any> }>}
 */
export async function createHeadlessStore(opts = {}) {
  if (cached) return cached;

  // Ordering is load-bearing: shim first, store import second.
  installNodeEnvironment({ persist: !!opts.persistPrefs });

  const mod = await import('../store/graphStore.js');
  const useGraphStore = mod.default || mod.useGraphStore;

  if (!useGraphStore || typeof useGraphStore.getState !== 'function') {
    throw new Error('createHeadlessStore: failed to load useGraphStore from graphStore.js');
  }

  cached = { useGraphStore };
  return cached;
}

/** Test/utility hook to drop the cached store (does not reset store state). */
export function __resetHeadlessStoreCache() {
  cached = null;
}
