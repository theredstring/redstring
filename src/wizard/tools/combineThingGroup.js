/**
 * combineThingGroup - Collapse a Thing-Group back into a single node
 * This replaces all group members with a single instance of the linked Thing.
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
 * Combine (collapse) a Thing-Group into a single node
 * @param {Object} args - { groupId?, groupName? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { success, groupId, goalId }
 */
export async function combineThingGroup(args, graphState, cid, ensureSchedulerStarted) {
  const { groupId, groupName } = args;
  
  const { activeGraphId } = graphState;
  
  if (!activeGraphId) {
    throw new Error('No active graph. Please open or create a graph first.');
  }
  
  // Resolve group ID from name if needed
  let resolvedGroupId = groupId;
  let groupData = null;
  if (!resolvedGroupId && groupName) {
    groupData = findGroupByName(groupName, graphState);
    if (groupData) {
      resolvedGroupId = groupData.id;
    } else {
      throw new Error(`Group "${groupName}" not found in active graph.`);
    }
  }
  
  if (!resolvedGroupId) {
    throw new Error('Either groupId or groupName is required.');
  }
  
  // Verify it's a Thing-Group
  if (groupData && !groupData.linkedNodePrototypeId) {
    throw new Error(`Group "${groupName || groupId}" is not a Thing-Group. Only Thing-Groups can be combined.`);
  }
  
  const dag = {
    tasks: [{
      toolName: 'combine_node_group',
      args: {
        graph_id: activeGraphId,
        group_id: resolvedGroupId
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'combine_thing_group',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return {
    success: true,
    groupId: resolvedGroupId,
    message: 'Thing-Group will be collapsed into a single node',
    goalId
  };
}

