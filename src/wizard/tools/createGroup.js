import { resolveGraphId } from './resolveGraphId.js';
import { suggestGroupName } from './utils/suggestionCalls.js';

/**
 * createGroup - Create a visual group containing specified nodes
 */

/**
 * Find instance IDs by node names in a graph
 */
function findInstanceIdsByNames(names, graphState, graphId) {
  const { graphs = [], nodePrototypes = [] } = graphState;
  if (!graphId) return [];

  const graph = graphs.find(g => g.id === graphId);
  if (!graph || !graph.instances) return [];

  const instances = graph.instances instanceof Map
    ? Array.from(graph.instances.values())
    : Array.isArray(graph.instances)
      ? graph.instances
      : Object.values(graph.instances);

  const protoMap = new Map();
  if (Array.isArray(nodePrototypes)) {
    nodePrototypes.forEach(p => protoMap.set(p.id, p));
  }

  const foundIds = [];
  const nameLower = names.map(n => String(n || '').toLowerCase());

  instances.forEach(inst => {
    const proto = protoMap.get(inst.prototypeId);
    const instName = (proto?.name || inst.name || '').toLowerCase();
    if (nameLower.includes(instName)) {
      foundIds.push(inst.id);
    }
  });

  return foundIds;
}

/**
 * Create a group
 * @param {Object} args - { name, memberNames?, color?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Group spec for UI application
 */
export async function createGroup(args, graphState, cid, ensureSchedulerStarted) {
  const { name = 'Group', memberNames = [], memberInstanceIds = [], color, targetGraphId } = args;

  const { activeGraphId, graphs = [] } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // Resolve member names to instance IDs if available in graphState
  let resolvedMemberIds = [...memberInstanceIds];
  if (memberNames.length > 0) {
    const foundIds = findInstanceIdsByNames(memberNames, graphState, graphId);
    resolvedMemberIds = [...new Set([...resolvedMemberIds, ...foundIds])];
  }

  // C5 — Group auto-naming. When no meaningful name was supplied, suggest a
  // ≤3-word collective name from the members ({Mercury, Venus, Earth} → "Inner
  // Planets"). Pre-fill only; a supplied name always wins. No model → keep 'Group'.
  let finalName = name;
  let nameSuggested = false;
  if ((!name || name === 'Group') && memberNames.length >= 2) {
    try {
      const suggestion = await suggestGroupName({ memberNames });
      if (suggestion && suggestion.name) {
        finalName = suggestion.name;
        nameSuggested = true;
      }
    } catch { /* best-effort */ }
  }

  console.error('[createGroup] Creating group:', finalName, '| members resolved:', resolvedMemberIds.length, '| memberNames:', memberNames);

  return {
    action: 'createGroup',
    graphId,
    name: finalName,
    color: color || '#8B0000',
    memberNames,
    memberInstanceIds: resolvedMemberIds,
    nameSuggested,
    created: true
  };
}
