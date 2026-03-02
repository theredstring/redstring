/**
 * condenseToNode - Package nodes into a new concept with definition graph
 *
 * Takes selected nodes in the active graph and packages them into a new concept.
 * Creates a group, converts it to a thing-group (which creates a definition graph
 * from the group members), and optionally collapses the group into a single node.
 *
 * This is the inverse of decomposeNode.
 */

/**
 * Resolve node names to instance IDs via fuzzy matching
 */
function resolveNodeNames(memberNames, activeGraph, nodePrototypes) {
  const resolvedIds = [];
  const nameToInstId = new Map();

  // Build name -> instanceId map
  const instances = Array.isArray(activeGraph.instances)
    ? activeGraph.instances
    : activeGraph.instances instanceof Map
      ? Array.from(activeGraph.instances.values())
      : Object.values(activeGraph.instances || {});

  for (const inst of instances) {
    const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
    const name = (inst.name || proto?.name || '').toLowerCase().trim();
    if (name) {
      nameToInstId.set(name, inst.id);
    }
  }

  // Resolve each member name
  for (const memberName of memberNames) {
    const nameLower = memberName.toLowerCase().trim();
    const instId = nameToInstId.get(nameLower);
    if (instId) {
      resolvedIds.push(instId);
    } else {
      console.error(`[condenseToNode] Warning: Could not resolve "${memberName}" to an instance ID`);
    }
  }

  return resolvedIds;
}

export async function condenseToNode(args, graphState, cid, ensureSchedulerStarted) {
  const { memberNames, nodeName, nodeColor, collapse = false } = args;

  const { graphs = [], activeGraphId, nodePrototypes = [] } = graphState;

  if (!activeGraphId) {
    throw new Error('No active graph. Cannot condense nodes without an active graph.');
  }

  const activeGraph = graphs.find(g => g.id === activeGraphId);
  if (!activeGraph) {
    throw new Error(`Active graph ${activeGraphId} not found in state.`);
  }

  if (!Array.isArray(memberNames) || memberNames.length === 0) {
    throw new Error('memberNames must be a non-empty array of node names to condense.');
  }

  // Resolve member names to instance IDs
  const resolvedMemberIds = resolveNodeNames(memberNames, activeGraph, nodePrototypes);

  if (resolvedMemberIds.length === 0) {
    throw new Error(`Could not find any of the specified nodes: ${memberNames.join(', ')}`);
  }

  if (resolvedMemberIds.length < memberNames.length) {
    const missing = memberNames.length - resolvedMemberIds.length;
    console.error(`[condenseToNode] Warning: ${missing} node(s) not found. Proceeding with ${resolvedMemberIds.length} nodes.`);
  }

  console.error(`[condenseToNode] Condensing ${resolvedMemberIds.length} node(s) into "${nodeName}"${collapse ? ' (collapsed)' : ''}`);

  return {
    action: 'condenseToNode',
    graphId: activeGraphId,
    memberNames,
    resolvedMemberIds,
    nodeName,
    nodeColor: nodeColor || '#8B0000',
    collapse
  };
}
