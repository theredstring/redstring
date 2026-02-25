/**
 * deleteGroup - Delete a group (keeps member nodes)
 */

/**
 * Find group by name in active graph
 */
function findGroupByName(name, graphState) {
  const { graphs = [], activeGraphId } = graphState;
  if (!activeGraphId) return null;

  const graph = graphs.find(g => g.id === activeGraphId);
  if (!graph || !graph.groups) return null;

  const groupsIterable = graph.groups instanceof Map
    ? Array.from(graph.groups.values())
    : Array.isArray(graph.groups)
      ? graph.groups
      : Object.values(graph.groups);

  const nameLower = String(name || '').toLowerCase();
  return groupsIterable.find(g =>
    String(g.name || '').toLowerCase() === nameLower
  );
}

/**
 * Delete a group
 * @param {Object} args - { groupId?, groupName? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Delete spec for UI application
 */
export async function deleteGroup(args, graphState, cid, ensureSchedulerStarted) {
  const { groupId, groupName } = args;

  const { activeGraphId } = graphState;

  if (!activeGraphId) {
    throw new Error('No active graph. Please open or create a graph first.');
  }

  // Resolve group ID from name if needed
  let resolvedGroupId = groupId;
  if (!resolvedGroupId && groupName) {
    const group = findGroupByName(groupName, graphState);
    if (group) {
      resolvedGroupId = group.id;
    }
  }

  if (!resolvedGroupId && !groupName) {
    throw new Error('Either groupId or groupName is required.');
  }

  console.error('[deleteGroup] Deleting group:', groupName || groupId, '| resolved:', resolvedGroupId || 'will resolve on client');

  return {
    action: 'deleteGroup',
    graphId: activeGraphId,
    groupId: resolvedGroupId || null,
    groupName: groupName || null,
    deleted: true
  };
}
