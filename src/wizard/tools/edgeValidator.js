/**
 * edgeValidator - Validates that edge source/target names reference existing nodes
 *
 * Shared utility used by createPopulatedGraph, expandGraph, and populateDefinitionGraph
 * to catch edges that reference non-existent nodes (common with small local LLMs).
 */

import { resolveNodeSmart } from './utils/resolveNodeSmart.js';

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

/**
 * Smart edge validation: instead of silently dropping every edge whose endpoint
 * isn't an EXACT name match, first try to resolve each unmatched endpoint to a
 * known node (exact → model → substring). Only genuinely unresolvable endpoints
 * cause a drop, and any endpoint that was remapped is reported (never silent).
 *
 * With no model configured this degrades to substring/exact resolution, so it
 * still drops true non-existent references (same net effect as validateEdges)
 * while recovering near-miss casing/whitespace/synonym references.
 *
 * @returns {Promise<{ validEdges: Array, droppedEdges: Array, remappedEndpoints: Array }>}
 */
export async function validateEdgesSmart(nodeSpecs, edges, existingNodeNames = []) {
  if (!edges || edges.length === 0) {
    return { validEdges: [], droppedEdges: [], remappedEndpoints: [] };
  }

  // Canonical candidate names (preserve original casing for rewriting).
  const canonicalByLower = new Map();
  const addName = (name) => {
    if (!name) return;
    const lower = String(name).toLowerCase().trim();
    if (lower && !canonicalByLower.has(lower)) canonicalByLower.set(lower, String(name));
  };
  for (const spec of nodeSpecs) addName(spec.name);
  for (const name of existingNodeNames) addName(name);

  const candidates = Array.from(canonicalByLower.values()).map((name) => ({ name }));
  const knownLower = new Set(canonicalByLower.keys());

  // Resolve each distinct unknown name at most once.
  const resolutionCache = new Map();
  async function resolveEndpoint(rawName) {
    const lower = String(rawName || '').toLowerCase().trim();
    if (!lower) return { canonical: null, remapped: false };
    if (knownLower.has(lower)) return { canonical: canonicalByLower.get(lower), remapped: false };
    if (resolutionCache.has(lower)) return resolutionCache.get(lower);

    const { match } = await resolveNodeSmart(rawName, candidates, { callSite: 'edgeValidator' });
    const res = match
      ? { canonical: match.name, remapped: true }
      : { canonical: null, remapped: false };
    resolutionCache.set(lower, res);
    return res;
  }

  const validEdges = [];
  const droppedEdges = [];
  const remappedEndpoints = [];

  for (const edge of edges) {
    const s = await resolveEndpoint(edge.source);
    const t = await resolveEndpoint(edge.target);

    if (s.canonical && t.canonical) {
      const rewritten = { ...edge, source: s.canonical, target: t.canonical };
      if (s.remapped) remappedEndpoints.push({ from: edge.source, to: s.canonical });
      if (t.remapped) remappedEndpoints.push({ from: edge.target, to: t.canonical });
      validEdges.push(rewritten);
    } else {
      const reasons = [];
      if (!s.canonical) reasons.push(`source "${edge.source}" could not be resolved to any node`);
      if (!t.canonical) reasons.push(`target "${edge.target}" could not be resolved to any node`);
      droppedEdges.push({ source: edge.source, target: edge.target, reason: reasons.join('; ') });
    }
  }

  if (remappedEndpoints.length > 0) {
    console.error(`[edgeValidator] Remapped ${remappedEndpoints.length} near-miss endpoint(s):`);
    for (const r of remappedEndpoints) console.error(`[edgeValidator]   "${r.from}" → "${r.to}"`);
  }
  if (droppedEdges.length > 0) {
    console.error(`[edgeValidator] Dropped ${droppedEdges.length} unresolvable edge(s):`);
    for (const d of droppedEdges) console.error(`[edgeValidator]   ${d.source} → ${d.target}: ${d.reason}`);
  }

  return { validEdges, droppedEdges, remappedEndpoints };
}
