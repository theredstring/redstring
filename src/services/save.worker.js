/**
 * Save Worker
 * Handles heavy serialization and hashing off the main thread.
 *
 * It keeps its own copy of the universe, updated by changes (saveMirror.js).
 * The file is built as UTF-8 bytes a piece at a time (universeBytes.js), and
 * goes back in a transferred buffer, which costs the main thread nothing to
 * receive.
 */

import { exportToRedstring } from '../formats/redstringFormat.js';
import { generateStateHash, createStateHashCache } from './saveHash.js';
import { applySaveMessage } from './saveMirror.js';
import { serializeRedstring, COMPACT_AT } from '../formats/universeBytes.js';
import { createExportCache } from '../formats/exportCache.js';

let mirror = null;

// A big universe's file is mostly what it was last save: each Thing's and
// web's finished bytes, and each one's hash, are kept while it's unchanged
// (exportCache.js, saveHash.js). Every VERIFY_EVERY-th save rebuilds and
// checks everything instead; if anything kept turns out stale, that save is
// written from the rebuild and nothing is kept again until the worker restarts.
const VERIFY_EVERY = 10;
let exportCache = createExportCache();
let hashCache = createStateHashCache();
let cachedSaves = 0;
let cacheDisabled = false;

const forgetCaches = () => {
  exportCache.clear();
  hashCache = createStateHashCache();
  cachedSaves = 0;
};

/** Only a compact file can take finished pieces, and only a big universe is written compact. */
const isLarge = (state) => ((state?.nodePrototypes?.size || 0) + (state?.graphs?.size || 0)) >= COMPACT_AT;

/**
 * The file and its hash for the worker's copy of the universe, reusing what
 * didn't change when the universe is big.
 */
const buildSave = (state, userDomain) => {
  if (cacheDisabled || !isLarge(state)) {
    const redstringData = exportToRedstring(state, userDomain);
    return { jsonBytes: serializeRedstring(redstringData), hash: generateStateHash(state) };
  }

  const verify = cachedSaves % VERIFY_EVERY === VERIFY_EVERY - 1;
  cachedSaves++;
  exportCache.setVerify(verify);
  const redstringData = exportToRedstring(state, userDomain, { cache: exportCache });
  const jsonBytes = serializeRedstring(redstringData, { compact: true });
  const hash = generateStateHash(state, { cache: hashCache });
  if (!verify) return { jsonBytes, hash, cache: exportCache.stats };

  // Verifying: the file was written from rebuilt pieces; check the kept ones agreed.
  const mismatches = exportCache.mismatches;
  const freshHash = generateStateHash(state);
  if (freshHash !== hash) mismatches.push({ kind: 'hash', id: '' });
  if (mismatches.length > 0) {
    cacheDisabled = true;
    forgetCaches();
  }
  return { jsonBytes, hash: freshHash, cache: exportCache.stats, verified: true, mismatches };
};

self.onmessage = (e) => {
  const { type, userDomain } = e.data;

  if (type === 'prime') {
    // A universe just loaded: take the copy, nothing to save or report.
    try {
      const applied = applySaveMessage(mirror, e.data);
      if (applied) {
        // A whole new copy: nothing kept from the last one applies.
        if (e.data.full) forgetCaches();
        mirror = applied;
      } else {
        self.postMessage({ type: 'prime-failed' });
      }
    } catch {
      mirror = null;
      forgetCaches();
      self.postMessage({ type: 'prime-failed' });
    }
    return;
  }

  if (type === 'process_save') {
    try {
      // Messages from before the incremental protocol carried `state` alone.
      const message = e.data.full === undefined && e.data.state ? { full: true, state: e.data.state } : e.data;
      const applied = applySaveMessage(mirror, message);
      if (!applied) {
        // A change list with no copy to apply it to (the worker restarted).
        self.postMessage({ type: 'error', code: 'no-mirror', error: 'Save worker has no copy of the universe yet', success: false });
        return;
      }
      if (message.full) forgetCaches();
      mirror = applied;

      // Built a piece at a time, never as one string; compact when large,
      // reusing what didn't change (buildSave).
      const { jsonBytes, hash, verified, mismatches } = buildSave(mirror, userDomain);

      // Only the bytes go back, transferred rather than copied.
      self.postMessage({
        type: 'save_processed',
        jsonBytes,
        hash,
        success: true,
        ...(verified && mismatches.length > 0 ? { cacheMismatches: mismatches } : {})
      }, [jsonBytes.buffer]);

    } catch (error) {
      // The copy may be half-updated; start again from a whole state.
      mirror = null;
      forgetCaches();
      self.postMessage({
        type: 'error',
        code: 'failed',
        error: error.message,
        success: false
      });
    }
  }
};
