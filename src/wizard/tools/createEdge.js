/**
 * createEdge - Connect two nodes by name
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
 * Create an edge between two nodes
 * @param {Object} args - { sourceId, targetId, type }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Edge spec for UI application
 */
export async function createEdge(args, graphState, cid, ensureSchedulerStarted) {
  const { sourceId, targetId, type } = args;
  if (!sourceId || !targetId) {
    throw new Error('sourceId and targetId are required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  if (!activeGraphId) {
    throw new Error('No active graph');
  }

  // Resolve source and target by name
  const resolvedSource = resolveNodeByName(sourceId, nodePrototypes, graphs, activeGraphId);
  const resolvedTarget = resolveNodeByName(targetId, nodePrototypes, graphs, activeGraphId);

  if (resolvedSource) {
    console.error('[createEdge] Resolved source:', sourceId, '→', resolvedSource.instanceId);
  } else {
    console.warn('[createEdge] Source not found in graphState, delegating to client:', sourceId);
  }

  if (resolvedTarget) {
    console.error('[createEdge] Resolved target:', targetId, '→', resolvedTarget.instanceId);
  } else {
    console.warn('[createEdge] Target not found in graphState, delegating to client:', targetId);
  }

  return {
    action: 'createEdge',
    graphId: activeGraphId,
    sourceName: resolvedSource?.name || sourceId,
    targetName: resolvedTarget?.name || targetId,
    sourceInstanceId: resolvedSource?.instanceId || null,
    targetInstanceId: resolvedTarget?.instanceId || null,
    type: type || '',
    created: true
  };
}
