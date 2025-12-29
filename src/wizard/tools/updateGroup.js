/**
 * updateGroup - Update a group's name, color, or members
 */

import queueManager from '../../services/queue/Queue.js';

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
 * Find instance IDs by node names in the active graph
 */
function findInstanceIdsByNames(names, graphState) {
  const { graphs = [], activeGraphId, nodePrototypes = [] } = graphState;
  if (!activeGraphId) return [];
  
  const graph = graphs.find(g => g.id === activeGraphId);
  if (!graph || !graph.instances) return [];
  
  const instances = graph.instances instanceof Map 
    ? Array.from(graph.instances.values())
    : Array.isArray(graph.instances) 
      ? graph.instances 
      : Object.values(graph.instances);
  
  const protoMap = new Map();
  if (Array.isArray(nodePrototypes)) {
    nodePrototypes.forEach(p => protoMap.set(p.id, p));
  }
  
  const foundIds = [];
  const nameLower = names.map(n => String(n || '').toLowerCase());
  
  instances.forEach(inst => {
    const proto = protoMap.get(inst.prototypeId);
    const instName = (proto?.name || inst.name || '').toLowerCase();
    if (nameLower.includes(instName)) {
      foundIds.push(inst.id);
    }
  });
  
  return foundIds;
}

/**
 * Update a group
 * @param {Object} args - { groupId?, groupName?, newName?, newColor?, addMembers?, removeMembers? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { success, groupId, goalId }
 */
export async function updateGroup(args, graphState, cid, ensureSchedulerStarted) {
  const { groupId, groupName, newName, newColor, addMembers = [], removeMembers = [] } = args;
  
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
    } else {
      throw new Error(`Group "${groupName}" not found in active graph.`);
    }
  }
  
  if (!resolvedGroupId) {
    throw new Error('Either groupId or groupName is required.');
  }
  
  // Resolve member names to IDs
  const addMemberIds = findInstanceIdsByNames(addMembers, graphState);
  const removeMemberIds = findInstanceIdsByNames(removeMembers, graphState);
  
  const dag = {
    tasks: [{
      toolName: 'update_group',
      args: {
        graph_id: activeGraphId,
        group_id: resolvedGroupId,
        new_name: newName || undefined,
        new_color: newColor || undefined,
        add_member_ids: addMemberIds.length > 0 ? addMemberIds : undefined,
        remove_member_ids: removeMemberIds.length > 0 ? removeMemberIds : undefined
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'update_group',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return {
    success: true,
    groupId: resolvedGroupId,
    goalId
  };
}

