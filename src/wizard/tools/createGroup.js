/**
 * createGroup - Create a visual group containing specified nodes
 */

import queueManager from '../../services/queue/Queue.js';

/**
 * Find instance IDs by node names in the active graph
 * @param {Array<string>} names - Node names to find
 * @param {Object} graphState - Current graph state
 * @returns {Array<string>} - Found instance IDs
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
 * Create a group
 * @param {Object} args - { name, memberNames?, memberInstanceIds?, color? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { groupId, name, memberCount, goalId }
 */
export async function createGroup(args, graphState, cid, ensureSchedulerStarted) {
  const { name = 'Group', memberNames = [], memberInstanceIds = [], color } = args;
  
  const { activeGraphId } = graphState;
  
  if (!activeGraphId) {
    throw new Error('No active graph. Please open or create a graph first.');
  }
  
  // Resolve member names to instance IDs if memberNames provided
  let resolvedMemberIds = [...memberInstanceIds];
  if (memberNames.length > 0) {
    const foundIds = findInstanceIdsByNames(memberNames, graphState);
    resolvedMemberIds = [...new Set([...resolvedMemberIds, ...foundIds])];
  }
  
  const dag = {
    tasks: [{
      toolName: 'create_group',
      args: {
        graph_id: activeGraphId,
        name,
        color: color || '#8B0000',
        memberInstanceIds: resolvedMemberIds
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'create_group',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return {
    groupId: 'pending',
    name,
    memberCount: resolvedMemberIds.length,
    goalId
  };
}

