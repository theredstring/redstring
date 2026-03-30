/**
 * String similarity calculation using Levenshtein distance.
 * Copied from graphStore.jsx for use in server-side wizard tools.
 */
export function calculateStringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const s1 = String(str1).toLowerCase().trim();
  const s2 = String(str2).toLowerCase().trim();

  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0 || len2 === 0) return 0;

  const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLength = Math.max(len1, len2);
  return 1 - (distance / maxLength);
}

/**
 * Score a node prototype's "richness" for merge priority.
 * Higher score = more data = should be kept as primary.
 */
export function scoreNodeRichness(proto, graphs) {
  let score = 0;
  if (proto.description && proto.description.trim()) { score += 1; }
  if (proto.description && proto.description.length > 100) { score += 1; }
  if (proto.semanticMetadata) { score += 2; }
  score += (proto.definitionGraphIds || []).length;
  for (const graph of graphs) {
    const instances = Array.isArray(graph.instances)
      ? graph.instances
      : Object.values(graph.instances || {});
    for (const inst of instances) {
      if (inst.prototypeId === proto.id) { score += 1; }
    }
  }
  return score;
}
