/**
 * switchToGraph - Change the active graph (explicit navigation)
 *
 * Use this ONLY when the user explicitly requests navigation
 * (e.g., "show me", "go into", "navigate to", "open").
 *
 * For editing definition graphs without disrupting the user's view,
 * use addDefinitionGraph + targetGraphId pattern instead.
 */

/**
 * Switch to a specific graph
 * @param {Object} args - { graphId?, graphName?, nodeName? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Action spec
 */
export async function switchToGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { graphId, graphName, nodeName } = args;

  const { graphs = [], nodePrototypes = [] } = graphState;

  let targetGraphId = graphId;

  // If nodeName provided, find its first definition graph
  if (!targetGraphId && nodeName) {
    const nameLower = String(nodeName || '').toLowerCase().trim();
    const prototype = nodePrototypes.find(p =>
      String(p.name || '').toLowerCase().trim() === nameLower ||
      String(p.name || '').toLowerCase().trim().includes(nameLower)
    );

    if (!prototype) {
      throw new Error(`Node "${nodeName}" not found. Cannot navigate to its definition graph.`);
    }

    const defGraphIds = Array.isArray(prototype.definitionGraphIds)
      ? prototype.definitionGraphIds
      : [];

    if (defGraphIds.length === 0) {
      throw new Error(`Node "${nodeName}" has no definition graphs. Use addDefinitionGraph to create one first.`);
    }

    targetGraphId = defGraphIds[0];
    console.error('[switchToGraph] Resolved nodeName', nodeName, '→ first definition graph:', targetGraphId);
  }

  // If graphName provided, find by name
  if (!targetGraphId && graphName) {
    const nameLower = String(graphName || '').toLowerCase().trim();
    const graph = graphs.find(g =>
      String(g.name || '').toLowerCase().trim() === nameLower ||
      String(g.name || '').toLowerCase().trim().includes(nameLower)
    );

    if (!graph) {
      throw new Error(`Graph "${graphName}" not found.`);
    }

    targetGraphId = graph.id;
    console.error('[switchToGraph] Resolved graphName', graphName, '→', targetGraphId);
  }

  if (!targetGraphId) {
    throw new Error('Either graphId, graphName, or nodeName is required.');
  }

  // Verify the graph exists
  const targetGraph = graphs.find(g => g.id === targetGraphId);
  if (!targetGraph) {
    throw new Error(`Graph "${targetGraphId}" not found.`);
  }

  console.error('[switchToGraph] Switching to graph:', targetGraphId, `(${targetGraph.name})`);

  return {
    action: 'switchToGraph',
    graphId: targetGraphId,
    graphName: targetGraph.name
  };
}
