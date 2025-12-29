/**
 * createPopulatedGraph - Create a new graph with nodes, edges, and groups in one operation
 */

import queueManager from '../../services/queue/Queue.js';

/**
 * Create a new graph and populate it with nodes, edges, and groups
 * @param {Object} args - { name, nodes: [{ name, color?, description? }], edges?: [{ source, target, type? }], groups?: [{ name, color?, memberNames }] }
 * @param {Object} graphState - Current graph state (not used, creates new graph)
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { graphId, graphName, nodesAdded, edgesAdded, groupsAdded }
 */
export async function createPopulatedGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { name, description = '', nodes = [], edges = [], groups = [] } = args;
  
  if (!name) {
    throw new Error('Graph name is required');
  }
  
  if (!nodes || nodes.length === 0) {
    throw new Error('At least one node is required');
  }

  // Generate a graph ID for the new graph
  const graphId = `graph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Build graph spec for the low-level task
  const graphSpec = {
    nodes: nodes.map(n => ({
      name: n.name,
      color: n.color || undefined,
      description: n.description || ''
    })),
    edges: (edges || []).map(e => ({
      source: e.source,
      target: e.target,
      type: e.type || '',
      definitionNode: e.type ? {
        name: e.type,
        color: '#708090',
        description: ''
      } : null
    })),
    groups: (groups || []).map(g => ({
      name: g.name,
      color: g.color || '#8B0000',
      memberNames: g.memberNames || []
    }))
  };

  const dag = {
    tasks: [{
      toolName: 'create_populated_graph',
      args: {
        name,
        description,
        graph_id: graphId,
        graph_spec: graphSpec,
        layout_algorithm: 'force',
        layout_mode: 'full'
      },
      threadId: cid
    }]
  };

  const goalId = queueManager.enqueue('goalQueue', {
    type: 'goal',
    goal: 'create_populated_graph',
    dag,
    threadId: cid,
    partitionKey: cid
  });

  if (ensureSchedulerStarted) ensureSchedulerStarted();

  return {
    graphId,
    graphName: name,
    nodesAdded: nodes.length,
    edgesAdded: edges.length,
    groupsAdded: groups.length,
    goalId
  };
}

