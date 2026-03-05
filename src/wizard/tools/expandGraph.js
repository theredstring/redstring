/**
 * expandGraph - Add multiple nodes and edges to a graph
 *
 * Unlike createPopulatedGraph which creates a new graph, this adds to an existing one.
 * Can target any graph via targetGraphId, or defaults to active graph.
 * Uses the same direct UI application pattern (bypassing the queue) for reliability.
 */

import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';

/**
 * Convert string to Title Case
 */
function toTitleCase(str) {
  if (!str) return '';
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Generate a deterministic color from a name
 */
function generateConnectionColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

/**
 * Expand graph with multiple nodes and edges
 * @param {Object} args - { nodes: [{ name, color?, description? }], edges: [{ source, target, type?, definitionNode? }], targetGraphId?: string }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { action, nodesAdded, edgesAdded, spec }
 */
export async function expandGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { nodes = [], edges = [], groups = [], targetGraphId, palette } = args;

  if ((!nodes || nodes.length === 0) && (!edges || edges.length === 0)) {
    throw new Error('At least one node or edge is required');
  }

  const { activeGraphId } = graphState;
  const graphId = targetGraphId || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // Pick a palette if none provided
  const activePalette = palette || getRandomPalette();

  // Build node specs
  const nodeSpecs = nodes.map(n => ({
    name: n.name,
    color: resolvePaletteColor(activePalette, n.color),
    description: n.description || '',
    type: n.type || null,
    typeColor: resolvePaletteColor(activePalette, n.typeColor || '#A0A0A0'),
    typeDescription: n.typeDescription || ''
  }));

  // Build edge specs with definitionNode handling (same as createPopulatedGraph)
  const edgeSpecs = (edges || []).map(e => {
    const inputDefNode = e.definitionNode;
    const typeName = inputDefNode?.name || e.type || '';
    const titleCaseName = toTitleCase(typeName);

    return {
      source: e.source,
      target: e.target,
      directionality: e.directionality || 'unidirectional',
      type: titleCaseName || 'Connection',
      definitionNode: titleCaseName ? {
        name: titleCaseName,
        color: resolvePaletteColor(activePalette, inputDefNode?.color || generateConnectionColor(titleCaseName)),
        description: inputDefNode?.description || ''
      } : null
    };
  });

  const groupSpecs = (groups || []).map(g => ({
    name: g.name,
    color: resolvePaletteColor(activePalette, g.color || '#8B0000'),
    memberNames: g.memberNames || []
  }));

  // Return full spec so UI can apply it directly (same pattern as createPopulatedGraph)
  return {
    action: 'expandGraph',
    graphId, // Can be activeGraphId or targetGraphId
    // For ToolCallCard summary (counts)
    nodesAdded: nodeSpecs.map(n => n.name),
    edgesAdded: edgeSpecs,
    groupsAdded: groupSpecs.map(g => g.name),
    nodeCount: nodeSpecs.length,
    edgeCount: edgeSpecs.length,
    groupCount: groupSpecs.length,
    // Include full spec for UI to apply
    spec: {
      nodes: nodeSpecs,
      edges: edgeSpecs,
      groups: groupSpecs
    }
  };
}
