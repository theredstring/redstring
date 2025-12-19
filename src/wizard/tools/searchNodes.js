/**
 * searchNodes - Find nodes by semantic meaning
 */

export async function searchNodes(args, graphState, cid, ensureSchedulerStarted) {
  const { query } = args;
  if (!query) {
    throw new Error('query is required');
  }

  const { nodePrototypes = [] } = graphState;
  
  // Simple name-based search (can be enhanced with semantic search later)
  const queryLower = query.toLowerCase();
  const results = nodePrototypes
    .filter(proto => {
      const name = (proto.name || '').toLowerCase();
      const desc = (proto.description || '').toLowerCase();
      return name.includes(queryLower) || desc.includes(queryLower);
    })
    .map(proto => ({
      id: proto.id,
      name: proto.name,
      color: proto.color,
      description: proto.description
    }))
    .slice(0, 20); // Limit results

  return { results };
}

