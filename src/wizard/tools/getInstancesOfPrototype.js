/**
 * getInstancesOfPrototype - Find all instances of a specific prototype across the workspace
 */

/**
 * Fuzzy match node name against prototypes
 */
function findPrototypeByName(nodeName, nodePrototypes, graphState = null) {
  const nameLower = String(nodeName || '').toLowerCase().trim();
  if (!nameLower) return null;

  let matches = [];

  for (const proto of nodePrototypes) {
    if (String(proto.name || '').toLowerCase().trim() === nameLower) {
      matches.push(proto);
    }
  }

  if (matches.length === 0) {
    for (const proto of nodePrototypes) {
      if (String(proto.name || '').toLowerCase().trim().includes(nameLower)) {
        matches.push(proto);
      }
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  if (graphState && graphState.activeGraphId && graphState.graphs) {
    const activeGraph = graphState.graphs.find(g => g.id === graphState.activeGraphId);
    if (activeGraph && activeGraph.instances) {
      for (const match of matches) {
        if (activeGraph.instances.some(inst => inst.prototypeId === match.id)) {
          return match;
        }
      }
    }
  }

  return matches[matches.length - 1];
}

/**
 * Find all instances of a specific prototype
 * @param {Object} args - { prototypeId, nodeName } 
 * @param {Object} graphState - Current state
 */
export async function getInstancesOfPrototype(args, graphState) {
  const { prototypeId, nodeName } = args;

  if (!prototypeId && !nodeName) {
    throw new Error('Either prototypeId or nodeName is required');
  }

  const { nodePrototypes = [], graphs = [] } = graphState;
  let targetProtoId = prototypeId;

  if (!targetProtoId) {
    const prototype = findPrototypeByName(nodeName, nodePrototypes, graphState);
    if (!prototype) {
      return `Prototype not found for name "${nodeName}"`;
    }
    targetProtoId = prototype.id;
  } else {
    if (!nodePrototypes.some(p => p.id === targetProtoId)) {
      return `Prototype with ID ${targetProtoId} not found.`;
    }
  }

  const instances = [];

  for (const graph of graphs) {
    if (!graph.instances) continue;
    
    // In plain state, instances is an array
    for (const instance of graph.instances) {
      if (instance.prototypeId === targetProtoId) {
        instances.push({
          instanceId: instance.id,
          graphId: graph.id,
          position: instance.position,
          isHidden: instance.isHidden,
          isGhost: instance.isGhost
        });
      }
    }
  }

  return {
    prototypeId: targetProtoId,
    totalInstancesFound: instances.length,
    instances
  };
}
