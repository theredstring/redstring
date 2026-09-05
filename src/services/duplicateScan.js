/**
 * Duplicate scanning for Redstring prototypes ("things").
 *
 * Adapts the store's prototype shape onto entityMatching's generic entity
 * vocabulary and turns a universe into banded candidate pairs for review.
 *
 * entityMatching.js is deliberately domain-agnostic ("across knowledge
 * sources"), so the Redstring-specific parts — the adapter, instance counts,
 * survivor choice, gap-fill — live here rather than being pushed into it.
 *
 * Scanning is staged so it stays cheap on a large universe:
 *
 *   1. Link buckets  — prototypes sharing an external link. O(n), and it finds
 *                      the strongest matches, since a shared Wikidata/DBpedia
 *                      URI is an identity claim the user already made.
 *   2. Name buckets  — prototypes sharing a normalized label. O(n).
 *   3. Fuzzy pass    — the O(n²) comparison, run ONLY under a size cap. Above
 *                      it the first two stages still work, so a big universe
 *                      degrades to "exact signals only" instead of hanging.
 */

import { calculateEntityMatchConfidence, normalizeLabel } from './entityMatching.js';
import { NODE_DEFAULT_COLOR } from '../constants.js';

/** Above this many prototypes, skip the O(n²) fuzzy stage. */
export const FUZZY_SCAN_CAP = 600;

/** Hard ceiling on returned pairs, so the UI can always render the result. */
export const MAX_PAIRS = 500;

/**
 * Map a store prototype onto the entity shape entityMatching expects.
 *
 * A prototype carries external links in two places — top level and under
 * semanticMetadata — and both are real, so both are folded in.
 *
 * `uri`/`sameAsLinks` are deliberately NOT synthesized. entityMatching's
 * sameAs factor asks whether one entity's sameAs list names the other's own
 * URI; prototypes have no public URI of their own, and inventing one (say, its
 * first external link) would make two things linked to the same page claim to
 * be sameAs each other through a back door that the Wikidata factor already
 * scores properly and more honestly.
 */
export function prototypeToEntity(prototype) {
  const top = Array.isArray(prototype?.externalLinks) ? prototype.externalLinks : [];
  const semantic = Array.isArray(prototype?.semanticMetadata?.externalLinks)
    ? prototype.semanticMetadata.externalLinks
    : [];
  return {
    id: prototype?.id,
    name: prototype?.name || '',
    description: prototype?.description || '',
    externalLinks: [...new Set([...top, ...semantic])]
  };
}

/**
 * Count how many instances each prototype has across every web.
 * Indexed once and reused — the survivor choice needs it for every pair.
 *
 * @returns {Map<string, number>}
 */
export function countInstancesByPrototype(graphs) {
  const counts = new Map();
  if (!graphs) return counts;
  for (const graph of (graphs instanceof Map ? graphs.values() : Object.values(graphs))) {
    const instances = graph?.instances;
    if (!(instances instanceof Map)) continue;
    for (const instance of instances.values()) {
      const pid = instance?.prototypeId;
      if (!pid) continue;
      counts.set(pid, (counts.get(pid) || 0) + 1);
    }
  }
  return counts;
}

const hasText = (v) => typeof v === 'string' && v.trim() !== '';
const hasColor = (v) => hasText(v) && v !== NODE_DEFAULT_COLOR;

/**
 * Which fields the survivor is MISSING that the other one has.
 *
 * Gap-fill, never overwrite: a field the survivor already has is left alone,
 * whatever the other side holds. Fields the store's own merge already unions
 * (externalLinks, semanticMetadata, definitionGraphIds) are not listed here —
 * they are not gaps, they combine on their own.
 *
 * @returns {Array<{field: string, label: string, value: *}>}
 */
export function computeCarryOver(survivor, other) {
  const gaps = [];

  if (!hasText(survivor?.description) && hasText(other?.description)) {
    gaps.push({ field: 'description', label: 'description', value: other.description });
  }

  if (!hasColor(survivor?.color) && hasColor(other?.color)) {
    gaps.push({ field: 'color', label: 'color', value: other.color });
  }

  // The image fields move as one unit — an aspect ratio without its image, or
  // a thumbnail pointing at a different picture than the full image, is worse
  // than having neither.
  if (!hasText(survivor?.imageSrc) && !hasText(survivor?.thumbnailSrc) &&
      (hasText(other?.imageSrc) || hasText(other?.thumbnailSrc))) {
    gaps.push({
      field: 'image',
      label: 'image',
      value: {
        imageSrc: other.imageSrc,
        thumbnailSrc: other.thumbnailSrc,
        imageAspectRatio: other.imageAspectRatio
      }
    });
  }

  if (!survivor?.typeNodeId && other?.typeNodeId) {
    gaps.push({ field: 'typeNodeId', label: 'type', value: other.typeNodeId });
  }

  // Per dimension: a chain the survivor has is kept as-is (its order is a
  // claim), one it lacks entirely is worth carrying.
  const otherChains = other?.abstractionChains;
  if (otherChains && typeof otherChains === 'object') {
    const survivorChains = survivor?.abstractionChains || {};
    const missing = {};
    for (const [dimension, chain] of Object.entries(otherChains)) {
      if (!survivorChains[dimension]) missing[dimension] = chain;
    }
    if (Object.keys(missing).length > 0) {
      gaps.push({ field: 'abstractionChains', label: 'abstraction', value: missing });
    }
  }

  return gaps;
}

/** Most-used wins; ties fall back to the longer description, then to id order. */
function chooseSurvivor(a, b, instanceCounts) {
  const ca = instanceCounts.get(a.id) || 0;
  const cb = instanceCounts.get(b.id) || 0;
  if (ca !== cb) return ca > cb ? [a, b] : [b, a];

  const da = (a.description || '').length;
  const db = (b.description || '').length;
  if (da !== db) return da > db ? [a, b] : [b, a];

  return String(a.id) <= String(b.id) ? [a, b] : [b, a];
}

const pairKey = (id1, id2) => (String(id1) < String(id2) ? `${id1}|${id2}` : `${id2}|${id1}`);

/**
 * Scan a universe for duplicate things.
 *
 * @param {Map} nodePrototypes
 * @param {Map} graphs
 * @param {Object} [options]
 * @param {number} [options.fuzzyCap=FUZZY_SCAN_CAP]
 * @param {number} [options.maxPairs=MAX_PAIRS]
 * @returns {{certain: Array, review: Array, unlikely: Array, scanned: number, fuzzySkipped: boolean}}
 */
export function scanForDuplicates(nodePrototypes, graphs, options = {}) {
  const { fuzzyCap = FUZZY_SCAN_CAP, maxPairs = MAX_PAIRS } = options;

  const protos = nodePrototypes instanceof Map
    ? [...nodePrototypes.values()]
    : Object.values(nodePrototypes || {});

  const result = { certain: [], review: [], unlikely: [], scanned: protos.length, fuzzySkipped: false };
  if (protos.length < 2) return result;

  const instanceCounts = countInstancesByPrototype(graphs);
  const entities = new Map(protos.map((p) => [p.id, prototypeToEntity(p)]));
  const byId = new Map(protos.map((p) => [p.id, p]));

  // -- Stage 1 + 2: bucket by shared external link, then by normalized name --
  const candidatePairs = new Set();
  const bucket = (keyOf) => {
    const buckets = new Map();
    for (const p of protos) {
      for (const key of keyOf(p)) {
        if (!key) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(p.id);
      }
    }
    for (const ids of buckets.values()) {
      if (ids.length < 2) continue;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) candidatePairs.add(pairKey(ids[i], ids[j]));
      }
    }
  };

  bucket((p) => entities.get(p.id).externalLinks);
  bucket((p) => [normalizeLabel(p.name)]);

  // -- Stage 3: fuzzy, only under the cap --
  if (protos.length <= fuzzyCap) {
    for (let i = 0; i < protos.length; i++) {
      for (let j = i + 1; j < protos.length; j++) {
        candidatePairs.add(pairKey(protos[i].id, protos[j].id));
      }
    }
  } else {
    result.fuzzySkipped = true;
  }

  // -- Score every candidate pair --
  for (const key of candidatePairs) {
    const [id1, id2] = key.split('|');
    const p1 = byId.get(id1);
    const p2 = byId.get(id2);
    if (!p1 || !p2) continue;

    const match = calculateEntityMatchConfidence(entities.get(id1), entities.get(id2));
    if (!match || match.confidence <= 0) continue;

    const [survivor, loser] = chooseSurvivor(p1, p2, instanceCounts);
    const candidate = {
      key,
      survivorId: survivor.id,
      loserId: loser.id,
      survivor,
      loser,
      confidence: match.confidence,
      factors: match.factors,
      carryOver: computeCarryOver(survivor, loser),
      survivorInstances: instanceCounts.get(survivor.id) || 0,
      loserInstances: instanceCounts.get(loser.id) || 0
    };

    if (match.shouldMerge) result.certain.push(candidate);
    else if (match.needsReview) result.review.push(candidate);
    else result.unlikely.push(candidate);
  }

  const byConfidence = (a, b) => b.confidence - a.confidence;
  result.certain.sort(byConfidence);
  result.review.sort(byConfidence);
  result.unlikely.sort(byConfidence);

  // Trim the weakest band first — the strong signals are what the UI is for.
  result.unlikely = result.unlikely.slice(0, Math.max(0, maxPairs - result.certain.length - result.review.length));

  return result;
}
