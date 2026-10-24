/**
 * setNodeSize - Change the visual size of an existing node instance.
 *
 * The wizard-side equivalent of the pie menu's "Size" button: writes the same
 * discrete `instance.sizeMul` steps (XS/S/M/L/XL). Size is per-INSTANCE, not
 * per-prototype — the same Thing can be large in one Web and medium in another.
 */

import { resolveGraphId } from './resolveGraphId.js';
import { readWeb, resolvePlace } from './utils/webView.js';
import { resolveNodeSize, NODE_SIZE_NAMES, DEFAULT_NODE_SIZE_NAME } from './utils/nodeSize.js';

/** A node of the web by id or by the name the web was shown under (webView.js). */
async function resolveNodeByName(name, graphState, graphId) {
  const web = readWeb(graphState, graphId);
  if (!web.graph) return null;
  const { match } = await resolvePlace(web, name, 'setNodeSize');
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

  const { graphs = [], activeGraphId } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  const resolved = await resolveNodeByName(lookupName, graphState, graphId);

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
