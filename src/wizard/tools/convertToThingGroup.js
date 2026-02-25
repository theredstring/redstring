/**
 * convertToThingGroup - Convert a Group into a Thing-Group (backed by a node prototype)
 * This creates a definitional graph for the Thing, making the group members its decomposition.
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
 * Convert a group to a Thing-Group
 * @param {Object} args - { groupId?, groupName?, thingName?, createNewThing?, newThingColor? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Conversion spec for UI application
 */
export async function convertToThingGroup(args, graphState, cid, ensureSchedulerStarted) {
  const {
    groupId,
    groupName,
    thingName,
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
    }
  }

  if (!resolvedGroupId && !groupName) {
    throw new Error('Either groupId or groupName is required.');
  }

  const newPrototypeName = thingName || groupData?.name || groupName || 'Thing Group';

  console.error('[convertToThingGroup] Converting group:', groupName || groupId, '| resolved:', resolvedGroupId || 'will resolve on client', '| thingName:', newPrototypeName);

  return {
    action: 'convertToThingGroup',
    graphId: activeGraphId,
    groupId: resolvedGroupId || null,
    groupName: groupName || null,
    thingName: newPrototypeName,
    createNewThing,
    newThingColor: newThingColor, // Don't default - let store use group.color if not specified
    converted: true
  };
}
