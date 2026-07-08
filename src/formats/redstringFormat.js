/**
 * Redstring Native Format Handler
 * Handles import/export of .redstring files with JSON-LD context
 * 
 * VERSION HISTORY:
 * - v3.0.0: Added versioning system, validation, and migration support
 * - v2.0.0-semantic: Semantic web integration with JSON-LD
 * - v1.0.0: Legacy format
 */

import { v4 as uuidv4 } from 'uuid';
import uriGenerator from '../services/uriGenerator.js';
import { runMigrations } from './migrations.js';
import { safeJsonParse, stripDangerousKeys } from '../utils/safeJson.js';

// Current format version
export const CURRENT_FORMAT_VERSION = '4.0.0';

// v4 dataset structure gate (D10). All phases 3–6 complete; v4 is live.
export const EMIT_V4 = true;

// Minimum supported version (older versions must be migrated)
export const MIN_SUPPORTED_VERSION = '1.0.0';

// Version history and breaking changes
export const VERSION_HISTORY = {
  '4.0.0': {
    date: '2026-06',
    changes: [
      'D10: prototypeSpace/spatialGraphs top-level shape (default + named graphs)',
      'Edges scoped inside their spatial graph (relationships section dissolved)',
      'SKOS+PROV alignment: skos:Concept, prov:wasAttributedTo, sameness ladder',
      'OWL context pruned to sameAs only (D9)',
      'Vocabulary document published at public/vocab/redstring.ttl (P6.1)',
      'TriG/N-Quads codecs (P5.2), lens table (P5.1), mergeUniverses (P5.4)',
    ],
    breaking: true
  },
  '3.0.0': {
    date: '2025-01',
    changes: [
      'Added comprehensive versioning system',
      'Added validation and migration support',
      'Added format compatibility checks'
    ],
    breaking: false
  },
  '2.0.0-semantic': {
    date: '2024-12',
    changes: [
      'Added JSON-LD semantic web integration',
      'Separated storage into prototypeSpace and spatialGraphs',
      'Added RDF schema compliance'
    ],
    breaking: false // Backwards compatible via legacy section
  },
  '1.0.0': {
    date: '2024-01',
    changes: [
      'Initial format'
    ],
    breaking: false
  }
};

/**
 * Parse version string to comparable format
 */
const parseVersion = (versionString) => {
  if (!versionString || typeof versionString !== 'string') {
    return null;
  }
  
  // Handle semantic versions like "2.0.0-semantic"
  const cleanVersion = versionString.split('-')[0];
  const parts = cleanVersion.split('.').map(Number);
  
  if (parts.length !== 3 || parts.some(isNaN)) {
    return null;
  }
  
  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
    original: versionString
  };
};

/**
 * Compare two version strings
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2, null if invalid
 */
const compareVersions = (v1, v2) => {
  const parsed1 = parseVersion(v1);
  const parsed2 = parseVersion(v2);
  
  if (!parsed1 || !parsed2) return null;
  
  if (parsed1.major !== parsed2.major) {
    return parsed1.major < parsed2.major ? -1 : 1;
  }
  if (parsed1.minor !== parsed2.minor) {
    return parsed1.minor < parsed2.minor ? -1 : 1;
  }
  if (parsed1.patch !== parsed2.patch) {
    return parsed1.patch < parsed2.patch ? -1 : 1;
  }
  
  return 0;
};

/**
 * Validate file format version and check compatibility
 */
export const validateFormatVersion = (redstringData) => {
  let fileVersion = redstringData?.format || redstringData?.metadata?.version || '1.0.0';
  
  // Strip "redstring-v" prefix if present (e.g., "redstring-v2.0.0-semantic" -> "2.0.0-semantic")
  if (typeof fileVersion === 'string' && fileVersion.startsWith('redstring-v')) {
    fileVersion = fileVersion.replace('redstring-v', '');
  }
  
  // Parse versions
  const fileParsed = parseVersion(fileVersion);
  const minParsed = parseVersion(MIN_SUPPORTED_VERSION);
  const currentParsed = parseVersion(CURRENT_FORMAT_VERSION);
  
  if (!fileParsed) {
    return {
      valid: false,
      version: fileVersion,
      error: `Invalid version format: ${fileVersion}`,
      needsMigration: false
    };
  }
  
  // Check if version is too old
  const compareToMin = compareVersions(fileVersion, MIN_SUPPORTED_VERSION);
  if (compareToMin === -1) {
    return {
      valid: false,
      version: fileVersion,
      error: `File version ${fileVersion} is too old. Minimum supported version is ${MIN_SUPPORTED_VERSION}.`,
      needsMigration: false,
      tooOld: true
    };
  }
  
  // Check if version is from the future
  const compareToCurrent = compareVersions(fileVersion, CURRENT_FORMAT_VERSION);
  if (compareToCurrent === 1) {
    return {
      valid: false,
      version: fileVersion,
      error: `File version ${fileVersion} is newer than the current app version ${CURRENT_FORMAT_VERSION}. Please update Redstring.`,
      needsMigration: false,
      tooNew: true
    };
  }
  
  // Check if migration is needed
  const needsMigration = compareToCurrent === -1;
  
  return {
    valid: true,
    version: fileVersion,
    currentVersion: CURRENT_FORMAT_VERSION,
    needsMigration,
    canAutoMigrate: needsMigration // Currently all older versions can auto-migrate
  };
};

/**
 * Migrate data from older format versions to current version.
 *
 * @deprecated Retained for API compatibility. The real migration logic lives in
 * the ledger (src/formats/migrations.js); this delegates to `runMigrations`,
 * which detects the source version itself (the fromVersion/toVersion args are
 * ignored). New code should call `runMigrations` directly.
 */
export const migrateFormat = (redstringData, fromVersion, toVersion = CURRENT_FORMAT_VERSION) => {
  const { data, applied } = runMigrations(redstringData, { now: new Date().toISOString() });
  if (applied.length > 0) {
    console.log('[Format Migration] Applied ledger migrations:', applied);
  }
  return data;
};

// IRI minting (decision D3). Internal IDs become resolvable, standards-friendly
// URNs instead of pseudo-scheme compact IRIs (prototype:/instance:/graph:/etc):
//   UUID id            → urn:uuid:{id}
//   any other id       → urn:redstring:id:{encodeURIComponent(id)}
// fromIri reverses both, AND accepts every legacy pseudo-scheme plus bare ids,
// forever — so files written before P1.6 still import.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_ID_PREFIXES = ['prototype:', 'instance:', 'graph:', 'node:', 'group:', 'type:', 'space:'];

export const toIri = (id) => {
  if (id === undefined || id === null) return id;
  const s = String(id);
  return UUID_RE.test(s) ? `urn:uuid:${s}` : `urn:redstring:id:${encodeURIComponent(s)}`;
};

export const fromIri = (iri) => {
  if (iri === undefined || iri === null) return iri;
  const s = String(iri);
  if (s.startsWith('urn:uuid:')) return s.slice(9);
  if (s.startsWith('urn:redstring:id:')) return decodeURIComponent(s.slice(17));
  for (const prefix of LEGACY_ID_PREFIXES) {
    if (s.startsWith(prefix)) return s.slice(prefix.length);
  }
  return s; // already a bare id
};

// Enhanced JSON-LD Context for Redstring with Full RDF Schema Support
export const REDSTRING_CONTEXT = {
  "@version": 1.1,
  "@vocab": "https://redstring.io/vocab/",
  
  // Core Redstring Concepts - Enhanced with Three-Layer Architecture
  "redstring": "https://redstring.io/vocab/",
  "Graph": "redstring:Graph",
  "Node": "redstring:Node", 
  "Edge": "redstring:Edge",
  "SpatialContext": "redstring:SpatialContext",
  "CognitiveSpace": "redstring:CognitiveSpace",
  
  // Three-Layer Architecture
  "SemanticType": "redstring:SemanticType",
  "Prototype": "redstring:Prototype", 
  "Instance": "redstring:Instance",
  "PrototypeSpace": "redstring:PrototypeSpace",
  "SpatialGraph": "redstring:SpatialGraph",
  "SpatialGraphCollection": "redstring:SpatialGraphCollection",
  
  // Recursive Composition (The Heart of Redstring)
  "defines": "redstring:defines",
  "definedBy": "redstring:definedBy", 
  "expandsTo": "redstring:expandsTo",
  "contractsFrom": "redstring:contractsFrom",
  "contextualDefinition": "redstring:contextualDefinition",
  
  // Standard Vocabularies for Interop
  "name": "http://schema.org/name",
  "description": "http://schema.org/description",
  "color": "http://schema.org/color",
  "image": "http://schema.org/image",
  "thumbnail": "http://schema.org/thumbnail",
  "contains": "http://purl.org/dc/terms/hasPart",
  "partOf": "http://purl.org/dc/terms/isPartOf",
  "composedOf": "http://purl.org/vocab/frbr/core#embodiment",
  "composes": "http://purl.org/vocab/frbr/core#embodimentOf",
  
  // Complete RDF Schema Vocabulary
  "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
  "Class": "rdfs:Class",
  "subClassOf": { "@id": "rdfs:subClassOf", "@type": "@id" },
  "subPropertyOf": { "@id": "rdfs:subPropertyOf", "@type": "@id" },
  "domain": { "@id": "rdfs:domain", "@type": "@id" },
  "range": { "@id": "rdfs:range", "@type": "@id" },
  "label": "rdfs:label",
  "comment": "rdfs:comment",
  "seeAlso": { "@id": "rdfs:seeAlso", "@type": "@id" },
  "isDefinedBy": { "@id": "rdfs:isDefinedBy", "@type": "@id" },
  "Resource": "rdfs:Resource",
  "Literal": "rdfs:Literal",
  "Datatype": "rdfs:Datatype",
  "Container": "rdfs:Container",
  "member": { "@id": "rdfs:member", "@type": "@id" },

  // Complete RDF Core Vocabulary
  "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  "type": { "@id": "rdf:type", "@type": "@id" },
  "Property": "rdf:Property",
  "Statement": "rdf:Statement",
  "subject": { "@id": "rdf:subject", "@type": "@id" },
  "predicate": { "@id": "rdf:predicate", "@type": "@id" },
  "object": { "@id": "rdf:object", "@type": "@id" },
  "value": "rdf:value",
  "first": { "@id": "rdf:first", "@type": "@id" },
  "rest": { "@id": "rdf:rest", "@type": "@id" },
  "nil": { "@id": "rdf:nil", "@type": "@id" },

  // OWL: docking port only (D9). Redstring docks with OWL per-link via sameAs;
  // it does not author axioms in its own voice, so the entailment toolkit
  // (equivalentClass/disjointWith/inverseOf/functional/transitive/symmetric…)
  // is intentionally NOT declared here.
  "owl": "http://www.w3.org/2002/07/owl#",
  "sameAs": { "@id": "owl:sameAs", "@type": "@id" },
  "equivalentProperty": { "@id": "owl:equivalentProperty", "@type": "@id" },
  "differentFrom": { "@id": "owl:differentFrom", "@type": "@id" },

  // SKOS + PROV: the registers Redstring actually speaks (concepts/categories
  // and provenance). Added in P2.1; terms emitted in P2.4–P2.6.
  "skos": "http://www.w3.org/2004/02/skos/core#",
  "prov": "http://www.w3.org/ns/prov#",

  // External Knowledge Bases - Rosetta Stone Mappings
  "wd": "http://www.wikidata.org/entity/",
  "wdt": "http://www.wikidata.org/prop/direct/",
  "dbr": "http://dbpedia.org/resource/",
  "dbo": "http://dbpedia.org/ontology/",
  "schema": "http://schema.org/",
  
  // Academic & Research Integration
  "doi": "https://doi.org/",
  "pubmed": "https://pubmed.ncbi.nlm.nih.gov/",
  "arxiv": "https://arxiv.org/abs/",
  "orcid": "https://orcid.org/",
  "researchgate": "https://www.researchgate.net/publication/",
  "semanticscholar": "https://www.semanticscholar.org/paper/",
  
  // Citation and Bibliography
  "cites": "http://purl.org/spar/cito/cites",
  "citedBy": "http://purl.org/spar/cito/citedBy",
  "isDocumentedBy": "http://purl.org/spar/cito/isDocumentedBy",
  "documents": "http://purl.org/spar/cito/documents",
  
  // Academic Metadata
  "author": "http://schema.org/author",
  "datePublished": "http://schema.org/datePublished",
  "publisher": "http://schema.org/publisher",
  "journal": "http://schema.org/isPartOf",
  "citation": "http://schema.org/citation",
  "abstract": "http://schema.org/abstract",
  "keywords": "http://schema.org/keywords",
  
  // Redstring Spatial Properties (Unique Contribution to Semantic Web)
  "spatialContext": "redstring:spatialContext",
  "xCoordinate": "redstring:xCoordinate",
  "yCoordinate": "redstring:yCoordinate", 
  "spatialScale": "redstring:spatialScale",
  "viewport": "redstring:viewport",
  "canvasSize": "redstring:canvasSize",
  
  // Redstring Visual Properties
  "visualProperties": "redstring:visualProperties",
  "cognitiveColor": "redstring:cognitiveColor",
  "expanded": "redstring:expanded",
  "visible": "redstring:visible",
  "thumbnailSrc": "redstring:thumbnailSrc",
  "imageSrc": "redstring:imageSrc",
  "imageAspectRatio": "redstring:imageAspectRatio",
  
  // Redstring Semantic Properties (Three-Layer Architecture)
  "hasDefinition": { "@id": "redstring:hasDefinition", "@type": "@id" },
  "definitionGraphIds": "redstring:definitionGraphIds",
  "prototypeId": { "@id": "redstring:prototypeId", "@type": "@id" },
  "instanceOf": { "@id": "redstring:instanceOf", "@type": "@id" },
  "containedIn": { "@id": "redstring:containedIn", "@type": "@id" },
  "abstractionChains": "redstring:abstractionChains",
  "abstractionDimensions": "redstring:abstractionDimensions",
  
  // Redstring Cognitive Properties
  "cognitiveProperties": "redstring:cognitiveProperties",
  "bookmarked": "redstring:bookmarked",
  "activeInContext": "redstring:activeInContext",
  "currentDefinitionIndex": "redstring:currentDefinitionIndex",
  "contextKey": "redstring:contextKey",
  "personalMeaning": "redstring:personalMeaning",
  "cognitiveAssociations": "redstring:cognitiveAssociations",
  "lastViewed": "redstring:lastViewed",
  
  // Redstring Relationship Properties
  "relationshipDirection": "redstring:relationshipDirection",
  "relationshipStrength": "redstring:relationshipStrength",
  "bidirectional": "redstring:bidirectional",
  "arrowsToward": "redstring:arrowsToward",
  "directionality": "redstring:directionality",
  
  // Redstring Metadata Properties
  "bio": "redstring:bio",
  "conjugation": "redstring:conjugation",
  "externalLinks": "redstring:externalLinks",
  "citations": "redstring:citations",
  "typeNodeId": { "@id": "redstring:typeNodeId", "@type": "@id" },
  
  // Temporal & Versioning
  "created": "http://purl.org/dc/terms/created",
  "modified": "http://purl.org/dc/terms/modified",
  "version": "http://purl.org/dc/terms/hasVersion",
  
  // Solid Pod Federation
  "pod": "https://www.w3.org/ns/solid/terms#pod",
  "webId": "http://xmlns.com/foaf/0.1/webId",
  "references": "redstring:references",
  "linkedThinking": "redstring:linkedThinking",

  // ── RDF projection tuning (P2.2) ──────────────────────────────────────────
  // These shape how jsonld.toRDF reads the document. They do NOT affect native
  // import (which reads raw JSON, ignoring the context).
  "xsd": "http://www.w3.org/2001/XMLSchema#",

  // Entity maps are keyed by id → declare @container:@id so the map keys link
  // each entity by its IRI instead of minting a junk predicate per key.
  "prototypes": { "@id": "redstring:prototypes", "@container": "@id" },
  "graphs": { "@id": "redstring:graphs", "@container": "@id" },
  "edges": { "@id": "redstring:edges", "@container": "@id" },
  "redstring:instances": { "@id": "redstring:instances", "@container": "@id" },
  "redstring:groups": { "@id": "redstring:groups", "@container": "@id" },

  // Datatype coercion for the prefixed forms the exporter actually emits.
  "redstring:xCoordinate": { "@id": "redstring:xCoordinate", "@type": "xsd:decimal" },
  "redstring:yCoordinate": { "@id": "redstring:yCoordinate", "@type": "xsd:decimal" },
  "redstring:spatialScale": { "@id": "redstring:spatialScale", "@type": "xsd:decimal" },
  "redstring:lastViewed": { "@id": "redstring:lastViewed", "@type": "xsd:dateTime" },
  "created": { "@id": "http://purl.org/dc/terms/created", "@type": "xsd:dateTime" },
  "modified": { "@id": "http://purl.org/dc/terms/modified", "@type": "xsd:dateTime" },

  // Derived/regenerable snapshots (D7) and non-semantic UI state are excluded
  // from the RDF projection — null drops them during JSON-LD expansion only.
  "graphLayouts": null,
  "graphSummaries": null,
  "userInterface": null,
  "globalSpatialContext": null
};

const coalesce = (value, fallback) => value ?? fallback;

const ensureArray = (value) => {
  if (Array.isArray(value)) {
    return [...value];
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
};

const ensureObject = (value) => (value && typeof value === 'object' ? value : {});

const ensureSet = (value) => {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set();
};

const EXPORT_MAX_LAYOUT_NODES = 400;
const EXPORT_MAX_SUMMARY_EDGES = 600;

const safePrototypeLabel = (prototypes, prototypeId) => {
  if (!prototypeId) return 'Unknown Prototype';
  const proto = prototypes.get(prototypeId);
  return proto?.name || prototypeId;
};

const characterizeGraphQuality = (nodeCount, edgeCount) => {
  if (nodeCount <= 0) return { label: 'empty', score: 0, density: 0 };
  if (nodeCount === 1) return { label: 'single', score: 10, density: 0 };
  const density = edgeCount / (nodeCount * (nodeCount - 1));
  let label = 'sparse';
  if (density >= 0.45) label = 'dense';
  else if (density >= 0.18) label = 'balanced';
  else if (density === 0) label = 'disconnected';
  const score = Math.max(5, Math.min(100, Math.round((density * 80) + Math.min(nodeCount * 2, 40))));
  return { label, score, density: Number(density.toFixed(3)) };
};

const buildLayoutSnapshot = (graphs) => {
  const layouts = {};
  graphs.forEach((graph, graphId) => {
    const instancesMap = graph?.instances instanceof Map ? graph.instances : new Map();
    const entries = Array.from(instancesMap.entries());
    const nodes = {};
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let totalX = 0;
    let totalY = 0;
    let counted = 0;

    entries.forEach(([instanceId, instance], index) => {
      if (!instance || typeof instance !== 'object') return;
      const { x = 0, y = 0, scale = 1, prototypeId = null } = instance;
      if (index < EXPORT_MAX_LAYOUT_NODES) {
        nodes[instanceId] = { x, y, scale, prototypeId };
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      totalX += x;
      totalY += y;
      counted += 1;
    });

    const edgeCount = Array.isArray(graph?.edgeIds) ? graph.edgeIds.length : 0;
    const metadata = {
      nodeCount: entries.length,
      edgeCount,
      boundingBox: counted ? { minX, minY, maxX, maxY } : null,
      centroid: counted ? { x: totalX / counted, y: totalY / counted } : null,
      computedAt: Date.now(),
      truncated: entries.length > EXPORT_MAX_LAYOUT_NODES
    };

    layouts[graphId] = { nodes, metadata };
  });
  return layouts;
};

const buildGraphSummariesSnapshot = (graphs, nodePrototypes, edges) => {
  const summaries = {};
  graphs.forEach((graph, graphId) => {
    const instancesMap = graph?.instances instanceof Map ? graph.instances : new Map();
    const instanceEntries = Array.from(instancesMap.entries());
    const instanceById = new Map(instanceEntries);

    const nodes = instanceEntries.slice(0, EXPORT_MAX_LAYOUT_NODES).map(([instanceId, instance]) => ({
      id: instanceId,
      prototypeId: instance?.prototypeId || null,
      name: safePrototypeLabel(nodePrototypes, instance?.prototypeId)
    }));

    const edgeIds = Array.isArray(graph?.edgeIds) ? graph.edgeIds : [];
    const edgeEntries = edgeIds
      .map(edgeId => edges.get(edgeId))
      .filter(Boolean);

    const edgesSerialized = edgeEntries.slice(0, EXPORT_MAX_SUMMARY_EDGES).map(edge => {
      const sourceInstance = instanceById.get(edge.sourceId);
      const targetInstance = instanceById.get(edge.destinationId);
      return {
        id: edge.id,
        from: edge.sourceId,
        to: edge.destinationId,
        type: safePrototypeLabel(nodePrototypes, edge.typeNodeId),
        sourceLabel: safePrototypeLabel(nodePrototypes, sourceInstance?.prototypeId),
        targetLabel: safePrototypeLabel(nodePrototypes, targetInstance?.prototypeId)
      };
    });

    const quality = characterizeGraphQuality(instanceEntries.length, edgeEntries.length);
    const textLines = [
      `Graph: ${graph?.name || 'Untitled'} (${graphId})`,
      `Nodes (${instanceEntries.length} total${instanceEntries.length > EXPORT_MAX_LAYOUT_NODES ? `, showing ${EXPORT_MAX_LAYOUT_NODES}` : ''}):`
    ];
    nodes.forEach(node => {
      textLines.push(`- ${node.name} [${node.id}]`);
    });

    textLines.push('', `Edges (${edgeEntries.length} total${edgeEntries.length > EXPORT_MAX_SUMMARY_EDGES ? `, showing ${EXPORT_MAX_SUMMARY_EDGES}` : ''}):`);
    edgesSerialized.forEach(edge => {
      const relation = edge.type ? ` (${edge.type})` : '';
      textLines.push(`- ${edge.sourceLabel} → ${edge.targetLabel}${relation}`);
    });

    summaries[graphId] = {
      id: graphId,
      name: graph?.name || 'New Thing',
      description: graph?.description || '',
      nodeCount: instanceEntries.length,
      edgeCount: edgeEntries.length,
      density: quality.density,
      quality: quality.label,
      score: quality.score,
      nodes,
      edges: edgesSerialized,
      text: textLines.join('\n'),
      computedAt: Date.now()
    };
  });

  return summaries;
};

/**
 * The complete set of store keys that get persisted to a .redstring file.
 *
 * SINGLE SOURCE OF TRUTH. Any component that forwards store state to the
 * serializer (notably SaveCoordinator's worker-clean step) MUST forward every
 * key in this list, or the worker autosave path silently truncates the file —
 * this is exactly how `wizardPlansByConversation` was being erased on every
 * autosave. Add a new persisted field here AND to the export block below AND
 * to the import hydration, or it round-trips lossily.
 */
export const PERSISTED_STORE_KEYS = [
  'graphs',
  'nodePrototypes',
  'edges',
  'edgePrototypes',
  'openGraphIds',
  'activeGraphId',
  'activeDefinitionNodeId',
  'expandedGraphIds',
  'rightPanelTabs',
  'savedNodeIds',
  'savedGraphIds',
  'showConnectionNames',
  'wizardPlansByConversation'
];

/**
 * Export current Zustand store state to .redstring format
 * @param {Object} storeState - The current state from the Zustand store
 * @param {string} [userDomain] - User's domain for dynamic URI generation
 * @returns {Object} Redstring data with dynamic URIs
 */
export const exportToRedstring = (storeState, userDomain = null, { emitV4 = EMIT_V4 } = {}) => {
  try {
    if (!storeState) {
      throw new Error('Store state is required for export');
    }

    const {
      graphs = new Map(),
      nodePrototypes = new Map(),
      edges = new Map(),
      edgePrototypes = new Map(),
      openGraphIds = [],
      activeGraphId = null,
      activeDefinitionNodeId = null,
      expandedGraphIds = new Set(),
      rightPanelTabs = [],
      savedNodeIds = new Set(),
      savedGraphIds = new Set(),
      showConnectionNames = false,
      wizardPlansByConversation = {}
    } = storeState;

  // Three-Layer Architecture: Export Spatial Graphs with Instance Collections
  const spatialGraphs = {};
  graphs.forEach((graph, graphId) => {
    // Export instances as positioned individuals with rdf:type relationships
    const spatialInstances = {};
    if (graph.instances) {
      graph.instances.forEach((instance, instanceId) => {
        spatialInstances[instanceId] = {
          // RDF Schema typing - instance is an individual
          "@type": "redstring:Instance",
          "@id": toIri(instanceId),

          // RDF Schema: this individual belongs to prototype class
          "rdf:type": { "@id": toIri(instance.prototypeId) },
          "rdfs:label": instance.name || null, // Don't generate fallback labels
          "rdfs:comment": instance.description || null,

          // Redstring: this instance is contained within specific graph
          "redstring:containedIn": { "@id": toIri(graphId) },
          
          // Unique spatial positioning data (Redstring's contribution to semantic web)
          "redstring:spatialContext": {
            "redstring:xCoordinate": instance.x,
            "redstring:yCoordinate": instance.y,
            "redstring:spatialScale": instance.scale
          },
          
          // Visual state properties
          "redstring:visualProperties": {
            "redstring:expanded": instance.expanded,
            "redstring:visible": instance.visible
          },
          
          // Preserve original prototype reference for internal use
          "redstring:prototypeId": instance.prototypeId,

          // Group anchor properties (for thing-group connection routing)
          "redstring:isGroupAnchor": instance.isGroupAnchor || false,
          "redstring:anchorForGroupId": instance.anchorForGroupId || null
        };
        // Quarantined unknown fields ride back out verbatim (D1/P1.3)
        if (instance._preserved) {
          spatialInstances[instanceId]._preserved = instance._preserved;
        }
      });
    }
    
    spatialGraphs[graphId] = {
      "@type": "redstring:SpatialGraph",
      "@id": toIri(graphId),
      "rdfs:label": graph.name || `Graph ${graphId}`,
      "rdfs:comment": graph.description || "",
      
      // Graph-level properties
      "redstring:definingNodeIds": graph.definingNodeIds || [],
      "redstring:edgeIds": graph.edgeIds || [],
      // Semantic/visual graph fields the store carries (createNewGraph sets
      // these). `directed` is a real semantic flag; color/picture/createdAt
      // were previously dropped on every save/load cycle.
      "redstring:directed": graph.directed !== false,
      ...(graph.color != null ? { "redstring:color": graph.color } : {}),
      ...(graph.picture != null ? { "redstring:picture": graph.picture } : {}),
      ...(graph.createdAt != null ? { "redstring:createdAt": graph.createdAt } : {}),

      // Viewport state for this graph
      "redstring:panOffset": graph.panOffset || { x: 0, y: 0 },
      "redstring:zoomLevel": typeof graph.zoomLevel === 'number' ? graph.zoomLevel : 1.0,
      
      // Spatial instances collection
      "redstring:instances": spatialInstances,
      
      // Groups collection with semantic metadata
      "redstring:groups": (() => {
        const groupsObj = {};
        if (graph.groups) {
          graph.groups.forEach((group, groupId) => {
            groupsObj[groupId] = {
              "@type": "redstring:Group",
              "@id": toIri(groupId),
              "rdfs:label": group.name,
              "rdfs:comment": group.description || "",
              "redstring:color": group.color,
              "redstring:memberInstanceIds": group.memberInstanceIds || [],
              "redstring:semanticMetadata": group.semanticMetadata || {},
              // Node-group properties (for groups that represent nodes)
              "redstring:linkedNodePrototypeId": group.linkedNodePrototypeId,
              "redstring:linkedDefinitionIndex": group.linkedDefinitionIndex,
              "redstring:hasCustomLayout": group.hasCustomLayout,
              "redstring:anchorInstanceId": group.anchorInstanceId,
              // RDF-style membership relationships
              "rdfs:member": (group.memberInstanceIds || []).map(memberId => ({
                "@id": toIri(memberId)
              }))
            };
          });
        }
        return groupsObj;
      })(),
      
      // UI state for this graph
      "redstring:visualProperties": {
        "redstring:expanded": expandedGraphIds.has(graphId),
        "redstring:activeInContext": graphId === activeGraphId
      }
    };
    // Quarantined unknown fields ride back out verbatim (D1/P1.3)
    if (graph._preserved) {
      spatialGraphs[graphId]._preserved = graph._preserved;
    }
  });

  // SKOS scheme IRI — the universe IS a skos:ConceptScheme; prototypes are the
  // concepts in it. One scheme per file (self-contained). (P2.4)
  const SCHEME_IRI = 'urn:redstring:scheme';

  // Three-Layer Architecture: Export Prototypes as Semantic Classes
  const prototypeSpace = {};
  nodePrototypes.forEach((prototype, id) => {
    prototypeSpace[id] = {
      // RDF Schema typing — prototype is a class AND a SKOS concept (P2.4).
      // skos:Concept is the load-bearing standards type; the rest is overlay.
      "@type": ["redstring:Prototype", "rdfs:Class", "schema:Thing", "skos:Concept"],
      "@id": toIri(id),

      // RDF Schema standard properties (W3C compliant) - preserve original
      "rdfs:label": prototype.name,
      "rdfs:comment": prototype.description,

      // SKOS concept properties (P2.4) — the register that survives the strip test
      "skos:prefLabel": prototype.name,
      "skos:altLabel": prototype.conjugation || undefined,
      "skos:inScheme": { "@id": SCHEME_IRI },

      // Redstring core properties (NEVER override these)
      "name": prototype.name,
      "description": prototype.description,
      "rdfs:seeAlso": prototype.externalLinks || [],
      "rdfs:isDefinedBy": { "@id": "https://redstring.io" },
      
      // Type hierarchy - automatic rdfs:subClassOf relationships
      "rdfs:subClassOf": prototype.typeNodeId ?
        { "@id": toIri(prototype.typeNodeId) } : null,
      
      // Sameness ladder (D8/P2.5) is appended after this literal so it can
      // branch on auto-enrichment. owl:equivalentClass stays as-is.
      "owl:equivalentClass": prototype.equivalentClasses || [],
      
      // Redstring spatial properties (unique contribution to semantic web)
      "redstring:spatialContext": {
        "redstring:xCoordinate": prototype.x || 0,
        "redstring:yCoordinate": prototype.y || 0,
        "redstring:spatialScale": prototype.scale || 1.0
      },
      
      // Redstring visual properties. Only strip the (large, base64) image when
      // it's genuinely re-fetchable from Wikipedia — auto-enriched AND we have
      // the thumbnail URL. Otherwise persist it: dropping a user's image to
      // save space is only acceptable when we can get it back. Must match the
      // import-side condition or images round-trip lossily.
      "redstring:visualProperties": {
        "redstring:cognitiveColor": prototype.color,
        "redstring:imageSrc": (prototype.semanticMetadata?.autoEnriched && prototype.semanticMetadata?.wikipediaThumbnail) ? null : prototype.imageSrc,
        "redstring:thumbnailSrc": (prototype.semanticMetadata?.autoEnriched && prototype.semanticMetadata?.wikipediaThumbnail) ? null : prototype.thumbnailSrc,
        "redstring:imageAspectRatio": prototype.imageAspectRatio
      },
      
      // Redstring semantic properties
      "redstring:definitionGraphIds": prototype.definitionGraphIds || [],
      "redstring:bio": prototype.bio,
      "redstring:conjugation": prototype.conjugation,
      "redstring:typeNodeId": prototype.typeNodeId,
      "redstring:citations": prototype.citations || [],
      // Abstraction-chain membership flags (read by mcpProvider). Emitted only
      // when set so we don't bloat every prototype; previously dropped on save.
      ...(prototype.isSpecificityChainNode ? { "redstring:isSpecificityChainNode": true } : {}),
      ...(prototype.hasSpecificityChain ? { "redstring:hasSpecificityChain": true } : {}),
      ...(prototype.createdAt != null ? { "redstring:createdAt": prototype.createdAt } : {}),
      
      // Redstring cognitive properties
      "redstring:cognitiveProperties": (() => {
        const cognitiveProps = {
          "redstring:bookmarked": savedNodeIds.has(id),
          "redstring:lastViewed": new Date().toISOString()
        };

        if (prototype.personalMeaning !== undefined && prototype.personalMeaning !== null) {
          cognitiveProps["redstring:personalMeaning"] = prototype.personalMeaning;
        }

        if (Array.isArray(prototype.cognitiveAssociations) && prototype.cognitiveAssociations.length > 0) {
          cognitiveProps["redstring:cognitiveAssociations"] = prototype.cognitiveAssociations;
        }

        return cognitiveProps;
      })(),
      
      // Abstraction chains for rdfs:subClassOf generation
      "redstring:abstractionChains": prototype.abstractionChains || {},
      
      // Agent configuration (if node is an agent)
      "redstring:agentConfig": prototype.agentConfig || null,

      // Semantic enrichment metadata (Wikipedia URLs, confidence, auto-enrich flag, etc.)
      // Critical for image re-fetching on reload and OOM prevention
      "redstring:semanticMetadata": prototype.semanticMetadata || null
    };

    // Sameness ladder (decision D8/P2.5). External links climb the ladder by how
    // strong the claim is. Auto-enrichment (e.g. a Wikipedia article matched to a
    // concept) is alignment, not identity → skos:closeMatch only. User-asserted
    // links are interchangeable → skos:exactMatch, and per the cumulative rule
    // co-emit owl:sameAs (the OWL docking port). rdfs:seeAlso keeps the raw URLs.
    const externalLinks = Array.isArray(prototype.externalLinks) ? prototype.externalLinks : [];
    if (externalLinks.length > 0) {
      const linkRefs = externalLinks.map((url) => ({ "@id": url }));
      if (prototype.semanticMetadata?.autoEnriched) {
        prototypeSpace[id]["skos:closeMatch"] = linkRefs;
      } else {
        prototypeSpace[id]["owl:sameAs"] = externalLinks;
        prototypeSpace[id]["skos:exactMatch"] = linkRefs;
      }
    }

    // PROV provenance (D/P2.6). Wizard-authored concepts carry provenance in
    // semanticMetadata (which round-trips natively); project it to standard PROV
    // on the entity. User-authored concepts have no provenance → no prov: terms.
    const provenance = prototype.semanticMetadata?.provenance;
    if (provenance?.wasAttributedTo) {
      prototypeSpace[id]["prov:wasAttributedTo"] = { "@id": `urn:redstring:agent:${provenance.wasAttributedTo}` };
    }
    if (provenance?.generatedAtTime) {
      prototypeSpace[id]["prov:generatedAtTime"] = provenance.generatedAtTime;
    }

    // Quarantined unknown fields ride back out verbatim (D1/P1.3)
    if (prototype._preserved) {
      prototypeSpace[id]._preserved = prototype._preserved;
    }
  });

  // Project abstraction chains to skos:broader links (P2.4). A chain is ordered
  // general → specific, so each more-specific concept is skos:broader its
  // immediate more-general neighbor. SKOS is the correct register here: it
  // carries NO logical entailment, matching Redstring's contested/interpretive
  // hierarchies — unlike rdfs:subClassOf (audit #8), which this replaces. The
  // native redstring:abstractionChains field is kept verbatim on each prototype.
  nodePrototypes.forEach((node, nodeId) => {
    if (node.abstractionChains) {
      for (const dimension in node.abstractionChains) {
        const chain = node.abstractionChains[dimension];
        if (chain && chain.length > 1) {
          for (let i = 1; i < chain.length; i++) {
            const moreSpecificId = chain[i];
            const moreGeneralId = chain[i - 1];
            if (prototypeSpace[moreSpecificId]) {
              if (!prototypeSpace[moreSpecificId]['skos:broader']) {
                prototypeSpace[moreSpecificId]['skos:broader'] = [];
              }
              const broaderRef = { "@id": toIri(moreGeneralId) };
              const existing = Array.isArray(prototypeSpace[moreSpecificId]['skos:broader'])
                ? prototypeSpace[moreSpecificId]['skos:broader']
                : [prototypeSpace[moreSpecificId]['skos:broader']];
              if (!existing.some(item => item?.["@id"] === toIri(moreGeneralId))) {
                existing.push(broaderRef);
                prototypeSpace[moreSpecificId]['skos:broader'] = existing;
              }
            }
          }
        }
      }
    }
  });

  // Create a map of instanceId -> prototypeId for efficient lookup
  const instanceToPrototypeMap = new Map();
  graphs.forEach(graph => {
    if (graph.instances) {
      graph.instances.forEach(instance => {
        instanceToPrototypeMap.set(instance.id, instance.prototypeId);
      });
    }
  });

  // Reverse index for v4 graph-scoped edge placement (D10). Built here so the
  // edge loop can populate graphEdgesMap without a second pass over graphs.
  const edgeToGraphId = new Map();
  const instanceToGraphId = new Map(); // fallback when edgeIds is missing
  const graphEdgesMap = {};
  graphs.forEach((graph, graphId) => {
    graphEdgesMap[graphId] = {};
    (graph.edgeIds || []).forEach(edgeId => edgeToGraphId.set(edgeId, graphId));
    if (graph.instances) {
      graph.instances.forEach((_, instId) => instanceToGraphId.set(instId, graphId));
    }
  });

  const edgesObj = {};
  edges.forEach((edge, id) => {
    //console.log('[DEBUG] Exporting edge:', id, edge);
    const sourcePrototypeId = instanceToPrototypeMap.get(edge.sourceId);
    const destinationPrototypeId = instanceToPrototypeMap.get(edge.destinationId);
    
    // Get the predicate prototype ID by mapping from definition node ID to its prototype ID
    let predicatePrototypeId = edge.typeNodeId; // fallback to type node ID
    if (edge.definitionNodeIds?.[0]) {
      // Find the definition node and get its prototype ID
      const definitionNodeId = edge.definitionNodeIds[0];
      const definitionNode = nodePrototypes.get(definitionNodeId);
      if (definitionNode) {
        predicatePrototypeId = definitionNode.prototypeId || definitionNode.typeNodeId;
      }
    }

    // console.log('[DEBUG] Edge mapping:', {
    //   sourceId: edge.sourceId,
    //   sourcePrototypeId,
    //   destinationId: edge.destinationId,
    //   destinationPrototypeId,
    //   predicatePrototypeId,
    //   definitionNodeIds: edge.definitionNodeIds
    // });

    // Prepare a JSON-serializable directionality (convert Set -> Array)
    const serializedDirectionality = (() => {
      if (!edge.directionality || typeof edge.directionality !== 'object') {
        return { arrowsToward: [] };
      }
      const maybeSetOrArray = edge.directionality.arrowsToward;
      let arrowsArray;
      if (maybeSetOrArray instanceof Set) {
        arrowsArray = Array.from(maybeSetOrArray);
      } else if (Array.isArray(maybeSetOrArray)) {
        arrowsArray = maybeSetOrArray;
      } else {
        arrowsArray = [];
      }
      return { ...edge.directionality, arrowsToward: arrowsArray };
    })();

    // Store both native Redstring format and RDF format
    edgesObj[id] = {
      // Native Redstring format (for application use)
      "id": edge.id,
      "sourceId": edge.sourceId,
      "destinationId": edge.destinationId,
      "name": edge.name,
      "description": edge.description,
      "typeNodeId": edge.typeNodeId,
      "definitionNodeIds": edge.definitionNodeIds,
      "directionality": serializedDirectionality,
      
      // RDF format (for semantic web integration)
      "rdfStatements": sourcePrototypeId && destinationPrototypeId && predicatePrototypeId ? (() => {
        // Project edge.directionality.arrowsToward (a Set of INSTANCE ids) to RDF.
        // Correct mapping (see src/core/Edge.js and FORMAT_REFACTOR_PLAN.md §2):
        //   empty            → two reciprocal triples (non-directed)
        //   {destinationId}  → one triple  source → dest
        //   {sourceId}       → one triple  dest → source
        //   both             → two reciprocal triples (bidirectional)
        // (node: prefix is a passthrough until P1.6 mints URNs.)
        const arrows = edge.directionality?.arrowsToward;
        const has = (instanceId) =>
          arrows instanceof Set ? arrows.has(instanceId)
          : Array.isArray(arrows) ? arrows.includes(instanceId)
          : false;
        const toDest = has(edge.destinationId);
        const toSource = has(edge.sourceId);
        const triple = (subjProtoId, objProtoId) => ({
          "@type": "Statement",
          "subject": { "@id": toIri(subjProtoId) },
          "predicate": { "@id": toIri(predicatePrototypeId) },
          "object": { "@id": toIri(objProtoId) },
        });

        if (toDest && !toSource) return [triple(sourcePrototypeId, destinationPrototypeId)];
        if (toSource && !toDest) return [triple(destinationPrototypeId, sourcePrototypeId)];
        // none (non-directed) or both (bidirectional): two reciprocal triples
        return [
          triple(sourcePrototypeId, destinationPrototypeId),
          triple(destinationPrototypeId, sourcePrototypeId),
        ];
      })() : null,
      
      // Metadata for both formats
      "sourcePrototypeId": sourcePrototypeId,
      "destinationPrototypeId": destinationPrototypeId,
      "predicatePrototypeId": predicatePrototypeId,
    };

    // Edge semanticMetadata + PROV (P2.6). Wizard-authored edges carry provenance
    // in semanticMetadata; round-trip it natively and project to standard PROV.
    if (edge.semanticMetadata) {
      edgesObj[id]["redstring:semanticMetadata"] = edge.semanticMetadata;
      const edgeProv = edge.semanticMetadata.provenance;
      if (edgeProv?.wasAttributedTo) {
        edgesObj[id]["prov:wasAttributedTo"] = { "@id": `urn:redstring:agent:${edgeProv.wasAttributedTo}` };
      }
      if (edgeProv?.generatedAtTime) {
        edgesObj[id]["prov:generatedAtTime"] = edgeProv.generatedAtTime;
      }
    }

    // Quarantined unknown fields ride back out verbatim (D1/P1.3)
    if (edge._preserved) {
      edgesObj[id]._preserved = edge._preserved;
    }

    // v4: also stash the edge in its owning graph's bucket.
    // Primary: graph.edgeIds membership. Fallback: infer from sourceId/destinationId
    // instance membership (handles states where edgeIds is absent/stale).
    const _owningGraphId =
      edgeToGraphId.get(id) ??
      instanceToGraphId.get(edge.sourceId) ??
      instanceToGraphId.get(edge.destinationId) ??
      null;
    if (_owningGraphId != null && graphEdgesMap[_owningGraphId]) {
      graphEdgesMap[_owningGraphId][id] = edgesObj[id];
    }

    //console.log('[DEBUG] Created dual-format edge:', id, edgesObj[id]);
  });

  // v4: attach graph-scoped edges inside each spatialGraph entry (D10).
  if (emitV4) {
    graphs.forEach((_, graphId) => {
      spatialGraphs[graphId]['redstring:edges'] = graphEdgesMap[graphId] || {};
    });
  }

  // Note: abstractionChains are now stored directly on node prototypes
  // No separate abstraction axes needed

  // Generate dynamic context if user domain is provided
  const context = userDomain ? uriGenerator.generateContext(userDomain) : REDSTRING_CONTEXT;
  
  // Generate user URIs if domain is provided
  const userURIs = userDomain ? uriGenerator.generateUserURIs(userDomain) : null;

  const layoutSnapshot = buildLayoutSnapshot(graphs);
  const summarySnapshot = buildGraphSummariesSnapshot(graphs, nodePrototypes, edges);
  
  return {
    "@context": context,
    // The universe is both Redstring's CognitiveSpace and a SKOS ConceptScheme
    // (P2.4); SCHEME_IRI is what every prototype's skos:inScheme points at.
    "@id": SCHEME_IRI,
    "@type": ["redstring:CognitiveSpace", "skos:ConceptScheme"],
    "format": emitV4 ? 'redstring-v4.0.0' : `redstring-v${CURRENT_FORMAT_VERSION}`,
    "metadata": {
      "version": emitV4 ? '4.0.0' : CURRENT_FORMAT_VERSION,
      "created": new Date().toISOString(),
      "modified": new Date().toISOString(),
      // Identity stamp: which universe this file belongs to. Used to refuse
      // adopting a same-named file that belongs to a DIFFERENT universe as a
      // save target (which would overwrite it). Absent for pre-stamp files.
      ...(storeState._universeSlug ? { "universeSlug": storeState._universeSlug } : {}),
      "title": (activeGraphId && graphs.get(activeGraphId)?.name) || "New Thing",
      "description": (activeGraphId && graphs.get(activeGraphId)?.description) || "",
      "domain": userDomain || null,
      "userURIs": userURIs,
      "semanticWebCompliant": true,
      "rdfSchemaVersion": "1.1",
      "owlVersion": "2.0",
      "formatHistory": VERSION_HISTORY[CURRENT_FORMAT_VERSION]
    },
    
    // Separated Storage Architecture
    "prototypeSpace": {
      "@type": "redstring:PrototypeSpace",
      "@id": "urn:redstring:space:prototypes",
      "rdfs:label": "Redstring Prototype Space",
      "rdfs:comment": "Collection of semantic classes with spatial properties",
      "prototypes": prototypeSpace
    },
    
    "spatialGraphs": {
      "@type": "redstring:SpatialGraphCollection", 
      "@id": "urn:redstring:space:graphs",
      "rdfs:label": "Redstring Spatial Graphs",
      "rdfs:comment": "Collection of positioned instances within spatial graphs",
      "graphs": spatialGraphs
    },
    
    // v3: edges in a global relationships section. v4 dissolves this — edges
    // live inside their owning spatialGraph entries (D10, P3.1).
    ...(emitV4 ? {} : {
      "relationships": {
        "@type": "redstring:RelationshipCollection",
        "@id": "urn:redstring:space:relationships",
        "rdfs:label": "Redstring Relationships",
        "rdfs:comment": "RDF statements representing connections between instances",
        "edges": edgesObj
      }
    }),
    
    // Global spatial context
    "globalSpatialContext": {
      "@type": "redstring:SpatialContext",
      "redstring:viewport": { "x": 0, "y": 0, "zoom": 1.0 },
      "redstring:canvasSize": { "width": 4000, "height": 3000 }
    },
    
    // User interface state (preserved for application functionality)
    "userInterface": {
      "@type": "redstring:UserInterfaceState",
      "redstring:openGraphIds": [...openGraphIds],
      "redstring:activeGraphId": activeGraphId,
      "redstring:activeDefinitionNodeId": activeDefinitionNodeId,
      "redstring:expandedGraphIds": [...expandedGraphIds],
      "redstring:rightPanelTabs": [...rightPanelTabs],
      "redstring:savedNodeIds": [...savedNodeIds],
      "redstring:savedGraphIds": [...savedGraphIds],
      "redstring:showConnectionNames": !!showConnectionNames,
      "redstring:wizardPlansByConversation": (typeof wizardPlansByConversation === 'object' && wizardPlansByConversation) ? wizardPlansByConversation : {}
    },
    
    // Spatial metadata snapshots for agent/CLI workflows
    "graphLayouts": layoutSnapshot,
    "graphSummaries": summarySnapshot,

    // Custom connection types (edge prototypes). Serialized as a plain object
    // so user-created / wizard-created connection types survive reload —
    // without this, edges pointing at a custom typeNodeId dangle on every
    // load and the type can't even be re-applied (setEdgeType validates
    // against edgePrototypes). Base types are re-seeded by the store, but
    // exporting them too keeps user recolors/renames of the base "Connection".
    "edgePrototypes": (() => {
      const out = {};
      if (edgePrototypes && typeof edgePrototypes.entries === 'function') {
        for (const [id, proto] of edgePrototypes) out[id] = proto;
      } else if (edgePrototypes && typeof edgePrototypes === 'object') {
        Object.assign(out, edgePrototypes);
      }
      return out;
    })(),

    // File-root quarantined unknown fields ride back out verbatim (D1/P1.3).
    // undefined is dropped by JSON.stringify, so absent when there is none.
    "_preserved": storeState._preserved
  };
  } catch (error) {
    console.error('[exportToRedstring] Error during export:', error);
    throw new Error(`Failed to export to Redstring format: ${error.message}`);
  }
};

/**
 * Import .redstring format into Zustand store
 */
export const importFromRedstring = (redstringData, storeActions) => {
  try {
    // Step 0: strip prototype-pollution keys at the ingestion chokepoint. Every
    // load path (file upload, Electron file:read, GitHub pull) funnels through
    // here, so this covers untrusted data regardless of which parser produced it.
    stripDangerousKeys(redstringData);

    // Step 1: Validate format version
    const validation = validateFormatVersion(redstringData);
    
    console.log('[Import] Format validation:', validation);
    
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    
    // Step 2: Run the migration ledger. This walks any older file up to the
    // current version AND guarantees the canonical top-level shape, so the
    // section read below never has to branch (the historical "prototypeSpace vs
    // legacy vs flat" three-way lives in migrations.js now). It is a near-no-op
    // for current-version files.
    const { data: processedData, applied } = runMigrations(redstringData, { now: new Date().toISOString() });
    if (applied.length > 0) {
      console.log('[Import] Migrations applied:', applied);
    }

    // Step 3: Single canonical shape — sections are guaranteed by the ledger.
    const nodesObj = processedData.prototypeSpace?.prototypes || {};
    const graphsObj = processedData.spatialGraphs?.graphs || {};
    // v3: edges in top-level relationships; v4: embedded inside each spatialGraph (D10/P3.2).
    // `!== undefined` distinguishes "absent" (v4) from "present but empty" (valid v3).
    const edgesObj = (() => {
      // `!= null` (not `!== undefined`): a file with `"edges": null` must fall
      // back to `{}`, not crash Object.entries and abort the whole import.
      if (processedData.relationships?.edges != null) {
        return processedData.relationships.edges;
      }
      if (processedData.relationships?.edges === null) {
        return {};
      }
      const collected = {};
      for (const g of Object.values(processedData.spatialGraphs?.graphs || {})) {
        Object.assign(collected, g['redstring:edges'] || {});
      }
      return collected;
    })();
    const userInterface = processedData.userInterface || {};

    //console.log('[DEBUG] Importing edges:', edgesObj);

    // Convert spatial graphs back to Maps and import to store
    const graphsMap = new Map();
    Object.entries(graphsObj).forEach(([id, graph]) => {
      try {
        // Handle both new semantic format and legacy format
        let instancesObj = {};
        let graphName = '';
        let graphDescription = '';
        let definingNodeIds = [];
        let edgeIds = [];
        
        if (graph['@type'] === 'redstring:SpatialGraph') {
          // New semantic format
          instancesObj = graph['redstring:instances'] || {};
          graphName = graph['rdfs:label'] || `Graph ${id}`;
          graphDescription = graph['rdfs:comment'] || '';
          definingNodeIds = ensureArray(graph['redstring:definingNodeIds']);
          edgeIds = ensureArray(graph['redstring:edgeIds']);
        } else {
          // Legacy format - handle both old nested structure and flat structure
          instancesObj = graph.instances || {};
          graphName = graph.name || `Graph ${id}`;
          graphDescription = graph.description || '';
          definingNodeIds = ensureArray(graph.definingNodeIds);
          edgeIds = ensureArray(graph.edgeIds);
        }

        // Convert groups back to Map with proper format conversion
        const groupsMap = new Map();
        let groupsObj = {};
        
        if (graph['@type'] === 'redstring:SpatialGraph') {
          // New semantic format
          groupsObj = graph['redstring:groups'] || {};
        } else {
          // Legacy format
          groupsObj = graph.groups || {};
        }
        
        Object.entries(groupsObj).forEach(([groupId, group]) => {
          try {
            let convertedGroup = {};
            
            if (group['@type'] === 'redstring:Group') {
              // Convert from new semantic format
              convertedGroup = {
                id: groupId,
                name: group['rdfs:label'] || 'Group',
                description: group['rdfs:comment'] || '',
                color: group['redstring:color'] || '#8B0000',
                memberInstanceIds: group['redstring:memberInstanceIds'] || [],
                semanticMetadata: group['redstring:semanticMetadata'] || {
                  type: 'Group',
                  relationships: [],
                  createdAt: new Date().toISOString(),
                  lastModified: new Date().toISOString()
                },
                // Preserve node-group properties
                linkedNodePrototypeId: group['redstring:linkedNodePrototypeId'] || group.linkedNodePrototypeId,
                linkedDefinitionIndex: group['redstring:linkedDefinitionIndex'] ?? group.linkedDefinitionIndex,
                hasCustomLayout: group['redstring:hasCustomLayout'] ?? group.hasCustomLayout,
                anchorInstanceId: group['redstring:anchorInstanceId'] || group.anchorInstanceId
              };
            } else {
              // Legacy format
              convertedGroup = {
                id: groupId,
                name: group.name || 'Group',
                description: group.description || '',
                color: group.color || '#8B0000',
                memberInstanceIds: group.memberInstanceIds || [],
                semanticMetadata: group.semanticMetadata || {
                  type: 'Group',
                  relationships: [],
                  createdAt: new Date().toISOString(),
                  lastModified: new Date().toISOString()
                },
                // Preserve node-group properties
                linkedNodePrototypeId: group.linkedNodePrototypeId,
                linkedDefinitionIndex: group.linkedDefinitionIndex,
                hasCustomLayout: group.hasCustomLayout,
                anchorInstanceId: group.anchorInstanceId
              };
            }
            
            groupsMap.set(groupId, convertedGroup);
          } catch (error) {
            console.warn(`[importFromRedstring] Error processing group ${groupId}:`, error);
          }
        });

        // Convert instances back to Map with proper format conversion
        const instancesMap = new Map();
        Object.entries(instancesObj).forEach(([instanceId, instance]) => {
          const convertedInstance = { id: instanceId };

          if (instance['@type'] === 'redstring:Instance') {
            const prototypeId = instance['redstring:prototypeId'] || fromIri(instance['rdf:type']?.['@id']);
            if (prototypeId) {
              convertedInstance.prototypeId = prototypeId;
            }

            const label = instance['rdfs:label'];
            if (label !== undefined && label !== null) {
              convertedInstance.name = label;
            }

            const comment = instance['rdfs:comment'];
            if (comment !== undefined && comment !== null) {
              convertedInstance.description = comment;
            }

            const spatial = ensureObject(instance['redstring:spatialContext']);
            const posX = spatial['redstring:xCoordinate'];
            const posY = spatial['redstring:yCoordinate'];
            const scaleValue = spatial['redstring:spatialScale'];

            convertedInstance.x = (posX !== undefined ? posX : instance.x) ?? 0;
            convertedInstance.y = (posY !== undefined ? posY : instance.y) ?? 0;

            if (scaleValue !== undefined || instance.scale !== undefined) {
              convertedInstance.scale = (scaleValue !== undefined ? scaleValue : instance.scale);
            }

            const visual = ensureObject(instance['redstring:visualProperties']);
            const expandedValue = visual['redstring:expanded'];
            if (expandedValue !== undefined) {
              convertedInstance.expanded = expandedValue;
            } else if (instance.expanded !== undefined) {
              convertedInstance.expanded = instance.expanded;
            }

            const visibleValue = visual['redstring:visible'];
            if (visibleValue !== undefined) {
              convertedInstance.visible = visibleValue;
            } else if (instance.visible !== undefined) {
              convertedInstance.visible = instance.visible;
            }

            // Group anchor properties
            if (instance['redstring:isGroupAnchor']) {
              convertedInstance.isGroupAnchor = true;
            }
            if (instance['redstring:anchorForGroupId']) {
              convertedInstance.anchorForGroupId = instance['redstring:anchorForGroupId'];
            }
          } else {
            // Legacy format - retain original structure
            convertedInstance.prototypeId = instance.prototypeId;
            if (instance.name !== undefined) convertedInstance.name = instance.name;
            if (instance.description !== undefined) convertedInstance.description = instance.description;
            convertedInstance.x = (instance.x !== undefined ? instance.x : 0);
            convertedInstance.y = (instance.y !== undefined ? instance.y : 0);
            if (instance.scale !== undefined) convertedInstance.scale = instance.scale;
            if (instance.expanded !== undefined) convertedInstance.expanded = instance.expanded;
            if (instance.visible !== undefined) convertedInstance.visible = instance.visible;

            // Preserve any additional legacy properties
            Object.entries(instance).forEach(([key, value]) => {
              if (!(key in convertedInstance)) {
                convertedInstance[key] = value;
              }
            });
          }

          // Carry the quarantine bag onto the store object (opaque cargo, D1/P1.3)
          if (instance._preserved) convertedInstance._preserved = instance._preserved;

          instancesMap.set(instanceId, convertedInstance);
        });

        const graphShape = {
          id,
          name: graphName,
          description: graphDescription,
          instances: instancesMap
        };

        if (groupsMap.size > 0) {
          graphShape.groups = groupsMap;
        }

        const cleanDefiningNodeIds = definingNodeIds.filter((value) => value !== undefined && value !== null && value !== '');
        if (cleanDefiningNodeIds.length > 0) {
          graphShape.definingNodeIds = cleanDefiningNodeIds;
        }

        const cleanEdgeIds = edgeIds.filter((value) => value !== undefined && value !== null && value !== '');
        if (cleanEdgeIds.length > 0) {
          graphShape.edgeIds = cleanEdgeIds;
        }

        // Extract viewport state for this graph
        if (graph['@type'] === 'redstring:SpatialGraph') {
          // New semantic format
          if (graph['redstring:panOffset']) {
            graphShape.panOffset = graph['redstring:panOffset'];
          }
          if (graph['redstring:zoomLevel'] !== undefined) {
            graphShape.zoomLevel = graph['redstring:zoomLevel'];
          }
        } else {
          // Legacy format
          if (graph.panOffset) {
            graphShape.panOffset = graph.panOffset;
          }
          if (graph.zoomLevel !== undefined) {
            graphShape.zoomLevel = graph.zoomLevel;
          }
        }

        // Restore semantic/visual graph fields (see export). Only set when
        // present so absent-in-old-file leaves the store default intact.
        const directedRaw = graph['redstring:directed'] ?? graph.directed;
        if (directedRaw !== undefined) graphShape.directed = directedRaw !== false;
        const colorRaw = graph['redstring:color'] ?? graph.color;
        if (colorRaw != null) graphShape.color = colorRaw;
        const pictureRaw = graph['redstring:picture'] ?? graph.picture;
        if (pictureRaw != null) graphShape.picture = pictureRaw;
        const createdAtRaw = graph['redstring:createdAt'] ?? graph.createdAt;
        if (createdAtRaw != null) graphShape.createdAt = createdAtRaw;

        // Carry the quarantine bag onto the store object (opaque cargo, D1/P1.3)
        if (graph._preserved) graphShape._preserved = graph._preserved;

        graphsMap.set(id, graphShape);
      } catch (error) {
        console.warn(`[importFromRedstring] Error processing graph ${id}:`, error);
        // Create a minimal valid graph to prevent crashes
        const fallbackGraph = {
          id,
          name: graph?.name || graph?.['rdfs:label'] || 'Unknown Graph',
          description: graph?.description || graph?.['rdfs:comment'] || 'Graph with import error',
          instances: new Map(),
          groups: new Map(), // Include groups in fallback
          edgeIds: [],
          definingNodeIds: []
        };
        graphsMap.set(id, fallbackGraph);
      }
    });

    const nodesMap = new Map();
    Object.entries(nodesObj).forEach(([id, prototype]) => {
      try {
        let convertedPrototype = {};
        
        if (prototype['@type']?.includes('redstring:Prototype')) {
          const spatial = ensureObject(prototype['redstring:spatialContext']);
          const visual = ensureObject(prototype['redstring:visualProperties']);
          const cognitive = ensureObject(prototype['redstring:cognitiveProperties']);
          const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

          convertedPrototype = { id };

          if (hasOwn(prototype, 'name') || hasOwn(prototype, 'rdfs:label')) {
            convertedPrototype.name = coalesce(prototype.name, prototype['rdfs:label']);
          }

          if (hasOwn(prototype, 'description') || hasOwn(prototype, 'rdfs:comment')) {
            convertedPrototype.description = coalesce(prototype.description, prototype['rdfs:comment']);
          }

          if (hasOwn(prototype, 'x') || hasOwn(spatial, 'redstring:xCoordinate')) {
            convertedPrototype.x = coalesce(prototype.x, spatial['redstring:xCoordinate']);
          }

          if (hasOwn(prototype, 'y') || hasOwn(spatial, 'redstring:yCoordinate')) {
            convertedPrototype.y = coalesce(prototype.y, spatial['redstring:yCoordinate']);
          }

          if (hasOwn(prototype, 'scale') || hasOwn(spatial, 'redstring:spatialScale')) {
            convertedPrototype.scale = coalesce(prototype.scale, spatial['redstring:spatialScale']);
          }

          if (hasOwn(prototype, 'color') || hasOwn(visual, 'redstring:cognitiveColor')) {
            convertedPrototype.color = coalesce(prototype.color, visual['redstring:cognitiveColor']);
          }

          // Detect auto-enriched nodes to skip importing their embedded image data
          // (auto-enriched images are re-fetched from Wikipedia URLs in semanticMetadata)
          // Check multiple signals: semanticMetadata flag OR wikipedia URL in external links (old files)
          const smRaw = prototype['redstring:semanticMetadata'] ?? prototype.semanticMetadata;
          // External links may sit on any sameness-ladder rung (D8/P2.5): owl:sameAs
          // (bare URLs) or skos:exactMatch/closeMatch ({@id} refs). Flatten them to
          // a plain URL list for both auto-enrich detection and link recovery.
          const ladderUrl = (v) => (v && typeof v === 'object') ? v['@id'] : v;
          const linksRaw = [
            ...ensureArray(prototype['owl:sameAs']),
            ...ensureArray(prototype['skos:exactMatch']),
            ...ensureArray(prototype['skos:closeMatch']),
            ...ensureArray(prototype.externalLinks)
          ].map(ladderUrl).filter((u) => u !== undefined && u !== null && u !== '');
          // Only treat images as re-fetchable (droppable) when the node is
          // EXPLICITLY flagged auto-enriched AND we still have the Wikipedia
          // thumbnail URL to re-fetch from. The old heuristic — "any node with
          // a wikipedia.org external link" — silently dropped user-uploaded
          // photos from nodes that merely happened to cite Wikipedia, with no
          // way to get them back. When in doubt, KEEP the image.
          const isAutoEnriched = !!smRaw?.autoEnriched && !!smRaw?.wikipediaThumbnail;

          if (!isAutoEnriched) {
            if (hasOwn(prototype, 'imageSrc') || hasOwn(visual, 'redstring:imageSrc')) {
              convertedPrototype.imageSrc = coalesce(prototype.imageSrc, visual['redstring:imageSrc']);
            }

            if (hasOwn(prototype, 'thumbnailSrc') || hasOwn(visual, 'redstring:thumbnailSrc')) {
              convertedPrototype.thumbnailSrc = coalesce(prototype.thumbnailSrc, visual['redstring:thumbnailSrc']);
            }
          }

          if (hasOwn(prototype, 'imageAspectRatio') || hasOwn(visual, 'redstring:imageAspectRatio')) {
            convertedPrototype.imageAspectRatio = coalesce(prototype.imageAspectRatio, visual['redstring:imageAspectRatio']);
          }

          // Semantic enrichment metadata (Wikipedia URLs, confidence, auto-enrich flag)
          if (hasOwn(prototype, 'redstring:semanticMetadata') || hasOwn(prototype, 'semanticMetadata')) {
            convertedPrototype.semanticMetadata = prototype['redstring:semanticMetadata'] ?? prototype.semanticMetadata ?? null;
          }

          // Recover external links from a single ladder rung (D8/P2.5), preferring
          // owl:sameAs, then skos:exactMatch/closeMatch, then a legacy flat list.
          // Reading one rung (not the union) avoids double-counting the same links
          // emitted on two rungs, and preserves any duplicates the store held.
          const sameAsRung =
            hasOwn(prototype, 'owl:sameAs') ? prototype['owl:sameAs']
            : hasOwn(prototype, 'skos:exactMatch') ? prototype['skos:exactMatch']
            : hasOwn(prototype, 'skos:closeMatch') ? prototype['skos:closeMatch']
            : prototype.externalLinks;
          convertedPrototype.externalLinks = ensureArray(sameAsRung).map(ladderUrl);

          if (hasOwn(prototype, 'owl:equivalentClass') || hasOwn(prototype, 'equivalentClasses')) {
            convertedPrototype.equivalentClasses = ensureArray(prototype['owl:equivalentClass'] ?? prototype.equivalentClasses);
          }

          if (hasOwn(prototype, 'redstring:citations') || hasOwn(prototype, 'citations')) {
            convertedPrototype.citations = ensureArray(prototype['redstring:citations'] ?? prototype.citations);
          }

          // Abstraction-chain flags + createdAt (round-trip with export above)
          if (hasOwn(prototype, 'redstring:isSpecificityChainNode') || hasOwn(prototype, 'isSpecificityChainNode')) {
            convertedPrototype.isSpecificityChainNode = !!(prototype['redstring:isSpecificityChainNode'] ?? prototype.isSpecificityChainNode);
          }
          if (hasOwn(prototype, 'redstring:hasSpecificityChain') || hasOwn(prototype, 'hasSpecificityChain')) {
            convertedPrototype.hasSpecificityChain = !!(prototype['redstring:hasSpecificityChain'] ?? prototype.hasSpecificityChain);
          }
          if (hasOwn(prototype, 'redstring:createdAt') || hasOwn(prototype, 'createdAt')) {
            convertedPrototype.createdAt = prototype['redstring:createdAt'] ?? prototype.createdAt;
          }

          if (hasOwn(prototype, 'redstring:definitionGraphIds') || hasOwn(prototype, 'definitionGraphIds')) {
            convertedPrototype.definitionGraphIds = ensureArray(prototype['redstring:definitionGraphIds'] ?? prototype.definitionGraphIds).filter((value) => value !== undefined && value !== null && value !== '');
          }

          if (hasOwn(prototype, 'redstring:bio') || hasOwn(prototype, 'bio')) {
            convertedPrototype.bio = prototype['redstring:bio'] ?? prototype.bio;
          }

          if (hasOwn(prototype, 'redstring:conjugation') || hasOwn(prototype, 'conjugation')) {
            convertedPrototype.conjugation = prototype['redstring:conjugation'] ?? prototype.conjugation;
          }

          if (hasOwn(prototype, 'redstring:typeNodeId') || hasOwn(prototype, 'typeNodeId') || hasOwn(prototype, 'rdfs:subClassOf')) {
            convertedPrototype.typeNodeId = coalesce(
              prototype['redstring:typeNodeId'],
              coalesce(
                prototype.typeNodeId,
                fromIri(prototype['rdfs:subClassOf']?.['@id'])
              )
            );
          }

          if (hasOwn(prototype, 'redstring:abstractionChains') || hasOwn(prototype, 'abstractionChains')) {
            convertedPrototype.abstractionChains = ensureObject(
              prototype['redstring:abstractionChains'] ?? prototype.abstractionChains
            );
          }

          if (hasOwn(cognitive, 'redstring:personalMeaning') || hasOwn(prototype, 'personalMeaning')) {
            convertedPrototype.personalMeaning = coalesce(cognitive['redstring:personalMeaning'], prototype.personalMeaning);
          }

          if (hasOwn(cognitive, 'redstring:cognitiveAssociations') || hasOwn(prototype, 'cognitiveAssociations')) {
            convertedPrototype.cognitiveAssociations = ensureArray(
              cognitive['redstring:cognitiveAssociations'] ?? prototype.cognitiveAssociations
            );
          }

          // Agent configuration
          if (hasOwn(prototype, 'redstring:agentConfig') || hasOwn(prototype, 'agentConfig')) {
            convertedPrototype.agentConfig = prototype['redstring:agentConfig'] ?? prototype.agentConfig ?? null;
          } else {
            convertedPrototype.agentConfig = null; // Default to null if not present
          }
        } else {
          // Legacy format - handle old structure
          const { spatial = {}, media = {}, cognitive = {}, semantic = {}, ...nodeData } = prototype;
          convertedPrototype = {
            ...nodeData,
            id,
            x: spatial.x || 0,
            y: spatial.y || 0,
            scale: spatial.scale || 1.0,
            imageSrc: media.image,
            thumbnailSrc: media.thumbnail,
            imageAspectRatio: media.aspectRatio,
            externalLinks: semantic.externalLinks || [],
            equivalentClasses: semantic.equivalentClasses || [],
            citations: semantic.citations || [],
            agentConfig: nodeData.agentConfig || null // Preserve agentConfig if present in legacy format
          };
        }
        
        if (convertedPrototype.definitionGraphIds) {
          convertedPrototype.definitionGraphIds = convertedPrototype.definitionGraphIds.filter((value) => value !== undefined && value !== null && value !== '');
        }

        if (convertedPrototype.externalLinks) {
          convertedPrototype.externalLinks = convertedPrototype.externalLinks.map((value) => value);
        }

        if (convertedPrototype.equivalentClasses) {
          convertedPrototype.equivalentClasses = convertedPrototype.equivalentClasses.map((value) => value);
        }

        if (convertedPrototype.citations) {
          convertedPrototype.citations = convertedPrototype.citations.map((value) => value);
        }

        Object.keys(convertedPrototype).forEach((key) => {
          if (convertedPrototype[key] === undefined) {
            delete convertedPrototype[key];
          }
        });

        // Carry the quarantine bag onto the store object (opaque cargo, D1/P1.3)
        if (prototype._preserved) convertedPrototype._preserved = prototype._preserved;

        nodesMap.set(id, convertedPrototype);
        
        // Note: rdfs:subClassOf relationships are preserved in the semantic format
        // but don't need to be imported back into abstractionChains as they are
        // generated dynamically from abstractionChains during export
      } catch (error) {
        console.warn(`[importFromRedstring] Error processing prototype ${id}:`, error);
        // Create a minimal valid prototype to prevent crashes
        const fallbackPrototype = {
          id,
          name: prototype?.['rdfs:label'] || prototype?.name || 'Unknown Prototype',
          description: prototype?.['rdfs:comment'] || prototype?.description || 'Prototype with import error',
          color: prototype?.['redstring:visualProperties']?.['redstring:cognitiveColor'] || 
                 prototype?.color || '#8B0000',
          x: 0,
          y: 0,
          scale: 1.0,
          externalLinks: [],
          equivalentClasses: [],
          definitionGraphIds: [],
          abstractionChains: {}
        };
        nodesMap.set(id, fallbackPrototype);
      }
    });

    const edgesMap = new Map();
    Object.entries(edgesObj).forEach(([id, edge]) => {
      try {
        //console.log('[DEBUG] Processing edge:', id, edge);
        let edgeData;
        
        // Check if this is the new dual-format (has both native and RDF data)
        if (edge.sourceId && edge.destinationId && edge.hasOwnProperty('rdfStatements')) {
          //console.log('[DEBUG] Edge is in dual format');
          // Use the native Redstring format for the application
          edgeData = {
            id: edge.id,
            sourceId: edge.sourceId,
            destinationId: edge.destinationId,
            name: edge.name,
            description: edge.description,
            typeNodeId: edge.typeNodeId,
            definitionNodeIds: edge.definitionNodeIds,
            directionality: edge.directionality,
          };
          // Edge provenance rides in semanticMetadata (P2.6)
          const edgeSemMeta = edge['redstring:semanticMetadata'] ?? edge.semanticMetadata;
          if (edgeSemMeta) edgeData.semanticMetadata = edgeSemMeta;
        }
        // Check if this is an old RDF statement format (legacy)
        else if (edge['@type'] === 'Statement' && edge.subject && edge.object) {
          //console.log('[DEBUG] Edge is in legacy RDF statement format');
          // Reconstruct from RDF statement format
          edgeData = {
            id,
            name: edge.name,
            description: edge.description,
            sourceId: edge.originalSourceId || fromIri(edge.subject['@id']),
            destinationId: edge.originalDestinationId || fromIri(edge.object['@id']),
            typeNodeId: fromIri(edge.predicate?.['@id']),
          };
        }
        // This is the old format - use the edge data directly
        else {
          //console.log('[DEBUG] Edge is in old format');
          edgeData = {
            ...edge,
            id // Ensure ID is preserved
          };
        }
        
        //console.log('[DEBUG] Final edge data:', edgeData);
        
        // Convert directionality.arrowsToward from Array back to Set if it exists
        if (edgeData.directionality && edgeData.directionality.arrowsToward) {
          if (Array.isArray(edgeData.directionality.arrowsToward)) {
            edgeData.directionality.arrowsToward = new Set(edgeData.directionality.arrowsToward);
          } else if (edgeData.directionality.arrowsToward instanceof Set) {
            // Already a Set, no conversion needed
          } else {
            // Invalid format, reset to empty Set
            edgeData.directionality.arrowsToward = new Set();
          }
        } else if (!edgeData.directionality) {
          // Ensure directionality exists for backwards compatibility
          edgeData.directionality = { arrowsToward: new Set() };
        } else if (!edgeData.directionality.arrowsToward) {
          // directionality exists but arrowsToward is missing
          edgeData.directionality.arrowsToward = new Set();
        }
        
        // Carry the quarantine bag onto the store object (opaque cargo, D1/P1.3)
        if (edge._preserved) edgeData._preserved = edge._preserved;

        edgesMap.set(id, edgeData);
      } catch (error) {
        console.warn(`[importFromRedstring] Error processing edge ${id}:`, error);
        // Create a minimal valid edge to prevent crashes
        const fallbackEdge = {
          id,
          sourceId: edge?.sourceId || `unknown-${id}`,
          destinationId: edge?.destinationId || `unknown-${id}`,
          name: edge?.name || 'Unknown Edge',
          description: edge?.description || 'Edge with import error',
          typeNodeId: edge?.typeNodeId || null,
          definitionNodeIds: edge?.definitionNodeIds || [],
          directionality: { arrowsToward: new Set() }
        };
        edgesMap.set(id, fallbackEdge);
      }
    });

    //console.log('[DEBUG] Final edges map:', edgesMap);

    // Note: abstractionChains are stored directly on node prototypes

    // Extract UI state from either new format or legacy format
    const uiState = userInterface || {};
    const extractedOpenGraphIds = uiState['redstring:openGraphIds'] || uiState.openGraphIds || [];
    const extractedActiveGraphId = uiState['redstring:activeGraphId'] || uiState.activeGraphId || null;
    const extractedActiveDefinitionNodeId = uiState['redstring:activeDefinitionNodeId'] || uiState.activeDefinitionNodeId || null;
    const extractedExpandedGraphIds = uiState['redstring:expandedGraphIds'] || uiState.expandedGraphIds || [];
    const extractedRightPanelTabs = uiState['redstring:rightPanelTabs'] || uiState.rightPanelTabs || [];
    const extractedSavedNodeIds = uiState['redstring:savedNodeIds'] || uiState.savedNodeIds || [];
    const extractedSavedGraphIds = uiState['redstring:savedGraphIds'] || uiState.savedGraphIds || [];
    const extractedShowConnectionNames = uiState['redstring:showConnectionNames'] ?? uiState.showConnectionNames ?? true;
    const extractedWizardPlansByConversation = uiState['redstring:wizardPlansByConversation'] || {};

    // Rehydrate custom edge prototypes (connection types). Absent in older
    // files — the store re-seeds base + agent types, so leaving the Map empty
    // (rather than undefined) lets the store merge defaults back in.
    const edgePrototypesMap = new Map();
    const edgeProtoObj = processedData.edgePrototypes || {};
    if (edgeProtoObj && typeof edgeProtoObj === 'object') {
      for (const [id, proto] of Object.entries(edgeProtoObj)) {
        edgePrototypesMap.set(id, proto);
      }
    }

    // Return the converted state for file storage to use
    const storeState = {
      graphs: graphsMap,
      nodePrototypes: nodesMap,
      edges: edgesMap,
      edgePrototypes: edgePrototypesMap,
      openGraphIds: Array.isArray(extractedOpenGraphIds) ? extractedOpenGraphIds : [],
      activeGraphId: extractedActiveGraphId,
      activeDefinitionNodeId: extractedActiveDefinitionNodeId,
      expandedGraphIds: new Set(Array.isArray(extractedExpandedGraphIds) ? extractedExpandedGraphIds : []),
      rightPanelTabs: Array.isArray(extractedRightPanelTabs) ? extractedRightPanelTabs : [],
      savedNodeIds: new Set(Array.isArray(extractedSavedNodeIds) ? extractedSavedNodeIds : []),
      savedGraphIds: new Set(Array.isArray(extractedSavedGraphIds) ? extractedSavedGraphIds : []),
      showConnectionNames: !!extractedShowConnectionNames,
      wizardPlansByConversation: extractedWizardPlansByConversation
    };

    // Carry the file-root quarantine bag through (opaque cargo, D1/P1.3)
    if (processedData._preserved) storeState._preserved = processedData._preserved;

    const importedTabs = extractedRightPanelTabs;

    // If no tabs are loaded or the array is empty, default to the home tab.
    if (!Array.isArray(importedTabs) || importedTabs.length === 0) {
      storeState.rightPanelTabs = [{ type: 'home', isActive: true }];
    } else {
      // Ensure at least one tab is active
      const isAnyTabActive = importedTabs.some(tab => tab && tab.isActive);
      if (!isAnyTabActive && importedTabs.length > 0) {
        // Find the home tab and make it active, or the first tab as a fallback
        const homeTabIndex = importedTabs.findIndex(tab => tab && tab.type === 'home');
        if (homeTabIndex > -1) {
          importedTabs[homeTabIndex].isActive = true;
        } else {
          importedTabs[0].isActive = true;
        }
      }
      storeState.rightPanelTabs = importedTabs;
    }
    
    return {
      storeState,
      errors: [], // For now, no error handling
      version: {
        imported: validation.version,
        current: CURRENT_FORMAT_VERSION,
        migrated: validation.needsMigration,
        migratedTo: validation.needsMigration ? CURRENT_FORMAT_VERSION : null
      }
    };
  } catch (error) {
    console.error('[importFromRedstring] Critical error during import:', error);
    // FAIL LOUDLY. This used to return an empty universe "to prevent complete
    // failure" — but a caller cannot distinguish that from a legitimately
    // empty file, so the empty state would flow into the store, become the
    // new save baseline, and the next autosave would overwrite the user's
    // real file with nothing. A failed import must surface as a failed load.
    throw new Error(`Failed to import Redstring file: ${error.message}`);
  }
};

/**
 * Generate file download for .redstring format
 */
export const downloadRedstringFile = (storeState, filename = 'cognitive-space.redstring') => {
  const redstringData = exportToRedstring(storeState);
  const jsonString = JSON.stringify(redstringData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Handle file upload and import
 */
export const uploadRedstringFile = (file, storeActions) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // Prototype-pollution-safe parse: strips __proto__/constructor/prototype
        // keys before the untrusted file data flows into the store.
        const redstringData = safeJsonParse(e.target.result);
        if (!redstringData || typeof redstringData !== 'object' || Array.isArray(redstringData)) {
          throw new Error('Redstring file must contain a JSON object at the top level');
        }
        importFromRedstring(redstringData, storeActions);
        resolve(redstringData);
      } catch (error) {
        reject(new Error(`Failed to parse Redstring file: ${error.message}`));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}; 
