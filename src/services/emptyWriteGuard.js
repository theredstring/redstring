/**
 * Last-resort guard: never write an empty store over a universe that has data.
 *
 * Every other safeguard in the save path answers "what do I remember about this
 * universe?" — the GitSyncEngine node-count floor, SaveCoordinator's
 * `dataBaseline`, the once-per-session first-contact check. All of them are
 * keyed to universe IDENTITY and armed from device-local bookkeeping.
 *
 * The destructive unit is not a universe, it is a FILE. On 2026-09-06 that gap
 * cost 518 things: two universes had been linked to the same repo folder, so
 * each engine's floor described only its own slug's history, and an empty store
 * was committed over a 2.1 MB universe without a single guard objecting. Both
 * ledgers were accurate. Neither was about the file being overwritten.
 *
 * So this one asks the only question that cannot be wrong: what is actually at
 * the destination right now? It deliberately consults nothing else — not the
 * last known SHA, not the floor, not the baseline.
 *
 * It runs only when the outgoing state is empty, which is rare, so the extra
 * read costs nothing in normal operation.
 */

import { getRedstringStats } from '../formats/redstringFormat.js';

/**
 * Is this store snapshot empty — no things AND no webs?
 *
 * Deliberately conservative: BOTH must be zero. A universe with webs but no
 * things is unusual but not empty, and a guard that fired on it would block
 * legitimate saves. Broader "did this shrink a lot" checks belong to
 * SaveCoordinator's `_isCatastrophicShrinkage`, which has the baseline to
 * judge it; this one only recognizes nothing-at-all.
 *
 * @param {Object} state - Store snapshot (Maps) or a parsed .redstring doc.
 * @returns {boolean}
 */
export function isEmptyStoreState(state) {
  if (!state || typeof state !== 'object') return false;
  const stats = getRedstringStats(state);
  // Unrecognizable shape → nulls. Not "empty", just unreadable; say no rather
  // than triggering a destination read on every save of an odd-shaped object.
  if (stats.nodeCount === null && stats.graphCount === null) return false;
  return (stats.nodeCount || 0) === 0 && (stats.graphCount || 0) === 0;
}

/** Counts for a destination's raw content, from a string or parsed object. */
function statsOfContent(content) {
  if (content == null) return null;
  let data = content;
  if (typeof content === 'string') {
    if (content.trim() === '') return null; // empty file
    try {
      data = JSON.parse(content);
    } catch {
      // Unparseable but PRESENT. Treat as data: something is there, and
      // clobbering it with an empty store is exactly what this guard exists to
      // stop. Git history would retain it, a local file would not.
      return { nodeCount: null, graphCount: null, unparseable: true };
    }
  }
  return getRedstringStats(data);
}

/**
 * Decide whether an empty write may proceed, by reading the destination.
 *
 * @param {Object} params
 * @param {Function} params.readDestination - `async () => content` (string or
 *   parsed object). Should THROW when the destination is absent or unreadable;
 *   `isNotFound` separates the two.
 * @param {Function} [params.isNotFound] - `(error) => boolean`. Defaults to
 *   matching the common 404 shapes used across the git providers.
 * @param {string} [params.label] - Destination description, for logs.
 * @returns {Promise<{safe: boolean, reason: string, destination?: Object, error?: Error}>}
 */
export async function checkDestinationBeforeEmptyWrite({
  readDestination,
  isNotFound = defaultIsNotFound,
  label = 'destination'
} = {}) {
  if (typeof readDestination !== 'function') {
    // No way to check. Refuse: an unverifiable empty write is the exact
    // situation this exists for, and a caller that cannot read its own
    // destination has no business clearing it.
    return { safe: false, reason: 'no-destination-reader' };
  }

  let content;
  try {
    content = await readDestination();
  } catch (error) {
    if (isNotFound(error)) {
      return { safe: true, reason: 'destination-absent' };
    }
    // UNKNOWN, not absent — an auth race, a 5xx, a permission prompt declined.
    // Never assume absent. This is the mobile-git wipe shape: every local
    // guard reads clean on a device that never synced, and an ambiguous read
    // was treated as "nothing there".
    console.error(
      `[emptyWriteGuard] Refusing empty write to ${label}: destination unreadable (${error?.message || error})`
    );
    return { safe: false, reason: 'destination-unreadable', error };
  }

  const stats = statsOfContent(content);
  if (stats === null) {
    return { safe: true, reason: 'destination-empty' };
  }
  if (stats.unparseable) {
    return { safe: false, reason: 'destination-unparseable', destination: stats };
  }
  if ((stats.nodeCount || 0) === 0 && (stats.graphCount || 0) === 0) {
    return { safe: true, reason: 'destination-empty' };
  }

  console.warn(`[emptyWriteGuard] Refusing empty write to ${label}: destination holds data`, {
    things: stats.nodeCount,
    webs: stats.graphCount
  });
  return { safe: false, reason: 'destination-has-data', destination: stats };
}

/** The 404 shapes the git providers and file adapters actually produce. */
function defaultIsNotFound(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const name = String(error.name || '');
  const message = String(error.message || '');
  return code === 'FILE_NOT_FOUND'
    || code === 'ENOENT'
    || name === 'NotFoundError'
    || message.includes('File not found')
    || message.includes('404');
}

export const __testing = { statsOfContent, defaultIsNotFound };
