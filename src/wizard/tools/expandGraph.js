/**
 * expandGraph - Add multiple nodes and edges at once
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
 * Expand graph with multiple nodes and edges
 * @param {Object} args - { nodes: [{ name, color?, description? }], edges: [{ source, target, type? }] }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { nodesAdded, edgesAdded }
 */
export async function expandGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { nodes = [], edges = [] } = args;
  
  if (!nodes || nodes.length === 0) {
    throw new Error('nodes array is required');
  }

  const { graphs = [], nodePrototypes = [], activeGraphId } = graphState;
  
  if (!activeGraphId) {
    throw new Error('No active graph. Please open or create a graph first.');
  }

  // Build graph spec for create_populated_graph
  const graphSpec = {
    nodes: nodes.map(n => ({
      name: n.name,
      color: n.color || undefined,
      description: n.description || ''
    })),
    edges: edges.map(e => ({
      source: e.source,
      target: e.target,
      type: e.type || '',
      definitionNode: e.type ? {
        name: e.type,
        color: '#708090',
        description: ''
      } : null
    }))
  };

  const dag = {
    tasks: [{
      toolName: 'create_populated_graph',
      args: {
        graph_spec: graphSpec,
        layout_algorithm: 'force',
        layout_mode: 'full',
        graph_id: activeGraphId
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'expand_graph',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return {
    nodesAdded: nodes.length,
    edgesAdded: edges.length,
    goalId
  };
}

