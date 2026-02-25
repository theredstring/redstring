/**
 * deleteNode - Remove a node and its connections
 */

/**
 * Resolve a node by name from graph state
 */
function resolveNodeByName(name, nodePrototypes, graphs, activeGraphId) {
  const queryLower = (name || '').toLowerCase().trim();
  if (!queryLower) return null;

  const activeGraph = graphs.find(g => g.id === activeGraphId);
  if (!activeGraph) return null;

  const instances = Array.isArray(activeGraph.instances)
    ? activeGraph.instances
    : activeGraph.instances instanceof Map
      ? Array.from(activeGraph.instances.values())
      : Object.values(activeGraph.instances || {});

  // Try exact match first
  for (const inst of instances) {
    const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
    const nodeName = (inst.name || proto?.name || '').toLowerCase().trim();
    if (nodeName === queryLower) {
      return { instanceId: inst.id, prototypeId: inst.prototypeId, name: inst.name || proto?.name };
    }
  }

  // Substring match fallback
  for (const inst of instances) {
    const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
    const nodeName = (inst.name || proto?.name || '').toLowerCase().trim();
    if (nodeName.includes(queryLower) || queryLower.includes(nodeName)) {
      return { instanceId: inst.id, prototypeId: inst.prototypeId, name: inst.name || proto?.name };
    }
  }

  return null;
}

/**
 * Delete a node
 * @param {Object} args - { nodeName }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Delete spec for UI application
 */
export async function deleteNode(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeName, nodeId, name } = args;
  const lookupName = nodeName || nodeId || name;
  if (!lookupName) {
    throw new Error('nodeName is required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  if (!activeGraphId) {
    throw new Error('No active graph');
  }

  const resolved = resolveNodeByName(lookupName, nodePrototypes, graphs, activeGraphId);

  if (resolved) {
    console.error('[deleteNode] Resolved:', lookupName, '→', resolved.instanceId);
  } else {
    // Node not in server-side graphState — still return action so client can resolve by name
    console.warn('[deleteNode] Not found in graphState, delegating to client:', lookupName);
  }

  return {
    action: 'deleteNode',
    graphId: activeGraphId,
    instanceId: resolved?.instanceId || null,
    prototypeId: resolved?.prototypeId || null,
    name: resolved?.name || lookupName,
    deleted: true
  };
}
