/**
 * findDuplicates - Find potential duplicate nodes by name similarity
 * Read-only tool: returns groups with richness scores and recommendations
 *
 * Cost notes (this runs synchronously inside the single-threaded wizard server,
 * so anything slow here blocks SSE, health checks, and cancel handling):
 *  - Instance counts are indexed ONCE up front. Previously scoreNodeRichness and
 *    countInstances each rescanned every instance of every graph for every
 *    prototype — O(n·I), which reached ~18s on a 3k-prototype universe when the
 *    instances arrived object-shaped and Object.values reallocated per call.
 *  - Group membership is a Set, not a linear scan of already-built groups.
 *  - The pair loop passes `threshold` into the similarity function so unequal
 *    lengths reject before the O(L²) edit distance runs.
 *  - Output is capped: the full result used to be re-uploaded to the model on
 *    every subsequent iteration (measured >500KB / ~128k tokens on a large
 *    universe), which is what made the whole turn look like it had hung.
 */
import { calculateStringSimilarity } from './utils/stringSimilarity.js';

const MAX_GROUPS = 25;
const MAX_NODES_PER_GROUP = 12;

/**
 * @param {Object} args - { threshold?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Duplicate groups with recommendations
 */
export async function findDuplicates(args, graphState) {
  const { threshold = 0.8, targetGraphId } = args;
  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;

  // One pass over every instance in every graph — the only full scan we do.
  const instanceCountByProto = new Map();
  for (const graph of graphs) {
    const instances = Array.isArray(graph.instances)
      ? graph.instances
      : Object.values(graph.instances || {});
    for (const inst of instances) {
      if (!inst?.prototypeId) continue;
      instanceCountByProto.set(inst.prototypeId, (instanceCountByProto.get(inst.prototypeId) || 0) + 1);
    }
  }

  // If targetGraphId provided, filter to prototypes that have instances in that graph
  let prototypesToCheck = nodePrototypes;
  if (targetGraphId) {
    const graphId = targetGraphId || activeGraphId;
    const targetGraph = graphs.find(g => g.id === graphId || g.name === targetGraphId);
    if (targetGraph) {
      const instances = Array.isArray(targetGraph.instances)
        ? targetGraph.instances
        : Object.values(targetGraph.instances || {});
      const protoIdsInGraph = new Set(instances.map(i => i.prototypeId));
      prototypesToCheck = nodePrototypes.filter(p => protoIdsInGraph.has(p.id));
    }
  }

  // Same weighting as scoreNodeRichness, but reading the precomputed count.
  const richness = (proto) => {
    let score = 0;
    if (proto.description && proto.description.trim()) score += 1;
    if (proto.description && proto.description.length > 100) score += 1;
    if (proto.semanticMetadata) score += 2;
    score += (proto.definitionGraphIds || []).length;
    score += instanceCountByProto.get(proto.id) || 0;
    return score;
  };

  const describe = (proto, extra = {}) => ({
    name: proto.name,
    protoId: proto.id,
    score: richness(proto),
    hasDescription: !!(proto.description && proto.description.trim()),
    hasSemanticData: !!proto.semanticMetadata,
    definitionGraphCount: (proto.definitionGraphIds || []).length,
    instanceCount: instanceCountByProto.get(proto.id) || 0,
    ...extra
  });

  const duplicateGroups = [];
  const grouped = new Set();
  let truncatedGroups = 0;
  let truncatedMembers = 0;

  for (let i = 0; i < prototypesToCheck.length; i++) {
    const current = prototypesToCheck[i];
    if (grouped.has(current.id)) continue;

    const group = [describe(current)];
    const groupIds = [current.id];
    let maxSimilarity = 0;
    let matchesBeyondCap = 0;

    for (let j = i + 1; j < prototypesToCheck.length; j++) {
      const other = prototypesToCheck[j];
      if (grouped.has(other.id)) continue;

      const similarity = calculateStringSimilarity(current.name, other.name, threshold);
      if (similarity >= threshold) {
        maxSimilarity = Math.max(maxSimilarity, similarity);
        // Keep claiming members even past the cap, so a huge near-identical
        // cluster doesn't get re-reported as dozens of overlapping groups.
        groupIds.push(other.id);
        if (group.length < MAX_NODES_PER_GROUP) {
          group.push(describe(other, { similarity: Math.round(similarity * 100) }));
        } else {
          matchesBeyondCap++;
        }
      }
    }

    if (group.length > 1) {
      if (duplicateGroups.length >= MAX_GROUPS) {
        truncatedGroups++;
        continue;
      }
      for (const id of groupIds) grouped.add(id);
      if (matchesBeyondCap > 0) truncatedMembers += matchesBeyondCap;

      // Recommend the node with highest richness score
      const sorted = [...group].sort((a, b) => b.score - a.score);
      duplicateGroups.push({
        nodes: group,
        recommendedPrimary: { name: sorted[0].name, protoId: sorted[0].protoId, score: sorted[0].score },
        similarity: maxSimilarity,
        ...(matchesBeyondCap > 0 ? { additionalMatches: matchesBeyondCap } : {})
      });
    }
  }

  const notes = [];
  if (truncatedGroups > 0) {
    notes.push(`Only the first ${MAX_GROUPS} duplicate groups are shown (${truncatedGroups} more found). Raise "threshold" to narrow, or pass "targetGraphId" to scope the scan to one web.`);
  }
  if (truncatedMembers > 0) {
    notes.push(`Some groups had more than ${MAX_NODES_PER_GROUP} members; ${truncatedMembers} additional matches are counted in "additionalMatches" but not listed. A group this large usually means the threshold is too low for templated names (e.g. "Concept 12" vs "Concept 13" scores 0.86).`);
  }

  // Read-only: no action field
  return {
    duplicateGroups,
    totalGroups: duplicateGroups.length + truncatedGroups,
    prototypesScanned: prototypesToCheck.length,
    threshold,
    ...(notes.length > 0 ? { truncated: true, truncationNote: notes.join(' ') } : {})
  };
}
