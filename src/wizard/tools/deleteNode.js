/**
 * deleteNode - Remove a node
 */

import queueManager from '../../services/queue/Queue.js';

export async function deleteNode(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeId } = args;
  if (!nodeId) {
    throw new Error('nodeId is required');
  }

  const { activeGraphId } = graphState;
  if (!activeGraphId) {
    throw new Error('No active graph');
  }

  const dag = {
    tasks: [{
      toolName: 'delete_node_instance',
      args: {
        instanceId: nodeId,
        graphId: activeGraphId
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'delete_node',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return { deleted: true, goalId };
}

