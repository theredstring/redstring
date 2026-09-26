/**
 * Semantic and full hash functions for .redstring documents and store states.
 *
 * D5 (FORMAT_REFACTOR_PLAN §3): two hash tiers.
 *
 * Tier-1 — semanticHash / semanticHashFromStore
 *   SHA-256 over URDNA2015 canonical N-Quads of the exported document.
 *   The canonical export is always produced via exportToRedstring (emitV4:false),
 *   so a v3-serialized file and a v4-serialized file with identical knowledge
 *   produce the same tier-1 hash. Used by detectSlotConflict.
 *
 * Tier-2 — fullHash / fullHashFromStore
 *   SHA-256 over canonically-ordered JSON minus presentation-only sections.
 *   Covers knowledge + spatial layout but not UI state / viewport / derived caches.
 */

import { exportToRedstring } from '../formats/redstringFormat.js';
import { semanticHash, sha256hex, stripKeys } from './semanticHashCore.js';

export { semanticHash };

// Fields excluded from tier-2 (presentation / viewport / derived cache).
// 'created', 'modified', 'redstring:lastViewed' are call-time timestamps —
// stripping them makes fullHash deterministic across multiple calls on the same content.
const EXCLUDED_FULL = [
  'userInterface', 'graphLayouts', 'graphSummaries',
  'viewportX', 'viewportY', 'viewportScale', 'viewport',
  'created', 'modified', 'redstring:lastViewed',
];

function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v).sort().map((k) => [k, sortKeysDeep(v[k])]),
    );
  }
  return v;
}

// ── Tier-1 ──────────────────────────────────────────────────────────────────

/**
 * Tier-1 semantic hash from an imported store state (Maps of prototypes/graphs/edges).
 * Always exports as canonical v3 (emitV4:false) so the hash is stable across the
 * EMIT_V4 flag and equal for v3-serialized / v4-serialized forms of the same knowledge.
 */
export async function semanticHashFromStore(storeState) {
  const doc = exportToRedstring(storeState, null, { emitV4: false });
  return semanticHash(doc);
}

// ── Tier-2 ──────────────────────────────────────────────────────────────────

/**
 * Tier-2 full hash from a raw JSON-LD document.
 * Strips presentation-only keys, sorts all object keys recursively for
 * stability, then SHA-256 the resulting JSON string.
 */
export async function fullHash(doc) {
  const canonical = JSON.stringify(sortKeysDeep(stripKeys(doc, EXCLUDED_FULL)));
  return sha256hex(canonical);
}

/**
 * Tier-2 full hash from an imported store state.
 */
export async function fullHashFromStore(storeState) {
  return fullHash(exportToRedstring(storeState, null, { emitV4: false }));
}

// ── Slot comparison ─────────────────────────────────────────────────────────

/**
 * Hash one exported document in a worker of its own, or on this thread when
 * workers are unavailable (tests, Node) or the worker fails.
 *
 * The document travels as JSON either way, so both paths hash exactly the
 * same input and a comparison never mixes a worker hash with a different
 * main-thread one.
 */
function semanticHashOfJson(json) {
  const onThisThread = () => semanticHash(JSON.parse(json));
  if (typeof Worker === 'undefined') return onThisThread();

  let worker;
  try {
    worker = new Worker(new URL('./semanticHash.worker.js', import.meta.url), { type: 'module' });
  } catch {
    return onThisThread();
  }

  return new Promise((resolve, reject) => {
    const finish = (settle) => {
      try { worker.terminate(); } catch { /* already gone */ }
      settle();
    };
    worker.onmessage = (e) => {
      if (e.data?.error) {
        console.warn('[semanticHash] Worker failed, hashing on the main thread:', e.data.error);
        finish(() => onThisThread().then(resolve, reject));
      } else {
        finish(() => resolve(e.data.hash));
      }
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      console.warn('[semanticHash] Worker error, hashing on the main thread:', event?.message || event);
      finish(() => onThisThread().then(resolve, reject));
    };
    worker.postMessage({ id: 1, json });
  });
}

/**
 * Returns true when two imported store states contain equal knowledge,
 * regardless of the format version they were loaded from.
 * Used as the verdict function inside detectSlotConflict (P4.2).
 *
 * Each side is canonicalized in its own worker, so the two run in parallel
 * and neither blocks the main thread. The export stays here: it needs the
 * store's Maps, and it is the cheap part.
 */
export async function slotsHaveEqualKnowledge(localStoreState, gitStoreState) {
  const toJson = (state) => JSON.stringify(exportToRedstring(state, null, { emitV4: false }));
  const [h1, h2] = await Promise.all([
    semanticHashOfJson(toJson(localStoreState)),
    semanticHashOfJson(toJson(gitStoreState)),
  ]);
  return h1 === h2;
}
