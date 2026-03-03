/**
 * deleteGroup - Delete a group (keeps member nodes)
 */

/**
 * Find group by name in a graph
 */
function findGroupByName(name, graphState, graphId) {
  const { graphs = [] } = graphState;
  if (!graphId) return null;

  const graph = graphs.find(g => g.id === graphId);
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
 * @param {Object} args - { groupId?, groupName?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Delete spec for UI application
 */
export async function deleteGroup(args, graphState, cid, ensureSchedulerStarted) {
  const { groupId, groupName, targetGraphId } = args;

  const { activeGraphId } = graphState;
  const graphId = targetGraphId || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // Resolve group ID from name if needed
  let resolvedGroupId = groupId;
  if (!resolvedGroupId && groupName) {
    const group = findGroupByName(groupName, graphState, graphId);
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
    graphId,
    groupId: resolvedGroupId || null,
    groupName: groupName || null,
    deleted: true
  };
}
