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
function findPrototypeByName(nodeName, nodePrototypes) {
  const nameLower = String(nodeName || '').toLowerCase().trim();
  if (!nameLower) return null;

  // Exact match first
  for (const proto of nodePrototypes) {
    if (String(proto.name || '').toLowerCase().trim() === nameLower) {
      return proto;
    }
  }

  // Partial match (contains)
  for (const proto of nodePrototypes) {
    if (String(proto.name || '').toLowerCase().trim().includes(nameLower)) {
      return proto;
    }
  }

  return null;
}

export async function listNodeDefinitions(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeName } = args;

  const { nodePrototypes = [], graphs = [] } = graphState;

  // Find the prototype by fuzzy matching name
  const prototype = findPrototypeByName(nodeName, nodePrototypes);

  if (!prototype) {
    return {
      error: `Node "${nodeName}" not found`,
      nodeName,
      found: false
    };
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
