/**
 * edgeValidator - Validates that edge source/target names reference existing nodes
 *
 * Shared utility used by createPopulatedGraph, expandGraph, and populateDefinitionGraph
 * to catch edges that reference non-existent nodes (common with small local LLMs).
 */

import { calculateStringSimilarity } from './utils/stringSimilarity.js';

/**
 * Validate edges against known node names, stripping invalid ones.
 * @param {Array} nodeSpecs - Array of node specs being created in this operation (each has .name)
 * @param {Array} edges - Raw edges from the LLM (each has .source and .target)
 * @param {Array} existingNodeNames - Optional: names of nodes that already exist in the target graph
 * @returns {{ validEdges: Array, droppedEdges: Array }}
 */
export function validateEdges(nodeSpecs, edges, existingNodeNames = []) {
  if (!edges || edges.length === 0) {
    return { validEdges: [], droppedEdges: [] };
  }

  // Build case-insensitive set of all known node names
  const knownNames = new Set();
  for (const spec of nodeSpecs) {
    if (spec.name) knownNames.add(String(spec.name).toLowerCase().trim());
  }
  for (const name of existingNodeNames) {
    if (name) knownNames.add(String(name).toLowerCase().trim());
  }

  const validEdges = [];
  const droppedEdges = [];

  for (const edge of edges) {
    const sourceName = (edge.source || '').toLowerCase().trim();
    const targetName = (edge.target || '').toLowerCase().trim();

    const sourceExists = knownNames.has(sourceName);
    const targetExists = knownNames.has(targetName);

    if (sourceExists && targetExists) {
      validEdges.push(edge);
    } else {
      const reasons = [];
      if (!sourceExists) reasons.push(`source "${edge.source}" is not in the nodes array`);
      if (!targetExists) reasons.push(`target "${edge.target}" is not in the nodes array`);

      droppedEdges.push({
        source: edge.source,
        target: edge.target,
        reason: reasons.join('; ')
      });
    }
  }

  if (droppedEdges.length > 0) {
    console.error(`[edgeValidator] Dropped ${droppedEdges.length} edge(s) with non-existent node references:`);
    for (const d of droppedEdges) {
      console.error(`[edgeValidator]   ${d.source} → ${d.target}: ${d.reason}`);
    }
  }

  return { validEdges, droppedEdges };
}

/** Case and spacing never distinguish two names. Nothing else is forgiven. */
export const normalizeEndpointName = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const listOf = (c) => (Array.isArray(c)
  ? c
  : c instanceof Map ? Array.from(c.values()) : Object.values(c || {}));

/**
 * The names a call's own layers put in the web: each layer, and, for a layer
 * that opens in place, everything its definition holds (copied in when it
 * decomposes). A collapsed layer keeps its contents inside it.
 */
function collectLayerNames(layers, out = []) {
  for (const layer of listOf(layers)) {
    if (!layer?.name) continue;
    out.push(String(layer.name));
    if (layer.display === 'collapsed' || layer.use) continue;
    const def = layer.definition || {};
    for (const n of listOf(def.nodes)) {
      const name = typeof n === 'string' ? n : n?.name;
      if (name) out.push(String(name));
    }
    collectLayerNames(def.layers, out);
  }
  return out;
}

/**
 * What an edge endpoint may resolve against outside the call: the target web's
 * instances by name, and every Thing in the universe (last match per name).
 * The Thing a web defines is left out of the universe: placing it inside its
 * own definition is never what an edge meant.
 */
export function edgeScopeFromState(graphState, graphId, { exclude = [] } = {}) {
  const protos = listOf(graphState?.nodePrototypes);
  const protoById = new Map(protos.map((p) => [p?.id, p]));
  const graph = graphId ? listOf(graphState?.graphs).find((g) => g?.id === graphId) : null;
  const webNames = graph
    ? listOf(graph.instances).map((i) => i?.name || protoById.get(i?.prototypeId)?.name).filter(Boolean)
    : [];
  const skip = new Set([...(Array.isArray(graph?.definingNodeIds) ? graph.definingNodeIds : []), ...exclude]);
  const universe = protos
    .filter((p) => p?.name && !skip.has(p.id))
    .map((p) => ({ name: p.name, prototypeId: p.id }));
  return { webNames, universe };
}

/** The few existing names nearest to one that matched nothing. */
function closestNames(raw, pool, max = 3) {
  const q = normalizeEndpointName(raw);
  return pool
    .map((name) => {
      const n = normalizeEndpointName(name);
      const contains = q && n && (n.includes(q) || q.includes(n)) ? 0.5 : 0;
      return { name, score: calculateStringSimilarity(q, n) + contains };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((e) => e.name);
}

/**
 * Edge validation by exact name. An endpoint resolves, case and spacing aside,
 * in this order:
 *   1. a name this call puts in the web: its nodes, its layers, and what those
 *      layers open into
 *   2. a Thing already in the target web
 *   3. a Thing elsewhere in the universe (last match), which the applier places
 *      in the web so the edge has an end
 * Anything else drops the edge, with the closest existing names in the reason.
 * There is no substring or model fallback: "Softmax Function" is not "max", and
 * a wrong guess wires the graph wrong without anyone being told.
 *
 * @param {Array} nodeSpecs - the call's nodes (each has .name)
 * @param {Array} edges - raw edges (.source, .target)
 * @param {Object} [scope] - { layers, webNames, universe: [{ name, prototypeId }] }.
 *   An array here is read as webNames.
 * @returns {Promise<{ validEdges, droppedEdges, remappedEndpoints, placedExisting }>}
 *   validEdges carry the canonical names, and toLayer: true when an end is one
 *   of the call's layers (or inside one), so the applier can add them after the
 *   layers exist. placedExisting lists the universe Things tier 3 resolved to.
 */
export async function validateEdgesSmart(nodeSpecs, edges, scope = {}) {
  if (!edges || edges.length === 0) {
    return { validEdges: [], droppedEdges: [], remappedEndpoints: [], placedExisting: [] };
  }

  const { layers = [], webNames = [], universe = [] } = Array.isArray(scope) ? { webNames: scope } : (scope || {});

  const callNames = new Map();
  for (const spec of listOf(nodeSpecs)) {
    if (spec?.name) callNames.set(normalizeEndpointName(spec.name), { name: String(spec.name), toLayer: false });
  }
  for (const name of collectLayerNames(layers)) {
    callNames.set(normalizeEndpointName(name), { name, toLayer: true });
  }
  const webByName = new Map();
  for (const name of webNames) if (name) webByName.set(normalizeEndpointName(name), String(name));
  const universeByName = new Map();
  for (const u of listOf(universe)) {
    if (u?.name) universeByName.set(normalizeEndpointName(u.name), { name: String(u.name), prototypeId: u.prototypeId || u.id });
  }

  const resolve = (raw) => {
    const q = normalizeEndpointName(raw);
    if (!q) return null;
    if (callNames.has(q)) return { ...callNames.get(q) };
    if (webByName.has(q)) return { name: webByName.get(q), toLayer: false };
    if (universeByName.has(q)) return { ...universeByName.get(q), toLayer: false, fromUniverse: true };
    return null;
  };

  let pool = null;
  const missing = (role, raw) => {
    if (!pool) {
      pool = Array.from(new Set([...Array.from(callNames.values()).map((c) => c.name), ...webByName.values()]));
      if (pool.length < 3) pool = Array.from(new Set([...pool, ...Array.from(universeByName.values()).map((u) => u.name)]));
    }
    const near = closestNames(raw, pool);
    return `${role} "${raw ?? ''}" is not a Thing in this call, this web or the universe`
      + (near.length > 0 ? ` (closest: ${near.map((n) => `"${n}"`).join(', ')})` : '');
  };

  const validEdges = [];
  const droppedEdges = [];
  const remappedEndpoints = [];
  const placed = new Map();

  for (const edge of edges) {
    const s = resolve(edge.source);
    const t = resolve(edge.target);
    if (!s || !t) {
      const reasons = [];
      if (!s) reasons.push(missing('source', edge.source));
      if (!t) reasons.push(missing('target', edge.target));
      droppedEdges.push({ source: edge.source, target: edge.target, reason: reasons.join('; ') });
      continue;
    }
    if (s.name !== edge.source) remappedEndpoints.push({ from: edge.source, to: s.name });
    if (t.name !== edge.target) remappedEndpoints.push({ from: edge.target, to: t.name });
    for (const end of [s, t]) {
      if (end.fromUniverse && end.prototypeId) placed.set(end.prototypeId, { name: end.name, prototypeId: end.prototypeId });
    }
    const { toLayer, ...rest } = edge;
    validEdges.push({ ...rest, source: s.name, target: t.name, ...(s.toLayer || t.toLayer ? { toLayer: true } : {}) });
  }

  if (remappedEndpoints.length > 0) {
    console.error(`[edgeValidator] ${remappedEndpoints.length} endpoint(s) matched ignoring case/spacing:`);
    for (const r of remappedEndpoints) console.error(`[edgeValidator]   "${r.from}" -> "${r.to}"`);
  }
  if (droppedEdges.length > 0) {
    console.error(`[edgeValidator] Dropped ${droppedEdges.length} edge(s) with unknown endpoints:`);
    for (const d of droppedEdges) console.error(`[edgeValidator]   ${d.source} -> ${d.target}: ${d.reason}`);
  }

  return { validEdges, droppedEdges, remappedEndpoints, placedExisting: Array.from(placed.values()) };
}

/**
 * The model-facing account of what validation did to the edges: every drop,
 * every name matched only after ignoring case/spacing, and every Thing brought
 * in from elsewhere in the universe. Null when it changed nothing.
 */
export function describeEdgeValidation({ droppedEdges = [], remappedEndpoints = [], placedExisting = [] } = {}) {
  const parts = [];
  if (droppedEdges.length > 0) {
    parts.push(
      `${droppedEdges.length} edge(s) were dropped because an endpoint names no existing Thing: `
      + droppedEdges.map((d) => `${d.source} → ${d.target} (${d.reason})`).join('; ')
      + '. Nothing was guessed: send them again with the exact names.'
    );
  }
  if (remappedEndpoints.length > 0) {
    const pairs = new Map();
    for (const r of remappedEndpoints) pairs.set(`${r.from}\u0000${r.to}`, r);
    parts.push(`Matched ignoring case/spacing: ${Array.from(pairs.values()).map((r) => `"${r.from}" as "${r.to}"`).join(', ')}.`);
  }
  if (placedExisting.length > 0) {
    parts.push(
      'Placed existing Things from elsewhere in the universe into this web so their edges have an end: '
      + `${placedExisting.map((p) => `"${p.name}"`).join(', ')}.`
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}
