/**
 * The steps between GitSyncEngine and the store for shared universes, kept
 * pure so the app and the two-client tests run the same code
 * (documentation/core-system/SHARED_UNIVERSE_SYNC.md).
 *
 *   planMerge         this device's commit vs what the repository holds now
 *   mergeOntoCanvas   bring a finished merge onto a canvas that kept moving
 *   bringInRemote     someone else saved and this device has nothing to push
 */
import { exportToRedstring, importFromRedstring } from '../formats/redstringFormat.js';
import { serializeRedstring } from '../formats/universeBytes.js';
import { syncMerge } from '../formats/syncMerge.js';

const read = (data) => importFromRedstring(typeof data === 'string' ? JSON.parse(data) : data).storeState;

/**
 * @param {Object} input
 * @param {string} input.baseText - the file at the version both sides grew from
 * @param {string} input.localJson - this device's commit
 * @param {string} [input.applyBaseJson] - what the canvas was built from, when
 *   that is not `localJson` (a second round after the remote moved mid-merge)
 * @param {Object} input.remoteData - the repository's file now, parsed
 * @returns {{ ok: true, content: string, merged: Object, report: Object, applyBase: Object }
 *         | { ok: false, reason: string, report?: Object }}
 */
export function planMerge({ baseText, localJson, applyBaseJson, remoteData }) {
  let base, ours, theirs;
  try {
    base = read(baseText);
    ours = read(localJson);
    theirs = read(remoteData);
  } catch (error) {
    return { ok: false, reason: `A version could not be read (${error?.message || error})` };
  }

  const { merged, report, safe, reason } = syncMerge(base, ours, theirs);
  if (!safe) return { ok: false, reason, report };

  const content = new TextDecoder().decode(serializeRedstring(exportToRedstring(merged)));
  const applyBase = applyBaseJson && applyBaseJson !== localJson ? read(applyBaseJson) : ours;
  return { ok: true, content, merged, report, applyBase };
}

/**
 * The canvas may have moved on since the commit a merge started from, so
 * applying it is itself a three-way merge: what the canvas built on → what
 * it holds now → the merge. Edits made while the merge ran win.
 *
 * @returns {Object} the store state to apply
 */
export function mergeOntoCanvas(applyBase, live, merged) {
  return syncMerge(applyBase, live, merged, { conflictWinner: 'ours', checkDeletions: false }).merged;
}

/**
 * @param {Object} input
 * @param {string} input.baseText - the version the canvas grew from
 * @param {Object} input.remoteData - the repository's file now, parsed
 * @param {Object} live - the store state on the canvas
 * @returns {{ ok: true, merged: Object, report: Object } | { ok: false, reason: string }}
 */
export function bringInRemote({ baseText, remoteData }, live) {
  let base, theirs;
  try {
    base = read(baseText);
    theirs = read(remoteData);
  } catch (error) {
    return { ok: false, reason: `The repository copy could not be read (${error?.message || error})` };
  }
  const { merged, report, safe, reason } = syncMerge(base, live, theirs);
  if (!safe) return { ok: false, reason, report };
  return { ok: true, merged, report };
}
