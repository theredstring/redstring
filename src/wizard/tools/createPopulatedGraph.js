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

  console.log('[createPopulatedGraph] Called with:');
  console.log('[createPopulatedGraph] - name:', name);
  console.log('[createPopulatedGraph] - nodes:', nodes.length, 'items');
  console.log('[createPopulatedGraph] - edges:', edges.length, 'items');
  console.log('[createPopulatedGraph] - groups:', groups.length, 'items');
  console.log('[createPopulatedGraph] - edges detail:', JSON.stringify(edges, null, 2));

  if (!name) {
    throw new Error('Graph name is required');
  }

  if (!nodes || nodes.length === 0) {
    throw new Error('At least one node is required');
  }

  // Generate a graph ID for the new graph
  const graphId = `graph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Helper to convert to Title Case
  const toTitleCase = (str) => {
    if (!str) return '';
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
  };

  // Helper to generate a color for connection types
  const generateConnectionColor = (name) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 60%, 45%)`;
  };

  // Build unified spec for both queue and UI
  const nodeSpecs = nodes.map(n => ({
    name: n.name,
    color: n.color || '#5B6CFF',
    description: n.description || ''
  }));

  const edgeSpecs = (edges || []).map(e => {
    // Handle both old format (type string) and new format (definitionNode object)
    const inputDefNode = e.definitionNode;
    const typeName = inputDefNode?.name || e.type || '';
    const titleCaseName = toTitleCase(typeName);

    return {
      source: e.source,
      target: e.target,
      directionality: e.directionality || 'unidirectional',
      type: titleCaseName || 'Connection',
      definitionNode: titleCaseName ? {
        name: titleCaseName,
        color: inputDefNode?.color || generateConnectionColor(titleCaseName),
        description: inputDefNode?.description || ''
      } : null
    };
  });

  const groupSpecs = (groups || []).map(g => ({
    name: g.name,
    color: g.color || '#8B0000',
    memberNames: g.memberNames || []
  }));

  // Build graph spec for the low-level task (with proper definitionNode)
  const graphSpec = {
    nodes: nodeSpecs,
    edges: edgeSpecs,
    groups: groupSpecs
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

  // UI-side creation + auto-layout handles graph population directly via
  // applyToolResultToStore in LeftAIView.jsx, which calls applyBulkGraphUpdates
  // and dispatches rs-trigger-auto-layout. The executor pipeline is skipped
  // to avoid creating duplicate nodes with different IDs.
  // const goalId = queueManager.enqueue('goalQueue', { ... });
  // if (ensureSchedulerStarted) ensureSchedulerStarted();

  // Return full spec so UI can apply it directly
  // Note: nodesAdded/edgesAdded are ARRAYS for ToolCallCard display
  return {
    action: 'createPopulatedGraph',
    graphId,
    graphName: name,
    description,
    // For ToolCallCard summary (counts)
    nodeCount: nodeSpecs.length,
    edgeCount: edgeSpecs.length,
    groupCount: groupSpecs.length,
    // For ToolCallCard details (arrays for display)
    nodesAdded: nodeSpecs.map(n => n.name),
    edgesAdded: edgeSpecs,
    groupsAdded: groupSpecs.map(g => g.name),
    goalId: null, // Executor pipeline disabled — UI handles creation + layout directly
    // Include full spec for UI to apply
    spec: {
      nodes: nodeSpecs,
      edges: edgeSpecs,
      groups: groupSpecs
    }
  };
}

