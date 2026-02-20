/**
 * expandGraph - Add multiple nodes and edges to the ACTIVE graph
 * 
 * Unlike createPopulatedGraph which creates a new graph, this adds to an existing one.
 * Uses the same direct UI application pattern (bypassing the queue) for reliability.
 */

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
 * @param {Object} args - { nodes: [{ name, color?, description? }], edges: [{ source, target, type?, definitionNode? }] }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { action, nodesAdded, edgesAdded, spec }
 */
export async function expandGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { nodes = [], edges = [] } = args;

  if (!nodes || nodes.length === 0) {
    throw new Error('nodes array is required');
  }

  const { activeGraphId } = graphState;

  if (!activeGraphId) {
    throw new Error('No active graph. Please open or create a graph first.');
  }

  // Build node specs
  const nodeSpecs = nodes.map(n => ({
    name: n.name,
    color: n.color || '#5B6CFF',
    description: n.description || ''
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
        color: inputDefNode?.color || generateConnectionColor(titleCaseName),
        description: inputDefNode?.description || ''
      } : null
    };
  });

  // Return full spec so UI can apply it directly (same pattern as createPopulatedGraph)
  return {
    action: 'expandGraph',
    graphId: activeGraphId,
    // For ToolCallCard summary (counts)
    nodesAdded: nodeSpecs.map(n => n.name),
    edgesAdded: edgeSpecs,
    nodeCount: nodeSpecs.length,
    edgeCount: edgeSpecs.length,
    // Include full spec for UI to apply
    spec: {
      nodes: nodeSpecs,
      edges: edgeSpecs
    }
  };
}
