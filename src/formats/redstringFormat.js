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

// Current format version
export const CURRENT_FORMAT_VERSION = '3.0.0';

// Minimum supported version (older versions must be migrated)
export const MIN_SUPPORTED_VERSION = '1.0.0';

// Version history and breaking changes
export const VERSION_HISTORY = {
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
 * Migrate data from older format versions to current version
 */
export const migrateFormat = (redstringData, fromVersion, toVersion = CURRENT_FORMAT_VERSION) => {
  console.log(`[Format Migration] Migrating from ${fromVersion} to ${toVersion}`);
  
  let migrated = { ...redstringData };
  const migrations = [];
  
  // Migration from v1.0.0 -> v2.0.0-semantic
  const compareV1 = compareVersions(fromVersion, '1.0.0');
  const compareV2 = compareVersions(fromVersion, '2.0.0');
  
  if (compareV1 === 0 || (compareV1 === 1 && compareV2 === -1)) {
    // File is v1.x, needs migration to v2
    console.log('[Format Migration] Applying v1 -> v2 migration');
    migrations.push('v1_to_v2');
    
    // v2 migration is handled by the existing import logic
    // which checks for prototypeSpace vs legacy format
    // Just ensure the format field is updated
    migrated.format = 'redstring-v2.0.0-semantic';
  }
  
  // Migration from v2.0.0-semantic -> v3.0.0
  if (compareVersions(fromVersion, '3.0.0') === -1) {
    console.log('[Format Migration] Applying v2 -> v3 migration');
    migrations.push('v2_to_v3');
    
    // Add new version metadata
    if (!migrated.metadata) {
      migrated.metadata = {};
    }
    
    migrated.metadata.version = CURRENT_FORMAT_VERSION;
    migrated.metadata.migrated = true;
    migrated.metadata.originalVersion = fromVersion;
    migrated.metadata.migrationDate = new Date().toISOString();
    migrated.metadata.migrationsApplied = migrations;
    
    // Update format string
    migrated.format = `redstring-v${CURRENT_FORMAT_VERSION}`;
  }
  
  console.log(`[Format Migration] Applied ${migrations.length} migrations:`, migrations);
  return migrated;
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

  // Complete OWL Vocabulary for Semantic Web Integration
  "owl": "http://www.w3.org/2002/07/owl#",
  "sameAs": { "@id": "owl:sameAs", "@type": "@id" },
  "equivalentClass": { "@id": "owl:equivalentClass", "@type": "@id" },
  "equivalentProperty": { "@id": "owl:equivalentProperty", "@type": "@id" },
  "differentFrom": { "@id": "owl:differentFrom", "@type": "@id" },
  "disjointWith": { "@id": "owl:disjointWith", "@type": "@id" },
  "inverseOf": { "@id": "owl:inverseOf", "@type": "@id" },
  "functionalProperty": "owl:FunctionalProperty",
  "inverseFunctionalProperty": "owl:InverseFunctionalProperty",
  "transitiveProperty": "owl:TransitiveProperty",
  "symmetricProperty": "owl:SymmetricProperty",
  
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
  "linkedThinking": "redstring:linkedThinking"
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
      name: graph?.name || 'Untitled Graph',
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
 * Export current Zustand store state to .redstring format
 * @param {Object} storeState - The current state from the Zustand store
 * @param {string} [userDomain] - User's domain for dynamic URI generation
 * @returns {Object} Redstring data with dynamic URIs
 */
export const exportToRedstring = (storeState, userDomain = null) => {
  try {
    if (!storeState) {
      throw new Error('Store state is required for export');
    }

    const {
      graphs = new Map(),
      nodePrototypes = new Map(),
      edges = new Map(),
      openGraphIds = [],
      activeGraphId = null,
      activeDefinitionNodeId = null,
      expandedGraphIds = new Set(),
      rightPanelTabs = [],
      savedNodeIds = new Set(),
      savedGraphIds = new Set(),
      showConnectionNames = false
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
          "@id": `instance:${instanceId}`,
          
          // RDF Schema: this individual belongs to prototype class
          "rdf:type": { "@id": `prototype:${instance.prototypeId}` },
          "rdfs:label": instance.name || null, // Don't generate fallback labels
          "rdfs:comment": instance.description || null,
          
          // Redstring: this instance is contained within specific graph
          "redstring:containedIn": { "@id": `graph:${graphId}` },
          
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
          "redstring:prototypeId": instance.prototypeId
        };
      });
    }
    
    spatialGraphs[graphId] = {
      "@type": "redstring:SpatialGraph", 
      "@id": `graph:${graphId}`,
      "rdfs:label": graph.name || `Graph ${graphId}`,
      "rdfs:comment": graph.description || "",
      
      // Graph-level properties
      "redstring:definingNodeIds": graph.definingNodeIds || [],
      "redstring:edgeIds": graph.edgeIds || [],
      
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
              "@id": `group:${groupId}`,
              "rdfs:label": group.name,
              "rdfs:comment": group.description || "",
              "redstring:color": group.color,
              "redstring:memberInstanceIds": group.memberInstanceIds || [],
              "redstring:semanticMetadata": group.semanticMetadata || {},
              // Node-group properties (for groups that represent nodes)
              "redstring:linkedNodePrototypeId": group.linkedNodePrototypeId,
              "redstring:linkedDefinitionIndex": group.linkedDefinitionIndex,
              "redstring:hasCustomLayout": group.hasCustomLayout,
              // RDF-style membership relationships
              "rdfs:member": (group.memberInstanceIds || []).map(memberId => ({
                "@id": `instance:${memberId}`
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
  });

  // Three-Layer Architecture: Export Prototypes as Semantic Classes
  const prototypeSpace = {};
  nodePrototypes.forEach((prototype, id) => {
    prototypeSpace[id] = {
      // RDF Schema typing - prototype is a class
      "@type": ["redstring:Prototype", "rdfs:Class", "schema:Thing"],
      "@id": `prototype:${id}`,
      
      // RDF Schema standard properties (W3C compliant) - preserve original
      "rdfs:label": prototype.name,
      "rdfs:comment": prototype.description,
      
      // Redstring core properties (NEVER override these)
      "name": prototype.name,
      "description": prototype.description,
      "rdfs:seeAlso": prototype.externalLinks || [],
      "rdfs:isDefinedBy": { "@id": "https://redstring.io" },
      
      // Type hierarchy - automatic rdfs:subClassOf relationships
      "rdfs:subClassOf": prototype.typeNodeId ? 
        { "@id": `type:${prototype.typeNodeId}` } : null,
      
      // Rosetta Stone mechanism - core semantic web linking
      "owl:sameAs": prototype.externalLinks || [],
      "owl:equivalentClass": prototype.equivalentClasses || [],
      
      // Redstring spatial properties (unique contribution to semantic web)
      "redstring:spatialContext": {
        "redstring:xCoordinate": prototype.x || 0,
        "redstring:yCoordinate": prototype.y || 0,
        "redstring:spatialScale": prototype.scale || 1.0
      },
      
      // Redstring visual properties
      "redstring:visualProperties": {
        "redstring:cognitiveColor": prototype.color,
        "redstring:imageSrc": prototype.imageSrc,
        "redstring:thumbnailSrc": prototype.thumbnailSrc,
        "redstring:imageAspectRatio": prototype.imageAspectRatio
      },
      
      // Redstring semantic properties
      "redstring:definitionGraphIds": prototype.definitionGraphIds || [],
      "redstring:bio": prototype.bio,
      "redstring:conjugation": prototype.conjugation,
      "redstring:typeNodeId": prototype.typeNodeId,
      "redstring:citations": prototype.citations || [],
      
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
      "redstring:agentConfig": prototype.agentConfig || null
    };
  });

  // Process abstraction chains to add additional subClassOf relationships
  nodePrototypes.forEach((node, nodeId) => {
    if (node.abstractionChains) {
      for (const dimension in node.abstractionChains) {
        const chain = node.abstractionChains[dimension];
        if (chain && chain.length > 1) {
          for (let i = 1; i < chain.length; i++) {
            const subClassId = chain[i];
            const superClassId = chain[i - 1];
            if (prototypeSpace[subClassId]) {
              if (!prototypeSpace[subClassId]['rdfs:subClassOf']) {
                prototypeSpace[subClassId]['rdfs:subClassOf'] = [];
              }
              // Add as an object to be expanded to a proper link by JSON-LD
              const superClassRef = { "@id": `prototype:${superClassId}` };
              // Avoid duplicates
              const existingSubClasses = Array.isArray(prototypeSpace[subClassId]['rdfs:subClassOf']) 
                ? prototypeSpace[subClassId]['rdfs:subClassOf'] 
                : [prototypeSpace[subClassId]['rdfs:subClassOf']];
              if (!existingSubClasses.some(item => item?.["@id"] === `prototype:${superClassId}`)) {
                existingSubClasses.push(superClassRef);
                prototypeSpace[subClassId]['rdfs:subClassOf'] = existingSubClasses;
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
        const statements = [];
        
        // Always add the forward direction
        statements.push({
          "@type": "Statement",
          "subject": { "@id": `node:${sourcePrototypeId}` },
          "predicate": { "@id": `node:${predicatePrototypeId}` },
          "object": { "@id": `node:${destinationPrototypeId}` },
        });
        
        // For non-directional connections, add the reverse direction
        if (edge.directionality && edge.directionality.arrowsToward && 
            (edge.directionality.arrowsToward instanceof Set ? 
             (edge.directionality.arrowsToward.size === 0) : 
             Array.isArray(edge.directionality.arrowsToward) ? 
             (edge.directionality.arrowsToward.length === 0) : true)) {
          statements.push({
            "@type": "Statement", 
            "subject": { "@id": `node:${destinationPrototypeId}` },
            "predicate": { "@id": `node:${predicatePrototypeId}` },
            "object": { "@id": `node:${sourcePrototypeId}` },
          });
        }
        
        return statements;
      })() : null,
      
      // Metadata for both formats
      "sourcePrototypeId": sourcePrototypeId,
      "destinationPrototypeId": destinationPrototypeId,
      "predicatePrototypeId": predicatePrototypeId,
    };
    
    //console.log('[DEBUG] Created dual-format edge:', id, edgesObj[id]);
  });

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
    "@type": "redstring:CognitiveSpace",
    "format": `redstring-v${CURRENT_FORMAT_VERSION}`,
    "metadata": {
      "version": CURRENT_FORMAT_VERSION,
      "created": new Date().toISOString(),
      "modified": new Date().toISOString(),
      "title": (activeGraphId && graphs.get(activeGraphId)?.name) || "Untitled Space",
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
      "@id": "space:prototypes",
      "rdfs:label": "Redstring Prototype Space",
      "rdfs:comment": "Collection of semantic classes with spatial properties",
      "prototypes": prototypeSpace
    },
    
    "spatialGraphs": {
      "@type": "redstring:SpatialGraphCollection", 
      "@id": "space:graphs",
      "rdfs:label": "Redstring Spatial Graphs",
      "rdfs:comment": "Collection of positioned instances within spatial graphs",
      "graphs": spatialGraphs
    },
    
    // Relationships as RDF statements/properties
    "relationships": {
      "@type": "redstring:RelationshipCollection",
      "@id": "space:relationships", 
      "rdfs:label": "Redstring Relationships",
      "rdfs:comment": "RDF statements representing connections between instances",
      "edges": edgesObj
    },
    
    // Direct accessors for backwards-compatibility with legacy tooling/tests
    "graphs": spatialGraphs,
    "nodePrototypes": prototypeSpace,
    "edges": edgesObj,
    
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
      "redstring:showConnectionNames": !!showConnectionNames
    },
    
    // Legacy compatibility (for backwards compatibility during transition)
    "legacy": {
      "graphs": spatialGraphs,
      "nodePrototypes": prototypeSpace,
      "edges": edgesObj
    },

    // Spatial metadata snapshots for agent/CLI workflows
    "graphLayouts": layoutSnapshot,
    "graphSummaries": summarySnapshot
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
    // Step 1: Validate format version
    const validation = validateFormatVersion(redstringData);
    
    console.log('[Import] Format validation:', validation);
    
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    
    // Step 2: Apply migrations if needed
    let processedData = redstringData;
    
    if (validation.needsMigration && validation.canAutoMigrate) {
      console.log(`[Import] Auto-migrating from ${validation.version} to ${validation.currentVersion}`);
      processedData = migrateFormat(redstringData, validation.version, validation.currentVersion);
      console.log('[Import] Migration complete');
    }
    
    // Step 3: Handle both new separated storage format and legacy format
    let graphsObj = {};
    let nodesObj = {};
    let edgesObj = {};
    let userInterface = {};
    
    if (processedData.prototypeSpace && processedData.spatialGraphs) {
      // New separated storage format (v2.0.0-semantic and v3.0.0)
      nodesObj = processedData.prototypeSpace.prototypes || {};
      graphsObj = processedData.spatialGraphs.graphs || {};
      edgesObj = processedData.relationships?.edges || {};
      userInterface = processedData.userInterface || {};
    } else if (processedData.legacy) {
      // Fallback to legacy section if available
      graphsObj = processedData.legacy.graphs || {};
      nodesObj = processedData.legacy.nodePrototypes || {};
      edgesObj = processedData.legacy.edges || {};
      userInterface = processedData.userInterface || {};
    } else {
      // Legacy format (v1.0.0)
      graphsObj = processedData.graphs || {};
      nodesObj = processedData.nodePrototypes || {};
      edgesObj = processedData.edges || {};
      userInterface = processedData.userInterface || {};
    }

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
                hasCustomLayout: group['redstring:hasCustomLayout'] ?? group.hasCustomLayout
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
                hasCustomLayout: group.hasCustomLayout
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
            const prototypeId = instance['redstring:prototypeId'] || instance['rdf:type']?.['@id']?.replace('prototype:', '');
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

          if (hasOwn(prototype, 'imageSrc') || hasOwn(visual, 'redstring:imageSrc')) {
            convertedPrototype.imageSrc = coalesce(prototype.imageSrc, visual['redstring:imageSrc']);
          }

          if (hasOwn(prototype, 'thumbnailSrc') || hasOwn(visual, 'redstring:thumbnailSrc')) {
            convertedPrototype.thumbnailSrc = coalesce(prototype.thumbnailSrc, visual['redstring:thumbnailSrc']);
          }

          if (hasOwn(prototype, 'imageAspectRatio') || hasOwn(visual, 'redstring:imageAspectRatio')) {
            convertedPrototype.imageAspectRatio = coalesce(prototype.imageAspectRatio, visual['redstring:imageAspectRatio']);
          }

          if (hasOwn(prototype, 'owl:sameAs') || hasOwn(prototype, 'externalLinks')) {
            convertedPrototype.externalLinks = ensureArray(prototype['owl:sameAs'] ?? prototype.externalLinks);
          }

          if (hasOwn(prototype, 'owl:equivalentClass') || hasOwn(prototype, 'equivalentClasses')) {
            convertedPrototype.equivalentClasses = ensureArray(prototype['owl:equivalentClass'] ?? prototype.equivalentClasses);
          }

          if (hasOwn(prototype, 'redstring:citations') || hasOwn(prototype, 'citations')) {
            convertedPrototype.citations = ensureArray(prototype['redstring:citations'] ?? prototype.citations);
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
                prototype['rdfs:subClassOf']?.['@id']?.replace('type:', '')
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
        }
        // Check if this is an old RDF statement format (legacy)
        else if (edge['@type'] === 'Statement' && edge.subject && edge.object) {
          //console.log('[DEBUG] Edge is in legacy RDF statement format');
          // Reconstruct from RDF statement format
          edgeData = {
            id,
            name: edge.name,
            description: edge.description,
            sourceId: edge.originalSourceId || edge.subject['@id'].replace('node:', ''),
            destinationId: edge.originalDestinationId || edge.object['@id'].replace('node:', ''),
            typeNodeId: edge.predicate?.['@id'].replace('node:', ''),
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
    const extractedShowConnectionNames = uiState['redstring:showConnectionNames'] || uiState.showConnectionNames || false;

    // Return the converted state for file storage to use
    const storeState = {
      graphs: graphsMap,
      nodePrototypes: nodesMap,
      edges: edgesMap,
      openGraphIds: Array.isArray(extractedOpenGraphIds) ? extractedOpenGraphIds : [],
      activeGraphId: extractedActiveGraphId,
      activeDefinitionNodeId: extractedActiveDefinitionNodeId,
      expandedGraphIds: new Set(Array.isArray(extractedExpandedGraphIds) ? extractedExpandedGraphIds : []),
      rightPanelTabs: Array.isArray(extractedRightPanelTabs) ? extractedRightPanelTabs : [],
      savedNodeIds: new Set(Array.isArray(extractedSavedNodeIds) ? extractedSavedNodeIds : []),
      savedGraphIds: new Set(Array.isArray(extractedSavedGraphIds) ? extractedSavedGraphIds : []),
      showConnectionNames: !!extractedShowConnectionNames
    };

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
    // Return a minimal valid state to prevent complete failure
    return {
      storeState: {
        graphs: new Map(),
        nodePrototypes: new Map(),
        edges: new Map(),
        openGraphIds: [],
        activeGraphId: null,
        activeDefinitionNodeId: null,
        expandedGraphIds: new Set(),
        rightPanelTabs: [{ type: 'home', isActive: true }],
        savedNodeIds: new Set(),
        savedGraphIds: new Set(),
        showConnectionNames: false
      },
      errors: [error.message]
    };
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
        const redstringData = JSON.parse(e.target.result);
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
