/**
 * createPopulatedGraph - Create a new graph with nodes, edges, and groups in one operation
 */

import queueManager from '../../services/queue/Queue.js';
import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';
import { validateEdgesSmart } from './edgeValidator.js';
import { analyzeGraphQuality } from './graphQuality.js';
import { classifyGraphShape } from './utils/classifyGraphShape.js';
import { isEdgelessShape, isAbstractionShape } from './utils/graphShapes.js';
import { planUnfold } from './utils/unfoldController.js';
import { newBuildId } from '../../services/oneShot.js';

/**
 * Create a new graph and populate it with nodes, edges, and groups
 * @param {Object} args - { name, nodes: [{ name, color?, description? }], edges?: [{ source, target, type? }], groups?: [{ name, color?, memberNames }] }
 * @param {Object} graphState - Current graph state (not used, creates new graph)
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { graphId, graphName, nodesAdded, edgesAdded, groupsAdded }
 */
export async function createPopulatedGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { name, description = '', nodes = [], edges = [], groups = [], targetGraphId, palette, color, enrich, overwriteDescription } = args;

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

  // A3 — Shape routing. Classify the structural shape (from an explicit shape arg,
  // else from the request/description/name if a model is available) and route the
  // two shapes where drawing the model's canvas edges is WRONG:
  //   - 'set'    → license NOT drawing edges (over-connection is a known failure)
  //   - 'ladder' → route to the abstraction axis, not canvas edges
  // Every other shape draws edges as given. No model → no classification, edges
  // unchanged (identical to before). Correlated in the log via buildId.
  const buildId = args.buildId || newBuildId();
  let shape = (typeof args.shape === 'string' && args.shape) ? args.shape : null;
  if (!shape) {
    const request = args.request || description || name;
    if (request) {
      try { shape = await classifyGraphShape({ request, buildId }); } catch { shape = null; }
    }
  }
  let workingEdges = edges || [];
  let shapeRouting = null;
  if (shape && isEdgelessShape(shape)) {
    shapeRouting = 'nodes-only';
    workingEdges = [];
  } else if (shape && isAbstractionShape(shape)) {
    shapeRouting = 'abstraction-axis';
    workingEdges = [];
  }

  // A3 — Recursive unfold PLANNING. Decide (all via one-off calls) whether each
  // member should open into its own definition graph of its contents, and build
  // a plan the applier executes against the real store. Null with no model /
  // "no unfold" — identical flat behavior. Disabled via unfold:false or when
  // routing to the abstraction axis (ladders are not nested definition graphs).
  let unfoldPlan = null;
  if (args.unfold !== false && shapeRouting !== 'abstraction-axis') {
    const unfoldRequest = args.request || description || name;
    try {
      unfoldPlan = await planUnfold({
        nodeSpecs,
        request: unfoldRequest,
        shape,
        memberKind: args.memberKind,
        buildId
      });
    } catch { unfoldPlan = null; }
  }
  const unfoldSummary = unfoldPlan
    ? unfoldPlan.members.map((m) => ({
        member: m.memberName,
        kind: m.memberKind,
        insideShape: m.insideShape,
        count: m.nodes.length
      }))
    : null;

  // Validate edges: strip any that reference nodes not in the nodes array
  const { validEdges, droppedEdges } = await validateEdgesSmart(nodeSpecs, workingEdges);

  // Validation: each edge needs SOMETHING describing its connection type.
  // Accepted shapes (in order of preference):
  //   1. definitionNode: { name, color?, description? }    — preferred
  //   2. type: "<string>"                                  — auto-promoted to definitionNode
  // If both are missing or empty, error out so the LLM can self-correct.
  for (let i = 0; i < validEdges.length; i++) {
    const e = validEdges[i];
    const hasDefNode = e.definitionNode && typeof e.definitionNode === 'object' && typeof e.definitionNode.name === 'string' && e.definitionNode.name.trim().length > 0;
    const hasTypeString = typeof e.type === 'string' && e.type.trim().length > 0;
    if (!hasDefNode && !hasTypeString) {
      throw new Error(
        `Edge ${i + 1} (${e.source} → ${e.target}) needs a connection type. ` +
        `Provide either a 'type' string (e.g., type: "Establishes") or a 'definitionNode' object (e.g., definitionNode: { name: "Establishes", description: "..." }). ` +
        `Both shapes are accepted.`
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
    // A3 shape routing feedback (buildId correlates all one-shot calls this build)
    buildId,
    shape,
    shapeRouting,
    shapeNote: shapeRouting === 'nodes-only'
      ? `Classified as "set": edges omitted (these items don't clearly relate).`
      : shapeRouting === 'abstraction-axis'
        ? `Classified as "ladder": this is an is-a hierarchy — route to the abstraction axis, not canvas edges.`
        : null,
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
    // Hint: defining node bio check
    definingNodeMissingBio: !description || description.trim() === '',
    bioHint: (!description || description.trim() === '')
        ? `This graph has no description. It becomes the bio of "${name}" in the parent graph. Provide one via the description parameter.`
        : null,
    // Enrichment control
    enrich: enrich !== false,
    overwriteDescription: overwriteDescription || false,
    // A3 unfold — concise summary survives sanitizeResultForLLM (spec is stripped)
    // so the agent can narrate what got unfolded. Null when nothing unfolds.
    unfoldSummary,
    unfoldNote: unfoldSummary
      ? `Each ${unfoldPlan.memberKind} was opened into its own definition graph of its contents.`
      : null,
    // Include full spec for UI to apply. unfoldPlan rides here (stripped from the
    // model payload) so the applier can build the nested definition graphs.
    spec: {
      nodes: nodeSpecs,
      edges: edgeSpecs,
      groups: groupSpecs,
      unfoldPlan
    }
  };
}

