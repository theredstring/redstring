/**
 * materializeSemanticEntities - Turn semantic discoveries into real Redstring nodes and edges
 *
 * The agent's version of dragging orbit candidates onto the canvas.
 * Delegates to the existing expandGraph action for store mutation.
 *
 * MUTATING tool: returns action: 'expandGraph' to reuse existing handlers.
 */

import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';
import titleCaseName from '../../utils/titleCaseName.js';
import { formatPredicate } from '../../utils/predicateFormatter.js';

/**
 * Names (lower-cased) of the Things already in a graph. An entity by one of
 * these names is connected to where it stands, not re-made — and not
 * re-coloured or re-described, which the bulk apply would otherwise do to a
 * reused node.
 */
function namesInGraph(graphState, graphId) {
  const graphs = Array.isArray(graphState?.graphs) ? graphState.graphs : [];
  const graph = graphs.find((g) => g?.id === graphId);
  const protoNames = new Map((graphState?.nodePrototypes || []).map((p) => [p.id, (p.name || '').trim().toLowerCase()]));
  const names = new Set();
  Object.values(graph?.instances || {}).forEach((inst) => {
    const name = protoNames.get(inst?.prototypeId);
    if (name) names.add(name);
  });
  return names;
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

  // Named the way the UI names semantic-web Things (title case, a word's own
  // capitals kept), so the same Thing added here and from the panel matches.
  const existing = namesInGraph(graphState, graphId);
  const nodeSpecs = entities.map(e => {
    const name = titleCaseName(e.name);
    if (existing.has(name.trim().toLowerCase())) return { name };
    return {
      name,
      color: resolvePaletteColor(activePalette, e.color || generateColor(name)),
      description: e.description || ''
    };
  });

  // Build edge specs from semantic connections, relations named as the UI names them
  const edgeSpecs = connections.map(c => {
    const typeName = formatPredicate(c.relation || c.type || 'Connection');
    return {
      source: titleCaseName(c.source),
      target: titleCaseName(c.target),
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
