/**
 * searchNodes - Find nodes by general search query
 * 
 * Supports natural language queries by splitting into words and
 * matching against node names, descriptions, and colors.
 * Returns results ranked by relevance (number of matching words).
 */

export async function searchNodes(args, graphState, cid, ensureSchedulerStarted) {
  const { query } = args;
  if (!query) {
    throw new Error('query is required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId, edges = [] } = graphState;

  // Build a combined node list from prototypes + active graph instances
  // This ensures we find nodes even if prototypes list is incomplete
  const nodeMap = new Map(); // id -> { id, name, color, description }

  // Add prototypes
  for (const proto of nodePrototypes) {
    if (proto.id) {
      nodeMap.set(proto.id, {
        id: proto.id,
        name: proto.name || '',
        color: proto.color || '',
        description: proto.description || ''
      });
    }
  }

  // Add instances from active graph (may have names not in prototypes)
  const activeGraph = graphs.find(g => g.id === activeGraphId);
  if (activeGraph) {
    const instances = Array.isArray(activeGraph.instances)
      ? activeGraph.instances
      : activeGraph.instances instanceof Map
        ? Array.from(activeGraph.instances.values())
        : Object.values(activeGraph.instances || {});

    for (const inst of instances) {
      // Use instance name, fall back to prototype data
      const protoData = nodeMap.get(inst.prototypeId) || {};
      const name = inst.name || protoData.name || '';
      const desc = inst.description || protoData.description || '';
      const color = inst.color || protoData.color || '';

      // Store by instance ID (preferred for operations) and prototype ID
      if (inst.id) {
        nodeMap.set(inst.id, {
          id: inst.id,
          prototypeId: inst.prototypeId,
          name,
          color,
          description: desc
        });
      }
    }
  }

  const allNodes = Array.from(nodeMap.values());

  if (allNodes.length === 0) {
    return { results: [], message: 'No nodes found in the current graph.' };
  }

  // Split query into individual words for flexible matching
  const queryLower = query.toLowerCase();
  const queryWords = queryLower
    .split(/\s+/)
    .filter(w => w.length > 1); // ignore single-char words

  // Score each node by relevance
  const scored = allNodes.map(node => {
    const name = (node.name || '').toLowerCase();
    const desc = (node.description || '').toLowerCase();
    const combined = `${name} ${desc}`;
    let score = 0;

    // Exact full-query substring match (highest priority)
    if (name.includes(queryLower)) score += 10;
    if (desc.includes(queryLower)) score += 5;

    // Individual word matches
    for (const word of queryWords) {
      if (name.includes(word)) score += 3;
      if (desc.includes(word)) score += 1;
    }

    // Partial word matches (e.g., "neuron" matches "neurons")
    for (const word of queryWords) {
      if (word.length >= 3) {
        const stem = word.slice(0, -1); // simple stemming: remove last char
        if (name.includes(stem) && !name.includes(word)) score += 2;
        if (desc.includes(stem) && !desc.includes(word)) score += 0.5;
      }
    }

    return { ...node, score };
  });

  // Filter to nodes with any match, sort by score descending
  const results = scored
    .filter(n => n.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ score, ...node }) => node); // remove score from output

  if (results.length === 0) {
    // If no word matches, try character-level fuzzy match as last resort
    const fuzzyResults = allNodes
      .map(node => {
        const name = (node.name || '').toLowerCase();
        const similarity = jaccardSimilarity(queryLower, name);
        return { ...node, similarity };
      })
      .filter(n => n.similarity > 0.2)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10)
      .map(({ similarity, ...node }) => node);

    if (fuzzyResults.length > 0) {
      return { results: fuzzyResults, message: `Found ${fuzzyResults.length} similar node(s) (fuzzy match).` };
    }

    return { results: [], message: `No nodes matched "${query}". The active graph has ${allNodes.length} node(s).` };
  }

  return { results, message: `Found ${results.length} node(s) matching "${query}".` };
}

/**
 * Simple Jaccard similarity between two strings (character bigram based)
 */
function jaccardSimilarity(a, b) {
  if (!a || !b) return 0;
  const bigramsA = new Set();
  const bigramsB = new Set();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  return intersection / (bigramsA.size + bigramsB.size - intersection);
}
