/**
 * mergeGraphs - Find and merge duplicate nodes between two graphs
 * Identifies overlapping nodes across graphs, scores richness, and merges them.
 */
import { calculateStringSimilarity, scoreNodeRichness } from './utils/stringSimilarity.js';

/**
 * Resolve a graph by ID or name
 */
function resolveGraph(idOrName, graphs) {
  if (!idOrName) return null;
  // Try exact ID match
  const byId = graphs.find(g => g.id === idOrName);
  if (byId) return byId;
  // Try name match
  const queryLower = idOrName.toLowerCase().trim();
  for (const g of graphs) {
    if ((g.name || '').toLowerCase().trim() === queryLower) return g;
  }
  // Substring fallback
  for (const g of graphs) {
    const gName = (g.name || '').toLowerCase().trim();
    if (gName.includes(queryLower) || queryLower.includes(gName)) return g;
  }
  return null;
}

/**
 * Get prototypes for all instances in a graph
 */
function getPrototypesInGraph(graph, nodePrototypes) {
  const instances = Array.isArray(graph.instances)
    ? graph.instances
    : Object.values(graph.instances || {});
  const protoIds = new Set(instances.map(i => i.prototypeId));
  return nodePrototypes.filter(p => protoIds.has(p.id));
}

/**
 * @param {Object} args - { sourceGraphId, targetGraphId?, threshold?, dryRun? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Merge pairs or preview
 */
export async function mergeGraphs(args, graphState) {
  const { sourceGraphId, targetGraphId, threshold = 0.85, dryRun = false } = args;

  if (!sourceGraphId) {
    throw new Error('sourceGraphId is required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;

  const sourceGraph = resolveGraph(sourceGraphId, graphs);
  if (!sourceGraph) {
    throw new Error(`Source graph not found: "${sourceGraphId}"`);
  }

  const targetId = targetGraphId || activeGraphId;
  const targetGraph = resolveGraph(targetId, graphs);
  if (!targetGraph) {
    throw new Error(`Target graph not found: "${targetId}"`);
  }

  if (sourceGraph.id === targetGraph.id) {
    throw new Error('Source and target graphs must be different');
  }

  const sourceProtos = getPrototypesInGraph(sourceGraph, nodePrototypes);
  const targetProtos = getPrototypesInGraph(targetGraph, nodePrototypes);

  const pairs = [];
  const usedTargetIds = new Set();

  for (const srcProto of sourceProtos) {
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const tgtProto of targetProtos) {
      if (usedTargetIds.has(tgtProto.id)) continue;
      if (srcProto.id === tgtProto.id) continue; // Same prototype, no merge needed

      const similarity = calculateStringSimilarity(srcProto.name, tgtProto.name);
      if (similarity >= threshold && similarity > bestSimilarity) {
        bestMatch = tgtProto;
        bestSimilarity = similarity;
      }
    }

    if (bestMatch) {
      usedTargetIds.add(bestMatch.id);

      const srcScore = scoreNodeRichness(srcProto, graphs);
      const tgtScore = scoreNodeRichness(bestMatch, graphs);

      // Richer node becomes primary
      const primary = srcScore >= tgtScore
        ? { name: srcProto.name, protoId: srcProto.id, score: srcScore }
        : { name: bestMatch.name, protoId: bestMatch.id, score: tgtScore };
      const secondary = srcScore >= tgtScore
        ? { name: bestMatch.name, protoId: bestMatch.id, score: tgtScore }
        : { name: srcProto.name, protoId: srcProto.id, score: srcScore };

      pairs.push({
        primary,
        secondary,
        similarity: Math.round(bestSimilarity * 100)
      });
    }
  }

  if (dryRun) {
    // Read-only preview — no action field
    return {
      pairs,
      totalPairs: pairs.length,
      sourceGraphId: sourceGraph.id,
      sourceGraphName: sourceGraph.name,
      targetGraphId: targetGraph.id,
      targetGraphName: targetGraph.name,
      threshold,
      dryRun: true
    };
  }

  if (pairs.length === 0) {
    return {
      pairs: [],
      totalPairs: 0,
      sourceGraphId: sourceGraph.id,
      targetGraphId: targetGraph.id,
      message: 'No duplicate nodes found between the two graphs at the given threshold.'
    };
  }

  console.error(`[mergeGraphs] Found ${pairs.length} duplicate pairs to merge between "${sourceGraph.name}" and "${targetGraph.name}"`);

  return {
    action: 'mergeGraphs',
    pairs,
    totalPairs: pairs.length,
    sourceGraphId: sourceGraph.id,
    targetGraphId: targetGraph.id,
    merged: true
  };
}
