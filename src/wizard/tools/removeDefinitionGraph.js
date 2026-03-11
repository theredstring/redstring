/**
 * removeDefinitionGraph - Remove a definition graph from a node
 *
 * Removes a definition graph from a node's definitionGraphIds array.
 * Optionally deletes the graph entirely.
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

  // Fallback to least recent / most recent (UI did LAST)
  return matches[matches.length - 1];
}

/**
 * Remove a definition graph from a node
 * @param {Object} args - { nodeName, definitionIndex } 
 * @param {Object} graphState - Current state
 */
export async function removeDefinitionGraph(args, graphState) {
  const { nodeName, definitionIndex = 0 } = args;

  if (!nodeName) {
    throw new Error('nodeName is required');
  }

  const { nodePrototypes = [] } = graphState;

  // Find the target prototype
  const prototype = findPrototypeByName(nodeName, nodePrototypes, graphState);

  if (!prototype) {
    throw new Error(`Node "${nodeName}" not found. Cannot remove definition graph.`);
  }

  // Check definition graphs
  const definitionGraphIds = Array.isArray(prototype.definitionGraphIds)
    ? prototype.definitionGraphIds
    : [];

  if (definitionGraphIds.length === 0) {
    throw new Error(`Node "${nodeName}" has no definition graphs to remove.`);
  }

  if (definitionIndex < 0 || definitionIndex >= definitionGraphIds.length) {
    throw new Error(`Definition index ${definitionIndex} out of range. Node "${nodeName}" has ${definitionGraphIds.length} definition graph(s).`);
  }

  const graphIdToRemove = definitionGraphIds[definitionIndex];

  console.error('[removeDefinitionGraph] Removing definition graph', graphIdToRemove, 'at index', definitionIndex, 'from', nodeName);

  return {
    action: 'removeDefinitionGraph',
    prototypeId: prototype.id,
    nodeName: prototype.name,
    definitionIndex,
    graphId: graphIdToRemove
  };
}
