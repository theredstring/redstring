/**
 * createEdge - Connect two nodes
 */

import queueManager from '../../services/queue/Queue.js';

export async function createEdge(args, graphState, cid, ensureSchedulerStarted) {
  const { sourceId, targetId, type } = args;
  if (!sourceId || !targetId) {
    throw new Error('sourceId and targetId are required');
  }

  const { activeGraphId } = graphState;
  if (!activeGraphId) {
    throw new Error('No active graph');
  }

  const dag = {
    tasks: [{
      toolName: 'create_edge',
      args: {
        source_instance_id: sourceId,
        target_instance_id: targetId,
        graph_id: activeGraphId,
        name: type || '',
        description: '',
        directionality: { arrowsToward: [targetId] },
        definitionNode: type ? {
          name: type,
          color: '#708090',
          description: ''
        } : null
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'create_edge',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return { edgeId: 'pending', source: sourceId, target: targetId, goalId };
}

