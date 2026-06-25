/**
 * deleteEdge - Remove a connection between nodes
 */

import { resolveGraphId } from './resolveGraphId.js';

function resolveNodeByName(name, nodePrototypes, graphs, graphId) {
  const queryLower = (name || '').toLowerCase().trim();
  if (!queryLower) return false;
  const targetGraph = graphs.find(g => g.id === graphId);
  if (!targetGraph) return false;
  const instances = Array.isArray(targetGraph.instances)
    ? targetGraph.instances
    : Object.values(targetGraph.instances || {});
  for (const inst of instances) {
    const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
    const nodeName = (inst.name || proto?.name || '').toLowerCase().trim();
    if (nodeName === queryLower) return true;
  }
  return false;
}

/**
 * Delete an edge
 * @param {Object} args - { edgeId, sourceName?, targetName?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Delete spec for UI application
 */
export async function deleteEdge(args, graphState, cid, ensureSchedulerStarted) {
  const { edgeId, sourceName, targetName, targetGraphId } = args;
  if (!edgeId && !sourceName) {
    throw new Error('edgeId or sourceName/targetName is required');
  }

  const { activeGraphId, graphs = [], nodePrototypes = [] } = graphState;
  // Resolve targetGraphId tolerantly — accept a graph NAME and disambiguate
  // toward the active graph / its parent-graph lineage.
  const resolved = targetGraphId ? resolveGraphId(targetGraphId, graphs, { activeGraphId }) : null;
  const graphId = resolved || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // When node names are provided (the reliable deletion path), validate they exist
  // so the model gets explicit feedback instead of a silent no-op on the client.
  // edgeId-only paths still pass through — the client verifies the ID against the real store.
  if (sourceName && !resolveNodeByName(sourceName, nodePrototypes, graphs, graphId)) {
    const graph = graphs.find(g => g.id === graphId);
    const instances = Array.isArray(graph?.instances) ? graph.instances : Object.values(graph?.instances || {});
    const available = instances
      .map(i => nodePrototypes.find(p => p.id === i.prototypeId)?.name || i.name)
      .filter(Boolean)
      .slice(0, 8)
      .join(', ');
    throw new Error(`Source node "${sourceName}" not found in graph. Available nodes: ${available || '(none)'}. Use readGraph to see all nodes.`);
  }
  if (targetName && !resolveNodeByName(targetName, nodePrototypes, graphs, graphId)) {
    const graph = graphs.find(g => g.id === graphId);
    const instances = Array.isArray(graph?.instances) ? graph.instances : Object.values(graph?.instances || {});
    const available = instances
      .map(i => nodePrototypes.find(p => p.id === i.prototypeId)?.name || i.name)
      .filter(Boolean)
      .slice(0, 8)
      .join(', ');
    throw new Error(`Target node "${targetName}" not found in graph. Available nodes: ${available || '(none)'}. Use readGraph to see all nodes.`);
  }

  return {
    action: 'deleteEdge',
    graphId,
    edgeId: edgeId || null,
    sourceName: sourceName || null,
    targetName: targetName || null,
    deleted: true
  };
}
