/**
 * setNodeSize - Change the visual size of an existing node instance.
 *
 * The wizard-side equivalent of the pie menu's "Size" button: writes the same
 * discrete `instance.sizeMul` steps (XS/S/M/L/XL). Size is per-INSTANCE, not
 * per-prototype — the same Thing can be large in one Web and medium in another.
 */

import { resolveGraphId } from './resolveGraphId.js';
import { resolveNodeSmart } from './utils/resolveNodeSmart.js';
import { resolveNodeSize, NODE_SIZE_NAMES, DEFAULT_NODE_SIZE_NAME } from './utils/nodeSize.js';

/**
 * Resolve a node by name from graph state via the shared smart resolver.
 * Mirrors the pattern in updateNode.js.
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

  const { match } = await resolveNodeSmart(name, candidates, { callSite: 'setNodeSize' });
  return match;
}

/**
 * Set a node's size.
 * @param {Object} args - { nodeName, size, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Size spec for UI application
 */
export async function setNodeSize(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeName, nodeId, name, size, targetGraphId } = args;
  const lookupName = nodeName || nodeId || name;
  if (!lookupName) {
    throw new Error('nodeName is required');
  }

  const resolvedSize = resolveNodeSize(size);
  if (!resolvedSize) {
    throw new Error(
      `Unknown size "${size}". Use one of: ${NODE_SIZE_NAMES.map(s => `"${s}"`).join(', ')}. ` +
      `Default is "${DEFAULT_NODE_SIZE_NAME}".`
    );
  }

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  const resolved = await resolveNodeByName(lookupName, nodePrototypes, graphs, graphId);

  if (!resolved) {
    // Not in the server-side graphState — still return the action so the client
    // can resolve by name against the real store (predictive IDs never match).
    console.error('[setNodeSize] Not found in graphState, delegating to client:', lookupName);
  }

  return {
    action: 'setNodeSize',
    graphId,
    instanceId: resolved?.instanceId || null,
    prototypeId: resolved?.prototypeId || null,
    nodeName: resolved?.name || lookupName,
    size: resolvedSize.name,
    sizeMul: resolvedSize.multiplier,
    updated: true
  };
}
