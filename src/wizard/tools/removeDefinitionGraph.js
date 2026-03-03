/**
 * removeDefinitionGraph - Remove a definition graph from a node
 *
 * Removes a definition graph from a node's definitionGraphIds array.
 * Optionally deletes the graph entirely.
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
 * Remove a definition graph from a node
 * @param {Object} args - { nodeName, definitionIndex }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Action spec
 */
export async function removeDefinitionGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeName, definitionIndex = 0 } = args;

  if (!nodeName) {
    throw new Error('nodeName is required');
  }

  const { nodePrototypes = [], graphs = [] } = graphState;

  // Find the prototype
  const prototype = findPrototypeByName(nodeName, nodePrototypes);

  if (!prototype) {
    throw new Error(`Node "${nodeName}" not found. Cannot remove definition graph from a node that doesn't exist.`);
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
