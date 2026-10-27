import { resolveGraphId } from './resolveGraphId.js';
import { sanitizeColor } from '../../utils/safeColor.js';
import { readWeb, resolvePlace } from './utils/webView.js';

// Every tool field is sent as required (see LLMClient makeAllRequired), so
// models fill the ones they aren't changing with "". A blank string is "not
// given", never "set to empty": treating it as an edit blanked descriptions
// the model only meant to leave alone.
const given = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/**
 * updateNode - Update an existing node's properties
 */

/** A node of the web by id or by the name the web was shown under (webView.js). */
async function resolveNodeByName(name, graphState, graphId) {
  const web = readWeb(graphState, graphId);
  if (!web.graph) return null;
  const { match } = await resolvePlace(web, name, 'updateNode');
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

  const { graphs = [], activeGraphId } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  const resolved = await resolveNodeByName(lookupName, graphState, graphId);

  if (resolved) {
    console.error('[updateNode] Resolved:', lookupName, '→', resolved.prototypeId);
  } else {
    // Node not in server-side graphState — still return action so client can resolve by name
    console.warn('[updateNode] Not found in graphState, delegating to client:', lookupName);
  }

  const updates = {};
  if (given(name)) updates.name = name;
  // Only a plain colour: it lands in inline styles. Anything else is ignored.
  if (given(color) && sanitizeColor(color) !== null) updates.color = sanitizeColor(color);
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
