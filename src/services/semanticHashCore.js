/**
 * The tier-1 semantic hash of a .redstring document, with nothing else
 * attached. Split out of semanticHash.js so the hash worker can import it
 * without also importing the module that spawns the worker.
 */

import jsonld from 'jsonld';

export async function sha256hex(str) {
  const buf = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function stripKeys(v, excluded) {
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
