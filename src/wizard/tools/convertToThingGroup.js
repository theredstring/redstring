/**
 * convertToThingGroup - Convert a Group into a Thing-Group (backed by a node prototype)
 * This creates a definitional graph for the Thing, making the group members its decomposition.
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
 * Find prototype by name
 */
function findPrototypeByName(name, graphState) {
  const { nodePrototypes = [] } = graphState;
  if (!Array.isArray(nodePrototypes)) return null;
  
  const nameLower = String(name || '').toLowerCase();
  return nodePrototypes.find(p => 
    String(p.name || '').toLowerCase() === nameLower
  );
}

/**
 * Convert a group to a Thing-Group
 * @param {Object} args - { groupId?, groupName?, thingName?, thingId?, createNewThing?, newThingColor? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { success, groupId, thingId, goalId }
 */
export async function convertToThingGroup(args, graphState, cid, ensureSchedulerStarted) {
  const { 
    groupId, 
    groupName, 
    thingName,
    thingId,
    createNewThing = true,
    newThingColor 
  } = args;
  
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
  
  // Resolve thing ID or prepare to create new
  let resolvedThingId = thingId;
  let shouldCreateNew = createNewThing;
  let newPrototypeName = thingName || groupData?.name || 'Thing Group';
  
  if (!resolvedThingId && thingName && !createNewThing) {
    const proto = findPrototypeByName(thingName, graphState);
    if (proto) {
      resolvedThingId = proto.id;
      shouldCreateNew = false;
    } else {
      // Thing not found, will create new
      shouldCreateNew = true;
    }
  }
  
  const dag = {
    tasks: [{
      toolName: 'convert_to_node_group',
      args: {
        graph_id: activeGraphId,
        group_id: resolvedGroupId,
        node_prototype_id: resolvedThingId || undefined,
        create_new_prototype: shouldCreateNew,
        new_prototype_name: shouldCreateNew ? newPrototypeName : undefined,
        new_prototype_color: newThingColor || '#8B0000'
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'convert_to_thing_group',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return {
    success: true,
    groupId: resolvedGroupId,
    thingName: newPrototypeName,
    createdNewThing: shouldCreateNew,
    goalId
  };
}

