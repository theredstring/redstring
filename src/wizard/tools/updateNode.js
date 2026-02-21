/**
 * updateNode - Update an existing node's properties
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

  // Try exact match first, then substring
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
 * Update a node
 * @param {Object} args - { nodeName, name?, color?, description? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Update spec for UI application
 */
export async function updateNode(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeName, nodeId, name, color, description } = args;
  const lookupName = nodeName || nodeId;
  if (!lookupName) {
    throw new Error('nodeName is required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  if (!activeGraphId) {
    throw new Error('No active graph');
  }

  const resolved = resolveNodeByName(lookupName, nodePrototypes, graphs, activeGraphId);

  if (resolved) {
    console.log('[updateNode] Resolved:', lookupName, '→', resolved.prototypeId);
  } else {
    // Node not in server-side graphState — still return action so client can resolve by name
    console.warn('[updateNode] Not found in graphState, delegating to client:', lookupName);
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (color !== undefined) updates.color = color;
  if (description !== undefined) updates.description = description;

  return {
    action: 'updateNode',
    prototypeId: resolved?.prototypeId || null,
    instanceId: resolved?.instanceId || null,
    originalName: resolved?.name || lookupName,
    updates,
    updated: true
  };
}
