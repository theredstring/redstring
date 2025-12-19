/**
 * updateNode - Update an existing node
 */

import queueManager from '../../services/queue/Queue.js';

export async function updateNode(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeId, name, color, description } = args;
  if (!nodeId) {
    throw new Error('nodeId is required');
  }

  const dag = {
    tasks: [{
      toolName: 'update_node_prototype',
      args: {
        prototypeId: nodeId,
        ...(name && { name }),
        ...(color && { color }),
        ...(description !== undefined && { description })
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'update_node',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return { nodeId, updated: true, goalId };
}

