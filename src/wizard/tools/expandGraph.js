/**
 * expandGraph - Add multiple nodes and edges to a graph
 *
 * Unlike createPopulatedGraph which creates a new graph, this adds to an existing one.
 * Can target any graph via targetGraphId, or defaults to active graph.
 * Uses the same direct UI application pattern (bypassing the queue) for reliability.
 */

import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';
import { validateEdgesSmart } from './edgeValidator.js';
import { analyzeGraphQuality } from './graphQuality.js';
import { resolveGraphId } from './resolveGraphId.js';
import { runStructureReview } from './utils/structureReview.js';
import { newBuildId } from '../../services/oneShot.js';

/**
 * Convert string to Title Case
 */
function toTitleCase(str) {
  if (!str) return '';
  // Split camelCase: "isPartOf" → "is Part Of"
  const spaced = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Generate a deterministic color from a name
 */
function generateConnectionColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

/**
 * Expand graph with multiple nodes and edges
 * @param {Object} args - { nodes: [{ name, color?, description? }], edges: [{ source, target, type?, definitionNode? }], targetGraphId?: string }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { action, nodesAdded, edgesAdded, spec }
 */
export async function expandGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { nodes = [], edges = [], groups = [], targetGraphId, palette, enrich, overwriteDescription } = args;

  if ((!nodes || nodes.length === 0) && (!edges || edges.length === 0)) {
    throw new Error('At least one node or edge is required');
  }

  const { activeGraphId } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphState.graphs || [], { activeGraphId }) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // Validate graph exists
  const graphExists = (graphState.graphs || []).some(g => g.id === graphId);
  if (!graphExists) {
    throw new Error(
      `Cannot expand graph: target graph "${graphId}" does not exist. ` +
      `Available graphs: ${(graphState.graphs || []).map(g => `"${g.name}" (${g.id})`).join(', ') || 'none'}`
    );
  }

  // Pick a palette if none provided
  const activePalette = palette || getRandomPalette();

  // Build node specs
  const nodeSpecs = nodes.map(n => ({
    name: n.name,
    color: resolvePaletteColor(activePalette, n.color),
    description: n.description || '',
    type: n.type || null,
    typeColor: resolvePaletteColor(activePalette, n.typeColor || '#A0A0A0'),
    typeDescription: n.typeDescription || ''
  }));

  // Validate edges: strip any that reference nodes not in the nodes array or existing graph
  const existingNodeNames = (graphState.nodePrototypes || []).map(p => p.name).filter(Boolean);
  const { validEdges, droppedEdges } = await validateEdgesSmart(nodeSpecs, edges || [], existingNodeNames);

  // Accept either definitionNode object OR a plain type string (like createPopulatedGraph allows).
  // Auto-construct definitionNode from type string so small models can use simple edge format.
  for (let i = 0; i < validEdges.length; i++) {
    const e = validEdges[i];
    if (!e.definitionNode || typeof e.definitionNode !== 'object' || !e.definitionNode.name) {
      if (e.type && typeof e.type === 'string' && e.type.trim()) {
        e.definitionNode = { name: e.type.trim() };
      } else {
        throw new Error(
          `Edge ${i + 1} (${e.source} → ${e.target}) needs either a 'definitionNode: { name: "..." }' object ` +
          `or a 'type: "..."' string. Example: { source: "A", target: "B", type: "Connects To" }`
        );
      }
    }
  }

  // Build edge specs with definitionNode handling (same as createPopulatedGraph)
  const edgeSpecs = validEdges.map(e => {
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

  // Detect nodes that are being added to a non-active (definition) graph but already exist
  // as prototypes in the universe. This catches the common mistake where a model adds
  // e.g. "Qin State" into the definition graph of "Warring States Period China" even though
  // "Qin State" already exists as a sibling node in the parent graph.
  const isTargetingOtherGraph = graphId !== activeGraphId;
  let duplicateNodeWarning = null;
  if (isTargetingOtherGraph && nodeSpecs.length > 0) {
    const allProtoNames = new Set(
      (graphState.nodePrototypes || []).map(p => (p.name || '').toLowerCase().trim()).filter(Boolean)
    );
    const duplicates = nodeSpecs.filter(n => allProtoNames.has((n.name || '').toLowerCase().trim()));
    if (duplicates.length > 0) {
      duplicateNodeWarning = `WARNING: The following nodes already exist in this universe and will create duplicates: ${duplicates.map(n => `"${n.name}"`).join(', ')}. These nodes were added to the parent graph. You are now inside a definition graph — add sub-components that describe the INTERNALS of the concept, not the sibling nodes from the parent web.`;
    }
  }

  // Analyze graph quality for LLM feedback
  const qualityReport = analyzeGraphQuality(nodeSpecs, edgeSpecs);

  // Part B — Structure review over the newly-added nodes/edges (free detection;
  // model pass only on dense candidates, biased to suggest nothing). Surfaced in
  // the result for the agent to relay; never auto-applied.
  const buildId = args.buildId || newBuildId();
  let structureSuggestions = [];
  try {
    const reviewNodes = nodeSpecs.map((n) => ({ id: n.name, name: n.name }));
    const reviewEdges = edgeSpecs.map((e) => ({ sourceId: e.source, destinationId: e.target }));
    const { suggestions } = await runStructureReview(reviewNodes, reviewEdges, { request: args.request, buildId });
    structureSuggestions = suggestions.map((s) => ({
      nodeNames: s.nodeNames,
      action: s.action,
      suggestedName: s.name,
      coherenceCallId: s.coherenceCallId,
      structureCallId: s.structureCallId,
      nameCallId: s.nameCallId
    }));
  } catch { structureSuggestions = []; }

  // Return full spec so UI can apply it directly (same pattern as createPopulatedGraph)
  return {
    action: 'expandGraph',
    graphId, // Can be activeGraphId or targetGraphId
    buildId,
    structureSuggestions,
    structureNote: structureSuggestions.length > 0
      ? `Found ${structureSuggestions.length} region(s) that could be tightened: ` +
        structureSuggestions.map((s) => `${s.action} {${s.nodeNames.join(', ')}}${s.suggestedName ? ` as "${s.suggestedName}"` : ''}`).join('; ') +
        `. Offer these to the user; apply only if they agree.`
      : null,
    // For ToolCallCard summary (counts)
    nodesAdded: nodeSpecs.map(n => n.name),
    edgesAdded: edgeSpecs,
    groupsAdded: groupSpecs.map(g => g.name),
    nodeCount: nodeSpecs.length,
    edgeCount: edgeSpecs.length,
    groupCount: groupSpecs.length,
    // Duplicate node warning (when adding nodes that already exist elsewhere in the universe)
    duplicateNodeWarning,
    // Edge validation feedback for LLM
    droppedEdges,
    edgeWarning: droppedEdges.length > 0
      ? `${droppedEdges.length} edge(s) were dropped because they referenced nodes not in the nodes array: ${droppedEdges.map(d => `${d.source} → ${d.target} (${d.reason})`).join('; ')}`
      : null,
    // Quality analysis — LLM should fix issues before responding
    qualityReport,
    // Enrichment control
    enrich: enrich !== false,
    overwriteDescription: overwriteDescription || false,
    // Include full spec for UI to apply
    spec: {
      nodes: nodeSpecs,
      edges: edgeSpecs,
      groups: groupSpecs
    }
  };
}
