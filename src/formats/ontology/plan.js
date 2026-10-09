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
 *  - Composition becomes webs. A relation whose name says one end is inside
 *    the other (part of, has part, located in, disease has location, composed
 *    of: vocab.js compositionalClue, read case-insensitively) places that end
 *    in the other's web: Pneumonia, located in the Lung, is placed in Lung's
 *    web. Relations between parts of the same whole are drawn there too.
 *
 *  - Every relation is drawn as a connection, whatever it is. A Thing with
 *    relations gets a web of its connections: the Thing itself, what it relates
 *    to, and a connection from it for each relation (Pneumonia → Disease Has
 *    Location → Lung). It's a declared sort of web, the one sort that holds its
 *    own Thing, since its members are what the Thing is defined against rather
 *    than parts of it. That's what lets every Thing's connections be found from
 *    either end. A relation whose other end isn't in the import is kept on the
 *    Thing as data.
 *
 *  - A Thing with more specific kinds gets a web of its kinds.
 *    A kind is a subset of the set its Thing names, so this is composition
 *    too, of the set rather than of the object; it's what makes a source that
 *    is only a tree of kinds (Mondo, most of ChEBI) walkable by opening Things.
 *    Every direct kind inside the slice is placed, whichever parent is its type.
 *
 *  - A Thing opens to its parts first, then its connections, then its kinds.
 *
 *  - The source becomes one Thing (named after the ontology) whose web is a
 *    declared folder: the roots that were asked for, or the slice's top kinds.
 *    That Thing is saved and its web is opened; nothing else is saved, and
 *    every imported Thing stays alive through its link to the source Thing.
 */

import { v5 as uuidv5 } from 'uuid';
import { compositionOf } from './slice.js';
import { namespaceOf } from './vocab.js';

/** Namespace for every ID the importer derives. Never change it: IDs in saved files depend on it. */
export const IMPORT_NAMESPACE = 'acebeb60-775d-4791-8f11-b7907ba203ea';

export const importIds = {
  thing: (iri) => uuidv5(iri, IMPORT_NAMESPACE),
  source: (sourceKey) => uuidv5(`source|${sourceKey}`, IMPORT_NAMESPACE),
  folderWeb: (sourceKey) => uuidv5(`folder|${sourceKey}`, IMPORT_NAMESPACE),
  compositionWeb: (sourceKey, wholeIri) => uuidv5(`composition|${sourceKey}|${wholeIri}`, IMPORT_NAMESPACE),
  kindsWeb: (sourceKey, iri) => uuidv5(`kinds|${sourceKey}|${iri}`, IMPORT_NAMESPACE),
  connectionsWeb: (sourceKey, iri) => uuidv5(`connections|${sourceKey}|${iri}`, IMPORT_NAMESPACE),
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

const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'via', 'with']);

/**
 * "disease of cellular proliferation" → "Disease of Cellular Proliferation".
 * Only words written all in lower case change, so names whose case carries
 * meaning (pH, mRNA, BRCA1, alpha-D-glucose, (2S)-...) are left as they are.
 */
export function titleCaseName(str) {
  let first = true;
  return String(str || '').replace(/\S+/g, (w) => {
    const isFirst = first;
    first = false;
    if (!/^[a-z][^A-Z]*$/.test(w)) return w;
    if (!isFirst && MINOR_WORDS.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
}


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
 * @param {boolean} [options.titleCase=true] - Title Case names; false keeps the source's own labels
 * @param {boolean} [options.kindsWebs=true] - give each Thing with more specific kinds a web of them
 * @returns {Object} the plan
 */
export function buildImportPlan(index, slice, options = {}) {
  const { sourceName = null, importedAt = null, titleCase: useTitleCase = true, kindsWebs = true } = options;
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
  // A relation whose name says one end is inside the other (part of, has part,
  // located in, disease has location, composed of: vocab.js compositionalClue)
  // places that end in the other's web.
  const clue = compositionOf(index);
  const partsOf = new Map(); // whole iri → Set<part iri>
  const addPart = (whole, part) => {
    if (whole === part || !iris.has(whole) || !iris.has(part)) return;
    let set = partsOf.get(whole);
    if (!set) { set = new Set(); partsOf.set(whole, set); }
    set.add(part);
  };
  for (const iri of sortedIris) {
    for (const rel of index.terms.get(iri)?.relations || []) {
      const inside = clue(rel.property);
      if (inside === 'in-subject') addPart(iri, rel.target);
      else if (inside === 'in-object') addPart(rel.target, iri);
    }
  }

  const relationLabel = (property) => {
    const label = index.properties.get(property)?.label || index.terms.get(property)?.label;
    if (!useTitleCase) return label || localName(property);
    return titleCase(label || localName(property));
  };

  const relationTypes = new Map(); // property iri → { iri, id, name }
  const addRelationType = (property) => {
    if (!relationTypes.has(property)) {
      relationTypes.set(property, { iri: property, id: importIds.thing(property), name: relationLabel(property) });
    }
  };
  /** A relation that can be drawn: both ends are Things of this import, and they're two. */
  const drawable = (iri, rel) => rel.target !== iri && iris.has(rel.target);

  const webs = [];
  for (const whole of [...partsOf.keys()].sort()) {
    const parts = [...partsOf.get(whole)].sort();
    const partSet = new Set(parts);
    const connections = [];
    for (const a of parts) {
      for (const rel of index.terms.get(a)?.relations || []) {
        if (!partSet.has(rel.target) || rel.target === a) continue;
        // Being in this web already says one is inside the other; a part with
        // its own parts gets its own web. Neither is drawn here between parts.
        if (clue(rel.property)) continue;
        connections.push({ source: a, property: rel.property, target: rel.target });
        addRelationType(rel.property);
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

  // ── Connections ───────────────────────────────────────────────────────────
  // Every relation is drawn, whatever it is: a Thing's web of connections holds
  // the Thing itself and what it relates to, with each relation as a connection
  // from it. A compositional relation is drawn here too, as well as placing its
  // inner end in the other's web.
  const connectionsWebList = [];
  for (const iri of sortedIris) {
    const rels = (index.terms.get(iri)?.relations || []).filter((rel) => drawable(iri, rel));
    if (rels.length === 0) continue;
    for (const rel of rels) addRelationType(rel.property);
    connectionsWebList.push({
      id: importIds.connectionsWeb(sourceKey, iri),
      kind: 'connections',
      whole: iri,
      members: [iri, ...[...new Set(rels.map((rel) => rel.target))].sort()],
      connections: rels.map((rel) => ({ source: iri, property: rel.property, target: rel.target })),
    });
  }
  const connectionsWebOf = new Map(connectionsWebList.map((w) => [w.whole, w.id]));

  // ── Kinds ─────────────────────────────────────────────────────────────────
  const kindsOf = new Map(); // iri → its direct, more specific kinds in the slice
  if (kindsWebs) {
    for (const iri of sortedIris) {
      for (const p of index.terms.get(iri)?.parents || []) {
        if (p === iri || !iris.has(p)) continue;
        let list = kindsOf.get(p);
        if (!list) { list = []; kindsOf.set(p, list); }
        list.push(iri); // sortedIris order, so each list is already sorted
      }
    }
  }
  const kindsWebList = [...kindsOf.keys()].sort().map((iri) => ({
    id: importIds.kindsWeb(sourceKey, iri),
    kind: 'kinds',
    whole: iri,
    members: [...new Set(kindsOf.get(iri))],
    connections: [],
  }));

  // ── The folder ────────────────────────────────────────────────────────────
  let folderMembers;
  if (slice.roots && slice.roots.length > 0) {
    folderMembers = slice.roots.filter((r) => iris.has(r));
  } else {
    // The source's own top kinds: not what rode along with the selection, nor
    // the Things from other ontologies it only refers to (full Mondo names
    // species, genes and anatomy, many with no kind above them in the file).
    const selected = slice.selected || iris;
    const namespaceCounts = new Map();
    for (const iri of selected) {
      const ns = namespaceOf(iri);
      namespaceCounts.set(ns, (namespaceCounts.get(ns) || 0) + 1);
    }
    const own = [...namespaceCounts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    let tops = sortedIris.filter((iri) => !typeOf.has(iri) && selected.has(iri));
    const ownTops = tops.filter((iri) => namespaceOf(iri) === own);
    if (ownTops.length > 0) tops = ownTops;
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
    const label = term.label || localName(iri);
    const name = useTitleCase ? titleCaseName(label) : label;
    return {
      iri,
      id: importIds.thing(iri),
      name,
      // The source's own label, kept when the name differs from it.
      label: name !== label ? label : null,
      description: term.definition || '',
      kind: term.kind,
      typeIri: type,
      // Labels ride along so the data reads on its own, without the index.
      otherParents: term.parents.filter((p) => p !== type).map((p) => ({ iri: p, label: labelOf(p) })),
      // Only what can't be drawn (its other end isn't in this import) stays as data.
      relations: term.relations.filter((r) => !drawable(iri, r)).map((r) => ({
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
      connectionsWebId: connectionsWebOf.get(iri) || null,
      kindsWebId: kindsOf.has(iri) ? importIds.kindsWeb(sourceKey, iri) : null,
    };
  });

  const allWebs = [...webs, ...connectionsWebList, ...kindsWebList];
  const connectionCount = allWebs.reduce((n, w) => n + w.connections.length, 0);

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
    webs: allWebs,
    relationTypes: [...relationTypes.values()].sort((a, b) => (a.iri < b.iri ? -1 : 1)),
    report: {
      things: things.length,
      typed: typeOf.size,
      compositionWebs: webs.length,
      connectionsWebs: connectionsWebList.length,
      kindsWebs: kindsWebList.length,
      connections: connectionCount,
      relationTypes: relationTypes.size,
      relationsKeptAsData: things.reduce((n, t) => n + t.relations.length, 0),
      folderMembers: folderMembers.length,
      // Every Thing placed in a web, the folder included: with the Things, what sets the file's size.
      placements: folderMembers.length + allWebs.reduce((n, w) => n + w.members.length, 0),
      missingRoots: slice.missingRoots || [],
      ambiguousRoots: slice.ambiguousRoots || [],
      slice: slice.counts || {},
      parse: index.stats || {},
    },
  };
}
