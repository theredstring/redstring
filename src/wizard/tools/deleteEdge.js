/**
 * deleteEdge - Remove a connection between nodes
 */

/**
 * Resolve an edge by source/target names or edge name
 */
function resolveEdgeByName(edgeId, graphState) {
  const { graphs = [], activeGraphId } = graphState;
  const activeGraph = graphs.find(g => g.id === activeGraphId);
  if (!activeGraph) return null;

  // edgeId could be an actual edge ID or a descriptive name
  // For now, pass it through — the client will resolve
  return null;
}

/**
 * Delete an edge
 * @param {Object} args - { edgeId, sourceName?, targetName? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Delete spec for UI application
 */
export async function deleteEdge(args, graphState, cid, ensureSchedulerStarted) {
  const { edgeId, sourceName, targetName } = args;
  if (!edgeId && !sourceName) {
    throw new Error('edgeId or sourceName/targetName is required');
  }

  const { activeGraphId } = graphState;
  if (!activeGraphId) {
    throw new Error('No active graph');
  }

  return {
    action: 'deleteEdge',
    graphId: activeGraphId,
    edgeId: edgeId || null,
    sourceName: sourceName || null,
    targetName: targetName || null,
    deleted: true
  };
}
