import { resolveGraphId } from './resolveGraphId.js';

/**
 * updateGroup - Update a group's name, color, or members
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
 * Update a group
 * @param {Object} args - { groupId?, groupName?, newName?, newColor?, addMembers?, removeMembers?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Update spec for UI application
 */
export async function updateGroup(args, graphState, cid, ensureSchedulerStarted) {
  const { groupId, groupName, newName, newColor, addMembers = [], removeMembers = [], targetGraphId } = args;

  const { activeGraphId, graphs = [] } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs) || activeGraphId;

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

  const updates = {};
  if (newName !== undefined) updates.name = newName;
  if (newColor !== undefined) updates.color = newColor;
  if (addMembers.length > 0) updates.addMembers = addMembers;
  if (removeMembers.length > 0) updates.removeMembers = removeMembers;

  console.error('[updateGroup] Updating group:', groupName || groupId, '| resolved:', resolvedGroupId || 'will resolve on client', '| updates:', Object.keys(updates));

  return {
    action: 'updateGroup',
    graphId,
    groupId: resolvedGroupId || null,
    groupName: groupName || null,
    updates,
    updated: true
  };
}
