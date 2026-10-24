import { resolveGraphId } from './resolveGraphId.js';
import { resolveNodeSmart } from './utils/resolveNodeSmart.js';
import { readWeb } from './utils/webView.js';

/**
 * deleteNode - Remove a node and its connections
 *
 * Deletion only ever acts on one exact instance: an instanceId in the web, or
 * the one instance whose name matches exactly (case/spacing aside). A name
 * that matches several instances, or matches only loosely, returns no action
 * and the candidates, so the next call can name the one meant.
 */

const listOf = (c) => (Array.isArray(c)
  ? c
  : c instanceof Map ? Array.from(c.values()) : Object.values(c || {}));

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function instancesOf(graph, protoById) {
  return listOf(graph?.instances).map(inst => ({
    instanceId: inst.id,
    prototypeId: inst.prototypeId,
    name: inst.name || protoById.get(inst.prototypeId)?.name || '',
    description: inst.description || protoById.get(inst.prototypeId)?.description || '',
    x: inst.x,
    y: inst.y
  }));
}

function edgeCountOf(instanceId, edges) {
  let n = 0;
  for (const e of edges) {
    if (e?.sourceId === instanceId || e?.destinationId === instanceId || e?.targetId === instanceId) n++;
  }
  return n;
}

const deleteSpec = (graphId, c) => ({
  action: 'deleteNode',
  graphId,
  instanceId: c.instanceId,
  prototypeId: c.prototypeId || null,
  name: c.name,
  deleted: true
});

/**
 * Delete a node
 * @param {Object} args - { nodeName?, instanceId?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Delete spec for UI application, or candidates with no action
 */
export async function deleteNode(args, graphState) {
  const { nodeName, nodeId, name, instanceId, targetGraphId } = args || {};
  const lookupName = nodeName || name || nodeId;
  if (!lookupName && !instanceId) {
    throw new Error('nodeName is required (or pass instanceId)');
  }

  const { nodePrototypes = [], activeGraphId } = graphState || {};
  const graphs = listOf(graphState?.graphs);
  const edges = listOf(graphState?.edges);
  const protoById = new Map(listOf(nodePrototypes).map(p => [p.id, p]));

  let graphId = targetGraphId ? resolveGraphId(targetGraphId, graphs, { activeGraphId, openGraphIds: graphState?.openGraphIds }) : activeGraphId;
  if (targetGraphId && graphs.length > 0 && !graphs.some(g => g.id === graphId)) {
    const available = graphs.map(g => g.name).filter(Boolean).slice(0, 8).join(', ');
    throw new Error(`No web named or with id "${targetGraphId}". Available webs: ${available || '(none)'}. Omit targetGraphId to use the active web.`);
  }

  // An instanceId names exactly one node. Without a targetGraphId it may live
  // in any web (ids are unique), so its own web is the one to delete it from.
  if (instanceId) {
    let graph = graphs.find(g => g.id === graphId);
    let hit = instancesOf(graph, protoById).find(c => c.instanceId === instanceId);
    if (!hit && !targetGraphId) {
      for (const g of graphs) {
        hit = instancesOf(g, protoById).find(c => c.instanceId === instanceId);
        if (hit) { graph = g; graphId = g.id; break; }
      }
    }
    if (hit) return deleteSpec(graphId, hit);
    if (!lookupName) {
      const where = graphs.find(g => g.id === graphId)?.name || graphId;
      return {
        deleted: false,
        notFound: true,
        instanceId,
        message: `No node with instanceId "${instanceId}" is in ${targetGraphId ? `web "${where}"` : 'any web'}, so nothing was deleted. Get instance ids from search (searchType: 'nodes').`
      };
    }
  }

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // The web's nodes under the names it was shown under (webView.js). A
  // formula's symbol is part of the formula, which the formula tool rewrites.
  const web = readWeb(graphState, graphId);
  const q = norm(lookupName);
  const symbol = web.places.find(p => p.inFormula && (norm(p.name) === q || norm(p.thing) === q));
  const candidates = web.places.filter(p => !p.inFormula);
  const exact = candidates.filter(c => norm(c.name) === q);
  if (exact.length === 0 && symbol) {
    return {
      deleted: false,
      graphId,
      name: lookupName,
      message: `"${symbol.thing}" here is a symbol of the formula "${symbol.inFormula}", not a node of its own. Nothing was deleted. To change the formula, use the formula tool (rewrite or delete).`
    };
  }

  if (exact.length === 1) return deleteSpec(graphId, exact[0]);

  if (exact.length > 1) {
    return {
      deleted: false,
      ambiguous: true,
      graphId,
      name: lookupName,
      candidates: exact.map(c => ({
        instanceId: c.instanceId,
        name: c.name,
        x: c.x,
        y: c.y,
        edgeCount: edgeCountOf(c.instanceId, edges)
      })),
      message: `"${lookupName}" is ${exact.length} nodes in this web. Nothing was deleted. Call deleteNode again with the instanceId of the one to delete.`
    };
  }

  // No exact name. A loose match is only ever a suggestion: deleting "Rate"
  // must never delete "Sampling Rate".
  if (candidates.length > 0) {
    const loose = await resolveNodeSmart(lookupName, candidates, { callSite: 'deleteNode' });
    const near = loose.match ? [loose.match] : (loose.method === 'ambiguous' ? (loose.candidates || []) : []);
    if (near.length > 0) {
      return {
        deleted: false,
        exactMatch: false,
        graphId,
        name: lookupName,
        candidates: near.map(c => ({
          instanceId: c.instanceId,
          name: c.name,
          x: c.x,
          y: c.y,
          edgeCount: edgeCountOf(c.instanceId, edges)
        })),
        message: `No node is named exactly "${lookupName}"; the closest is ${near.map(c => `"${c.name}"`).join(', ')}. Nothing was deleted. Call deleteNode again with the exact name or instanceId.`
      };
    }
  }

  // Not in the state this tool sees. The app may have it (state can lag a
  // step), and it deletes only on an exact name, so hand it over.
  return {
    action: 'deleteNode',
    graphId,
    instanceId: null,
    prototypeId: null,
    name: lookupName,
    deleted: false,
    notFound: true,
    note: `No node named "${lookupName}" is in this workspace, so nothing was deleted. Check the name with readGraph.`
  };
}
