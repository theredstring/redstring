/**
 * addDefinitionGraph - Create a new definition graph for a node
 *
 * This creates a new graph that defines what a node is made of, WITHOUT changing
 * the user's active graph. The wizard can then use targetGraphId to populate
 * the new definition graph without disrupting the user's workflow.
 *
 * This is the non-disruptive replacement for navigateDefinition.
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
 * Add a new, empty definition graph to a node
 * @param {Object} args - { nodeName } 
 * @param {Object} graphState - Current state
 */
export async function addDefinitionGraph(args, graphState) {
  const { nodeName } = args;

  if (!nodeName) {
    throw new Error('nodeName is required');
  }

  const { nodePrototypes = [] } = graphState;

  // Find the target prototype
  const prototype = findPrototypeByName(nodeName, nodePrototypes, graphState);

  if (!prototype) {
    throw new Error(`Node "${nodeName}" not found. Cannot add definition graph.`);
  }

  // Generate a predictive ID for the new definition graph
  const newGraphId = `graph-def-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  console.error('[addDefinitionGraph] Creating new definition graph for', nodeName, '→', newGraphId);

  return {
    action: 'addDefinitionGraph',
    prototypeId: prototype.id,
    nodeName: prototype.name,
    graphId: newGraphId
  };
}
