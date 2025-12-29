/**
 * createEdge - Connect two nodes
 */

import queueManager from '../../services/queue/Queue.js';

export async function createEdge(args, graphState, cid, ensureSchedulerStarted) {
  const { sourceId, targetId, type } = args;
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'createEdge.js:entry',message:'createEdge tool called',data:{sourceId,targetId,type,cid},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A-C'})}).catch(()=>{});
  // #endregion
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

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'createEdge.js:enqueue',message:'Enqueuing edge creation goal',data:{activeGraphId,dagTaskCount:dag.tasks.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A-C'})}).catch(()=>{});
  // #endregion
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

