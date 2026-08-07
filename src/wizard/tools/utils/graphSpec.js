/**
 * graphSpec - Normalize a nested graph spec (nodes / edges / groups / layers).
 *
 * Extracted from buildComposition so that every build tool can accept layers,
 * not just the one tool the model has to consciously reach for. That asymmetry
 * was the structural reason the wizard didn't compose on its own: `expandGraph`,
 * `createPopulatedGraph` and `populateDefinitionGraph` could only emit flat nodes
 * and plain visual groups, and `expandGraph` is what the quality-repair loop
 * runs — so even a graph that started composed got flattened by its own fixes.
 *
 * A "layer" is a Thing that also has a web inside it. Layers nest: a layer's
 * definition can contain further layers, each a real web at its own level.
 */

import { resolvePaletteColor } from '../../../ai/palettes.js';
import { nodeSizeMul } from './nodeSize.js';

export const MAX_LAYER_DEPTH = 4;
export const SOFT_NODE_CAP = 12;

/** "isPartOf" → "Is Part Of" */
export const toTitleCase = (str) => {
  if (!str) return '';
  const spaced = String(str).replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
};

export const generateConnectionColor = (name) => {
  const s = String(name || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 60%, 45%)`;
};

/** Tolerate a JSON string where an array was expected (small models do this). */
export function coerceArray(value) {
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
export function prototypeNameSet(graphState) {
  const names = new Set();
  const protos = graphState?.nodePrototypes;
  if (!protos) return names;
  const iter = Array.isArray(protos) ? protos : (protos instanceof Map ? protos.values() : Object.values(protos));
  for (const p of iter) {
    if (p?.name) names.add(String(p.name).toLowerCase().trim());
  }
  return names;
}

/** A fresh normalization context. */
export function createSpecContext(palette, graphState) {
  return {
    palette,
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
}

/**
 * Normalize one GraphSpec level and collect warnings. Recurses through
 * `layer.definition`.
 *
 * @param {Object} spec - { nodes?, edges?, groups?, layers? }
 * @param {Object} ctx - from createSpecContext()
 * @param {number} depth - 0 at the top level
 * @param {string} path - human-readable location, for warnings
 */
export function normalizeGraphSpec(spec, ctx, depth = 0, path = 'graph') {
  const { palette, knownPrototypes, warnings, stats } = ctx;
  const nodes = coerceArray(spec?.nodes);
  const edges = coerceArray(spec?.edges);
  const groups = coerceArray(spec?.groups);
  const layers = coerceArray(spec?.layers);

  stats.maxDepth = Math.max(stats.maxDepth, depth);

  // A layer already materializes as a Thing at this level, so the same name in
  // `nodes` is the same Thing described twice — and keeping both breaks the
  // build: the plain node wins the race into the graph, the layer's shell is
  // swallowed by name de-duplication, and with no shell to decompose the layer
  // never opens into a node-group. See dropLayerNameCollisions for why the
  // duplicate is folded in rather than simply discarded.
  const rawLayers = coerceArray(spec?.layers).filter(l => l && l.name);
  const layersByKey = new Map(rawLayers.map(l => [String(l.name).toLowerCase().trim(), l]));

  const collidingNodeNames = [];
  const nodeSpecs = nodes
    .filter(n => n && n.name)
    .filter(n => {
      const layer = layersByKey.get(String(n.name).toLowerCase().trim());
      if (!layer) return true;
      // Carry the duplicate's prose over rather than losing it; never touch a
      // `use:` layer, whose identity belongs to the web it already has.
      if (!layer.use) {
        if (!layer.description && n.description) layer.description = n.description;
        if (!layer.color && n.color) layer.color = n.color;
      }
      collidingNodeNames.push(n.name);
      return false;
    })
    .map(n => ({
      name: n.name,
      color: resolvePaletteColor(palette, n.color),
      description: n.description || '',
      sizeMul: nodeSizeMul(n.size),
      type: n.type || null,
      typeColor: resolvePaletteColor(palette, n.typeColor || '#A0A0A0'),
      typeDescription: n.typeDescription || ''
    }));
  if (collidingNodeNames.length > 0) {
    warnings.push(`${path}: ${layerCollisionWarning(collidingNodeNames)}`);
  }
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

    if (depth + 1 > MAX_LAYER_DEPTH) {
      warnings.push(`${lPath}: exceeds max nesting depth ${MAX_LAYER_DEPTH} — dropped.`);
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
      // A layer creates a real, reusable prototype, so its name has to identify
      // it outside the web it was authored in. Authoring a fresh definition under
      // a name that already exists is the precise case where that fails: either
      // this IS that Thing (so invoke it) or it is a different one that happens to
      // share a generic name (so qualify it). Nothing here guesses at whether a
      // name is "too generic" — it only fires on a real collision.
      if (knownPrototypes.has(layer.name.toLowerCase().trim())) {
        warnings.push(
          `${lPath}: a Thing named "${layer.name}" already exists. If this is that same Thing, `
          + `invoke it with { "name": "${layer.name}", "use": "${layer.name}" } instead of authoring it again. `
          + `If it is a different one, qualify the name so it reads unambiguously on its own `
          + `(e.g. "${layer.name} for <the thing it belongs to>") — a layer is a Thing that can be reused anywhere, `
          + 'so its name has to make sense away from here.'
        );
      }
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
 * Fold nodes that duplicate a layer name into that layer.
 *
 * A layer already materializes as a Thing at this level, so the same name in
 * `nodes` is the same Thing described twice. Keeping both is not an option: the
 * plain node beats the layer's shell into the graph, the shell is de-duplicated
 * away, and the layer silently never decomposes — the concept ends up defined but
 * flat, which reads to the model as success.
 *
 * But the duplicate is not worthless. The model usually writes a real description
 * on the plain node (that is the form it is used to), and discarding it loses
 * work for no reason. So the node's description and colour are merged onto the
 * layer wherever the layer left them blank, and only the redundant *structure*
 * goes away. A `use:` layer is left strictly alone — its identity belongs to the
 * web it already has, and an incidental duplicate here must not rewrite it.
 *
 * @returns {{nodes: Array, dropped: string[]}}
 */
export function dropLayerNameCollisions(nodeSpecs, layerSpecs) {
  const layersByKey = new Map();
  for (const l of (layerSpecs || [])) {
    if (l && l.name) layersByKey.set(String(l.name).toLowerCase().trim(), l);
  }
  if (layersByKey.size === 0) return { nodes: nodeSpecs || [], dropped: [] };

  const dropped = [];
  const nodes = (nodeSpecs || []).filter(n => {
    const layer = n && layersByKey.get(String(n.name || '').toLowerCase().trim());
    if (!layer) return true;

    if (!layer.use) {
      if (!layer.description && n.description) layer.description = n.description;
      if (!layer.color && n.color) layer.color = n.color;
    }
    dropped.push(n.name);
    return false;
  });
  return { nodes, dropped };
}

/** The warning text for a collision fold, so every tool words it identically. */
export function layerCollisionWarning(dropped) {
  return `${dropped.map(n => `"${n}"`).join(', ')} listed as both a plain node and a layer — `
    + 'folded into the layer (its description and colour were carried over). A layer already '
    + 'appears at this level as a Thing, so you never need to list it in `nodes` too; '
    + 'edges can name it directly.';
}

/**
 * Normalize just the `layers` field of a flat build tool's arguments.
 *
 * `expandGraph` and friends keep their own handling of nodes, edges and groups —
 * those paths carry smart edge validation and structure review that composition
 * does not need to duplicate. This normalizes only the composed part, so a flat
 * tool can grow depth without being rewritten around a different spec shape.
 *
 * @returns {{layers: Array, warnings: string[], stats: Object}|null} null when no layers were given
 */
export function normalizeLayersOnly(rawLayers, { palette, graphState }) {
  const layers = coerceArray(rawLayers);
  if (layers.length === 0) return null;

  const ctx = createSpecContext(palette, graphState);
  // Top-level nodes are validated by the host tool, so an edge from a layer out
  // to one of them is not visible here. Normalizing under an empty top level
  // keeps the layer definitions (and their internal edges) correct, which is the
  // part that matters.
  const spec = normalizeGraphSpec({ layers }, ctx, 0, 'graph');

  return { layers: spec.layers, warnings: ctx.warnings, stats: ctx.stats };
}
