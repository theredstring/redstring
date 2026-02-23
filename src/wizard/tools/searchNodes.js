/**
 * searchNodes - Find nodes by general search query
 * 
 * Supports natural language queries by splitting into words and
 * matching against node names, descriptions, and colors.
 * Returns results ranked by relevance (number of matching words).
 */

export async function searchNodes(args, graphState, cid, ensureSchedulerStarted) {
  const { query } = args;

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;

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
  const totalNodeCount = allNodes.length;
  const limit = typeof args.limit === 'number' ? args.limit : 100;
  const offset = typeof args.offset === 'number' ? args.offset : 0;

  if (!query || query.trim() === '') {
    const page = allNodes.slice(offset, offset + limit);
    const hasMore = offset + limit < totalNodeCount;
    return {
      results: page,
      total: totalNodeCount,
      returned: page.length,
      offset,
      hasMore,
      message: hasMore
        ? `Showing nodes ${offset + 1}–${offset + page.length} of ${totalNodeCount}. Use offset=${offset + limit} to see more.`
        : `Showing all ${page.length} node(s) in the graph.`
    };
  }

  if (allNodes.length === 0) {
    return { results: [], total: 0, message: 'No nodes found in the current graph.' };
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

  const totalMatched = scored.filter(n => n.score > 0).length;
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
      return { results: fuzzyResults, total: fuzzyResults.length, message: `Found ${fuzzyResults.length} similar node(s) (fuzzy match). Total nodes in graph: ${totalNodeCount}.` };
    }

    return { results: [], total: 0, message: `No nodes matched "${query}". The active graph has ${totalNodeCount} node(s) total. Try omitting query to browse all nodes.` };
  }

  const hasMore = totalMatched > results.length;
  return {
    results,
    total: totalNodeCount,
    matched: totalMatched,
    returned: results.length,
    hasMore,
    message: hasMore
      ? `Showing top ${results.length} of ${totalMatched} matching node(s) for "${query}". Graph has ${totalNodeCount} nodes total.`
      : `Found ${results.length} node(s) matching "${query}". Graph has ${totalNodeCount} nodes total.`
  };
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
