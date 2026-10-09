/**
 * The save worker's cache of finished pieces of a universe file.
 *
 * A big universe's file is rebuilt on every save, and nearly all of it is the
 * same as last time: one Thing moved, the rest didn't. exportToRedstring
 * builds each Thing, web (with its connections), layout and summary with a
 * pure function of what it reads, and asks this cache first. If every one of
 * those inputs is the same value as last time (the same object, for anything
 * that's an object), the bytes built last time are used as they are.
 *
 * Why "the same object" means "unchanged": the worker's copy of the universe
 * (saveMirror.js) replaces an entry only when the store changed it, and the
 * store never edits an entry in place. So an input that's the same object as
 * last time holds what it held then.
 *
 * Verification. Every so often (setVerify), the cache rebuilds every piece it
 * would have reused, from the current inputs, stamped with the time the
 * cached copy was built, and compares the bytes. A correct piece comes out
 * identical; one that differs means a piece read something its inputs don't
 * cover. That export uses the rebuilt pieces, so what's written is right
 * either way, and the mismatches are reported for the caller to act on (the
 * worker stops using the cache for the session).
 *
 * Pieces come out as compact bytes: only a compact file can use them.
 */

import { RawJson } from './universeBytes.js';

const sameInputs = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
};

const sameBytes = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

/**
 * @returns {Object} a cache to pass to exportToRedstring as `cache`
 */
export function createExportCache() {
  const encoder = new TextEncoder();
  let current = new Map(); // "kind\0id" → { inputs, raw, builtAt }
  let next = null;
  let verifying = false;
  let stats = { reused: 0, built: 0, verified: 0 };
  let mismatches = [];

  const make = (inputs, build, time) => ({
    inputs,
    raw: new RawJson(encoder.encode(JSON.stringify(build(time)))),
    builtAt: time,
  });

  return {
    /** Check every reusable piece on the next export (see above). */
    setVerify(on) {
      verifying = !!on;
    },

    begin() {
      next = new Map();
      stats = { reused: 0, built: 0, verified: 0 };
      mismatches = [];
    },

    /**
     * @param {string} kind - 'prototype' | 'graph' | 'layout' | 'summary'
     * @param {string} id
     * @param {Array} inputs - everything the piece reads, compared with Object.is
     * @param {Function} build - (time) => the piece's value
     * @param {number} now - the export's time, for a piece built now
     * @returns {RawJson}
     */
    piece(kind, id, inputs, build, now) {
      const key = `${kind}\u0000${id}`;
      const cached = current.get(key);
      let entry;
      if (cached && sameInputs(cached.inputs, inputs)) {
        if (verifying) {
          const rebuilt = make(inputs, build, cached.builtAt);
          stats.verified++;
          if (!sameBytes(rebuilt.raw.bytes, cached.raw.bytes)) {
            mismatches.push({ kind, id: String(id) });
          }
          entry = rebuilt;
        } else {
          entry = cached;
          stats.reused++;
        }
      } else {
        entry = make(inputs, build, now);
        stats.built++;
      }
      next.set(key, entry);
      return entry.raw;
    },

    /** The export finished: what it used is the cache now (pieces of removed entries go). */
    end() {
      current = next;
      next = null;
    },

    /** The export failed: keep the cache as it was. */
    abort() {
      next = null;
    },

    /** Forget everything (another universe, or the cache can't be trusted). */
    clear() {
      current = new Map();
      next = null;
    },

    /** What the last export did: { reused, built, verified }. */
    get stats() {
      return { ...stats, pieces: current.size };
    },

    /** Pieces the last verifying export found stale: [{ kind, id }]. */
    get mismatches() {
      return mismatches.slice();
    },
  };
}
