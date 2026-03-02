/**
 * decomposeNode - Replace a node with a thing-group of its definition graph contents
 *
 * Takes a node instance in the active graph that has a definition graph, and replaces it
 * with a thing-group containing the definition graph's nodes and edges. Like unpacking a
 * box - the box goes away, the parts are laid out.
 *
 * This is the inverse of condenseToNode.
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

export async function decomposeNode(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeName, definitionIndex = 0 } = args;

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;

  if (!activeGraphId) {
    throw new Error('No active graph. Cannot decompose nodes without an active graph.');
  }

  const activeGraph = graphs.find(g => g.id === activeGraphId);
  if (!activeGraph) {
    throw new Error(`Active graph ${activeGraphId} not found in state.`);
  }

  // Find the prototype
  const prototype = findPrototypeByName(nodeName, nodePrototypes);
  if (!prototype) {
    throw new Error(`Node "${nodeName}" not found. Cannot decompose a node that doesn't exist.`);
  }

  // Check definition graphs
  const definitionGraphIds = Array.isArray(prototype.definitionGraphIds)
    ? prototype.definitionGraphIds
    : [];

  if (definitionGraphIds.length === 0) {
    throw new Error(`Node "${nodeName}" has no definition graphs. Cannot decompose a node without a definition graph. Navigate into it first to create one.`);
  }

  if (definitionIndex < 0 || definitionIndex >= definitionGraphIds.length) {
    throw new Error(`Definition index ${definitionIndex} out of range. Node "${nodeName}" has ${definitionGraphIds.length} definition graph(s).`);
  }

  const definitionGraphId = definitionGraphIds[definitionIndex];
  const definitionGraph = graphs.find(g => g.id === definitionGraphId);

  if (!definitionGraph) {
    throw new Error(`Definition graph ${definitionGraphId} not found in state.`);
  }

  // Check if definition graph is empty
  const defInstances = Array.isArray(definitionGraph.instances)
    ? definitionGraph.instances
    : definitionGraph.instances instanceof Map
      ? Array.from(definitionGraph.instances.values())
      : Object.values(definitionGraph.instances || {});

  if (defInstances.length === 0) {
    throw new Error(`Definition graph for "${nodeName}" is empty. Cannot decompose an empty definition graph. Navigate into it and add content first.`);
  }

  // Find the instance of this node in the active graph (to remove it)
  const activeInstances = Array.isArray(activeGraph.instances)
    ? activeGraph.instances
    : activeGraph.instances instanceof Map
      ? Array.from(activeGraph.instances.values())
      : Object.values(activeGraph.instances || {});

  let originalInstanceId = null;
  for (const inst of activeInstances) {
    if (inst.prototypeId === prototype.id) {
      originalInstanceId = inst.id;
      break;
    }
  }

  if (!originalInstanceId) {
    throw new Error(`No instance of "${nodeName}" found in active graph. Cannot decompose a node that doesn't have an instance in the current graph.`);
  }

  // Build definition instances data (with prototype names for context)
  const definitionInstances = defInstances.map(inst => {
    const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
    return {
      instanceId: inst.id,
      prototypeId: inst.prototypeId,
      name: inst.name || proto?.name || 'Unnamed',
      x: inst.x || 0,
      y: inst.y || 0,
      scale: inst.scale || 1
    };
  });

  const definitionEdgeIds = Array.isArray(definitionGraph.edgeIds) ? definitionGraph.edgeIds : [];

  console.error(`[decomposeNode] Decomposing "${nodeName}" - will replace instance ${originalInstanceId} with ${definitionInstances.length} node(s) from definition graph`);

  return {
    action: 'decomposeNode',
    prototypeId: prototype.id,
    nodeName: prototype.name,
    graphId: activeGraphId,
    originalInstanceId,
    definitionIndex,
    definitionGraphId,
    definitionInstances,
    definitionEdgeIds
  };
}
