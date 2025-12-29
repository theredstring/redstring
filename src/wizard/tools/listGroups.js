/**
 * listGroups - List all groups in the active graph
 */

/**
 * List groups in active graph
 * @param {Object} args - {} (no args needed)
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { groups: Array }
 */
export async function listGroups(args, graphState, cid, ensureSchedulerStarted) {
  const { graphs = [], activeGraphId, nodePrototypes = [] } = graphState;
  
  if (!activeGraphId) {
    return { groups: [], message: 'No active graph' };
  }
  
  const graph = graphs.find(g => g.id === activeGraphId);
  if (!graph) {
    return { groups: [], message: 'Active graph not found' };
  }
  
  // Get groups from graph
  let groups = [];
  if (graph.groups) {
    const groupsIterable = graph.groups instanceof Map 
      ? Array.from(graph.groups.values())
      : Array.isArray(graph.groups)
        ? graph.groups
        : Object.values(graph.groups);
    
    const protoMap = new Map();
    if (Array.isArray(nodePrototypes)) {
      nodePrototypes.forEach(p => protoMap.set(p.id, p));
    }
    
    groups = groupsIterable.map(g => ({
      id: g.id,
      name: g.name || 'Unnamed Group',
      color: g.color,
      memberCount: (g.memberInstanceIds || []).length,
      isThingGroup: !!g.linkedNodePrototypeId,
      linkedThingName: g.linkedNodePrototypeId 
        ? (protoMap.get(g.linkedNodePrototypeId)?.name || 'Unknown Thing')
        : null
    }));
  }
  
  return { 
    groups,
    count: groups.length,
    graphName: graph.name || 'Unnamed Graph'
  };
}

