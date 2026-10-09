/**
 * The deterministic import plan: how an ontology slice becomes Redstring.
 *
 * Every decision here is a rule, and the same index and slice always give the
 * same plan, IDs included. A later "smart" planner may revise individual
 * decisions; it will do so on this same plan, and the builder never changes.
 *
 * The rules, in Redstring's terms:
 *
 *  - Every term becomes a Thing. Its ID is derived from its IRI (UUID v5), so
 *    the same IRI is the same Thing in every pack and every re-import, and the
 *    IRI itself is kept as an exact external link.
 *
 *  - A Thing's type is the next lens down its specificity stack: its most
 *    specific parent inside the slice (the parent furthest from the top, ties
 *    broken by IRI). Linked types make the carousel, so the full ladder shows
 *    without storing it. A term's other parents are kept on the Thing as data.
 *
 *  - Composition (has part / part of) becomes webs. A whole's web holds its
 *    parts, and relations between those parts are drawn there as connections.
 *    That is the only place the import draws connections: a web is the inside
 *    of its Thing, so nothing is put in a web that isn't part of it.
 *
 *  - Every other relation (has role, is conjugate acid of, ...) is kept on the
 *    Thing as data, with nothing lost, until there is a web it belongs in.
 *
 *  - The source becomes one Thing (named after the ontology) whose web is a
 *    declared folder: the roots that were asked for, or the slice's top kinds.
 *    That Thing is saved and its web is opened; nothing else is saved, and
 *    every imported Thing stays alive through its link to the source Thing.
 */

import { v5 as uuidv5 } from 'uuid';
import { HAS_PART_PREDICATES, PART_OF_PREDICATES } from './vocab.js';

/** Namespace for every ID the importer derives. Never change it: IDs in saved files depend on it. */
export const IMPORT_NAMESPACE = 'acebeb60-775d-4791-8f11-b7907ba203ea';

export const importIds = {
  thing: (iri) => uuidv5(iri, IMPORT_NAMESPACE),
  source: (sourceKey) => uuidv5(`source|${sourceKey}`, IMPORT_NAMESPACE),
  folderWeb: (sourceKey) => uuidv5(`folder|${sourceKey}`, IMPORT_NAMESPACE),
  compositionWeb: (sourceKey, wholeIri) => uuidv5(`composition|${sourceKey}|${wholeIri}`, IMPORT_NAMESPACE),
  instance: (graphId, thingId) => uuidv5(`instance|${graphId}|${thingId}`, IMPORT_NAMESPACE),
  edge: (graphId, s, p, o) => uuidv5(`edge|${graphId}|${s}|${p}|${o}`, IMPORT_NAMESPACE),
};

/** Last path segment or fragment of an IRI, for terms with no label. */
export function localName(iri) {
  const s = String(iri);
  const hash = s.lastIndexOf('#');
  const tail = hash !== -1 ? s.slice(hash + 1) : s.slice(s.lastIndexOf('/') + 1);
  const name = tail || s.slice(s.lastIndexOf(':') + 1) || s;
  try { return decodeURIComponent(name).replace(/_/g, ' ').trim() || s; } catch { return name; }
}

/** "has role" → "Has Role", matching how the wizard names connection types. */
const titleCase = (str) => String(str || '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));


/**
 * Longest distance from the top of the slice for each term, where the top is a
 * term with no parent inside the slice. Cycles (A ⊑ B ⊑ A, which OWL reads as
 * equivalence) are cut where the walk meets a term still on its own stack.
 */
function depthsInSlice(index, iris) {
  const depth = new Map();
  const onStack = new Set();
  const visit = (start) => {
    // Iterative DFS so a 20-level-deep ontology can't overflow the call stack.
    const stack = [[start, 0]];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const [iri, i] = frame;
      if (i === 0) {
        if (depth.has(iri)) { stack.pop(); continue; }
        onStack.add(iri);
      }
      const parents = (index.terms.get(iri)?.parents || []).filter((p) => iris.has(p));
      if (i < parents.length) {
        frame[1] = i + 1;
        const p = parents[i];
        if (!depth.has(p) && !onStack.has(p)) stack.push([p, 0]);
        continue;
      }
      let d = 0;
      for (const p of parents) if (depth.has(p)) d = Math.max(d, depth.get(p) + 1);
      depth.set(iri, d);
      onStack.delete(iri);
      stack.pop();
    }
  };
  for (const iri of iris) visit(iri);
  return depth;
}

/**
 * Build the plan.
 *
 * @param {Object} index - the ontology index
 * @param {Object} slice - from computeSlice()
 * @param {Object} [options]
 * @param {string} [options.sourceName] - shown when the ontology has no title (e.g. the file name)
 * @param {string} [options.importedAt] - ISO time recorded on the source Thing only
 * @returns {Object} the plan
 */
export function buildImportPlan(index, slice, options = {}) {
  const { sourceName = null, importedAt = null } = options;
  const iris = slice.iris;
  const ontology = index.ontology || {};
  const sourceKey = ontology.iri || `file:${sourceName || 'ontology'}`;
  const sourceTitle = ontology.title || sourceName || localName(sourceKey);
  const sourceId = importIds.source(sourceKey);
  const folderWebId = importIds.folderWeb(sourceKey);

  const depth = depthsInSlice(index, iris);
  const sortedIris = [...iris].sort();

  // ── Things and their types ────────────────────────────────────────────────
  const typeOf = new Map(); // iri → parent iri chosen as its type
  for (const iri of sortedIris) {
    const inSlice = (index.terms.get(iri)?.parents || []).filter((p) => iris.has(p) && p !== iri);
    if (inSlice.length === 0) continue;
    let best = null;
    for (const p of inSlice) {
      if (best === null) { best = p; continue; }
      const dp = depth.get(p) ?? 0;
      const db = depth.get(best) ?? 0;
      if (dp > db || (dp === db && p < best)) best = p;
    }
    typeOf.set(iri, best);
  }
  // Belt and braces: a type link may never close a loop, whatever the depths
  // said. Walk each type chain and cut the link that would revisit a term.
  for (const iri of sortedIris) {
    const seen = new Set([iri]);
    let cur = typeOf.get(iri);
    while (cur) {
      if (seen.has(cur)) { typeOf.delete(iri); break; }
      seen.add(cur);
      cur = typeOf.get(cur);
    }
  }

  // ── Composition ───────────────────────────────────────────────────────────
  const partsOf = new Map(); // whole iri → Set<part iri>
  const addPart = (whole, part) => {
    if (whole === part || !iris.has(whole) || !iris.has(part)) return;
    let set = partsOf.get(whole);
    if (!set) { set = new Set(); partsOf.set(whole, set); }
    set.add(part);
  };
  for (const iri of sortedIris) {
    for (const rel of index.terms.get(iri)?.relations || []) {
      if (HAS_PART_PREDICATES.has(rel.property)) addPart(iri, rel.target);
      else if (PART_OF_PREDICATES.has(rel.property)) addPart(rel.target, iri);
    }
  }

  const relationLabel = (property) => {
    const label = index.properties.get(property)?.label || index.terms.get(property)?.label;
    return titleCase(label || localName(property));
  };

  const webs = [];
  const relationTypes = new Map(); // property iri → { iri, name }
  for (const whole of [...partsOf.keys()].sort()) {
    const parts = [...partsOf.get(whole)].sort();
    const partSet = new Set(parts);
    const connections = [];
    for (const a of parts) {
      for (const rel of index.terms.get(a)?.relations || []) {
        if (!partSet.has(rel.target) || rel.target === a) continue;
        // Being in this web already says "part of the whole"; a part that has
        // its own parts gets its own web. Neither is drawn as a connection.
        if (HAS_PART_PREDICATES.has(rel.property) || PART_OF_PREDICATES.has(rel.property)) continue;
        connections.push({ source: a, property: rel.property, target: rel.target });
        if (!relationTypes.has(rel.property)) {
          relationTypes.set(rel.property, { iri: rel.property, id: importIds.thing(rel.property), name: relationLabel(rel.property) });
        }
      }
    }
    webs.push({
      id: importIds.compositionWeb(sourceKey, whole),
      kind: 'composition',
      whole,
      members: parts,
      connections,
    });
  }

  // ── The folder ────────────────────────────────────────────────────────────
  let folderMembers;
  if (slice.roots && slice.roots.length > 0) {
    folderMembers = slice.roots.filter((r) => iris.has(r));
  } else {
    const tops = sortedIris.filter((iri) => !typeOf.has(iri));
    folderMembers = tops;
    if (tops.length === 1) {
      const only = tops[0];
      folderMembers = [only, ...sortedIris.filter((iri) => typeOf.get(iri) === only)];
    }
  }
  folderMembers = [...new Set(folderMembers)].sort();

  // ── Things ────────────────────────────────────────────────────────────────
  const labelOf = (ref) => index.terms.get(ref)?.label || localName(ref);
  const things = sortedIris.map((iri) => {
    const term = index.terms.get(iri);
    const type = typeOf.get(iri) || null;
    return {
      iri,
      id: importIds.thing(iri),
      name: term.label || localName(iri),
      description: term.definition || '',
      kind: term.kind,
      typeIri: type,
      // Labels ride along so the data reads on its own, without the index.
      otherParents: term.parents.filter((p) => p !== type).map((p) => ({ iri: p, label: labelOf(p) })),
      relations: term.relations.map((r) => ({
        property: r.property,
        propertyLabel: relationLabel(r.property),
        target: r.target,
        targetLabel: labelOf(r.target),
      })),
      synonyms: term.synonyms,
      xrefs: term.xrefs,
      equivalents: term.equivalents,
      deprecated: term.deprecated,
      replacedBy: term.replacedBy,
      compositionWebId: partsOf.has(iri) ? importIds.compositionWeb(sourceKey, iri) : null,
    };
  });

  const connectionCount = webs.reduce((n, w) => n + w.connections.length, 0);

  return {
    source: {
      key: sourceKey,
      id: sourceId,
      title: sourceTitle,
      description: ontology.description || '',
      iri: ontology.iri || null,
      versionIri: ontology.versionIri || null,
      version: ontology.version || null,
      license: ontology.license || null,
      homepage: ontology.homepage || null,
      date: ontology.date || null,
      format: index.format || null,
      fileName: sourceName,
      importedAt,
      folderWebId,
      folderMembers,
      roots: slice.roots || [],
    },
    things,
    webs,
    relationTypes: [...relationTypes.values()].sort((a, b) => (a.iri < b.iri ? -1 : 1)),
    report: {
      things: things.length,
      typed: typeOf.size,
      compositionWebs: webs.length,
      connections: connectionCount,
      relationTypes: relationTypes.size,
      relationsKeptAsData: things.reduce((n, t) => n + t.relations.length, 0),
      folderMembers: folderMembers.length,
      missingRoots: slice.missingRoots || [],
      ambiguousRoots: slice.ambiguousRoots || [],
      slice: slice.counts || {},
      parse: index.stats || {},
    },
  };
}
