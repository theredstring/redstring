/**
 * String similarity calculation using Levenshtein distance.
 * Copied from graphStore.js for use in server-side wizard tools.
 */
/**
 * @param {string} str1
 * @param {string} str2
 * @param {number} [minSimilarity] - Optional. When the two lengths alone make
 *   this score unreachable, return 0 without doing the O(L²) work. Callers
 *   comparing every pair (findDuplicates, mergeGraphs) pass their threshold
 *   here; the returned value is otherwise identical.
 * @returns {number} 0..1
 */
export function calculateStringSimilarity(str1, str2, minSimilarity = 0) {
  if (!str1 || !str2) return 0;

  const s1 = String(str1).toLowerCase().trim();
  const s2 = String(str2).toLowerCase().trim();

  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0 || len2 === 0) return 0;

  const maxLength = Math.max(len1, len2);

  // Edit distance is at least the length difference, so the best possible score
  // is bounded before we compute anything. Cheap reject for the common case of
  // comparing every name against every other name.
  if (minSimilarity > 0) {
    const bestPossible = 1 - Math.abs(len1 - len2) / maxLength;
    if (bestPossible < minSimilarity) return 0;
  }

  // Two rolling rows rather than a full (len1+1)×(len2+1) array-of-arrays: the
  // matrix allocation, not the arithmetic, dominated the cost when this runs
  // O(n²) times over a large universe.
  let prev = new Array(len2 + 1);
  let curr = new Array(len2 + 1);
  for (let j = 0; j <= len2; j++) prev[j] = j;

  for (let i = 1; i <= len1; i++) {
    curr[0] = i;
    const c1 = s1[i - 1];
    for (let j = 1; j <= len2; j++) {
      const cost = c1 === s2[j - 1] ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    const swap = prev; prev = curr; curr = swap;
  }

  const distance = prev[len2];
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
