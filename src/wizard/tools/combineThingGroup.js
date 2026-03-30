import { resolveGraphId } from './resolveGraphId.js';

/**
 * combineThingGroup - Collapse a Thing-Group back into a single node
 * This replaces all group members with a single instance of the linked Thing.
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
 * Combine (collapse) a Thing-Group into a single node
 * @param {Object} args - { groupId?, groupName?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Combine spec for UI application
 */
export async function combineThingGroup(args, graphState, cid, ensureSchedulerStarted) {
  const { groupId, groupName, targetGraphId } = args;

  const { activeGraphId, graphs = [] } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // Resolve group ID from name if needed
  let resolvedGroupId = groupId;
  let groupData = null;
  if (!resolvedGroupId && groupName) {
    groupData = findGroupByName(groupName, graphState, graphId);
    if (groupData) {
      resolvedGroupId = groupData.id;
    }
  }

  if (!resolvedGroupId && !groupName) {
    throw new Error('Either groupId or groupName is required.');
  }

  console.error('[combineThingGroup] Combining group:', groupName || groupId, '| resolved:', resolvedGroupId || 'will resolve on client');

  return {
    action: 'combineThingGroup',
    graphId,
    groupId: resolvedGroupId || null,
    groupName: groupName || null,
    combined: true
  };
}
