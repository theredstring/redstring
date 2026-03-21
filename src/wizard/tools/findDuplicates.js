/**
 * findDuplicates - Find potential duplicate nodes by name similarity
 * Read-only tool: returns groups with richness scores and recommendations
 */
import { calculateStringSimilarity, scoreNodeRichness } from './utils/stringSimilarity.js';

/**
 * @param {Object} args - { threshold?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Duplicate groups with recommendations
 */
export async function findDuplicates(args, graphState) {
  const { threshold = 0.8, targetGraphId } = args;
  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;

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

  const duplicateGroups = [];

  for (let i = 0; i < prototypesToCheck.length; i++) {
    const current = prototypesToCheck[i];
    // Skip if already included as a duplicate in a previous group
    const alreadyGrouped = duplicateGroups.some(g =>
      g.nodes.some(n => n.protoId === current.id)
    );
    if (alreadyGrouped) continue;

    const group = [{
      name: current.name,
      protoId: current.id,
      score: scoreNodeRichness(current, graphs),
      hasDescription: !!(current.description && current.description.trim()),
      hasSemanticData: !!current.semanticMetadata,
      definitionGraphCount: (current.definitionGraphIds || []).length,
      instanceCount: countInstances(current.id, graphs)
    }];

    let maxSimilarity = 0;

    for (let j = i + 1; j < prototypesToCheck.length; j++) {
      const other = prototypesToCheck[j];
      const alreadyInGroup = duplicateGroups.some(g =>
        g.nodes.some(n => n.protoId === other.id)
      );
      if (alreadyInGroup) continue;

      const similarity = calculateStringSimilarity(current.name, other.name);
      if (similarity >= threshold) {
        maxSimilarity = Math.max(maxSimilarity, similarity);
        group.push({
          name: other.name,
          protoId: other.id,
          score: scoreNodeRichness(other, graphs),
          hasDescription: !!(other.description && other.description.trim()),
          hasSemanticData: !!other.semanticMetadata,
          definitionGraphCount: (other.definitionGraphIds || []).length,
          instanceCount: countInstances(other.id, graphs),
          similarity: Math.round(similarity * 100)
        });
      }
    }

    if (group.length > 1) {
      // Recommend the node with highest richness score
      const sorted = [...group].sort((a, b) => b.score - a.score);
      duplicateGroups.push({
        nodes: group,
        recommendedPrimary: { name: sorted[0].name, protoId: sorted[0].protoId, score: sorted[0].score },
        similarity: maxSimilarity
      });
    }
  }

  // Read-only: no action field
  return {
    duplicateGroups,
    totalGroups: duplicateGroups.length,
    threshold
  };
}

function countInstances(protoId, graphs) {
  let count = 0;
  for (const graph of graphs) {
    const instances = Array.isArray(graph.instances)
      ? graph.instances
      : Object.values(graph.instances || {});
    for (const inst of instances) {
      if (inst.prototypeId === protoId) count++;
    }
  }
  return count;
}
