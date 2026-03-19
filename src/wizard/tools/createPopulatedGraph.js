/**
 * createPopulatedGraph - Create a new graph with nodes, edges, and groups in one operation
 */

import queueManager from '../../services/queue/Queue.js';
import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';
import { validateEdges } from './edgeValidator.js';
import { analyzeGraphQuality } from './graphQuality.js';

/**
 * Create a new graph and populate it with nodes, edges, and groups
 * @param {Object} args - { name, nodes: [{ name, color?, description? }], edges?: [{ source, target, type? }], groups?: [{ name, color?, memberNames }] }
 * @param {Object} graphState - Current graph state (not used, creates new graph)
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { graphId, graphName, nodesAdded, edgesAdded, groupsAdded }
 */
export async function createPopulatedGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { name, description = '', nodes = [], edges = [], groups = [], targetGraphId, palette, color } = args;

  console.error('[createPopulatedGraph] Called with:');
  console.error('[createPopulatedGraph] - name:', name);
  console.error('[createPopulatedGraph] - nodes:', nodes.length, 'items');
  console.error('[createPopulatedGraph] - edges:', edges.length, 'items');
  console.error('[createPopulatedGraph] - groups:', groups.length, 'items');
  console.error('[createPopulatedGraph] - targetGraphId:', targetGraphId);
  console.error('[createPopulatedGraph] - edges detail:', JSON.stringify(edges));

  if (!name && !targetGraphId) {
    throw new Error('Graph name is required when creating a new graph');
  }

  if (!nodes || nodes.length === 0) {
    throw new Error('At least one node is required');
  }

  // Generate a graph ID for the new graph or use targetGraphId
  const graphId = targetGraphId || `graph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Helper to convert to Title Case
  const toTitleCase = (str) => {
    if (!str) return '';
    // Split camelCase: "isPartOf" → "is Part Of"
    const spaced = str.replace(/([a-z])([A-Z])/g, '$1 $2');
    return spaced.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
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

  // Pick a palette if none provided
  const activePalette = palette || getRandomPalette();

  // Build unified spec for both queue and UI
  const nodeSpecs = nodes.map(n => ({
    name: n.name,
    color: resolvePaletteColor(activePalette, n.color),
    description: n.description || '',
    type: n.type || null,
    typeColor: resolvePaletteColor(activePalette, n.typeColor || '#A0A0A0'),
    typeDescription: n.typeDescription || ''
  }));

  // Validate edges: strip any that reference nodes not in the nodes array
  const { validEdges, droppedEdges } = validateEdges(nodeSpecs, edges || []);

  // Strict validation: require definitionNode on all edges
  for (let i = 0; i < validEdges.length; i++) {
    const e = validEdges[i];
    if (!e.definitionNode || typeof e.definitionNode !== 'object') {
      throw new Error(
        `Edge ${i + 1} (${e.source} → ${e.target}) is missing required field 'definitionNode'. ` +
        `Check for typos in your JSON - did you write 'definition,Node' or 'definitionnode' instead of 'definitionNode'?`
      );
    }
    if (!e.definitionNode.name) {
      throw new Error(
        `Edge ${i + 1} (${e.source} → ${e.target}): definitionNode must have a 'name' property. ` +
        `Example: definitionNode: { name: "Connects To", description: "..." }`
      );
    }
  }

  const edgeSpecs = validEdges.map(e => {
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
        color: resolvePaletteColor(activePalette, inputDefNode?.color || generateConnectionColor(titleCaseName)),
        description: inputDefNode?.description || ''
      } : null
    };
  });

  const groupSpecs = (groups || []).map(g => ({
    name: g.name,
    color: resolvePaletteColor(activePalette, g.color || '#8B0000'),
    memberNames: g.memberNames || [],
    definedBy: g.definedBy ? {
      name: g.definedBy.name,
      color: resolvePaletteColor(activePalette, g.definedBy.color || '#8B0000'),
      description: g.definedBy.description || ''
    } : undefined
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

  // Analyze graph quality for LLM feedback
  const qualityReport = analyzeGraphQuality(nodeSpecs, edgeSpecs);

  // Returns full spec so UI can apply it directly
  // Note: nodesAdded/edgesAdded are ARRAYS for ToolCallCard display
  return {
    action: 'createPopulatedGraph',
    graphId,
    graphName: name || 'existing graph',
    description,
    color: resolvePaletteColor(activePalette, color || args.color), // Added color resolution
    // For ToolCallCard summary (counts)
    nodeCount: nodeSpecs.length,
    edgeCount: edgeSpecs.length,
    groupCount: groupSpecs.length,
    // For ToolCallCard details (arrays for display)
    nodesAdded: nodeSpecs.map(n => n.name),
    edgesAdded: edgeSpecs,
    groupsAdded: groupSpecs.map(g => g.name),
    goalId: null, // Executor pipeline disabled — UI handles creation + layout directly
    // Edge validation feedback for LLM
    droppedEdges,
    edgeWarning: droppedEdges.length > 0
      ? `${droppedEdges.length} edge(s) were dropped because they referenced nodes not in the nodes array: ${droppedEdges.map(d => `${d.source} → ${d.target} (${d.reason})`).join('; ')}`
      : null,
    // Quality analysis — LLM should fix issues before responding
    qualityReport,
    // Include full spec for UI to apply
    spec: {
      nodes: nodeSpecs,
      edges: edgeSpecs,
      groups: groupSpecs
    }
  };
}

