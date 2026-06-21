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

import jsonld from 'jsonld';
import { exportToRedstring } from '../formats/redstringFormat.js';

// Fields excluded from tier-2 (presentation / viewport / derived cache).
const EXCLUDED_FULL = [
  'userInterface', 'graphLayouts', 'graphSummaries',
  'viewportX', 'viewportY', 'viewportScale', 'viewport',
];

async function sha256hex(str) {
  const buf = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v).sort().map((k) => [k, sortKeysDeep(v[k])]),
    );
  }
  return v;
}

function stripKeys(v, excluded) {
  if (Array.isArray(v)) return v.map((x) => stripKeys(x, excluded));
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !excluded.includes(k))
        .map(([k, x]) => [k, stripKeys(x, excluded)]),
    );
  }
  return v;
}

// ── Tier-1 ──────────────────────────────────────────────────────────────────

// Non-semantic sections stripped before tier-1 hashing.
// These are already context-nulled for the RDF projection (see REDSTRING_CONTEXT)
// but some also appear under non-null paths or contain time-varying fields:
// - metadata                    — doc-level timestamps (created/modified)
// - redstring:cognitiveProperties — per-prototype, contains lastViewed (new Date())
// - userInterface / graphLayouts / graphSummaries — UI & derived caches (context-nulled)
const EXCLUDED_SEMANTIC = [
  'metadata',
  'redstring:cognitiveProperties',
  'userInterface',
  'graphLayouts',
  'graphSummaries',
];

/**
 * Tier-1 semantic hash from a raw JSON-LD document (the .redstring format).
 * Order-independent: URDNA2015 canonicalization normalizes blank-node labels
 * and triple ordering before hashing. Non-semantic sections (timestamps, UI
 * state, derived caches) are stripped first for stability.
 */
export async function semanticHash(doc) {
  const stable = stripKeys(doc, EXCLUDED_SEMANTIC);
  const nq = await jsonld.canonize(stable, {
    algorithm: 'URDNA2015',
    format: 'application/n-quads',
    safe: false,
  });
  return sha256hex(nq);
}

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
 * Returns true when two imported store states contain equal knowledge,
 * regardless of the format version they were loaded from.
 * Used as the verdict function inside detectSlotConflict (P4.2).
 */
export async function slotsHaveEqualKnowledge(localStoreState, gitStoreState) {
  const [h1, h2] = await Promise.all([
    semanticHashFromStore(localStoreState),
    semanticHashFromStore(gitStoreState),
  ]);
  return h1 === h2;
}
