import { resolveGraphId } from './resolveGraphId.js';
import { resolveNodeSmart } from './utils/resolveNodeSmart.js';

// Every tool field is sent as required (see LLMClient makeAllRequired), so
// models fill the ones they aren't changing with "". A blank string is "not
// given", never "set to empty": treating it as an edit blanked descriptions
// the model only meant to leave alone.
const given = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/**
 * updateNode - Update an existing node's properties
 */

/**
 * Resolve a node by name from graph state via the shared smart resolver.
 */
async function resolveNodeByName(name, nodePrototypes, graphs, graphId) {
  const targetGraph = graphs.find(g => g.id === graphId);
  if (!targetGraph) return null;

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

  const { match } = await resolveNodeSmart(name, candidates, { callSite: 'updateNode' });
  return match;
}

/**
 * Update a node
 * @param {Object} args - { nodeName, name?, color?, description?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Update spec for UI application
 */
export async function updateNode(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeName, nodeId, name, color, description, targetGraphId, typeNodeId } = args;
  const lookupName = nodeName || nodeId;
  if (!lookupName) {
    throw new Error('nodeName is required');
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  const resolved = await resolveNodeByName(lookupName, nodePrototypes, graphs, graphId);

  if (resolved) {
    console.error('[updateNode] Resolved:', lookupName, '→', resolved.prototypeId);
  } else {
    // Node not in server-side graphState — still return action so client can resolve by name
    console.warn('[updateNode] Not found in graphState, delegating to client:', lookupName);
  }

  const updates = {};
  if (given(name)) updates.name = name;
  if (given(color)) updates.color = color;
  if (given(description)) updates.description = description;
  if (given(typeNodeId)) updates.typeNodeId = typeNodeId;

  return {
    action: 'updateNode',
    graphId,
    prototypeId: resolved?.prototypeId || null,
    instanceId: resolved?.instanceId || null,
    originalName: resolved?.name || lookupName,
    updates,
    // Not in this workspace: the action still goes out, since the app resolves
    // by name against the live store (a type-only node is not in the snapshot),
    // but the result must not claim an edit that most likely did not happen.
    updated: !!resolved,
    ...(resolved ? {} : {
      notFound: true,
      note: `No node named "${lookupName}" is in this workspace, so nothing was updated. Check the name with readGraph.`
    })
  };
}
