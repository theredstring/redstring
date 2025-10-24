/**
 * Semantic Discovery Service
 *
 * Enhanced SPARQL queries using property-path traversal for fast, targeted results
 * with clear relationship labels and confidence scoring.
 */

import { sparqlClient } from './sparqlClient.js';

/**
 * Property importance weights for different relationship types
 * Higher scores = more semantically meaningful connections
 */
const PROPERTY_WEIGHTS = {
  // DBpedia ontology properties (dbo:)
  'dbo:series': 0.95,
  'dbo:developer': 0.90,
  'dbo:publisher': 0.90,
  'dbo:creator': 0.90,
  'dbo:author': 0.90,
  'dbo:genre': 0.85,
  'dbo:platform': 0.85,
  'dbo:engine': 0.80,
  'dbo:composer': 0.80,
  'dbo:designer': 0.80,
  'dbo:director': 0.80,
  'dbo:producer': 0.75,
  'dbo:influencedBy': 0.75,
  'dbo:influenced': 0.75,
  'dbo:subsequentWork': 0.70,
  'dbo:previousWork': 0.70,
  'dbo:related': 0.60,
  'dbo:wikiPageWikiLink': 0.30, // Weak - just mentions

  // Wikidata properties (P-codes)
  'wdt:P123': 0.90, // publisher
  'wdt:P178': 0.90, // developer
  'wdt:P57': 0.90,  // director
  'wdt:P170': 0.90, // creator
  'wdt:P50': 0.90,  // author
  'wdt:P136': 0.85, // genre
  'wdt:P400': 0.85, // platform
  'wdt:P144': 0.80, // based on
  'wdt:P737': 0.75, // influenced by
  'wdt:P156': 0.70, // followed by
  'wdt:P155': 0.70, // follows

  // Default fallbacks
  'default': 0.50
};

/**
 * Human-readable labels for property URIs
 */
const PROPERTY_LABELS = {
  'dbo:series': 'part of series',
  'dbo:developer': 'developed by',
  'dbo:publisher': 'published by',
  'dbo:creator': 'created by',
  'dbo:author': 'authored by',
  'dbo:genre': 'genre',
  'dbo:platform': 'platform',
  'dbo:engine': 'uses engine',
  'dbo:composer': 'music by',
  'dbo:designer': 'designed by',
  'dbo:director': 'directed by',
  'dbo:producer': 'produced by',
  'dbo:influencedBy': 'influenced by',
  'dbo:influenced': 'influenced',
  'dbo:subsequentWork': 'followed by',
  'dbo:previousWork': 'preceded by',
  'dbo:related': 'related to',
  'dbo:wikiPageWikiLink': 'mentioned in',

  'wdt:P123': 'publisher',
  'wdt:P178': 'developer',
  'wdt:P57': 'director',
  'wdt:P170': 'creator',
  'wdt:P50': 'author',
  'wdt:P136': 'genre',
  'wdt:P400': 'platform',
  'wdt:P144': 'based on',
  'wdt:P737': 'influenced by',
  'wdt:P156': 'followed by',
  'wdt:P155': 'follows',
};

/**
 * Get property weight (confidence score for relationship type)
 */
function getPropertyWeight(propertyUri) {
  if (!propertyUri) return PROPERTY_WEIGHTS.default;

  // Extract short form (e.g., "dbo:series" from full URI)
  const shortForm = propertyUri.includes('/')
    ? propertyUri.split('/').pop()
    : propertyUri;

  // Check exact matches first
  for (const [key, weight] of Object.entries(PROPERTY_WEIGHTS)) {
    if (propertyUri.includes(key) || shortForm === key) {
      return weight;
    }
  }

  return PROPERTY_WEIGHTS.default;
}

/**
 * Get human-readable property label
 */
function getPropertyLabel(propertyUri) {
  if (!propertyUri) return 'related to';

  const shortForm = propertyUri.includes('/')
    ? propertyUri.split('/').pop()
    : propertyUri;

  for (const [key, label] of Object.entries(PROPERTY_LABELS)) {
    if (propertyUri.includes(key) || shortForm === key) {
      return label;
    }
  }

  // Generate fallback label from URI
  return shortForm
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim();
}

/**
 * Discover relationships using property-path queries (FAST!)
 * @param {string} entityName - Entity to find relationships for
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Connections with clear relationship labels
 */
export async function discoverDBpediaConnections(entityName, options = {}) {
  const { timeout = 15000, limit = 30 } = options;

  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[SemanticDiscovery] Invalid entityName for DBpedia connections:', entityName);
    return [];
  }

  const sanitizedEntityName = entityName.trim();
  const resourceUri = `http://dbpedia.org/resource/${sanitizedEntityName.replace(/\s+/g, '_')}`;

  // High-value properties to query (most semantically meaningful)
  const importantProperties = [
    'dbo:series', 'dbo:developer', 'dbo:publisher', 'dbo:creator', 'dbo:author',
    'dbo:genre', 'dbo:platform', 'dbo:engine', 'dbo:composer', 'dbo:designer',
    'dbo:director', 'dbo:producer', 'dbo:influencedBy', 'dbo:influenced',
    'dbo:subsequentWork', 'dbo:previousWork'
  ].join('|');

  // Property-path query (uses indexes - very fast!)
  const query = `
    PREFIX dbo: <http://dbpedia.org/ontology/>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

    SELECT DISTINCT ?property ?target ?targetLabel ?targetComment WHERE {
      # Start from our entity
      <${resourceUri}> ?property ?target .

      # Filter to important properties only
      FILTER(?property IN (${importantProperties.split('|').map(p => `dbo:${p.split(':')[1]}`).join(', ')}))

      # Get target label and description
      OPTIONAL { ?target rdfs:label ?targetLabel . FILTER(LANG(?targetLabel) = "en") }
      OPTIONAL { ?target rdfs:comment ?targetComment . FILTER(LANG(?targetComment) = "en") }

      # Ensure target is a resource (not literal)
      FILTER(isIRI(?target))
    } LIMIT ${limit}
  `;

  try {
    const results = await sparqlClient.executeQuery('dbpedia', query, { timeout });

    return results.map(binding => {
      const propertyUri = binding.property?.value;
      const targetUri = binding.target?.value;
      const targetLabel = binding.targetLabel?.value || targetUri?.split('/').pop();
      const targetComment = binding.targetComment?.value;

      const propertyWeight = getPropertyWeight(propertyUri);
      const propertyLabel = getPropertyLabel(propertyUri);

      return {
        source: sanitizedEntityName,
        target: targetLabel,
        targetUri: targetUri,
        relation: propertyLabel,
        relationUri: propertyUri,
        description: targetComment ? targetComment.substring(0, 200) : null,
        confidence: propertyWeight,
        distance: 1, // Direct connection
        provider: 'dbpedia'
      };
    }).sort((a, b) => b.confidence - a.confidence);

  } catch (error) {
    console.warn('[SemanticDiscovery] DBpedia property-path query failed:', error);
    return [];
  }
}

/**
 * Discover Wikidata relationships using property IDs
 * @param {string} entityName - Entity to find relationships for
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Connections with relationship labels
 */
export async function discoverWikidataConnections(entityName, options = {}) {
  const { timeout = 15000, limit = 30 } = options;

  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[SemanticDiscovery] Invalid entityName for Wikidata connections:', entityName);
    return [];
  }

  const sanitizedEntityName = entityName.trim();

  // First, find the entity ID
  const entityQuery = `
    SELECT ?item WHERE {
      ?item rdfs:label "${sanitizedEntityName}"@en .
    } LIMIT 1
  `;

  try {
    const entityResults = await sparqlClient.executeQuery('wikidata', entityQuery, { timeout: timeout * 0.3 });

    if (!entityResults || entityResults.length === 0) {
      return [];
    }

    const entityUri = entityResults[0].item?.value;

    // Now get relationships using important properties
    const relationQuery = `
      PREFIX wdt: <http://www.wikidata.org/prop/direct/>
      PREFIX wd: <http://www.wikidata.org/entity/>

      SELECT ?property ?target ?targetLabel WHERE {
        <${entityUri}> ?property ?target .

        # Filter to important properties
        FILTER(?property IN (
          wdt:P123, wdt:P178, wdt:P57, wdt:P170, wdt:P50,
          wdt:P136, wdt:P400, wdt:P144, wdt:P737, wdt:P156, wdt:P155
        ))

        # Get labels
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
      } LIMIT ${limit}
    `;

    const results = await sparqlClient.executeQuery('wikidata', relationQuery, { timeout: timeout * 0.7 });

    return results.map(binding => {
      const propertyUri = binding.property?.value;
      const targetUri = binding.target?.value;
      const targetLabel = binding.targetLabel?.value;

      const propertyWeight = getPropertyWeight(propertyUri);
      const propertyLabel = getPropertyLabel(propertyUri);

      return {
        source: sanitizedEntityName,
        target: targetLabel,
        targetUri: targetUri,
        relation: propertyLabel,
        relationUri: propertyUri,
        description: null,
        confidence: propertyWeight,
        distance: 1,
        provider: 'wikidata'
      };
    }).sort((a, b) => b.confidence - a.confidence);

  } catch (error) {
    console.warn('[SemanticDiscovery] Wikidata property-path query failed:', error);
    return [];
  }
}

/**
 * Combined federated discovery from multiple sources
 * @param {string} entityName - Entity to discover connections for
 * @param {Object} options - Discovery options
 * @returns {Promise<Object>} Structured discovery results
 */
export async function discoverConnections(entityName, options = {}) {
  const {
    timeout = 20000,
    limit = 50,
    sources = ['dbpedia', 'wikidata'],
    minConfidence = 0.5
  } = options;

  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[SemanticDiscovery] Invalid entityName for connection discovery:', entityName);
    return {
      entity: entityName,
      connections: [],
      byProvider: {},
      byRelation: {},
      metadata: {
        totalConnections: 0,
        sources: [],
        timestamp: new Date().toISOString(),
        error: 'Invalid entity name'
      }
    };
  }

  const sanitizedEntityName = entityName.trim();
  const results = {
    entity: sanitizedEntityName,
    connections: [],
    byProvider: {},
    byRelation: {},
    metadata: {
      totalConnections: 0,
      sources: [],
      timestamp: new Date().toISOString()
    }
  };

  try {
    const queries = [];

    // Query DBpedia if enabled
    if (sources.includes('dbpedia')) {
      queries.push(
        discoverDBpediaConnections(sanitizedEntityName, {
          timeout: timeout * 0.6,
          limit: Math.floor(limit * 0.6)
        })
      );
      results.metadata.sources.push('dbpedia');
    }

    // Query Wikidata if enabled
    if (sources.includes('wikidata')) {
      queries.push(
        discoverWikidataConnections(sanitizedEntityName, {
          timeout: timeout * 0.4,
          limit: Math.floor(limit * 0.4)
        })
      );
      results.metadata.sources.push('wikidata');
    }

    // Execute all queries in parallel
    const allResults = await Promise.allSettled(queries);

    // Collect all connections
    for (const result of allResults) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        results.connections.push(...result.value);
      }
    }

    // Filter by minimum confidence
    results.connections = results.connections.filter(conn =>
      conn.confidence >= minConfidence
    );

    // Sort by confidence
    results.connections.sort((a, b) => b.confidence - a.confidence);

    // Limit total results
    results.connections = results.connections.slice(0, limit);

    // Group by provider
    for (const conn of results.connections) {
      if (!results.byProvider[conn.provider]) {
        results.byProvider[conn.provider] = [];
      }
      results.byProvider[conn.provider].push(conn);
    }

    // Group by relation type
    for (const conn of results.connections) {
      if (!results.byRelation[conn.relation]) {
        results.byRelation[conn.relation] = [];
      }
      results.byRelation[conn.relation].push(conn);
    }

    results.metadata.totalConnections = results.connections.length;

    console.log(`[SemanticDiscovery] Discovered ${results.metadata.totalConnections} connections for "${sanitizedEntityName}"`);

    return results;

  } catch (error) {
    console.error('[SemanticDiscovery] Connection discovery failed:', error);
    results.metadata.error = error.message;
    return results;
  }
}

/**
 * Discover second-degree connections (connections of connections)
 * @param {string} entityName - Starting entity
 * @param {Object} options - Discovery options
 * @returns {Promise<Object>} Multi-level connection graph
 */
export async function discoverConnectionGraph(entityName, options = {}) {
  const {
    maxDepth = 2,
    maxPerLevel = 10,
    timeout = 30000,
    minConfidence = 0.6
  } = options;

  const graph = {
    nodes: new Map(),
    edges: [],
    levels: new Map()
  };

  // Add root node
  graph.nodes.set(entityName, {
    name: entityName,
    level: 0,
    isRoot: true
  });
  graph.levels.set(0, [entityName]);

  // Level 1: Direct connections
  const level1 = await discoverConnections(entityName, {
    timeout: timeout * 0.5,
    limit: maxPerLevel,
    minConfidence
  });

  const level1Entities = [];
  for (const conn of level1.connections) {
    if (!graph.nodes.has(conn.target)) {
      graph.nodes.set(conn.target, {
        name: conn.target,
        uri: conn.targetUri,
        level: 1,
        description: conn.description
      });
      level1Entities.push(conn.target);
    }

    graph.edges.push({
      source: entityName,
      target: conn.target,
      relation: conn.relation,
      confidence: conn.confidence,
      distance: 1
    });
  }
  graph.levels.set(1, level1Entities);

  // Level 2: Second-degree connections (if maxDepth >= 2)
  if (maxDepth >= 2) {
    const level2Queries = level1Entities.slice(0, Math.floor(maxPerLevel / 2)).map(entity =>
      discoverConnections(entity, {
        timeout: timeout * 0.3 / level1Entities.length,
        limit: 5,
        minConfidence: minConfidence + 0.1 // Higher threshold for second-degree
      })
    );

    const level2Results = await Promise.allSettled(level2Queries);
    const level2Entities = [];

    for (const result of level2Results) {
      if (result.status === 'fulfilled' && result.value.connections) {
        for (const conn of result.value.connections) {
          if (!graph.nodes.has(conn.target) && conn.target !== entityName) {
            graph.nodes.set(conn.target, {
              name: conn.target,
              uri: conn.targetUri,
              level: 2,
              description: conn.description
            });
            level2Entities.push(conn.target);
          }

          // Avoid duplicate edges
          const edgeExists = graph.edges.some(e =>
            e.source === conn.source && e.target === conn.target
          );

          if (!edgeExists && conn.source !== entityName && conn.target !== entityName) {
            graph.edges.push({
              source: conn.source,
              target: conn.target,
              relation: conn.relation,
              confidence: conn.confidence,
              distance: 2
            });
          }
        }
      }
    }
    graph.levels.set(2, level2Entities);
  }

  return {
    root: entityName,
    graph,
    stats: {
      totalNodes: graph.nodes.size,
      totalEdges: graph.edges.length,
      maxDepth,
      nodesByLevel: Object.fromEntries(graph.levels.entries())
    }
  };
}
