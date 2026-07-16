import { resolveGraphId } from './resolveGraphId.js';
import { resolveNodeSmart } from './utils/resolveNodeSmart.js';

/**
 * deleteNode - Remove a node and its connections
 */

/**
 * Resolve a node by name from graph state via the shared smart resolver.
 * Returns the full resolution result so the caller can distinguish an exact
 * match from a fuzzy/model-resolved one (deletion is destructive).
 */
async function resolveNodeByName(name, nodePrototypes, graphs, graphId) {
  const targetGraph = graphs.find(g => g.id === graphId);
  if (!targetGraph) return { match: null, method: 'empty', exact: false };

  const instances = Array.isArray(targetGraph.instances)
    ? targetGraph.instances
    : targetGraph.instances instanceof Map
      ? Array.from(targetGraph.instances.values())
      : Object.values(targetGraph.instances || {});

  const candidates = instances.map(inst => {
    const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
    return {
      instanceId: inst.id,
      prototypeId: inst.prototypeId,
      name: inst.name || proto?.name || '',
      description: inst.description || proto?.description || ''
    };
  });

  return resolveNodeSmart(name, candidates, { callSite: 'deleteNode' });
}

/**
 * Delete a node
 * @param {Object} args - { nodeName, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Delete spec for UI application
 */
export async function deleteNode(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeName, nodeId, name, targetGraphId } = args;
  const lookupName = nodeName || nodeId || name;
  if (!lookupName) {
    throw new Error('nodeName is required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  const resolution = await resolveNodeByName(lookupName, nodePrototypes, graphs, graphId);
  const resolved = resolution.match;

  if (resolved) {
    console.error('[deleteNode] Resolved:', lookupName, '→', resolved.instanceId, `(${resolution.method})`);
  } else {
    // Node not in server-side graphState — still return action so client can resolve by name
    console.warn('[deleteNode] Not found in graphState, delegating to client:', lookupName);
  }

  const result = {
    action: 'deleteNode',
    graphId,
    instanceId: resolved?.instanceId || null,
    prototypeId: resolved?.prototypeId || null,
    name: resolved?.name || lookupName,
    deleted: true
  };

  // Destructive op: never delete on a fuzzy/model-resolved guess silently.
  // Surface exactly what was resolved so the agent/user can confirm before it lands.
  if (resolved && !resolution.exact) {
    result.exactMatch = false;
    result.requiresConfirmation = true;
    result.resolvedVia = resolution.method; // 'model' | 'substring'
    result.warning =
      `"${lookupName}" was not an exact match — it was resolved to "${resolved.name}" ` +
      `via ${resolution.method}. Confirm this is the node you meant to delete before proceeding.`;
  }

  return result;
}
