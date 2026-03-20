/**
 * importKnowledgeCluster - BFS-based knowledge import from the semantic web
 *
 * Agent version of the Semantic Discovery panel's "Load Wikidata slice".
 * Uses KnowledgeFederation to traverse related entities from a seed,
 * then delegates to expandGraph for store mutation.
 *
 * MUTATING tool: returns action: 'expandGraph' to reuse existing handlers.
 */

import { KnowledgeFederation } from '../../services/knowledgeFederation.js';
import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';
import { withSafeConsole } from './withSafeConsole.js';

/**
 * Convert predicate string to Title Case
 */
function predicateToTitle(predicate) {
  if (!predicate) return 'Connection';
  const spaced = predicate.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Generate a deterministic color from a name
 */
function generateColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

/**
 * @param {Object} args - { seedEntity, maxDepth?, maxEntitiesPerLevel?, sources?, targetGraphId?, enrich?, palette? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} expandGraph-compatible action spec
 */
export async function importKnowledgeCluster(args, graphState) {
  const {
    seedEntity,
    maxDepth = 1,
    maxEntitiesPerLevel = 5,
    sources = ['wikidata', 'dbpedia'],
    targetGraphId,
    enrich = true,
    palette
  } = args;

  if (!seedEntity || typeof seedEntity !== 'string' || seedEntity.trim() === '') {
    throw new Error('seedEntity is required and must be a non-empty string');
  }

  const { activeGraphId } = graphState;
  const graphId = targetGraphId || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // Cap depth and entities to prevent runaway queries
  const safeDepth = Math.min(Math.max(1, maxDepth), 2);
  const safeEntitiesPerLevel = Math.min(Math.max(1, maxEntitiesPerLevel), 15);

  console.error(`[importKnowledgeCluster] Importing cluster for "${seedEntity}" (depth=${safeDepth}, perLevel=${safeEntitiesPerLevel})`);

  // Create federation instance — pass null for graphStore since
  // only SPARQL queries are needed (no ConceptNet proxy)
  // Wrap in withSafeConsole because KnowledgeFederation uses console.log internally
  const clusterResult = await withSafeConsole(async () => {
    const federation = new KnowledgeFederation(null);
    return federation.importKnowledgeCluster(seedEntity.trim(), {
      maxDepth: safeDepth,
      maxEntitiesPerLevel: safeEntitiesPerLevel,
      includeSources: sources,
      includeRelationships: true
    });
  });

  if (!clusterResult || clusterResult.totalEntities === 0) {
    return {
      message: `No semantic web data found for "${seedEntity}". Try a different entity name.`,
      total: 0
    };
  }

  const activePalette = palette || getRandomPalette();

  // Convert federation entities to node specs
  const nodeSpecs = [];
  for (const [entityName, entityData] of clusterResult.entities) {
    // Pick the best description from available sources
    const description = (entityData.descriptions || []).find(d => d) || '';

    nodeSpecs.push({
      name: entityName,
      color: resolvePaletteColor(activePalette, generateColor(entityName)),
      description: typeof description === 'string' ? description.substring(0, 500) : ''
    });
  }

  // Convert federation relationships to edge specs
  const edgeSpecs = (clusterResult.relationships || []).map(rel => {
    const typeName = predicateToTitle(rel.predicate || rel.type || 'Connection');
    return {
      source: rel.source,
      target: rel.target,
      directionality: 'unidirectional',
      type: typeName,
      definitionNode: {
        name: typeName,
        color: resolvePaletteColor(activePalette, generateColor(typeName)),
        description: ''
      }
    };
  });

  console.error(`[importKnowledgeCluster] Cluster: ${nodeSpecs.length} entities, ${edgeSpecs.length} relationships`);

  // Return expandGraph-compatible action
  return {
    action: 'expandGraph',
    graphId,
    nodesAdded: nodeSpecs.map(n => n.name),
    edgesAdded: edgeSpecs,
    groupsAdded: [],
    nodeCount: nodeSpecs.length,
    edgeCount: edgeSpecs.length,
    groupCount: 0,
    droppedEdges: [],
    edgeWarning: null,
    enrich: enrich !== false,
    overwriteDescription: false,
    spec: {
      nodes: nodeSpecs,
      edges: edgeSpecs,
      groups: []
    }
  };
}
