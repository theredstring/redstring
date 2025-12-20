/**
 * deleteEdge - Remove a connection
 */

import queueManager from '../../services/queue/Queue.js';

export async function deleteEdge(args, graphState, cid, ensureSchedulerStarted) {
  const { edgeId } = args;
  if (!edgeId) {
    throw new Error('edgeId is required');
  }

  const { activeGraphId } = graphState;
  if (!activeGraphId) {
    throw new Error('No active graph');
  }

  const dag = {
    tasks: [{
      toolName: 'delete_edge',
      args: {
        graph_id: activeGraphId,
        edge_id: edgeId
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'delete_edge',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return { deleted: true, goalId };
}

