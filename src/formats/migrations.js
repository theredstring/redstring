/**
 * Redstring format migration ledger (decision D2 of the v3→v4 refactor).
 *
 * A single, append-only, ORDERED list of pure migration steps. `runMigrations`
 * walks from a file's detected version up to the current version, applying each
 * step in order, then guarantees the canonical top-level shape so the importer
 * never has to branch on which sections to read.
 *
 * Rules for this file (see FORMAT_REFACTOR_PLAN.md §0):
 *   - Migration functions are PURE: no I/O, no store access, no `Date.now()`
 *     (timestamps are injected via the `now` argument).
 *   - Never edit a shipped step's behavior — append a new step instead.
 *   - This module must not import from redstringFormat.js (would be circular);
 *     it is intentionally self-contained.
 */

// Normalize a version string ("redstring-v2.0.0-semantic" / "2.0.0-semantic")
// to its detected form, and to a coarse integer "stage" (major version) used to
// decide which steps still need to run. Stage is robust to suffix variants like
// "2.0.0" vs "2.0.0-semantic".
const stripPrefix = (v) =>
  typeof v === 'string' && v.startsWith('redstring-v') ? v.replace('redstring-v', '') : v;

export const detectFormatVersion = (data) =>
  stripPrefix(data?.format || data?.metadata?.version || '1.0.0');

const stageOf = (version) => {
  const major = parseInt(String(stripPrefix(version)), 10);
  return Number.isFinite(major) ? major : 1;
};

// Prefer structuredClone (preserves Infinity/NaN/undefined) over a JSON clone,
// which would silently coerce them. Falls back to JSON only on ancient runtimes.
const clone = (data) =>
  typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data));

/**
 * Guarantee the canonical top-level sections exist and are populated, drawing
 * from (in priority order) the canonical sections, the legacy block, or the v1
 * flat top-level. Idempotent: a fully-canonical document is returned unchanged.
 *
 * This is what lets `importFromRedstring` read a single shape — the historical
 * three-way "prototypeSpace vs legacy vs flat" branch lives here now.
 */
export const ensureCanonicalSections = (data) => {
  if (data?.prototypeSpace?.prototypes && data?.spatialGraphs?.graphs) {
    return data; // already canonical — leave verbatim
  }

  const prototypes =
    data?.prototypeSpace?.prototypes || data?.legacy?.nodePrototypes || data?.nodePrototypes || {};
  const graphs =
    data?.spatialGraphs?.graphs || data?.legacy?.graphs || data?.graphs || {};
  const edges =
    data?.relationships?.edges || data?.legacy?.edges || data?.edges || {};

  return {
    ...data,
    prototypeSpace: { ...(data?.prototypeSpace || {}), prototypes },
    spatialGraphs: { ...(data?.spatialGraphs || {}), graphs },
    relationships: { ...(data?.relationships || {}), edges }
  };
};

/**
 * Quarantine whitelists (decision D1). "Known" keys are the union of what the
 * exporter emits and what the importer reads for each entity type, across both
 * the semantic (redstring:/rdfs:/owl:) and legacy-flat spellings. Any top-level
 * key on an entity that is NOT here is treated as unknown future data and moved
 * verbatim into that entity's `_preserved[detectedVersion]` bag rather than
 * dropped. Only top-level entity keys are inspected — nested objects are opaque.
 *
 * Append a key here when the exporter/importer starts consuming it; never remove
 * one (that would start quarantining data older files legitimately carry).
 */
export const KNOWN_ROOT_KEYS = new Set([
  '@context', '@type', '@id', 'format', 'metadata',
  'prototypeSpace', 'spatialGraphs', 'relationships',
  'graphs', 'nodePrototypes', 'edges',          // duplicate top-level mirrors (until P1.5)
  'globalSpatialContext', 'userInterface', 'legacy',
  'graphLayouts', 'graphSummaries', '_preserved'
]);

export const KNOWN_PROTOTYPE_KEYS = new Set([
  // semantic (emitted)
  '@type', '@id', 'rdfs:label', 'rdfs:comment', 'name', 'description',
  'rdfs:seeAlso', 'rdfs:isDefinedBy', 'rdfs:subClassOf',
  'owl:sameAs', 'owl:equivalentClass',
  'redstring:spatialContext', 'redstring:visualProperties',
  'redstring:definitionGraphIds', 'redstring:bio', 'redstring:conjugation',
  'redstring:typeNodeId', 'redstring:citations', 'redstring:cognitiveProperties',
  'redstring:abstractionChains', 'redstring:agentConfig', 'redstring:semanticMetadata',
  // SKOS + PROV emitted by Phase 2 (P2.4/P2.5/P2.6) — recognized, not quarantined
  'skos:prefLabel', 'skos:altLabel', 'skos:inScheme', 'skos:broader',
  'skos:closeMatch', 'skos:exactMatch',
  'prov:wasAttributedTo', 'prov:generatedAtTime',
  // legacy flat (read)
  'id', 'x', 'y', 'scale', 'color', 'imageSrc', 'thumbnailSrc', 'imageAspectRatio',
  'semanticMetadata', 'externalLinks', 'equivalentClasses', 'citations',
  'definitionGraphIds', 'bio', 'conjugation', 'typeNodeId', 'abstractionChains',
  'personalMeaning', 'cognitiveAssociations', 'agentConfig',
  // ancient legacy nested groupings (read via destructure)
  'spatial', 'media', 'cognitive', 'semantic',
  '_preserved'
]);

export const KNOWN_INSTANCE_KEYS = new Set([
  // semantic (emitted)
  '@type', '@id', 'rdf:type', 'rdfs:label', 'rdfs:comment',
  'redstring:containedIn', 'redstring:spatialContext', 'redstring:visualProperties',
  'redstring:prototypeId', 'redstring:isGroupAnchor', 'redstring:anchorForGroupId',
  // legacy flat (read)
  'id', 'prototypeId', 'name', 'description', 'x', 'y', 'scale',
  'expanded', 'visible', 'isGroupAnchor', 'anchorForGroupId',
  '_preserved'
]);

export const KNOWN_GRAPH_KEYS = new Set([
  // semantic (emitted)
  '@type', '@id', 'rdfs:label', 'rdfs:comment',
  'redstring:definingNodeIds', 'redstring:edgeIds', 'redstring:panOffset',
  'redstring:zoomLevel', 'redstring:instances', 'redstring:groups',
  'redstring:visualProperties',
  // legacy flat (read)
  'id', 'name', 'description', 'definingNodeIds', 'edgeIds', 'instances',
  'groups', 'panOffset', 'zoomLevel',
  '_preserved'
]);

export const KNOWN_EDGE_KEYS = new Set([
  // dual native+RDF format (emitted/read)
  'id', 'sourceId', 'destinationId', 'name', 'description', 'typeNodeId',
  'definitionNodeIds', 'directionality', 'rdfStatements',
  'sourcePrototypeId', 'destinationPrototypeId', 'predicatePrototypeId',
  // old RDF Statement format (read)
  '@type', 'subject', 'predicate', 'object', 'originalSourceId', 'originalDestinationId',
  // PROV emitted by P2.6 for wizard-authored edges
  'prov:wasAttributedTo', 'prov:generatedAtTime',
  '_preserved'
]);

/**
 * Split one entity's top-level keys into known (kept) and unknown (moved into
 * `_preserved[version]`). Returns the SAME reference when nothing is unknown;
 * otherwise a new object sharing value references (no deep clone, so Infinity/
 * NaN survive). Any pre-existing `_preserved` bag is merged, not overwritten.
 */
const quarantineKeys = (entity, knownKeys, version) => {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return entity;

  const kept = {};
  const unknown = {};
  let hasUnknown = false;
  for (const [key, value] of Object.entries(entity)) {
    if (key === '_preserved') continue; // handled below
    if (knownKeys.has(key)) kept[key] = value;
    else { unknown[key] = value; hasUnknown = true; }
  }

  const existing = entity._preserved && typeof entity._preserved === 'object' ? entity._preserved : null;
  if (!hasUnknown) return entity; // nothing to move — leave verbatim

  return {
    ...kept,
    _preserved: {
      ...(existing || {}),
      [version]: { ...((existing && existing[version]) || {}), ...unknown }
    }
  };
};

/**
 * Walk the canonical structure and quarantine unknown top-level keys on the file
 * root, every prototype, graph, instance, and edge. Pure: builds fresh container
 * objects, never mutates the input, shares leaf values.
 */
export const quarantineUnknownFields = (data, version) => {
  if (!data || typeof data !== 'object') return data;

  let out = quarantineKeys(data, KNOWN_ROOT_KEYS, version);
  if (out === data) out = { ...data }; // ensure we never mutate the caller's object

  if (out.prototypeSpace?.prototypes && typeof out.prototypeSpace.prototypes === 'object') {
    const next = {};
    for (const [id, proto] of Object.entries(out.prototypeSpace.prototypes)) {
      next[id] = quarantineKeys(proto, KNOWN_PROTOTYPE_KEYS, version);
    }
    out.prototypeSpace = { ...out.prototypeSpace, prototypes: next };
  }

  if (out.spatialGraphs?.graphs && typeof out.spatialGraphs.graphs === 'object') {
    const nextGraphs = {};
    for (const [gid, graph] of Object.entries(out.spatialGraphs.graphs)) {
      let g = quarantineKeys(graph, KNOWN_GRAPH_KEYS, version);
      for (const instKey of ['redstring:instances', 'instances']) {
        const instances = g?.[instKey];
        if (instances && typeof instances === 'object' && !Array.isArray(instances)) {
          const nextInst = {};
          for (const [iid, instance] of Object.entries(instances)) {
            nextInst[iid] = quarantineKeys(instance, KNOWN_INSTANCE_KEYS, version);
          }
          if (g === graph) g = { ...graph }; // avoid mutating the input graph
          g[instKey] = nextInst;
        }
      }
      nextGraphs[gid] = g;
    }
    out.spatialGraphs = { ...out.spatialGraphs, graphs: nextGraphs };
  }

  if (out.relationships?.edges && typeof out.relationships.edges === 'object') {
    const nextEdges = {};
    for (const [eid, edge] of Object.entries(out.relationships.edges)) {
      nextEdges[eid] = quarantineKeys(edge, KNOWN_EDGE_KEYS, version);
    }
    out.relationships = { ...out.relationships, edges: nextEdges };
  }

  return out;
};

/**
 * The migration ledger. ORDERED and append-only. Each step is pure and reshapes
 * data toward the next version's canonical shape.
 *
 * Historical note on the existing steps:
 *   - 1.0.0 → 2.0.0-semantic was a STRUCTURAL change (flat top-level → separated
 *     prototypeSpace / spatialGraphs / relationships). That reshape is performed
 *     by ensureCanonicalSections, which `runMigrations` applies after the walk.
 *   - 2.0.0-semantic → 3.0.0 was metadata-only (additive versioning fields). The
 *     metadata bookkeeping is centralized in `runMigrations`.
 * Both steps therefore carry no per-step body today; the structure is in place
 * for the future 3.0.0 → 4.0.0 step (P3.3), which will have real reshaping.
 */
export const MIGRATIONS = [
  {
    from: '1.0.0',
    to: '2.0.0-semantic',
    migrate(data) {
      // Flat → separated sections; handled uniformly by ensureCanonicalSections.
      return ensureCanonicalSections(data);
    }
  },
  {
    from: '2.0.0-semantic',
    to: '3.0.0',
    migrate(data) {
      // Additive versioning only — metadata stamped by runMigrations.
      return data;
    }
  }
];

/**
 * Walk the ledger from a file's detected version up to the latest version,
 * applying each not-yet-applied step in order, then canonicalize the shape.
 *
 * @param {Object} data - parsed .redstring document (plain JSON)
 * @param {Object} [opts]
 * @param {string|null} [opts.now] - ISO timestamp to stamp on migrated metadata
 *   (injected for purity/determinism; pass a fixed value in tests)
 * @returns {{ data: Object, applied: string[] }} migrated data and the list of
 *   applied step labels (e.g. ['1.0.0→2.0.0-semantic', '2.0.0-semantic→3.0.0'])
 */
export function runMigrations(data, { now = null } = {}) {
  const startVersion = detectFormatVersion(data);
  const startStage = stageOf(startVersion);
  const steps = MIGRATIONS.filter((step) => startStage < stageOf(step.to));

  // Fast path: no version change. Canonicalize defensively (returns the same
  // reference when already canonical) WITHOUT cloning — this preserves the
  // input verbatim, including non-JSON values like Infinity/NaN that a clone
  // would coerce, and avoids cloning large current-version files on every load.
  // Quarantine still runs so unknown future fields (e.g. a v4 file opened by an
  // older install) survive instead of being dropped.
  if (steps.length === 0) {
    const canonical = ensureCanonicalSections(data);
    return { data: quarantineUnknownFields(canonical, startVersion), applied: [] };
  }

  // Migration path: clone first so step transforms and metadata stamping never
  // mutate the caller's object.
  let working = clone(data);
  const applied = [];
  let finalTo = startVersion;

  for (const step of steps) {
    working = step.migrate(working, { now });
    applied.push(`${step.from}→${step.to}`);
    finalTo = step.to;
  }

  working = ensureCanonicalSections(working);
  working = quarantineUnknownFields(working, startVersion);

  working.metadata = { ...(working.metadata || {}) };
  working.metadata.version = finalTo;
  working.metadata.migrated = true;
  working.metadata.originalVersion = startVersion;
  working.metadata.migrationDate = now;
  working.metadata.migrationsApplied = applied;
  working.format = `redstring-v${finalTo}`;

  return { data: working, applied };
}
