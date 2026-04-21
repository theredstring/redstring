import { resolveGraphId } from './resolveGraphId.js';

/**
 * createEdge - Connect two nodes by name
 */

/**
 * Resolve a node by name from graph state
 */
function resolveNodeByName(name, nodePrototypes, graphs, graphId) {
  const queryLower = (name || '').toLowerCase().trim();
  if (!queryLower) return null;

  const targetGraph = graphs.find(g => g.id === graphId);
  if (!targetGraph) return null;

  const instances = Array.isArray(targetGraph.instances)
    ? targetGraph.instances
    : targetGraph.instances instanceof Map
      ? Array.from(targetGraph.instances.values())
      : Object.values(targetGraph.instances || {});

  // Exact match — take LAST match so newly created instances win over stale duplicates.
  // (Rule from project memory: Maps iterate insertion-order; oldest first. Never break early.)
  let exactMatch = null;
  for (const inst of instances) {
    const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
    const nodeName = (inst.name || proto?.name || '').toLowerCase().trim();
    if (nodeName === queryLower) {
      exactMatch = { instanceId: inst.id, prototypeId: inst.prototypeId, name: inst.name || proto?.name };
    }
  }
  if (exactMatch) return exactMatch;

  // Substring fallback — also LAST match, and warn so silent mis-wires are visible in logs.
  let substringMatch = null;
  for (const inst of instances) {
    const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
    const nodeName = (inst.name || proto?.name || '').toLowerCase().trim();
    if (nodeName && (nodeName.includes(queryLower) || queryLower.includes(nodeName))) {
      substringMatch = { instanceId: inst.id, prototypeId: inst.prototypeId, name: inst.name || proto?.name };
    }
  }
  if (substringMatch) {
    console.warn('[createEdge] Substring fallback matched — may be wrong instance:', { query: name, matched: substringMatch.name });
    return substringMatch;
  }

  // Thing-group names — also LAST match.
  const groups = Array.isArray(targetGraph.groups)
    ? targetGraph.groups
    : targetGraph.groups instanceof Map
      ? Array.from(targetGraph.groups.values())
      : Object.values(targetGraph.groups || {});

  let groupMatch = null;
  for (const group of groups) {
    if (!group.linkedNodePrototypeId || !group.anchorInstanceId) continue;
    const groupName = (group.name || '').toLowerCase().trim();
    if (groupName === queryLower) {
      groupMatch = { instanceId: group.anchorInstanceId, prototypeId: group.linkedNodePrototypeId, name: group.name };
    }
  }
  if (groupMatch) return groupMatch;

  return null;
}

/**
 * Create an edge between two nodes
 * @param {Object} args - { sourceId, targetId, type, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Edge spec for UI application
 */
export async function createEdge(args, graphState, cid, ensureSchedulerStarted) {
  const { sourceId, targetId, type, targetGraphId } = args;
  if (!sourceId || !targetId) {
    throw new Error('sourceId and targetId are required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // Resolve source and target by name
  const resolvedSource = resolveNodeByName(sourceId, nodePrototypes, graphs, graphId);
  const resolvedTarget = resolveNodeByName(targetId, nodePrototypes, graphs, graphId);

  if (resolvedSource) {
    console.error('[createEdge] Resolved source:', sourceId, '→', resolvedSource.instanceId);
  } else {
    console.warn('[createEdge] Source not found in graphState, delegating to client:', sourceId);
  }

  if (resolvedTarget) {
    console.error('[createEdge] Resolved target:', targetId, '→', resolvedTarget.instanceId);
  } else {
    console.warn('[createEdge] Target not found in graphState, delegating to client:', targetId);
  }

  return {
    action: 'createEdge',
    graphId,
    sourceName: resolvedSource?.name || sourceId,
    targetName: resolvedTarget?.name || targetId,
    sourceInstanceId: resolvedSource?.instanceId || null,
    targetInstanceId: resolvedTarget?.instanceId || null,
    type: type || '',
    created: true
  };
}
