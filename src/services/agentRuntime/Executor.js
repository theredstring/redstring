// Executor: Executes plans by reusing existing queue + roleRunners (Builder)
// Maps semantic intents to queue tasks

import queueManager from '../queue/Queue.js';

/**
 * Helper to find prototype ID by name
 */
function findPrototypeIdByName(name, nodePrototypes) {
  if (!Array.isArray(nodePrototypes)) return null;
  const m = nodePrototypes.find(p => String(p?.name || '').toLowerCase() === String(name || '').toLowerCase());
  return m ? m.id : null;
}

/**
 * Helper to find instance ID in a graph
 */
function findInstanceIdInActiveGraph(prototypeId, graphId, graphs) {
  const g = graphs.find(x => x.id === graphId);
  if (!g || !g.instances) return null;
  
  const instances = Array.isArray(g.instances) ? g.instances : Object.values(g.instances);
  for (const inst of instances) {
    if (inst.prototypeId === prototypeId) return inst.id;
  }
  return null;
}

/**
 * Helper to find edge by node names
 */
function findEdgeByNodeNames(sourceName, targetName, graphId, graphs, nodePrototypes, edges) {
  const graph = graphs.find(g => g.id === graphId);
  if (!graph || !graph.edgeIds || !Array.isArray(graph.edgeIds)) return null;

  const sourceProtoId = findPrototypeIdByName(sourceName, nodePrototypes);
  const targetProtoId = findPrototypeIdByName(targetName, nodePrototypes);
  if (!sourceProtoId || !targetProtoId) return null;

  const sourceInstanceId = findInstanceIdInActiveGraph(sourceProtoId, graphId, graphs);
  const targetInstanceId = findInstanceIdInActiveGraph(targetProtoId, graphId, graphs);
  if (!sourceInstanceId || !targetInstanceId) return null;

  for (const edgeId of graph.edgeIds) {
    const edge = edges[edgeId] || (Array.isArray(graph.graphEdges) 
      ? graph.graphEdges.find(e => e.id === edgeId) 
      : null);
    
    if (edge) {
      if (edge.sourceId === sourceInstanceId && edge.destinationId === targetInstanceId) {
        return edgeId;
      }
      // Check reverse
      if (edge.sourceId === targetInstanceId && edge.destinationId === sourceInstanceId) {
        return edgeId;
      }
    }
  }
  return null;
}

/**
 * Resolve node names to instance IDs
 */
function resolveNodeNamesToInstances(sourceName, targetName, graphId, graphs, nodePrototypes) {
  const sourceProtoId = findPrototypeIdByName(sourceName, nodePrototypes);
  const targetProtoId = findPrototypeIdByName(targetName, nodePrototypes);
  
  if (!sourceProtoId) {
    return { error: `Could not find node "${sourceName}"` };
  }
  if (!targetProtoId) {
    return { error: `Could not find node "${targetName}"` };
  }

  const sourceInstanceId = findInstanceIdInActiveGraph(sourceProtoId, graphId, graphs);
  const targetInstanceId = findInstanceIdInActiveGraph(targetProtoId, graphId, graphs);

  if (!sourceInstanceId) {
    return { error: `Could not find instance of "${sourceName}" in the current graph` };
  }
  if (!targetInstanceId) {
    return { error: `Could not find instance of "${targetName}" in the current graph` };
  }

  return { sourceInstanceId, targetInstanceId };
}

/**
 * Execute a plan by enqueuing appropriate goals/tasks
 * @param {Object} plan - Plan from Planner
 * @param {Object} context - Execution context (graphId, graphs, nodePrototypes, edges, etc.)
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to ensure scheduler is running
 * @returns {Object} { goalId, toolCalls, response }
 */
export function execute(plan, context, cid, ensureSchedulerStarted) {
  const { intent } = plan;
  const graphs = context.graphs || [];
  const nodePrototypes = context.nodePrototypes || [];
  const edges = context.edges || {};
  const targetGraphId = context.activeGraphId || context.graphId;

  // QA intent - no execution needed
  if (intent === 'qa') {
    return {
      goalId: null,
      toolCalls: [],
      response: plan.response || "I'm here to help you create knowledge graphs. What would you like to map?"
    };
  }

  // CREATE EDGE
  if (intent === 'create_edge') {
    if (!targetGraphId) {
      return {
        goalId: null,
        toolCalls: [],
        response: 'I need an active graph to create a connection. Please select a graph first.'
      };
    }

    const edgeSpec = plan.edge;
    if (!edgeSpec || !edgeSpec.source || !edgeSpec.target) {
      return {
        goalId: null,
        toolCalls: [],
        response: 'I need both source and target node names to create a connection.'
      };
    }

    const resolved = resolveNodeNamesToInstances(edgeSpec.source, edgeSpec.target, targetGraphId, graphs, nodePrototypes);
    if (resolved.error) {
      return {
        goalId: null,
        toolCalls: [],
        response: resolved.error
      };
    }

    let arrowsToward = [resolved.targetInstanceId];
    if (edgeSpec.directionality === 'bidirectional') {
      arrowsToward = [resolved.sourceInstanceId, resolved.targetInstanceId];
    } else if (edgeSpec.directionality === 'none' || edgeSpec.directionality === 'undirected') {
      arrowsToward = [];
    } else if (edgeSpec.directionality === 'reverse') {
      arrowsToward = [resolved.sourceInstanceId];
    }

    const dag = {
      tasks: [{
        toolName: 'create_edge',
        args: {
          source_instance_id: resolved.sourceInstanceId,
          target_instance_id: resolved.targetInstanceId,
          graph_id: targetGraphId,
          name: edgeSpec.definitionNode?.name || '',
          description: edgeSpec.definitionNode?.description || '',
          directionality: { arrowsToward },
          definitionNode: edgeSpec.definitionNode ? {
            name: edgeSpec.definitionNode.name,
            color: edgeSpec.definitionNode.color || '#708090',
            description: edgeSpec.definitionNode.description || ''
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

    return {
      goalId,
      toolCalls: [{ name: 'create_edge', status: 'queued', args: { source: edgeSpec.source, target: edgeSpec.target } }],
      response: plan.response || `I'll connect "${edgeSpec.source}" to "${edgeSpec.target}".`
    };
  }

  // DELETE EDGE
  if (intent === 'delete_edge') {
    if (!targetGraphId) {
      return {
        goalId: null,
        toolCalls: [],
        response: 'I need an active graph to delete a connection. Please select a graph first.'
      };
    }

    const edgeSpec = plan.edgeDelete;
    if (!edgeSpec || !edgeSpec.source || !edgeSpec.target) {
      return {
        goalId: null,
        toolCalls: [],
        response: 'I need both source and target node names to delete a connection.'
      };
    }

    const existingEdgeId = findEdgeByNodeNames(edgeSpec.source, edgeSpec.target, targetGraphId, graphs, nodePrototypes, edges);
    if (!existingEdgeId) {
      return {
        goalId: null,
        toolCalls: [],
        response: `I couldn't find an existing connection between "${edgeSpec.source}" and "${edgeSpec.target}".`
      };
    }

    const dag = {
      tasks: [{
        toolName: 'delete_edge',
        args: {
          graphId: targetGraphId,
          edgeId: existingEdgeId
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

    return {
      goalId,
      toolCalls: [{ name: 'delete_edge', status: 'queued', args: { source: edgeSpec.source, target: edgeSpec.target } }],
      response: plan.response || `I'll remove the connection between "${edgeSpec.source}" and "${edgeSpec.target}".`
    };
  }

  // DELETE GRAPH
  if (intent === 'delete_graph') {
    const deleteSpec = plan.delete;
    if (!deleteSpec || !deleteSpec.target) {
      return {
        goalId: null,
        toolCalls: [],
        response: 'I need to know which graph to delete. Please specify the graph name.'
      };
    }

    const graphToDelete = graphs.find(g => g.name === deleteSpec.target || g.id === deleteSpec.graphId);
    if (!graphToDelete) {
      return {
        goalId: null,
        toolCalls: [],
        response: `I couldn't find that graph to delete.`
      };
    }

    const dag = {
      tasks: [{
        toolName: 'delete_graph',
        args: {
          graphId: graphToDelete.id
        },
        threadId: cid
      }]
    };

    const goalId = queueManager.enqueue('goalQueue', {
      type: 'goal',
      goal: 'delete_graph',
      dag,
      threadId: cid,
      partitionKey: cid
    });

    if (ensureSchedulerStarted) ensureSchedulerStarted();

    return {
      goalId,
      toolCalls: [{ name: 'delete_graph', status: 'queued', args: { graphId: graphToDelete.id } }],
      response: plan.response || `I'll delete the "${deleteSpec.target}" graph.`
    };
  }

  // ENRICH NODE
  if (intent === 'enrich_node') {
    if (!targetGraphId) {
      return {
        goalId: null,
        toolCalls: [],
        response: 'I need an active graph to enrich a node. Please select a graph first.'
      };
    }

    const targetName = plan.enrich?.target || null;
    if (!targetName) {
      return {
        goalId: null,
        toolCalls: [],
        response: 'I need to know which node to enrich. Please specify the node name.'
      };
    }

    const prototypeId = findPrototypeIdByName(targetName, nodePrototypes);
    if (!prototypeId) {
      return {
        goalId: null,
        toolCalls: [],
        response: `I couldn't find a node named "${targetName}" to enrich.`
      };
    }

    const prototype = nodePrototypes.find(p => p.id === prototypeId);
    const graphSpec = plan.enrich?.graphSpec || plan.graphSpec;
    
    if (!graphSpec || !Array.isArray(graphSpec.nodes) || graphSpec.nodes.length === 0) {
      return {
        goalId: null,
        toolCalls: [],
        response: `I'll enrich "${targetName}", but I need a graphSpec with nodes that define/compose it.`
      };
    }

    if (prototype?.definitionGraphIds && prototype.definitionGraphIds.length > 0) {
      const existingGraphId = prototype.definitionGraphIds[0];
      const dag = {
        tasks: [{
          toolName: 'create_populated_graph',
          args: {
            graphSpec: {
              nodes: graphSpec.nodes || [],
              edges: graphSpec.edges || []
            },
            layoutAlgorithm: graphSpec.layoutAlgorithm || 'force',
            layoutMode: 'full',
            graphId: existingGraphId
          },
          threadId: cid
        }]
      };

      const goalId = queueManager.enqueue('goalQueue', {
        type: 'goal',
        goal: 'enrich_node',
        dag,
        threadId: cid,
        partitionKey: cid
      });

      if (ensureSchedulerStarted) ensureSchedulerStarted();

      return {
        goalId,
        toolCalls: [{ name: 'enrich_node', status: 'queued', args: { target: targetName, graphId: existingGraphId } }],
        response: plan.response || `I'll populate the definition graph for "${targetName}" with ${graphSpec.nodes.length} components.`
      };
    } else {
      const dag = {
        tasks: [
          {
            toolName: 'create_and_assign_graph_definition',
            args: { prototypeId },
            threadId: cid
          },
          {
            toolName: 'create_populated_graph',
            args: {
              graphSpec: {
                nodes: graphSpec.nodes || [],
                edges: graphSpec.edges || []
              },
              layoutAlgorithm: graphSpec.layoutAlgorithm || 'force',
              layoutMode: 'full'
            },
            threadId: cid,
            dependsOn: ['create_and_assign_graph_definition']
          }
        ]
      };

      const goalId = queueManager.enqueue('goalQueue', {
        type: 'goal',
        goal: 'enrich_node',
        dag,
        threadId: cid,
        partitionKey: cid
      });

      if (ensureSchedulerStarted) ensureSchedulerStarted();

      return {
        goalId,
        toolCalls: [{ name: 'enrich_node', status: 'queued', args: { target: targetName } }],
        response: plan.response || `I'll create a definition graph for "${targetName}" with ${graphSpec.nodes.length} components.`
      };
    }
  }

  // For other intents (create_graph, create_node, etc.), they're handled by the existing
  // roleRunners via the queue system. This Executor focuses on the simpler, direct intents.
  // More complex intents can be added here or handled by AgentCoordinator.

  return {
    goalId: null,
    toolCalls: [],
    response: plan.response || `Intent "${intent}" is not yet implemented in Executor.`
  };
}

