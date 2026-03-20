/**
 * materializeSemanticEntities - Turn semantic discoveries into real Redstring nodes and edges
 *
 * The agent's version of dragging orbit candidates onto the canvas.
 * Delegates to the existing expandGraph action for store mutation.
 *
 * MUTATING tool: returns action: 'expandGraph' to reuse existing handlers.
 */

import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';

/**
 * Convert predicate string to Title Case for definitionNode name
 */
function predicateToTitle(predicate) {
  if (!predicate) return 'Connection';
  // Split camelCase: "isPartOf" → "is Part Of"
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
 * @param {Object} args - { entities, connections?, targetGraphId?, enrich?, palette? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} expandGraph-compatible action spec
 */
export async function materializeSemanticEntities(args, graphState) {
  const {
    entities = [],
    connections = [],
    targetGraphId,
    enrich = true,
    palette
  } = args;

  if (!entities || entities.length === 0) {
    throw new Error('entities array is required and must have at least one entry');
  }

  const { activeGraphId } = graphState;
  const graphId = targetGraphId || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  const activePalette = palette || getRandomPalette();

  // Build node specs
  const nodeSpecs = entities.map(e => ({
    name: e.name,
    color: resolvePaletteColor(activePalette, e.color || generateColor(e.name)),
    description: e.description || ''
  }));

  // Build edge specs from semantic connections
  const edgeSpecs = connections.map(c => {
    const typeName = predicateToTitle(c.relation || c.type || 'Connection');
    return {
      source: c.source,
      target: c.target,
      directionality: c.directionality || 'unidirectional',
      type: typeName,
      definitionNode: {
        name: typeName,
        color: resolvePaletteColor(activePalette, generateColor(typeName)),
        description: ''
      }
    };
  });

  console.error(`[materializeSemanticEntities] Materializing ${nodeSpecs.length} entities, ${edgeSpecs.length} connections into graph ${graphId}`);

  // Return expandGraph-compatible action — reuses existing store handler
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
