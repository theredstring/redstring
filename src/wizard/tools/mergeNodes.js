/**
 * mergeNodes - Merge two node prototypes into one
 * The primary survives; the secondary is absorbed and deleted.
 */

function resolveNodeByName(name, nodePrototypes, graphs, graphId) {
  const queryLower = (name || '').toLowerCase().trim();
  if (!queryLower) return null;

  // Search all prototypes (not scoped to a graph — merge is prototype-level)
  for (const proto of nodePrototypes) {
    const protoName = (proto.name || '').toLowerCase().trim();
    if (protoName === queryLower) {
      return { protoId: proto.id, name: proto.name };
    }
  }

  // Substring fallback
  for (const proto of nodePrototypes) {
    const protoName = (proto.name || '').toLowerCase().trim();
    if (protoName.includes(queryLower) || queryLower.includes(protoName)) {
      return { protoId: proto.id, name: proto.name };
    }
  }

  return null;
}

/**
 * @param {Object} args - { primaryNodeName, secondaryNodeName, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Merge action spec for UI application
 */
export async function mergeNodes(args, graphState) {
  const { primaryNodeName, secondaryNodeName, targetGraphId } = args;

  if (!primaryNodeName) {
    throw new Error('primaryNodeName is required');
  }
  if (!secondaryNodeName) {
    throw new Error('secondaryNodeName is required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  const graphId = targetGraphId || activeGraphId;

  const resolvedPrimary = resolveNodeByName(primaryNodeName, nodePrototypes, graphs, graphId);
  const resolvedSecondary = resolveNodeByName(secondaryNodeName, nodePrototypes, graphs, graphId);

  if (resolvedPrimary) {
    console.error('[mergeNodes] Resolved primary:', primaryNodeName, '→', resolvedPrimary.protoId);
  } else {
    console.error('[mergeNodes] Primary not found in graphState, delegating to client:', primaryNodeName);
  }

  if (resolvedSecondary) {
    console.error('[mergeNodes] Resolved secondary:', secondaryNodeName, '→', resolvedSecondary.protoId);
  } else {
    console.error('[mergeNodes] Secondary not found in graphState, delegating to client:', secondaryNodeName);
  }

  return {
    action: 'mergeNodes',
    graphId,
    primaryName: resolvedPrimary?.name || primaryNodeName,
    secondaryName: resolvedSecondary?.name || secondaryNodeName,
    primaryProtoId: resolvedPrimary?.protoId || null,
    secondaryProtoId: resolvedSecondary?.protoId || null,
    merged: true
  };
}
