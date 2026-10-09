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
import { countUserPrototypes, isRecognizedShape } from '../formats/userDataCounts.js';
import { parseRedstringBytes, isBlankBytes } from '../formats/universeBytes.js';

const isBytes = (value) => ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1;

/**
 * Does this snapshot hold nothing the user made?
 *
 * Counts USER prototypes only. The store seeds `base-thing-prototype` and
 * `base-connection-prototype`, and the UI re-adds Thing whenever it goes
 * missing — so a universe that was just emptied by a bad read reports one or
 * two prototypes, which is how an empty state walked past every zero-check on
 * 2026-09-12.
 *
 * The old version also required zero WEBS before calling a state empty. A
 * wiped store that has been re-seeded often still carries a web, and this
 * guard only ever triggers a destination READ — it blocks nothing unless the
 * destination turns out to hold data. Being strict here costs one HTTP call.
 *
 * An unrecognizable object is not "empty", it is unreadable; say no rather
 * than treating garbage as a clear-everything intent.
 *
 * @param {Object} state - Store snapshot (Maps) or a parsed .redstring doc.
 * @returns {boolean}
 */
export function isEmptyStoreState(state) {
  if (!state || typeof state !== 'object') return false;
  if (!isRecognizedShape(state)) return false;
  return countUserPrototypes(state) === 0;
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
  const stats = getRedstringStats(data);
  if (stats.nodeCount === null && stats.graphCount === null) return stats;
  // Safety counts, like every other guard: things the USER made. Every file
  // carries the seeded base Thing, including a universe created a moment ago,
  // whose first write is otherwise empty; counted as data, it made that
  // universe's next empty save "overwrite data" and it was refused.
  return { ...stats, nodeCount: countUserPrototypes(data) };
}

/**
 * Decide whether an empty write may proceed, by reading the destination.
 *
 * @param {Object} params
 * @param {Function} params.readDestination - `async () => content` (string,
 *   bytes, or parsed object). Should THROW when the destination is absent or unreadable;
 *   `isNotFound` separates the two.
 * @param {Function} [params.isNotFound] - `(error) => boolean`. Defaults to
 *   `isConfirmedNotFound` (structured codes only, never message text).
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

  // A destination read as bytes (a local file can be too big for a string):
  // parsed the same way a load parses it.
  if (isBytes(content)) {
    if (isBlankBytes(content)) {
      content = '';
    } else {
      try {
        content = await parseRedstringBytes(content);
      } catch {
        return { safe: false, reason: 'destination-unparseable', destination: { nodeCount: null, graphCount: null, unparseable: true } };
      }
    }
  }

  const stats = statsOfContent(content);
  if (stats === null) {
    return { safe: true, reason: 'destination-empty' };
  }
  if (stats.unparseable) {
    return { safe: false, reason: 'destination-unparseable', destination: stats };
  }
  // Parseable JSON that is not a Redstring document — an API envelope, some
  // other file, a half-written document. `getRedstringStats` reports nulls,
  // which the old code read as "zero things, safe to clear". It is not: we do
  // not know what is there, and unknown is never safe to overwrite with
  // nothing.
  if (stats.nodeCount === null && stats.graphCount === null) {
    console.warn(`[emptyWriteGuard] Refusing empty write to ${label}: destination content is not a recognizable Redstring document`);
    return { safe: false, reason: 'destination-unrecognized', destination: stats };
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

/**
 * Is this error a CONFIRMED "nothing is there"?
 *
 * Decided on structured fields only, never on message text. The old check
 * matched any message containing "404" or "File not found", so a 403 or 5xx
 * whose text happened to mention 404 (a universe called "404", a status line
 * quoted inside an error body) read as "absent" — and absent is the one
 * answer that lets an empty write through. Every producer that means
 * not-found sets a code: the git providers throw `code: 'FILE_NOT_FOUND'`
 * (with `status: 404`), Node file reads `ENOENT`, the File System Access API
 * a `NotFoundError`. An error carrying any other HTTP status is never absent,
 * whatever its code or message claims.
 *
 * Unknown shapes answer false. False only ever costs a refused write; true can
 * cost the user's universe.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isConfirmedNotFound(error) {
  if (!error || typeof error !== 'object') return false;
  const status = error.status;
  if (typeof status === 'number' && status !== 404) return false;
  const code = String(error.code || '');
  const name = String(error.name || '');
  return code === 'FILE_NOT_FOUND'
    || code === 'ENOENT'
    || name === 'NotFoundError';
}

/** The default `isNotFound` for checkDestinationBeforeEmptyWrite. */
function defaultIsNotFound(error) {
  return isConfirmedNotFound(error);
}

export const __testing = { statsOfContent, defaultIsNotFound };
