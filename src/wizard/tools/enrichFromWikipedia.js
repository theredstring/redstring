/**
 * enrichFromWikipedia - Pull Wikipedia data (image, description, links) for a node.
 *
 * This is a client-side async tool: the tool function validates the request and
 * returns an action spec. The actual Wikipedia fetching, image conversion, and
 * store update happen in applyToolResultToStore (browser context).
 */

/**
 * @param {Object} args - { nodeName, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Action spec for client-side enrichment
 */
export async function enrichFromWikipedia(args, graphState) {
  const { nodeName, targetGraphId } = args;

  if (!nodeName) {
    throw new Error('nodeName is required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  const graphId = targetGraphId || activeGraphId;

  // Try to find the node in predictive state
  const queryLower = nodeName.toLowerCase().trim();
  let resolvedProto = null;
  for (const proto of nodePrototypes) {
    if ((proto.name || '').toLowerCase().trim() === queryLower) {
      resolvedProto = proto;
    }
  }

  if (!resolvedProto) {
    // Substring fallback
    for (const proto of nodePrototypes) {
      const name = (proto.name || '').toLowerCase().trim();
      if (name.includes(queryLower) || queryLower.includes(name)) {
        resolvedProto = proto;
      }
    }
  }

  console.error('[enrichFromWikipedia] Resolving:', nodeName, '→', resolvedProto?.id || '(will resolve client-side)');

  return {
    action: 'enrichFromWikipedia',
    nodeName: resolvedProto?.name || nodeName,
    prototypeId: resolvedProto?.id || null,
    graphId
  };
}
