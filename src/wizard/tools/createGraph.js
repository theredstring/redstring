/**
 * createGraph - Create a new graph workspace
 */

import queueManager from '../../services/queue/Queue.js';

/**
 * Create a graph
 * @param {Object} args - { name }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { graphId, name }
 */
export async function createGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { name } = args;
  if (!name) {
    throw new Error('name is required');
  }

  const dag = {
    tasks: [{
      toolName: 'create_graph',
      args: {
        name
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'create_graph',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return {
    graphId: 'pending',
    name,
    goalId
  };
}

