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

import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';
import { analyzeGraphQuality } from './graphQuality.js';
import { resolveGraphId } from './resolveGraphId.js';
import { nodeSizeMul } from './utils/nodeSize.js';

const MAX_DEPTH = 4;
const SOFT_NODE_CAP = 12;

/** "isPartOf" → "Is Part Of" */
const toTitleCase = (str) => {
  if (!str) return '';
  const spaced = String(str).replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
};

const generateConnectionColor = (name) => {
  const s = String(name || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 60%, 45%)`;
};

/** Tolerate a JSON string where an array was expected (small models do this). */
function coerceArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

/** All prototype names in the serialized graphState (Array or Map). */
function prototypeNameSet(graphState) {
  const names = new Set();
  const protos = graphState?.nodePrototypes;
  if (!protos) return names;
  const iter = Array.isArray(protos) ? protos : (protos instanceof Map ? protos.values() : Object.values(protos));
  for (const p of iter) {
    if (p?.name) names.add(String(p.name).toLowerCase().trim());
  }
  return names;
}

/**
 * Normalize one GraphSpec level (nodes / edges / plain groups / layers) and
 * collect warnings. Recurses through `layer.definition`.
 */
function normalizeGraphSpec(spec, ctx, depth, path) {
  const { palette, knownPrototypes, warnings, stats } = ctx;
  const nodes = coerceArray(spec?.nodes);
  const edges = coerceArray(spec?.edges);
  const groups = coerceArray(spec?.groups);
  const layers = coerceArray(spec?.layers);

  stats.maxDepth = Math.max(stats.maxDepth, depth);

  const nodeSpecs = nodes
    .filter(n => n && n.name)
    .map(n => ({
      name: n.name,
      color: resolvePaletteColor(palette, n.color),
      description: n.description || '',
      sizeMul: nodeSizeMul(n.size),
      type: n.type || null,
      typeColor: resolvePaletteColor(palette, n.typeColor || '#A0A0A0'),
      typeDescription: n.typeDescription || ''
    }));
  stats.nodeCount += nodeSpecs.length;

  if (nodeSpecs.length > SOFT_NODE_CAP) {
    warnings.push(`${path}: ${nodeSpecs.length} nodes at one level — consider grouping some into layers (soft cap ${SOFT_NODE_CAP}).`);
  }

  // Layer names are legal endpoints at this level: a layer materializes as a
  // shell instance here, and after decomposition that shell is the group's
  // anchor — which is exactly where edges to "the Thing" attach.
  const layerNames = layers.filter(l => l && l.name).map(l => l.name);
  const seenLayerNames = new Set();
  for (const ln of layerNames) {
    const key = ln.toLowerCase().trim();
    if (seenLayerNames.has(key)) warnings.push(`${path}: duplicate layer name "${ln}" at the same level.`);
    seenLayerNames.add(key);
  }

  const validEndpoints = new Set([
    ...nodeSpecs.map(n => n.name.toLowerCase().trim()),
    ...layerNames.map(n => n.toLowerCase().trim())
  ]);

  const edgeSpecs = [];
  for (const e of edges) {
    if (!e || !e.source || !e.target) continue;
    const srcOk = validEndpoints.has(String(e.source).toLowerCase().trim());
    const dstOk = validEndpoints.has(String(e.target).toLowerCase().trim());
    if (!srcOk || !dstOk) {
      warnings.push(`${path}: dropped edge ${e.source} → ${e.target} (${!srcOk ? `"${e.source}"` : `"${e.target}"`} is not a node or layer at this level).`);
      continue;
    }
    const typeName = e.definitionNode?.name || e.type || '';
    const titleCaseName = toTitleCase(typeName);
    edgeSpecs.push({
      source: e.source,
      target: e.target,
      directionality: e.directionality || 'unidirectional',
      type: titleCaseName || 'Connection',
      definitionNode: titleCaseName ? {
        name: titleCaseName,
        color: resolvePaletteColor(palette, e.definitionNode?.color || generateConnectionColor(titleCaseName)),
        description: e.definitionNode?.description || ''
      } : null
    });
  }
  stats.edgeCount += edgeSpecs.length;

  // Plain visual groups — loose clustering only, never node-groups.
  const groupSpecs = [];
  for (const g of groups) {
    if (!g || !g.name) continue;
    const memberNames = coerceArray(g.memberNames).filter(m => validEndpoints.has(String(m).toLowerCase().trim()));
    if (memberNames.length === 0) {
      warnings.push(`${path}: dropped plain group "${g.name}" — none of its members exist at this level.`);
      continue;
    }
    groupSpecs.push({
      name: g.name,
      color: resolvePaletteColor(palette, g.color || '#8B0000'),
      memberNames
    });
  }

  const layerSpecs = [];
  for (const layer of layers) {
    if (!layer || !layer.name) {
      warnings.push(`${path}: dropped a layer with no name.`);
      continue;
    }
    const lPath = `${path} › ${layer.name}`;

    if (depth + 1 > MAX_DEPTH) {
      warnings.push(`${lPath}: exceeds max nesting depth ${MAX_DEPTH} — dropped.`);
      continue;
    }

    const useName = typeof layer.use === 'string' && layer.use.trim() ? layer.use.trim() : null;
    const hasDefinition = layer.definition && typeof layer.definition === 'object';
    if (useName && hasDefinition) {
      warnings.push(`${lPath}: has both "use" and "definition" — using the existing web "${useName}" and ignoring the authored definition.`);
    }

    const display = layer.display === 'collapsed' ? 'collapsed' : 'decomposed';
    const normalized = {
      name: layer.name,
      color: resolvePaletteColor(palette, layer.color || '#8B0000'),
      description: layer.description || '',
      display
    };

    if (useName) {
      normalized.use = useName;
      if (!knownPrototypes.has(useName.toLowerCase().trim())) {
        warnings.push(`${lPath}: use: "${useName}" — no Thing with that name exists yet; an empty Thing will be created instead. Author a "definition" if you meant to create it.`);
      }
      stats.reusedLayers.push(layer.name);
    } else {
      normalized.definition = normalizeGraphSpec(layer.definition || {}, ctx, depth + 1, lPath);
      const innerCount = normalized.definition.nodes.length + normalized.definition.layers.length;
      if (innerCount === 0) {
        warnings.push(`${lPath}: definition is empty — it will render as an empty node-group. Give it 3-8 sub-components, or make it a plain node instead of a layer.`);
      } else if (innerCount < 2) {
        warnings.push(`${lPath}: definition has only ${innerCount} component — too thin to be a web. Consider a plain node instead of a layer.`);
      }
    }

    if (display === 'collapsed') stats.collapsedLayers.push(layer.name);
    else stats.decomposedLayers.push(layer.name);
    stats.layerCount += 1;

    layerSpecs.push(normalized);
  }

  return { nodes: nodeSpecs, edges: edgeSpecs, groups: groupSpecs, layers: layerSpecs };
}

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
    throw new Error(
      'At least one layer is required. A layer is a Thing with a web inside it. Example: ' +
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

  const ctx = {
    palette: palette || getRandomPalette(),
    knownPrototypes: prototypeNameSet(graphState),
    warnings: [],
    stats: {
      layerCount: 0,
      maxDepth: 0,
      nodeCount: 0,
      edgeCount: 0,
      decomposedLayers: [],
      collapsedLayers: [],
      reusedLayers: []
    }
  };

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

  // Quality feedback on the top level only; nested levels are reported through warnings.
  const qualityReport = analyzeGraphQuality(spec.nodes, spec.edges);

  console.error('[buildComposition] graph:', graphId, 'layers:', ctx.stats.layerCount, 'maxDepth:', ctx.stats.maxDepth);

  return {
    action: 'buildComposition',
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
