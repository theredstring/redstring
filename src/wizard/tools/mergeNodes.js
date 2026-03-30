import { resolveGraphId } from './resolveGraphId.js';

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

function resolveNodeById(id, nodePrototypes) {
  if (!id) return null;
  const proto = nodePrototypes.find(p => p.id === id);
  if (!proto) return null;
  return { protoId: proto.id, name: proto.name };
}

/**
 * @param {Object} args - { primaryNodeName?, secondaryNodeName?, primaryPrototypeId?, secondaryPrototypeId?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Merge action spec for UI application
 */
export async function mergeNodes(args, graphState) {
  const {
    primaryNodeName, secondaryNodeName,
    primaryPrototypeId, secondaryPrototypeId,
    targetGraphId
  } = args;

  // Validate: at least one identifier per node
  if (!primaryPrototypeId && !primaryNodeName) {
    throw new Error('Either primaryPrototypeId or primaryNodeName is required');
  }
  if (!secondaryPrototypeId && !secondaryNodeName) {
    throw new Error('Either secondaryPrototypeId or secondaryNodeName is required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs) || activeGraphId;

  // Resolve primary: prefer ID, fall back to name
  const resolvedPrimary = primaryPrototypeId
    ? resolveNodeById(primaryPrototypeId, nodePrototypes)
    : resolveNodeByName(primaryNodeName, nodePrototypes, graphs, graphId);

  // Resolve secondary: prefer ID, fall back to name
  const resolvedSecondary = secondaryPrototypeId
    ? resolveNodeById(secondaryPrototypeId, nodePrototypes)
    : resolveNodeByName(secondaryNodeName, nodePrototypes, graphs, graphId);

  if (resolvedPrimary) {
    console.error('[mergeNodes] Resolved primary:', primaryPrototypeId || primaryNodeName, '→', resolvedPrimary.protoId);
  } else {
    console.error('[mergeNodes] Primary not found in graphState, delegating to client:', primaryPrototypeId || primaryNodeName);
  }

  if (resolvedSecondary) {
    console.error('[mergeNodes] Resolved secondary:', secondaryPrototypeId || secondaryNodeName, '→', resolvedSecondary.protoId);
  } else {
    console.error('[mergeNodes] Secondary not found in graphState, delegating to client:', secondaryPrototypeId || secondaryNodeName);
  }

  return {
    action: 'mergeNodes',
    graphId,
    primaryName: resolvedPrimary?.name || primaryNodeName,
    secondaryName: resolvedSecondary?.name || secondaryNodeName,
    primaryProtoId: resolvedPrimary?.protoId || primaryPrototypeId || null,
    secondaryProtoId: resolvedSecondary?.protoId || secondaryPrototypeId || null,
    merged: true
  };
}
