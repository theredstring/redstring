/**
 * navigateDefinition - Navigate into a node's definition graph (agentic "Expand")
 *
 * Opens a node's definition graph as the active graph. If no definition graph exists,
 * signals that one should be created. If an empty definition graph exists, prefers
 * navigating to that (to populate it) rather than creating new.
 *
 * This is the agentic equivalent of clicking "Expand" on a node in the PieMenu.
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

export async function navigateDefinition(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeName, definitionIndex } = args;

  const { nodePrototypes = [], graphs = [] } = graphState;

  // Find the prototype by fuzzy matching name
  const prototype = findPrototypeByName(nodeName, nodePrototypes);

  if (!prototype) {
    throw new Error(`Node "${nodeName}" not found. Create it first before navigating into its definition graph.`);
  }

  const definitionGraphIds = Array.isArray(prototype.definitionGraphIds)
    ? prototype.definitionGraphIds
    : [];

  // If no definition graphs exist, signal creation
  if (definitionGraphIds.length === 0) {
    console.error(`[navigateDefinition] No definition graphs for "${nodeName}" - will create new`);
    return {
      action: 'navigateDefinition',
      prototypeId: prototype.id,
      nodeName: prototype.name,
      graphId: null,
      definitionIndex: null,
      created: true
    };
  }

  // If definitionIndex provided, use it
  let targetIndex = definitionIndex;

  // Otherwise, auto-select: prefer first empty graph, else first non-empty
  if (targetIndex === undefined || targetIndex === null) {
    // Find first empty definition graph
    let firstEmptyIndex = null;
    for (let i = 0; i < definitionGraphIds.length; i++) {
      const graphId = definitionGraphIds[i];
      const graph = graphs.find(g => g.id === graphId);
      if (graph) {
        const instances = Array.isArray(graph.instances)
          ? graph.instances
          : graph.instances instanceof Map
            ? Array.from(graph.instances.values())
            : Object.values(graph.instances || {});
        const nodeCount = instances.length;
        const edgeCount = Array.isArray(graph.edgeIds) ? graph.edgeIds.length : 0;
        const isEmpty = nodeCount === 0 && edgeCount === 0;

        if (isEmpty && firstEmptyIndex === null) {
          firstEmptyIndex = i;
          break; // Found first empty, use it
        }
      }
    }

    targetIndex = firstEmptyIndex !== null ? firstEmptyIndex : 0;
  }

  // Validate index
  if (targetIndex < 0 || targetIndex >= definitionGraphIds.length) {
    throw new Error(`Definition index ${targetIndex} out of range. Node "${nodeName}" has ${definitionGraphIds.length} definition graph(s).`);
  }

  const targetGraphId = definitionGraphIds[targetIndex];
  const targetGraph = graphs.find(g => g.id === targetGraphId);

  if (!targetGraph) {
    throw new Error(`Definition graph ${targetGraphId} not found in state. It may need to be loaded.`);
  }

  console.error(`[navigateDefinition] Navigating into "${nodeName}" definition graph #${targetIndex} (${targetGraphId})`);

  return {
    action: 'navigateDefinition',
    prototypeId: prototype.id,
    nodeName: prototype.name,
    graphId: targetGraphId,
    graphName: targetGraph.name,
    definitionIndex: targetIndex,
    created: false
  };
}
