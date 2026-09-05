/**
 * mergeUniverses(base, incoming, options) → { merged, report }
 *
 * Pure function — no store access. Unions two Redstring store states.
 *
 * `base` is the DESTINATION: the universe the result lives in, and the source
 * of truth wherever a conflict is unavoidable.
 *
 * This is deliberately a union, not a reconciliation. Duplicates are allowed to
 * come through and are resolved later, in one deliberate pass in the things-
 * merge UI — a merge should not be quietly deciding which of two descriptions
 * of the world is correct. Three alignment classes for prototypes:
 *
 *   1. Exact ID match         → the SAME entity, and two entries cannot share
 *                               one Map key, so this one must resolve: fields
 *                               union, base wins conflicting scalars, and the
 *                               losing value is banked in _preserved.merge.
 *   2. externalLinks overlap  → owl:sameAs / skos:exactMatch. Folded only when
 *                               `foldSameAs` is set; otherwise both are kept
 *                               and reported in report.sameAsCandidates.
 *   3. Case-insensitive name  → never merged. A shared name is not evidence of
 *                               a shared referent; listed in
 *                               report.closeMatchCandidates for review.
 *
 * Edges and edge prototypes are set-unioned by ID (identical IDs → base wins).
 * Graphs with the same ID on both sides have their CONTENTS unioned (instances,
 * groups, edgeIds) with base winning on graph scalars — dropping the incoming
 * side outright would throw away half of the case this exists for, two forks of
 * one universe where the shared graphs are where both sides did their work.
 *
 * Because class 2 folds an incoming prototype into a base one, every incoming
 * reference to a prototype (instance.prototypeId, graph.definingNodeIds,
 * edge.typeNodeId/definitionNodeIds, proto.typeNodeId, abstractionChains, the
 * saved sets) is rewritten through a remap. Edge sourceId/destinationId are
 * INSTANCE ids and are deliberately left alone.
 *
 * No-silent-loss invariant: every scalar value dropped in a conflict is
 * written to the winning prototype's _preserved.merge object.
 *
 * P5.4 (FORMAT_REFACTOR_PLAN §5).
 */

// Scalar fields on a prototype that can conflict during merge.
// imageRef/imageRefExt merge as scalars like the image fields they stand in
// for. This is where content-addressing pays off twice: a conflicting image
// used to bank a SECOND full base64 copy into _preserved.merge (and concat
// another on every re-merge), whereas two conflicting refs bank 71 characters
// and both blobs already exist in the repo, addressed by their own content.
const SCALAR_FIELDS = ['name', 'description', 'color', 'imageSrc', 'thumbnailSrc', 'imageAspectRatio', 'imageRef', 'imageRefExt'];

// Build externalLink-URL → Set<prototypeId> reverse index.
function buildSameAsIndex(prototypes) {
  const idx = new Map();
  for (const [id, proto] of prototypes) {
    for (const url of (proto.externalLinks || [])) {
      if (!idx.has(url)) idx.set(url, new Set());
      idx.get(url).add(id);
    }
  }
  return idx;
}

/**
 * Merge semanticMetadata, following the field rules mergeNodePrototypes already
 * settled on in graphStore (externalLinks union, relationships concat, max
 * confidence). Dropping this wholesale used to lose linkConfirmations, which is
 * what drives the skos:exactMatch / skos:closeMatch ladder on the next export —
 * so a merge silently degraded semantic identity.
 */
function mergeSemanticMetadata(base, incoming) {
  if (!base && !incoming) return undefined;
  if (!base) return incoming;
  if (!incoming) return base;

  const result = { ...base, ...incoming, ...base };

  const links = new Set([...(base.externalLinks || []), ...(incoming.externalLinks || [])]);
  if (links.size) result.externalLinks = [...links];

  const relationships = [...(base.relationships || []), ...(incoming.relationships || [])];
  if (relationships.length) result.relationships = relationships;

  const bc = typeof base.confidence === 'number' ? base.confidence : null;
  const ic = typeof incoming.confidence === 'number' ? incoming.confidence : null;
  if (bc !== null || ic !== null) result.confidence = Math.max(bc ?? -Infinity, ic ?? -Infinity);

  if (base.linkConfirmations || incoming.linkConfirmations) {
    result.linkConfirmations = { ...(incoming.linkConfirmations || {}), ...(base.linkConfirmations || {}) };
  }

  return result;
}

// Merge two prototype objects. Base wins on scalar conflicts; incoming
// conflict values are recorded in _preserved.merge (no-silent-loss).
function mergePrototype(base, incoming) {
  const result = { ...base };
  const preserved = { ...(base._preserved?.merge || {}) };
  let anyConflict = false;

  for (const field of SCALAR_FIELDS) {
    const bv = base[field];
    const iv = incoming[field];
    if (iv !== undefined && iv !== null && iv !== bv) {
      // Base wins. Incoming value banked to _preserved.merge.
      const existing = preserved[field];
      preserved[field] = existing !== undefined ? [].concat(existing, iv) : iv;
      anyConflict = true;
    }
  }

  // Array fields: set-union.
  result.externalLinks = [
    ...new Set([...(base.externalLinks || []), ...(incoming.externalLinks || [])]),
  ];
  result.definitionGraphIds = [
    ...new Set([...(base.definitionGraphIds || []), ...(incoming.definitionGraphIds || [])]),
  ];

  const semantic = mergeSemanticMetadata(base.semanticMetadata, incoming.semanticMetadata);
  if (semantic !== undefined) result.semanticMetadata = semantic;

  // abstractionChains is { [dimension]: orderedPrototypeIds[] }. The array is a
  // chain (generic → specific), so a set-union would silently invent an order
  // neither side asserted. Take incoming's only for a dimension base doesn't
  // have; where both have one, base wins and incoming's is banked.
  const bChains = base.abstractionChains;
  const iChains = incoming.abstractionChains;
  if (bChains || iChains) {
    const chains = { ...(bChains || {}) };
    const bankedChains = { ...(preserved.abstractionChains || {}) };
    let chainConflict = false;
    for (const [dimension, chain] of Object.entries(iChains || {})) {
      if (!chains[dimension]) {
        chains[dimension] = chain;
      } else if (JSON.stringify(chains[dimension]) !== JSON.stringify(chain)) {
        const existing = bankedChains[dimension];
        bankedChains[dimension] = existing !== undefined ? [].concat(existing, [chain]) : [chain];
        chainConflict = true;
      }
    }
    result.abstractionChains = chains;
    if (chainConflict) {
      preserved.abstractionChains = bankedChains;
      anyConflict = true;
    }
  }

  if (anyConflict) {
    result._preserved = { ...(base._preserved || {}), merge: preserved };
  }
  return result;
}

/**
 * Rewrite a prototype ID through the sameAs remap.
 *
 * Class-2 folds an incoming prototype into a base one and never adds the
 * incoming ID, so anything still pointing at that ID would dangle. Every
 * incoming reference to a PROTOTYPE has to come through here.
 */
const remapId = (remap, id) => (id != null && remap.has(id) ? remap.get(id) : id);

const remapIdList = (remap, ids) =>
  Array.isArray(ids) ? ids.map((id) => remapId(remap, id)) : ids;

// Rewrite prototype references inside one incoming graph. Instances carry a
// prototypeId; the graph itself carries definingNodeIds.
function remapGraph(remap, graph) {
  if (!remap.size) return graph;
  const result = { ...graph };

  if (graph.instances instanceof Map) {
    const instances = new Map();
    for (const [instanceId, instance] of graph.instances) {
      instances.set(instanceId, instance?.prototypeId != null
        ? { ...instance, prototypeId: remapId(remap, instance.prototypeId) }
        : instance);
    }
    result.instances = instances;
  }

  if (Array.isArray(graph.definingNodeIds)) {
    result.definingNodeIds = remapIdList(remap, graph.definingNodeIds);
  }

  return result;
}

// Rewrite prototype references inside one incoming edge. sourceId and
// destinationId are INSTANCE ids (graphStore.js:4044), not prototype ids —
// remapping those would corrupt the edge.
function remapEdge(remap, edge) {
  if (!remap.size) return edge;
  const result = { ...edge };
  if (edge.typeNodeId != null) result.typeNodeId = remapId(remap, edge.typeNodeId);
  if (Array.isArray(edge.definitionNodeIds)) {
    result.definitionNodeIds = remapIdList(remap, edge.definitionNodeIds);
  }
  return result;
}

/**
 * Union two versions of the same graph.
 *
 * "Base wins" used to drop the incoming graph outright, which is wrong for the
 * case this feature exists to serve: two forks of one universe, where the
 * shared graphs are exactly where both sides did their work. Base still wins on
 * graph scalars (name, description, colour, viewport) — only the contents union.
 */
function mergeGraph(base, incoming) {
  const result = { ...base };

  if (base.instances instanceof Map || incoming.instances instanceof Map) {
    const instances = new Map(base.instances instanceof Map ? base.instances : []);
    if (incoming.instances instanceof Map) {
      for (const [instanceId, instance] of incoming.instances) {
        if (!instances.has(instanceId)) instances.set(instanceId, instance);
      }
    }
    result.instances = instances;
  }

  if (base.groups instanceof Map || incoming.groups instanceof Map) {
    const groups = new Map(base.groups instanceof Map ? base.groups : []);
    if (incoming.groups instanceof Map) {
      for (const [groupId, group] of incoming.groups) {
        if (!groups.has(groupId)) groups.set(groupId, group);
      }
    }
    result.groups = groups;
  }

  result.edgeIds = [...new Set([...(base.edgeIds || []), ...(incoming.edgeIds || [])])];
  result.definingNodeIds = [
    ...new Set([...(base.definingNodeIds || []), ...(incoming.definingNodeIds || [])]),
  ];

  return result;
}

// ---------------------------------------------------------------------------

export function mergeUniverses(base, incoming, options = {}) {
  const { foldSameAs = true } = options;
  const merged = {
    graphs:               new Map(base.graphs     || new Map()),
    nodePrototypes:       new Map(base.nodePrototypes || new Map()),
    edges:                new Map(base.edges      || new Map()),
    // Unioned below. Leaving this out entirely used to dangle the typeNodeId of
    // every incoming edge that used a custom connection type.
    edgePrototypes:       new Map(base.edgePrototypes || new Map()),
    // Copies, not references: these are unioned in place below, and the base
    // is the LIVE store state — pushing onto its own array would mutate it.
    openGraphIds:         [...(base.openGraphIds || [])],
    activeGraphId:        base.activeGraphId      || null,
    expandedGraphIds:     new Set(base.expandedGraphIds || new Set()),
    savedNodeIds:         new Set(base.savedNodeIds || new Set()),
    savedGraphIds:        new Set(base.savedGraphIds || new Set()),
    rightPanelTabs:       base.rightPanelTabs     || [],
    showConnectionNames:  base.showConnectionNames || false,
    activeDefinitionNodeId: base.activeDefinitionNodeId || null,
  };

  const report = {
    dedupedIds:           [],  // exact-ID dedup
    mergedIds:            [],  // [{baseId, incomingId}] sameAs merges (foldSameAs)
    sameAsCandidates:     [],  // [{baseId, incomingId, ...}] kept apart (!foldSameAs)
    addedPrototypeIds:    [],  // brought in whole (new, or a duplicate left standing)
    closeMatchCandidates: [],  // [{baseId, incomingId, baseName, incomingName}]
    addedGraphIds:        [],
    mergedGraphIds:       [],  // same ID on both sides → contents unioned
    addedEdgeIds:         [],
  };

  // incomingPrototypeId → basePrototypeId, populated by class-2 sameAs merges.
  // Everything incoming that references a prototype is rewritten through this.
  const remap = new Map();

  // Live indexes (updated as prototypes are added).
  const sameAsIdx  = buildSameAsIndex(merged.nodePrototypes);
  const nameIdx    = new Map(); // normalizedName → prototypeId
  for (const [id, p] of merged.nodePrototypes) {
    const key = (p.name || '').toLowerCase().trim();
    if (key) nameIdx.set(key, id);
  }

  // -- Prototype merge --
  for (const [iid, iproto] of (incoming.nodePrototypes || new Map())) {

    // Class 1: exact ID match.
    if (merged.nodePrototypes.has(iid)) {
      merged.nodePrototypes.set(iid, mergePrototype(merged.nodePrototypes.get(iid), iproto));
      report.dedupedIds.push(iid);
      continue;
    }

    // Class 2: externalLinks intersection (owl:sameAs / skos:exactMatch).
    let sameAsBaseId = null;
    for (const url of (iproto.externalLinks || [])) {
      const hits = sameAsIdx.get(url);
      if (hits?.size > 0) { sameAsBaseId = [...hits][0]; break; }
    }

    if (sameAsBaseId && foldSameAs) {
      const winner = mergePrototype(merged.nodePrototypes.get(sameAsBaseId), iproto);
      merged.nodePrototypes.set(sameAsBaseId, winner);
      // Keep the sameAs index current.
      for (const url of (iproto.externalLinks || [])) {
        if (!sameAsIdx.has(url)) sameAsIdx.set(url, new Set());
        sameAsIdx.get(url).add(sameAsBaseId);
      }
      remap.set(iid, sameAsBaseId);
      report.mergedIds.push({ baseId: sameAsBaseId, incomingId: iid });
      continue;
    }

    if (sameAsBaseId) {
      // Folding is off: both survive, and the pairing is handed to the
      // things-merge UI to settle rather than being decided here.
      report.sameAsCandidates.push({
        baseId:       sameAsBaseId,
        incomingId:   iid,
        baseName:     merged.nodePrototypes.get(sameAsBaseId)?.name,
        incomingName: iproto.name,
      });
    }

    // Class 3: case-insensitive name match → candidate, but still add.
    const ikey = (iproto.name || '').toLowerCase().trim();
    if (ikey && nameIdx.has(ikey)) {
      const bId = nameIdx.get(ikey);
      report.closeMatchCandidates.push({
        baseId:       bId,
        incomingId:   iid,
        baseName:     merged.nodePrototypes.get(bId)?.name,
        incomingName: iproto.name,
      });
    }

    // Add prototype (either new or name-collision candidate).
    merged.nodePrototypes.set(iid, iproto);
    report.addedPrototypeIds.push(iid);
    if (ikey && !nameIdx.has(ikey)) nameIdx.set(ikey, iid);
    for (const url of (iproto.externalLinks || [])) {
      if (!sameAsIdx.has(url)) sameAsIdx.set(url, new Set());
      sameAsIdx.get(url).add(iid);
    }
  }

  // Prototypes reference other prototypes (typeNodeId, abstractionChains), and
  // a chain can name a prototype that was still unprocessed when the chain was
  // merged. So the remap is applied in one pass here, after every class-2 fold
  // is known, rather than inline above.
  if (remap.size) {
    for (const [pid, proto] of merged.nodePrototypes) {
      let next = proto;
      if (proto?.typeNodeId != null && remap.has(proto.typeNodeId)) {
        next = { ...next, typeNodeId: remap.get(proto.typeNodeId) };
      }
      if (proto?.abstractionChains) {
        const chains = {};
        for (const [dimension, chain] of Object.entries(proto.abstractionChains)) {
          chains[dimension] = remapIdList(remap, chain);
        }
        next = { ...next, abstractionChains: chains };
      }
      if (next !== proto) merged.nodePrototypes.set(pid, next);
    }
  }

  // -- Graphs: new ones added, shared ones unioned (base wins on scalars) --
  for (const [gid, graph] of (incoming.graphs || new Map())) {
    const remapped = remapGraph(remap, graph);
    if (merged.graphs.has(gid)) {
      merged.graphs.set(gid, mergeGraph(merged.graphs.get(gid), remapped));
      report.mergedGraphIds.push(gid);
    } else {
      merged.graphs.set(gid, remapped);
      report.addedGraphIds.push(gid);
    }
  }

  // -- Edges: set-union (identical ID → base wins) --
  for (const [eid, edge] of (incoming.edges || new Map())) {
    if (!merged.edges.has(eid)) {
      merged.edges.set(eid, remapEdge(remap, edge));
      report.addedEdgeIds.push(eid);
    }
  }

  // -- Edge prototypes: set-union (identical ID → base wins) --
  for (const [epid, edgeProto] of (incoming.edgePrototypes || new Map())) {
    if (!merged.edgePrototypes.has(epid)) merged.edgePrototypes.set(epid, edgeProto);
  }

  // -- Open webs: union, base's first then the incoming ones appended.
  //
  // Which webs are open is not session chrome to be discarded — it is the
  // shape the universe is actually experienced in, and dropping it loses the
  // arrangement of the side being merged in while keeping every one of its
  // webs. Base's order is preserved so the tabs you were working in stay put
  // and the incoming ones arrive after them. --
  for (const gid of (incoming.openGraphIds || [])) {
    if (!merged.openGraphIds.includes(gid)) merged.openGraphIds.push(gid);
  }
  for (const gid of (incoming.expandedGraphIds || new Set())) {
    merged.expandedGraphIds.add(gid);
  }

  // -- Saved sets: union. These are the user's own saved items, so a merge that
  // kept only base's would quietly unsave everything the incoming side had. --
  for (const id of (incoming.savedNodeIds || new Set())) merged.savedNodeIds.add(remapId(remap, id));
  // savedGraphIds is keyed by DEFINING PROTOTYPE id, not graph id (graphStore.js:1272),
  // so it remaps like a prototype reference.
  for (const id of (incoming.savedGraphIds || new Set())) merged.savedGraphIds.add(remapId(remap, id));

  return { merged, report };
}
