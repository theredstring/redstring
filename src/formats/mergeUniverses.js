/**
 * mergeUniverses(base, incoming) → { merged, report }
 *
 * Pure function — no store access. Merges two Redstring store states using
 * three alignment classes for prototypes:
 *
 *   1. Exact ID match         → same entity; fields union; conflicting
 *                               scalars preserved in _preserved.merge.
 *   2. externalLinks overlap  → treated as owl:sameAs / skos:exactMatch
 *                               equivalence; same merge rules as above.
 *   3. Case-insensitive name  → NOT merged; listed in
 *                               report.closeMatchCandidates for the UI.
 *
 * Named graphs and edges are set-unioned by ID (identical IDs → base wins).
 *
 * No-silent-loss invariant: every scalar value dropped in a conflict is
 * written to the winning prototype's _preserved.merge object.
 *
 * P5.4 (FORMAT_REFACTOR_PLAN §5).
 */

// Scalar fields on a prototype that can conflict during merge.
const SCALAR_FIELDS = ['name', 'description', 'color', 'imageSrc', 'thumbnailSrc', 'imageAspectRatio'];

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

  if (anyConflict) {
    result._preserved = { ...(base._preserved || {}), merge: preserved };
  }
  return result;
}

// ---------------------------------------------------------------------------

export function mergeUniverses(base, incoming) {
  const merged = {
    graphs:               new Map(base.graphs     || new Map()),
    nodePrototypes:       new Map(base.nodePrototypes || new Map()),
    edges:                new Map(base.edges      || new Map()),
    openGraphIds:         base.openGraphIds       || [],
    activeGraphId:        base.activeGraphId      || null,
    expandedGraphIds:     base.expandedGraphIds   || new Set(),
    savedNodeIds:         base.savedNodeIds       || new Set(),
    savedGraphIds:        base.savedGraphIds      || new Set(),
    rightPanelTabs:       base.rightPanelTabs     || [],
    showConnectionNames:  base.showConnectionNames || false,
    activeDefinitionNodeId: base.activeDefinitionNodeId || null,
  };

  const report = {
    dedupedIds:           [],  // exact-ID dedup
    mergedIds:            [],  // [{baseId, incomingId}] sameAs merges
    closeMatchCandidates: [],  // [{baseId, incomingId, baseName, incomingName}]
    addedGraphIds:        [],
    addedEdgeIds:         [],
  };

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

    if (sameAsBaseId) {
      const winner = mergePrototype(merged.nodePrototypes.get(sameAsBaseId), iproto);
      merged.nodePrototypes.set(sameAsBaseId, winner);
      // Keep the sameAs index current.
      for (const url of (iproto.externalLinks || [])) {
        if (!sameAsIdx.has(url)) sameAsIdx.set(url, new Set());
        sameAsIdx.get(url).add(sameAsBaseId);
      }
      report.mergedIds.push({ baseId: sameAsBaseId, incomingId: iid });
      continue;
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
    if (ikey && !nameIdx.has(ikey)) nameIdx.set(ikey, iid);
    for (const url of (iproto.externalLinks || [])) {
      if (!sameAsIdx.has(url)) sameAsIdx.set(url, new Set());
      sameAsIdx.get(url).add(iid);
    }
  }

  // -- Graphs: set-union (identical ID → base wins) --
  for (const [gid, graph] of (incoming.graphs || new Map())) {
    if (!merged.graphs.has(gid)) {
      merged.graphs.set(gid, graph);
      report.addedGraphIds.push(gid);
    }
  }

  // -- Edges: set-union (identical ID → base wins) --
  for (const [eid, edge] of (incoming.edges || new Map())) {
    if (!merged.edges.has(eid)) {
      merged.edges.set(eid, edge);
      report.addedEdgeIds.push(eid);
    }
  }

  return { merged, report };
}
