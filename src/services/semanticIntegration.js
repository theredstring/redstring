/**
 * Semantic Integration - Unified API
 *
 * High-level API that combines semantic discovery, entity matching,
 * and radial layout into a cohesive system.
 */

import { discoverConnections, discoverConnectionGraph } from './semanticDiscovery.js';
import { deduplicateEntities, calculateEntityMatchConfidence, mergeEntities } from './entityMatching.js';
import { layoutRadialGraph, calculateNodeDimensions } from './radialLayout.js';

/**
 * Complete semantic discovery workflow
 * Discovers connections, deduplicates entities, and generates radial layout
 *
 * @param {string} entityName - Entity to explore
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Complete semantic graph with layout
 */
export async function exploreEntity(entityName, options = {}) {
  const {
    maxDepth = 2,
    maxConnectionsPerLevel = 20,
    timeout = 30000,
    minConfidence = 0.6,
    enableDeduplication = true,
    generateLayout = true,
    sources = ['dbpedia', 'wikidata']
  } = options;

  console.log(`[SemanticIntegration] Exploring "${entityName}" with maxDepth=${maxDepth}`);

  try {
    // Step 1: Discover connections
    const discoveryResult = maxDepth === 1
      ? await discoverConnections(entityName, {
          timeout: timeout * 0.6,
          limit: maxConnectionsPerLevel,
          minConfidence,
          sources
        })
      : await discoverConnectionGraph(entityName, {
          maxDepth,
          maxPerLevel: maxConnectionsPerLevel,
          timeout,
          minConfidence
        });

    console.log(`[SemanticIntegration] Discovered ${discoveryResult.connections?.length || discoveryResult.graph?.edges?.length || 0} connections`);

    // Step 2: Build entity list from connections
    let entities = [];
    let connections = [];

    if (maxDepth === 1) {
      // Simple connection result
      connections = discoveryResult.connections;

      // Extract unique entities
      const entityMap = new Map();
      entityMap.set(entityName, {
        name: entityName,
        source: 'query',
        confidence: 1.0
      });

      for (const conn of connections) {
        if (!entityMap.has(conn.target)) {
          entityMap.set(conn.target, {
            name: conn.target,
            uri: conn.targetUri,
            description: conn.description,
            source: conn.provider,
            confidence: conn.confidence
          });
        }
      }

      entities = Array.from(entityMap.values());

    } else {
      // Graph result
      const graph = discoveryResult.graph;
      entities = Array.from(graph.nodes.values());
      connections = graph.edges;
    }

    console.log(`[SemanticIntegration] Extracted ${entities.length} entities before deduplication`);

    // Step 3: Deduplicate entities if enabled
    let deduplicatedEntities = entities;
    let deduplicationInfo = null;

    if (enableDeduplication && entities.length > 1) {
      const deduplicationResult = deduplicateEntities(entities, {
        autoMergeThreshold: 0.85,
        returnDuplicates: true
      });

      deduplicatedEntities = deduplicationResult.deduplicated || deduplicationResult;
      deduplicationInfo = {
        originalCount: entities.length,
        deduplicatedCount: deduplicatedEntities.length,
        mergedGroups: deduplicationResult.duplicateGroups?.length || 0
      };

      console.log(`[SemanticIntegration] Deduplication: ${entities.length} → ${deduplicatedEntities.length} entities`);
    }

    // Step 4: Organize into orbits by distance from center
    const orbits = [];
    const centralEntity = deduplicatedEntities.find(e =>
      e.name === entityName || e.isRoot
    ) || deduplicatedEntities[0];

    // Remove central entity from list
    const orbitEntities = deduplicatedEntities.filter(e => e !== centralEntity);

    // Group by level/distance
    const byLevel = new Map();
    for (const entity of orbitEntities) {
      const level = entity.level || 1;
      if (!byLevel.has(level)) {
        byLevel.set(level, []);
      }
      byLevel.get(level).push(entity);
    }

    // Convert to orbit array
    const maxLevel = Math.max(...byLevel.keys(), 1);
    for (let i = 1; i <= maxLevel; i++) {
      orbits.push({
        level: i,
        entities: byLevel.get(i) || []
      });
    }

    console.log(`[SemanticIntegration] Organized into ${orbits.length} orbits`);

    // Step 5: Generate radial layout if enabled
    let layout = null;
    if (generateLayout) {
      layout = layoutRadialGraph(centralEntity, orbits, connections, {
        baseRadius: 180,
        orbitSpacing: 140,
        minNodeMargin: 28
      });

      console.log(`[SemanticIntegration] Generated layout with ${layout.nodes.length} positioned nodes`);
    }

    // Return comprehensive result
    return {
      entity: entityName,
      central: centralEntity,
      entities: deduplicatedEntities,
      connections,
      orbits,
      layout,
      metadata: {
        totalEntities: deduplicatedEntities.length,
        totalConnections: connections.length,
        orbitCount: orbits.length,
        deduplication: deduplicationInfo,
        sources: discoveryResult.metadata?.sources || sources,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error('[SemanticIntegration] Entity exploration failed:', error);
    throw error;
  }
}

/**
 * Quick discovery without layout (faster)
 */
export async function quickDiscover(entityName, options = {}) {
  return await exploreEntity(entityName, {
    ...options,
    maxDepth: 1,
    generateLayout: false,
    maxConnectionsPerLevel: 15
  });
}

/**
 * Deep exploration with multi-level connections
 */
export async function deepExplore(entityName, options = {}) {
  return await exploreEntity(entityName, {
    ...options,
    maxDepth: 2,
    generateLayout: true,
    maxConnectionsPerLevel: 20
  });
}

/**
 * Find similar entities for comparison
 */
export async function findSimilarEntities(entityName, candidateNames, options = {}) {
  const { timeout = 10000, sources = ['dbpedia', 'wikidata'] } = options;

  // Fetch data for all candidates
  const fetchPromises = [entityName, ...candidateNames].map(name =>
    discoverConnections(name, {
      timeout: timeout / (candidateNames.length + 1),
      limit: 10,
      sources
    })
  );

  const results = await Promise.allSettled(fetchPromises);
  const entities = [];

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      const result = results[i].value;
      entities.push({
        name: i === 0 ? entityName : candidateNames[i - 1],
        connections: result.connections,
        metadata: result.metadata
      });
    }
  }

  // Calculate similarity scores
  const similarities = [];
  const mainEntity = entities[0];

  for (let i = 1; i < entities.length; i++) {
    const candidate = entities[i];

    // Simple similarity based on shared connections
    const sharedTargets = new Set(
      mainEntity.connections
        .map(c => c.target)
        .filter(t => candidate.connections.some(cc => cc.target === t))
    );

    const similarity = sharedTargets.size / Math.max(
      mainEntity.connections.length,
      candidate.connections.length,
      1
    );

    similarities.push({
      entity: candidate.name,
      similarity,
      sharedConnections: Array.from(sharedTargets)
    });
  }

  // Sort by similarity
  similarities.sort((a, b) => b.similarity - a.similarity);

  return {
    reference: entityName,
    candidates: similarities
  };
}

/**
 * Export for visualization frameworks
 */
export function exportForVisualization(explorationResult, format = 'd3') {
  if (format === 'd3') {
    // D3.js force graph format
    return {
      nodes: [
        {
          id: explorationResult.central.name,
          name: explorationResult.central.name,
          group: 0,
          radius: 20
        },
        ...explorationResult.entities
          .filter(e => e !== explorationResult.central)
          .map((entity, idx) => ({
            id: entity.name,
            name: entity.name,
            group: entity.level || 1,
            radius: 15 - (entity.level || 1) * 2
          }))
      ],
      links: explorationResult.connections.map(conn => ({
        source: conn.source,
        target: conn.target,
        value: conn.confidence * 10,
        label: conn.relation
      }))
    };
  }

  if (format === 'cytoscape') {
    // Cytoscape.js format
    return {
      elements: [
        // Nodes
        ...explorationResult.entities.map(entity => ({
          data: {
            id: entity.name,
            label: entity.name,
            level: entity.level || 0,
            description: entity.description
          }
        })),
        // Edges
        ...explorationResult.connections.map((conn, idx) => ({
          data: {
            id: `edge-${idx}`,
            source: conn.source,
            target: conn.target,
            label: conn.relation,
            weight: conn.confidence
          }
        }))
      ]
    };
  }

  // Default: return raw data
  return explorationResult;
}

/**
 * Example usage patterns
 */
export const examples = {
  // Quick lookup
  async quickLookup(entityName) {
    const result = await quickDiscover(entityName);
    console.log(`Found ${result.connections.length} connections for ${entityName}`);
    return result;
  },

  // Full exploration
  async fullExploration(entityName) {
    const result = await deepExplore(entityName, {
      maxDepth: 2,
      minConfidence: 0.65,
      sources: ['dbpedia', 'wikidata']
    });

    console.log('Exploration complete:');
    console.log(`- ${result.entities.length} entities`);
    console.log(`- ${result.connections.length} connections`);
    console.log(`- ${result.orbits.length} orbit levels`);

    if (result.layout) {
      console.log(`- Layout generated with ${result.layout.nodes.length} positioned nodes`);
    }

    return result;
  },

  // Compare entities
  async compareEntities(entity1, entity2) {
    const results = await Promise.all([
      quickDiscover(entity1),
      quickDiscover(entity2)
    ]);

    const connections1 = new Set(results[0].connections.map(c => c.target));
    const connections2 = new Set(results[1].connections.map(c => c.target));

    const shared = [...connections1].filter(c => connections2.has(c));

    console.log(`${entity1} and ${entity2} share ${shared.length} connections`);
    return { entity1, entity2, sharedConnections: shared };
  }
};
