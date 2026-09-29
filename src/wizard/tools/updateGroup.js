import { resolveGraphId } from './resolveGraphId.js';
import { sanitizeColor } from '../../utils/safeColor.js';

// Every tool field is sent as required (see LLMClient makeAllRequired), so
// models fill the ones they aren't changing with "". A blank string is "not
// given", never "set to empty": treating it as an edit blanked descriptions
// the model only meant to leave alone.
const given = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

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

  const updates = {};
  if (given(newName)) updates.name = newName;
  // Only a plain colour: it lands in inline styles. Anything else is ignored.
  if (given(newColor) && sanitizeColor(newColor) !== null) updates.color = sanitizeColor(newColor);
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
