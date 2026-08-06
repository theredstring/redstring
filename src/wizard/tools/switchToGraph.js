/**
 * switchToGraph - Change the active graph (explicit navigation)
 *
 * Use this ONLY when the user explicitly requests navigation
 * (e.g., "show me", "go into", "navigate to", "open").
 *
 * For editing definition graphs without disrupting the user's view,
 * use addDefinitionGraph + targetGraphId pattern instead.
 */

import { resolveGraphId } from './resolveGraphId.js';

/**
 * Switch to a specific graph
 * @param {Object} args - { graphId?, graphName?, nodeName? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Action spec
 */
export async function switchToGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { graphId, graphName, nodeName } = args;

  const { graphs = [], nodePrototypes = [], activeGraphId } = graphState;

  const exists = (id) => graphs.some(g => g.id === id);

  // Each identifier is TRIED IN TURN and the first one that actually resolves
  // wins. Previously graphId was taken unconditionally and the other two
  // branches were skipped, so a stale or invented id made the whole call throw
  // even when a valid graphName/nodeName was supplied alongside it — and the
  // model supplies all three routinely, because the context lists webs by NAME
  // only (real ids reach it solely through a readGraph result).
  const attempts = [];
  let targetGraphId = null;

  if (graphId) {
    if (exists(graphId)) {
      targetGraphId = graphId;
    } else {
      // Names are accepted here too — models pass one into graphId often enough.
      const resolved = resolveGraphId(graphId, graphs, { activeGraphId });
      if (resolved && exists(resolved)) {
        targetGraphId = resolved;
        console.error('[switchToGraph] graphId', graphId, 'resolved by name →', resolved);
      } else {
        attempts.push(`graphId "${graphId}" does not match any web`);
      }
    }
  }

  // nodeName → that node's first definition graph
  if (!targetGraphId && nodeName) {
    const nameLower = String(nodeName).toLowerCase().trim();
    const prototype = nodePrototypes.find(p =>
      String(p.name || '').toLowerCase().trim() === nameLower
    ) || nodePrototypes.find(p =>
      String(p.name || '').toLowerCase().trim().includes(nameLower)
    );

    if (!prototype) {
      attempts.push(`node "${nodeName}" not found`);
    } else {
      const defGraphIds = Array.isArray(prototype.definitionGraphIds) ? prototype.definitionGraphIds : [];
      if (defGraphIds.length === 0) {
        attempts.push(`node "${nodeName}" has no definition web (use buildComposition or populateDefinitionGraph to give it one)`);
      } else if (!exists(defGraphIds[0])) {
        attempts.push(`node "${nodeName}" points at a definition web that no longer exists`);
      } else {
        targetGraphId = defGraphIds[0];
        console.error('[switchToGraph] Resolved nodeName', nodeName, '→ first definition graph:', targetGraphId);
      }
    }
  }

  // graphName → shared resolver (handles same-name disambiguation)
  if (!targetGraphId && graphName) {
    const resolved = resolveGraphId(graphName, graphs, { activeGraphId });
    if (resolved && exists(resolved)) {
      targetGraphId = resolved;
      console.error('[switchToGraph] Resolved graphName', graphName, '→', targetGraphId);
    } else {
      attempts.push(`graph "${graphName}" not found`);
    }
  }

  if (!targetGraphId) {
    const available = graphs.slice(0, 8).map(g => `"${g.name}"`).join(', ') || '(none)';
    throw new Error(
      attempts.length > 0
        ? `Could not navigate: ${attempts.join('; ')}. Available webs: ${available}.`
        : `Either graphId, graphName, or nodeName is required. Available webs: ${available}.`
    );
  }

  const targetGraph = graphs.find(g => g.id === targetGraphId);
  const alreadyActive = targetGraphId === activeGraphId;

  console.error('[switchToGraph] Switching to graph:', targetGraphId, `(${targetGraph.name})`, alreadyActive ? '[already active]' : '');

  return {
    action: 'switchToGraph',
    graphId: targetGraphId,
    graphName: targetGraph.name,
    // Without this the result is byte-identical whether navigation happened or
    // was a no-op, and the rebuilt context is identical too — so the model has
    // no evidence it worked and calls again. Mirrors populateDefinitionGraph's
    // alreadyPopulated warning.
    alreadyActive,
    alreadyActiveWarning: alreadyActive
      ? `Already viewing "${targetGraph.name}" — no navigation was needed. Do NOT call switchToGraph for this web again; continue with the task.`
      : null
  };
}
