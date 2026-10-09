/**
 * Choosing which part of an ontology to import.
 *
 * A slice is one or more root terms plus everything more specific than them,
 * down to a depth. Whole ontologies are allowed (no roots), but most packs are
 * slices: ChEBI has 238k terms, and the water corner of it has a few dozen.
 *
 * Two kinds of term ride along with the selection so the result is complete
 * rather than ragged:
 *  - ancestors: everything less specific than a selected term, so each Thing's
 *    ladder reaches the top of its ontology instead of stopping at the slice;
 *  - partners: the parts of selected terms (has part, or a part declaring part
 *    of), so every composition web the import draws has all its members.
 */

import { OBO, HAS_PART_PREDICATES, PART_OF_PREDICATES } from './vocab.js';

/**
 * Resolve a user-written reference to index IRIs: a full IRI, an OBO CURIE
 * (`CHEBI:15377`), or a label (case-insensitive, exact).
 *
 * @returns {string[]} matching IRIs, sorted; empty when nothing matches
 */
export function resolveTermRef(index, ref) {
  const raw = String(ref ?? '').trim();
  if (!raw) return [];
  if (index.terms.has(raw)) return [raw];

  const curie = raw.match(/^([A-Za-z][A-Za-z0-9_.-]*):([A-Za-z0-9_.-]+)$/);
  if (curie && !/^https?$/i.test(curie[1])) {
    const obo = `${OBO}${curie[1]}_${curie[2]}`;
    if (index.terms.has(obo)) return [obo];
  }

  const wanted = raw.toLowerCase();
  const hits = [];
  for (const term of index.terms.values()) {
    if (term.label && term.label.toLowerCase() === wanted) hits.push(term.iri);
  }
  return hits.sort();
}

/**
 * Search terms by label, for picking roots in the import dialog.
 * Exact matches first, then prefix matches, then substring matches.
 */
export function searchTerms(index, query, limit = 20) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const exact = [];
  const prefix = [];
  const contains = [];
  for (const term of index.terms.values()) {
    if (term.deprecated) continue;
    const label = term.label?.toLowerCase();
    const idMatch = term.iri.toLowerCase().endsWith(q.replace(':', '_'));
    if (label === q || idMatch) exact.push(term);
    else if (label?.startsWith(q)) prefix.push(term);
    else if (label?.includes(q)) contains.push(term);
    if (exact.length >= limit) break;
  }
  const byLength = (a, b) => (a.label?.length ?? 0) - (b.label?.length ?? 0) || (a.iri < b.iri ? -1 : 1);
  return [...exact, ...prefix.sort(byLength), ...contains.sort(byLength)]
    .slice(0, limit)
    .map((t) => ({ iri: t.iri, label: t.label, definition: t.definition }));
}

/** Children (more specific terms) of every term, built once per index. */
export function childrenOf(index) {
  if (index._children) return index._children;
  const children = new Map();
  for (const term of index.terms.values()) {
    for (const parent of term.parents) {
      let list = children.get(parent);
      if (!list) { list = []; children.set(parent, list); }
      list.push(term.iri);
    }
  }
  for (const list of children.values()) list.sort();
  Object.defineProperty(index, '_children', { value: children, enumerable: false });
  return children;
}

/** For each whole, the terms that declare themselves part of it. Built once per index. */
export function declaredPartsOf(index) {
  if (index._declaredParts) return index._declaredParts;
  const parts = new Map();
  for (const term of index.terms.values()) {
    for (const rel of term.relations) {
      if (!PART_OF_PREDICATES.has(rel.property)) continue;
      let list = parts.get(rel.target);
      if (!list) { list = []; parts.set(rel.target, list); }
      list.push(term.iri);
    }
  }
  Object.defineProperty(index, '_declaredParts', { value: parts, enumerable: false });
  return parts;
}

/**
 * Pick the slice.
 *
 * @param {Object} index - from the index builder
 * @param {Object} [options]
 * @param {string[]} [options.roots] - IRIs, CURIEs or labels. Empty = the whole ontology
 * @param {number} [options.depth=Infinity] - how many steps more specific than a root to go
 * @param {string[]} [options.namespaces] - IRI prefixes to keep (e.g. `http://purl.obolibrary.org/obo/CHEBI_`)
 * @param {boolean} [options.includeDeprecated=false]
 * @param {boolean} [options.includeAncestors=true]
 * @param {boolean} [options.includePartners=true]
 * @returns {{iris: Set<string>, roots: string[], missingRoots: string[], ambiguousRoots: Object[], counts: Object}}
 */
export function computeSlice(index, options = {}) {
  const {
    roots = [],
    depth = Infinity,
    namespaces = [],
    includeDeprecated = false,
    includeAncestors = true,
    includePartners = true,
  } = options;

  const prefixes = (namespaces || []).map((n) => String(n).trim()).filter(Boolean);
  const inScope = (iri) => {
    const term = index.terms.get(iri);
    if (!term) return false;
    if (term.deprecated && !includeDeprecated) return false;
    if (prefixes.length > 0 && !prefixes.some((p) => iri.startsWith(p))) return false;
    return true;
  };

  const resolvedRoots = [];
  const missingRoots = [];
  const ambiguousRoots = [];
  for (const ref of roots || []) {
    const hits = resolveTermRef(index, ref);
    if (hits.length === 0) missingRoots.push(String(ref));
    else {
      if (hits.length > 1) ambiguousRoots.push({ ref: String(ref), matches: hits });
      for (const hit of hits) if (!resolvedRoots.includes(hit)) resolvedRoots.push(hit);
    }
  }

  const iris = new Set();
  const counts = { selected: 0, ancestors: 0, partners: 0, deprecatedSkipped: 0, outOfNamespace: 0 };

  if ((roots || []).length === 0) {
    for (const iri of index.terms.keys()) {
      if (inScope(iri)) iris.add(iri);
      else if (index.terms.get(iri).deprecated) counts.deprecatedSkipped++;
      else counts.outOfNamespace++;
    }
    counts.selected = iris.size;
    return { iris, roots: [], missingRoots, ambiguousRoots, counts };
  }

  // Descendants of each root, breadth first, to the depth asked for.
  const children = childrenOf(index);
  const maxDepth = depth == null || depth === '' ? Infinity
    : (Number.isFinite(Number(depth)) && Number(depth) >= 0 ? Number(depth) : Infinity);
  let frontier = resolvedRoots.filter(inScope);
  for (const iri of frontier) iris.add(iri);
  let level = 0;
  while (frontier.length > 0 && level < maxDepth) {
    const next = [];
    for (const iri of frontier) {
      for (const child of children.get(iri) || []) {
        if (iris.has(child)) continue;
        if (!inScope(child)) {
          if (index.terms.get(child)?.deprecated) counts.deprecatedSkipped++;
          continue;
        }
        iris.add(child);
        next.push(child);
      }
    }
    frontier = next;
    level++;
  }
  counts.selected = iris.size;

  const addAncestors = (start) => {
    const stack = [...start];
    while (stack.length > 0) {
      const iri = stack.pop();
      for (const parent of index.terms.get(iri)?.parents || []) {
        if (iris.has(parent) || !inScope(parent)) continue;
        iris.add(parent);
        counts.ancestors++;
        stack.push(parent);
      }
    }
  };

  if (includePartners) {
    const partners = [];
    const addPartner = (iri) => {
      if (iris.has(iri) || !inScope(iri)) return;
      iris.add(iri);
      partners.push(iri);
      counts.partners++;
    };
    const declared = declaredPartsOf(index);
    for (const iri of [...iris]) {
      for (const rel of index.terms.get(iri)?.relations || []) {
        if (HAS_PART_PREDICATES.has(rel.property)) addPartner(rel.target);
      }
      for (const part of declared.get(iri) || []) addPartner(part);
    }
    if (includeAncestors) addAncestors(partners);
  }
  if (includeAncestors) addAncestors([...iris]);

  return { iris, roots: resolvedRoots.filter(inScope), missingRoots, ambiguousRoots, counts };
}
