/**
 * buildComposition - Build nested node-group LAYERS in one deterministic call.
 *
 * A "layer" is a Thing that also has a web inside it: the tool creates the
 * prototype, creates and populates its definition graph, and (when the layer is
 * `display: 'decomposed'`) spreads that web open in the parent graph as a
 * node-group. Layers nest — a layer's definition can contain further layers.
 *
 * The model authors the whole nested structure ONCE; the recursion
 * (create prototype → populate definition → decompose into the parent) runs in
 * code in toolResultApplier.applyToolResultToStore. That split is deliberate:
 * small models cannot reliably hold a multi-call recursive pipeline in their
 * problem space, and every previous attempt to have them orchestrate
 * thingGroup/decomposeNode by hand produced plain groups instead of node-groups.
 *
 * This tool only validates and normalizes. It never mutates the store.
 */

import { getRandomPalette } from '../../ai/palettes.js';
import { analyzeGraphQuality } from './graphQuality.js';
import { summarizeLadders } from './utils/abstractionSpec.js';
import { resolveGraphId } from './resolveGraphId.js';
import {
  normalizeGraphSpec,
  createSpecContext,
  coerceArray,
  describeReceived
} from './utils/graphSpec.js';

/**
 * Build nested node-group layers in a graph.
 *
 * @param {Object} args - { targetGraphId?, nodes?, edges?, groups?, layers*, palette?, enrich?, overwriteDescription? }
 * @param {Object} graphState - Serialized graph state (read-only; used to resolve
 *   the target graph and to check `use:` targets)
 * @returns {Promise<Object>} result carrying the normalized spec for the applier
 */
export async function buildComposition(args, graphState) {
  const { targetGraphId, palette, enrich, overwriteDescription } = args;

  const layers = coerceArray(args.layers);
  if (layers.length === 0) {
    // `layers` arrives as a hand-escaped JSON string on every provider path
    // (flattenDeepNesting), so "empty" usually means malformed rather than
    // missing. Echo what actually arrived — a model cannot repair its own broken
    // JSON if the error only tells it the field was required.
    throw new Error(
      `At least one layer is required (received ${describeReceived(args.layers)}). ` +
      'If that looks like your layers, the JSON string was malformed — re-send it as valid JSON. ' +
      'A layer is a Thing with a web inside it. Example: ' +
      'buildComposition({"layers": [{"name": "Engine", "display": "decomposed", "definition": {"nodes": [{"name": "Pistons"}, {"name": "Crankshaft"}]}}]}). ' +
      'For a flat graph with no composition, use createPopulatedGraph or expandGraph instead.'
    );
  }

  const graphId = resolveGraphId(
    targetGraphId || graphState?.activeGraphId,
    graphState?.graphs,
    { activeGraphId: graphState?.activeGraphId }
  );
  if (!graphId) {
    throw new Error('No target graph. Pass targetGraphId, or create a graph first with createGraph/createPopulatedGraph.');
  }

  const graphList = Array.isArray(graphState?.graphs)
    ? graphState.graphs
    : (graphState?.graphs instanceof Map ? Array.from(graphState.graphs.values()) : []);
  const graphName = graphList.find(g => g?.id === graphId)?.name || '';

  const ctx = createSpecContext(palette || getRandomPalette(), graphState);

  const spec = normalizeGraphSpec(
    { nodes: args.nodes, edges: args.edges, groups: args.groups, layers: args.layers },
    ctx,
    0,
    graphName || 'graph'
  );

  if (spec.layers.length === 0) {
    throw new Error(`All ${layers.length} layer(s) were dropped during validation: ${ctx.warnings.join(' ')}`);
  }

  if (ctx.stats.maxDepth > 3) {
    ctx.warnings.push(`Nesting is ${ctx.stats.maxDepth} levels deep — deep stacks are hard to read on the canvas. Consider marking some layers "collapsed".`);
  }

  // Quality feedback on the top level only; nested levels are reported through
  // warnings. Layers MUST be passed: they are legal edge endpoints here, so
  // omitting them dropped every node-to-layer edge from the adjacency and
  // reported perfectly well-connected nodes as orphans — which is what drove the
  // model to "fix" a composed graph by flattening it with hub edges.
  const qualityReport = analyzeGraphQuality(spec.nodes, spec.edges, { layers: spec.layers, groups: spec.groups });

  console.error('[buildComposition] graph:', graphId, 'layers:', ctx.stats.layerCount, 'maxDepth:', ctx.stats.maxDepth);

  // Ladders can sit on nodes at any depth, and result.spec never reaches the model —
  // so gather them across the whole nesting for the summary.
  const collectLaddered = (s) => [
    ...(s?.nodes || []).filter((n) => n?.isA?.length),
    ...(s?.layers || []).flatMap((l) => [
      ...(l?.isA?.length ? [l] : []),
      ...collectLaddered(l?.definition)
    ])
  ];

  return {
    action: 'buildComposition',
    ...summarizeLadders(collectLaddered(spec)),
    graphId,
    graphName,
    // Stripped from LLM history by sanitizeResultForLLM; reaches the applier intact.
    spec,
    layerCount: ctx.stats.layerCount,
    maxDepth: ctx.stats.maxDepth,
    nodeCount: ctx.stats.nodeCount,
    edgeCount: ctx.stats.edgeCount,
    decomposedLayers: ctx.stats.decomposedLayers,
    collapsedLayers: ctx.stats.collapsedLayers,
    reusedLayers: ctx.stats.reusedLayers,
    qualityReport,
    warnings: ctx.warnings,
    enrich: enrich !== false,
    overwriteDescription: overwriteDescription || false
  };
}

export default buildComposition;
