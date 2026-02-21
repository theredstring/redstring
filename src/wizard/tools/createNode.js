/**
 * createNode - Create a single node in the active graph
 */

/**
 * Create a node
 * @param {Object} args - { name, color?, description? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Node spec for UI application
 */
export async function createNode(args, graphState, cid, ensureSchedulerStarted) {
  const { name, color, description } = args;
  if (!name) {
    throw new Error('name is required');
  }

  const { activeGraphId } = graphState;
  if (!activeGraphId) {
    throw new Error('No active graph. Please open or create a graph first.');
  }

  return {
    action: 'createNode',
    graphId: activeGraphId,
    name,
    color: color || '#5B6CFF',
    description: description || ''
  };
}
