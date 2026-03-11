/**
 * getPrototype - Get detailed properties of a Node Prototype
 */

/**
 * Fuzzy match node name against prototypes
 */
function findPrototypeByName(nodeName, nodePrototypes, graphState = null) {
  const nameLower = String(nodeName || '').toLowerCase().trim();
  if (!nameLower) return null;

  let matches = [];

  // Exact match first
  for (const proto of nodePrototypes) {
    if (String(proto.name || '').toLowerCase().trim() === nameLower) {
      matches.push(proto);
    }
  }

  // Partial match (contains) if no exact
  if (matches.length === 0) {
    for (const proto of nodePrototypes) {
      if (String(proto.name || '').toLowerCase().trim().includes(nameLower)) {
        matches.push(proto);
      }
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Prioritize active graph instances
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

  // Fallback to most recent
  return matches[matches.length - 1];
}

/**
 * Get detailed properties of a Prototype directly
 * @param {Object} args - { prototypeId, nodeName } 
 * @param {Object} graphState - Current state
 */
export async function getPrototype(args, graphState) {
  const { prototypeId, nodeName } = args;

  if (!prototypeId && !nodeName) {
    throw new Error('Either prototypeId or nodeName is required');
  }

  const { nodePrototypes = [] } = graphState;
  let prototype;

  if (prototypeId) {
    prototype = nodePrototypes.find(p => p.id === prototypeId);
  } else {
    prototype = findPrototypeByName(nodeName, nodePrototypes, graphState);
  }

  if (!prototype) {
    const identifier = prototypeId || nodeName;
    return `Prototype not found for ${identifier}`;
  }

  return {
    id: prototype.id,
    name: prototype.name,
    description: prototype.description,
    color: prototype.color,
    palette: prototype.palette,
    typeNodeId: prototype.typeNodeId,
    definitionGraphIds: prototype.definitionGraphIds || [],
  };
}
