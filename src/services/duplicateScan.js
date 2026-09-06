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

import { calculateEntityMatchConfidence, normalizeLabel, calculateTextSimilarity } from './entityMatching.js';
import { NODE_DEFAULT_COLOR } from '../constants.js';

/**
 * Pages that cover MANY things rather than naming one.
 *
 * A Wikipedia or DBpedia URL identifies a page, not an entity, and enrichment
 * routinely lands a whole cast on the same "List of X characters" page. Two
 * things sharing that link have no more been claimed identical than two books
 * sharing a library. Only Wikidata QIDs name a single entity — and even those
 * have list items — so a shared hub link is not identity evidence.
 */
const HUB_LINK_PATTERNS = [
  /\/lists?_of_/i,
  /\/index_of_/i,
  /\/outline_of_/i,
  /\/glossary_of_/i,
  /\/timeline_of_/i,
  /\(disambiguation\)/i,
  /\/category:/i,
  /\/portal:/i,
];

export function isHubLink(url) {
  if (typeof url !== 'string') return false;
  return HUB_LINK_PATTERNS.some((re) => re.test(url));
}

/**
 * How alike two names must be before a link match can be called certain.
 *
 * Deliberately loose. It has to pass real pairs whose names differ
 * ("Dog"/"Doggo") while rejecting things that merely share a hub page
 * ("Mario"/"Princess Peach"). A pair that fails this is not discarded — it
 * drops to review, where a person decides.
 */
export const NAME_PLAUSIBILITY_THRESHOLD = 0.5;

export function namesPlausiblyMatch(nameA, nameB) {
  const a = normalizeLabel(nameA);
  const b = normalizeLabel(nameB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  return calculateTextSimilarity(a, b) >= NAME_PLAUSIBILITY_THRESHOLD;
}

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
 * Count how much each prototype is actually used.
 *
 * Two ways a thing gets used, and both count: as an instance placed on a web,
 * and as the TYPE of a connection. Counting only instances made a thing that
 * types fifty connections but sits on no canvas look unused, and lose the
 * survivor choice to a near-duplicate placed once.
 *
 * Indexed once and reused — the survivor choice needs it for every pair.
 *
 * @returns {Map<string, {instances: number, connections: number, total: number}>}
 */
export function countUsesByPrototype(graphs, edges) {
  const counts = new Map();
  const bump = (id, key) => {
    if (!id) return;
    const entry = counts.get(id) || { instances: 0, connections: 0, total: 0 };
    entry[key] += 1;
    entry.total += 1;
    counts.set(id, entry);
  };

  if (graphs) {
    for (const graph of (graphs instanceof Map ? graphs.values() : Object.values(graphs))) {
      const instances = graph?.instances;
      if (!(instances instanceof Map)) continue;
      for (const instance of instances.values()) bump(instance?.prototypeId, 'instances');
    }
  }

  if (edges) {
    for (const edge of (edges instanceof Map ? edges.values() : Object.values(edges || {}))) {
      bump(edge?.typeNodeId, 'connections');
    }
  }

  return counts;
}

const NO_USES = { instances: 0, connections: 0, total: 0 };
const usesOf = (counts, id) => counts.get(id) || NO_USES;

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
function chooseSurvivor(a, b, useCounts) {
  const ca = usesOf(useCounts, a.id).total;
  const cb = usesOf(useCounts, b.id).total;
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
 * @param {Map} [edges] - Needed to count things used as connection types.
 * @param {Object} [options]
 * @param {number} [options.fuzzyCap=FUZZY_SCAN_CAP]
 * @param {number} [options.maxPairs=MAX_PAIRS]
 * @returns {{certain: Array, review: Array, unlikely: Array, scanned: number, fuzzySkipped: boolean}}
 */
export function scanForDuplicates(nodePrototypes, graphs, edges, options = {}) {
  const { fuzzyCap = FUZZY_SCAN_CAP, maxPairs = MAX_PAIRS } = options;

  const protos = nodePrototypes instanceof Map
    ? [...nodePrototypes.values()]
    : Object.values(nodePrototypes || {});

  const result = { certain: [], review: [], unlikely: [], scanned: protos.length, fuzzySkipped: false };
  if (protos.length < 2) return result;

  const useCounts = countUsesByPrototype(graphs, edges);
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

    const e1 = entities.get(id1);
    const e2 = entities.get(id2);
    const match = calculateEntityMatchConfidence(e1, e2);
    if (!match || match.confidence <= 0) continue;

    // What the two actually share, and whether any of it names one thing.
    const otherLinks = new Set(e2.externalLinks);
    const sharedLinks = e1.externalLinks.filter((url) => otherLinks.has(url));
    const onlyHubEvidence = sharedLinks.length > 0 && sharedLinks.every(isHubLink);
    const namesOk = namesPlausiblyMatch(p1.name, p2.name);

    // "Certain" means safe to merge in bulk without reading it, so it has to
    // clear a bar the raw score does not: a shared link scores 0.90 on its own,
    // which is enough to auto-merge every character on one cast-list page.
    let demotedBecause = null;
    if (match.shouldMerge) {
      if (onlyHubEvidence) demotedBecause = 'shared page covers many things';
      else if (!namesOk) demotedBecause = 'names are quite different';
    }

    const [survivor, loser] = chooseSurvivor(p1, p2, useCounts);
    const candidate = {
      key,
      survivorId: survivor.id,
      loserId: loser.id,
      survivor,
      loser,
      confidence: match.confidence,
      factors: match.factors,
      sharedLinks,
      demotedBecause,
      carryOver: computeCarryOver(survivor, loser),
      survivorUses: usesOf(useCounts, survivor.id),
      loserUses: usesOf(useCounts, loser.id)
    };

    if (match.shouldMerge && !demotedBecause) result.certain.push(candidate);
    else if (match.shouldMerge || match.needsReview) result.review.push(candidate);
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
