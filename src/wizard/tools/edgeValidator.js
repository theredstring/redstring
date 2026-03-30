/**
 * edgeValidator - Validates that edge source/target names reference existing nodes
 *
 * Shared utility used by createPopulatedGraph, expandGraph, and populateDefinitionGraph
 * to catch edges that reference non-existent nodes (common with small local LLMs).
 */

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
