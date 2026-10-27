import { resolveGraphId } from './resolveGraphId.js';
import { webAsDrawn } from './utils/webView.js';

/**
 * deleteGroup - Delete a group (keeps member nodes)
 */

/**
 * Find group by name in a graph
 */
function findGroupByName(name, graphState, graphId) {
  const { graphs = [] } = graphState;
  if (!graphId) return null;

  const graph = graphs.some(g => g.id === graphId) ? webAsDrawn(graphState, graphId) : null; // as drawn: opened Things are Thing-groups
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

  const { activeGraphId, graphs = [] } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

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

  // Ungrouping a formula leaves its Things and operations strewn about the web.
  const graph = graphs.some(g => g.id === graphId) ? webAsDrawn(graphState, graphId) : null; // as drawn: opened Things are Thing-groups
  const groups = Array.isArray(graph?.groups) ? graph.groups : graph?.groups instanceof Map ? [...graph.groups.values()] : Object.values(graph?.groups || {});
  const target = groups.find(g => g.id === resolvedGroupId);
  if (target?.format === 'formula') {
    throw new Error(`"${target.name}" is a formula. Use the formula tool: action "delete" to remove it with its Things, or "fold" to fold it into its Thing.`);
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
