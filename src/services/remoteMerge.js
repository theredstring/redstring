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
import { syncMerge, rememberInlineImageRef, knowsInlineImageRef, deepEqual } from '../formats/syncMerge.js';
import { computeImageRef, isDataUrl } from '../formats/imageRefs.js';

/**
 * Learn the content ref of every inline image in these states, so the merge
 * can tell an inline picture from the same picture held as a ref (see
 * syncMerge's Images). Hashing is async, the merge is not, so this runs first.
 * An image that can't be hashed just compares as itself.
 */
export async function primeImageRefs(...states) {
  for (const state of states) {
    const prototypes = state?.nodePrototypes;
    if (!(prototypes instanceof Map)) continue;
    for (const proto of prototypes.values()) {
      const src = proto?.imageSrc;
      if (!isDataUrl(src) || knowsInlineImageRef(src, proto)) continue;
      try {
        const computed = await computeImageRef(src);
        if (computed?.ref) rememberInlineImageRef(src, computed.ref, proto);
      } catch (_) { /* compares as itself */ }
    }
  }
}

const read = (data) => importFromRedstring(typeof data === 'string' ? JSON.parse(data) : data).storeState;

/**
 * The canvas as its file would hold it. A Thing made on the canvas carries
 * fewer fields than the same Thing read back from a file (no `x: 0`, no empty
 * lists, `null` where the file leaves a field out), so compared as-is every
 * Thing this person made reads as edited: a collaborator's delete of it is
 * undone ("an edit beats a delete"), and never arrives here. Compared as the
 * file holds it, only real edits are edits.
 */
const asSaved = (live) => read(new TextDecoder().decode(serializeRedstring(exportToRedstring(live))));

const COLLECTIONS = ['graphs', 'nodePrototypes', 'edges', 'edgePrototypes'];
const isPlain = (v) => v !== null && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v);

/** One entity: the canvas's own object if the merge left it as it was, else the merge's, keeping the canvas's value for every field the merge didn't change. */
function keepLiveEntity(merged, saved, own) {
  if (own === undefined || saved === undefined) return merged;
  if (deepEqual(merged, saved)) return own;
  if (!isPlain(merged) || !isPlain(own)) return merged;
  const out = { ...merged };
  for (const key of new Set([...Object.keys(own), ...Object.keys(merged)])) {
    if (!deepEqual(merged[key], saved[key])) continue;
    if (key in own) out[key] = own[key];
    else delete out[key];
  }
  return out;
}

/**
 * Put the canvas's own objects back wherever the merge (made on `saved`, the
 * file form of `live`) didn't change them: fields the file doesn't carry, such
 * as a picture fetched again from its source, stay on the canvas.
 */
function keepLive(merged, saved, live) {
  const out = { ...merged };
  for (const key of COLLECTIONS) {
    if (!(merged[key] instanceof Map) || !(live[key] instanceof Map)) continue;
    const next = new Map();
    for (const [id, entity] of merged[key]) next.set(id, keepLiveEntity(entity, saved[key]?.get(id), live[key].get(id)));
    out[key] = next;
  }
  for (const key of Object.keys(out)) {
    if (!COLLECTIONS.includes(key) && key in live && deepEqual(out[key], saved[key])) out[key] = live[key];
  }
  return out;
}

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
export async function planMerge({ baseText, localJson, applyBaseJson, remoteData }) {
  let base, ours, theirs;
  try {
    base = read(baseText);
    ours = read(localJson);
    theirs = read(remoteData);
  } catch (error) {
    return { ok: false, reason: `A version could not be read (${error?.message || error})` };
  }

  await primeImageRefs(base, ours, theirs);
  const { merged, report, safe, reason } = syncMerge(base, ours, theirs);
  if (!safe) return { ok: false, reason, report };

  const content = new TextDecoder().decode(serializeRedstring(exportToRedstring(merged)));
  const applyBase = applyBaseJson && applyBaseJson !== localJson ? read(applyBaseJson) : ours;
  return { ok: true, content, merged, report, applyBase };
}

/**
 * The canvas may have moved on since the commit a merge started from, so
 * applying it is itself a three-way merge: what the canvas built on → what
 * it holds now → the merge. Edits made while the merge ran win. Prime the
 * live state's images first (primeImageRefs).
 *
 * @returns {Object} the store state to apply
 */
export function mergeOntoCanvas(applyBase, live, merged) {
  const saved = asSaved(live);
  return keepLive(syncMerge(applyBase, saved, merged, { conflictWinner: 'ours', checkDeletions: false }).merged, saved, live);
}

/**
 * @param {Object} input
 * @param {string} input.baseText - the version the canvas grew from
 * @param {Object} input.remoteData - the repository's file now, parsed
 * @param {Object} live - the store state on the canvas (images primed: primeImageRefs)
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
  let saved;
  try {
    saved = asSaved(live);
  } catch (error) {
    return { ok: false, reason: `This canvas could not be compared (${error?.message || error})` };
  }
  const { merged, report, safe, reason } = syncMerge(base, saved, theirs);
  if (!safe) return { ok: false, reason, report };
  return { ok: true, merged: keepLive(merged, saved, live), report };
}
