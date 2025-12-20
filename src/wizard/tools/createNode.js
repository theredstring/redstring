/**
 * createNode - Create a single node in the active graph
 */

import queueManager from '../../services/queue/Queue.js';

/**
 * Find prototype ID by name
 */
function findPrototypeIdByName(name, nodePrototypes) {
  if (!Array.isArray(nodePrototypes)) return null;
  const proto = nodePrototypes.find(p => String(p?.name || '').toLowerCase() === String(name || '').toLowerCase());
  return proto ? proto.id : null;
}

/**
 * Create a node
 * @param {Object} args - { name, color?, description? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { nodeId, name, ... }
 */
export async function createNode(args, graphState, cid, ensureSchedulerStarted) {
  const { name, color, description } = args;
  if (!name) {
    throw new Error('name is required');
  }

  const { graphs = [], nodePrototypes = [], activeGraphId } = graphState;
  
  if (!activeGraphId) {
    throw new Error('No active graph. Please open or create a graph first.');
  }

  const targetGraphId = activeGraphId;
  const dag = {
    tasks: [{
      toolName: 'create_node',
      args: {
        name,
        graph_id: targetGraphId,
        color: color || '#5B6CFF',
        description: description || ''
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'create_node',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return {
    nodeId: existingProtoId || 'pending',
    name,
    goalId
  };
}

