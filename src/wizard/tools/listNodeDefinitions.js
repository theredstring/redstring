/**
 * listNodeDefinitions - Inspect a node's definition graphs (read-only)
 *
 * Lists all definition graphs for a given node, showing which are empty,
 * their node/edge counts, and other metadata. This helps the agent decide
 * whether to navigate into an existing definition graph, populate an empty one,
 * or create a new one.
 */

/**
 * Fuzzy match node name against prototypes
 */
function findPrototypeByName(nodeName, nodePrototypes, graphState = null) {
  const nameLower = String(nodeName || '').toLowerCase().trim();
  if (!nameLower) return null;

  let matches = [];

  // Exact match first
  for (const proto of nodePrototypes) {
    if (String(proto.name || '').toLowerCase().trim() === nameLower) {
      matches.push(proto);
    }
  }

  // Partial match (contains) if no exact
  if (matches.length === 0) {
    for (const proto of nodePrototypes) {
      if (String(proto.name || '').toLowerCase().trim().includes(nameLower)) {
        matches.push(proto);
      }
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Prioritize active graph instances
  if (graphState && graphState.activeGraphId && graphState.graphs) {
    const activeGraph = graphState.graphs.find(g => g.id === graphState.activeGraphId);
    if (activeGraph && activeGraph.instances) {
      for (const match of matches) {
        if (activeGraph.instances.some(inst => inst.prototypeId === match.id)) {
          return match;
        }
      }
    }
  }

  // Fallback to least recent / most recent (UI did LAST)
  return matches[matches.length - 1];
}

/**
 * List the definition graphs attached to a node, including their size (node/edge count)
 * @param {Object} args - { nodeName } 
 * @param {Object} graphState - Current state
 */
export async function listNodeDefinitions(args, graphState) {
  const { nodeName } = args;

  if (!nodeName) {
    throw new Error('nodeName is required');
  }

  const { nodePrototypes = [], graphs = [] } = graphState;

  // Find the target prototype
  const prototype = findPrototypeByName(nodeName, nodePrototypes, graphState);

  if (!prototype) {
    throw new Error(`Node "${nodeName}" not found. Cannot list definition graphs.`);
  }

  // Get definition graph IDs
  const definitionGraphIds = Array.isArray(prototype.definitionGraphIds)
    ? prototype.definitionGraphIds
    : [];

  // Build definition graph metadata
  const definitionGraphs = [];
  let hasEmptyDefinitionGraph = false;
  let firstEmptyDefinitionIndex = null;

  for (let i = 0; i < definitionGraphIds.length; i++) {
    const graphId = definitionGraphIds[i];
    const graph = graphs.find(g => g.id === graphId);

    if (graph) {
      // Count nodes
      const instances = Array.isArray(graph.instances)
        ? graph.instances
        : graph.instances instanceof Map
          ? Array.from(graph.instances.values())
          : Object.values(graph.instances || {});
      const nodeCount = instances.length;

      // Count edges
      const edgeCount = Array.isArray(graph.edgeIds) ? graph.edgeIds.length : 0;

      const isEmpty = nodeCount === 0 && edgeCount === 0;
      if (isEmpty) {
        hasEmptyDefinitionGraph = true;
        if (firstEmptyDefinitionIndex === null) {
          firstEmptyDefinitionIndex = i;
        }
      }

      definitionGraphs.push({
        index: i,
        graphId: graph.id,
        graphName: graph.name || prototype.name || 'Unnamed',
        nodeCount,
        edgeCount,
        isEmpty
      });
    } else {
      // Definition graph ID exists but graph not found
      definitionGraphs.push({
        index: i,
        graphId,
        graphName: 'Unknown (graph not loaded)',
        nodeCount: 0,
        edgeCount: 0,
        isEmpty: true,
        error: 'Graph not found in state'
      });
    }
  }

  console.error(`[listNodeDefinitions] Found ${definitionGraphs.length} definition graph(s) for "${nodeName}"`);

  return {
    nodeName: prototype.name,
    prototypeId: prototype.id,
    definitionGraphCount: definitionGraphs.length,
    definitionGraphs,
    hasEmptyDefinitionGraph,
    firstEmptyDefinitionIndex
  };
}
