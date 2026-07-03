/**
 * nodeEnvironment.js — Node/headless environment shims.
 *
 * The Redstring store (src/store/graphStore.js) reads/writes `localStorage`
 * at module-init time and inside UI-preference actions. In a browser those
 * calls hit real storage; in plain Node there is no `localStorage`, so we
 * install a lightweight in-memory shim (optionally persisted to disk) BEFORE
 * the store module is imported.
 *
 * This module has NO effect in a browser (it early-returns when a real
 * `localStorage` already exists), so importing it is safe from shared code —
 * but in practice only Node hosts (daemon / CLI / tests) call it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

let installed = false;

/**
 * Install a Map-backed localStorage shim on globalThis if one is not present.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.persist=false] Persist UI-preference keys to
 *        ~/.redstring/headless-prefs.json across daemon restarts.
 * @param {string}  [opts.persistPath]   Override the persistence file path.
 * @returns {{ localStorage: object }}
 */
export function installNodeEnvironment(opts = {}) {
  // Real browser storage (or a prior install) already present → no-op.
  if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
    return { localStorage: globalThis.localStorage };
  }

  const persist = !!opts.persist;
  const persistPath =
    opts.persistPath || join(homedir(), '.redstring', 'headless-prefs.json');

  const store = new Map();

  if (persist && existsSync(persistPath)) {
    try {
      const raw = JSON.parse(readFileSync(persistPath, 'utf-8'));
      for (const [k, v] of Object.entries(raw)) store.set(k, String(v));
    } catch {
      // Corrupt/partial prefs file — start clean rather than crash.
    }
  }

  const flush = () => {
    if (!persist) return;
    try {
      mkdirSync(dirname(persistPath), { recursive: true });
      writeFileSync(persistPath, JSON.stringify(Object.fromEntries(store)), 'utf-8');
    } catch {
      // Best-effort: preferences are non-critical, never fail the caller.
    }
  };

  const shim = {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
      flush();
    },
    removeItem(key) {
      store.delete(String(key));
      flush();
    },
    clear() {
      store.clear();
      flush();
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
  };

  globalThis.localStorage = shim;
  installed = true;
  return { localStorage: shim };
}

/** True once this process installed the shim (vs. a pre-existing localStorage). */
export function didInstallShim() {
  return installed;
}
