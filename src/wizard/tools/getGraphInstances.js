/**
 * getGraphInstances - List all raw instances inside a specific graph
 */

/**
 * List all instances in a graph
 * @param {Object} args - { graphId } 
 * @param {Object} graphState - Current state
 */
export async function getGraphInstances(args, graphState) {
  const { graphId } = args;
  
  const targetGraphId = graphId || graphState.activeGraphId;

  if (!targetGraphId) {
    throw new Error('No target graph specified, and no active graph available.');
  }

  const { graphs = [], nodePrototypes = [] } = graphState;
  
  const graph = graphs.find(g => g.id === targetGraphId);
  if (!graph) {
    return `Graph with ID ${targetGraphId} not found.`;
  }

  if (!graph.instances || graph.instances.length === 0) {
    return `Graph ${targetGraphId} has no instances.`;
  }

  // Create a quick lookup for prototype basic info to include
  const protoMap = new Map();
  for (const proto of nodePrototypes) {
    protoMap.set(proto.id, { name: proto.name, color: proto.color });
  }

  const instances = graph.instances.map(inst => {
    const protoInfo = protoMap.get(inst.prototypeId) || { name: 'Unknown', color: 'gray' };
    return {
      instanceId: inst.id,
      prototypeId: inst.prototypeId,
      prototypeName: protoInfo.name,
      x: Math.round(inst.position?.x || 0),
      y: Math.round(inst.position?.y || 0)
    };
  });

  return {
    graphId: targetGraphId,
    totalInstances: instances.length,
    instances
  };
}
