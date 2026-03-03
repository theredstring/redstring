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
function findPrototypeByName(nodeName, nodePrototypes) {
  const nameLower = String(nodeName || '').toLowerCase().trim();
  if (!nameLower) return null;

  // Exact match first
  for (const proto of nodePrototypes) {
    if (String(proto.name || '').toLowerCase().trim() === nameLower) {
      return proto;
    }
  }

  // Partial match (contains)
  for (const proto of nodePrototypes) {
    if (String(proto.name || '').toLowerCase().trim().includes(nameLower)) {
      return proto;
    }
  }

  return null;
}

/**
 * Add a new definition graph to a node
 * @param {Object} args - { nodeName }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Action spec with new graph ID
 */
export async function addDefinitionGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeName } = args;

  if (!nodeName) {
    throw new Error('nodeName is required');
  }

  const { nodePrototypes = [] } = graphState;

  // Find the prototype
  const prototype = findPrototypeByName(nodeName, nodePrototypes);

  if (!prototype) {
    throw new Error(`Node "${nodeName}" not found. Cannot add definition graph to a node that doesn't exist.`);
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
