/**
 * createNode - Create a single node in a graph (defaults to active)
 */

import { resolvePaletteColor } from '../../ai/palettes.js';
import { resolveNodeSmart } from './utils/resolveNodeSmart.js';

/**
 * Create a node
 * @param {Object} args - { name, color?, description?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Node spec for UI application
 */
export async function createNode(args, graphState, cid, ensureSchedulerStarted) {
  const { name, color, description, targetGraphId, palette, typeNodeId, enrich, overwriteDescription } = args;
  if (!name) {
    throw new Error('name is required');
  }

  const { activeGraphId, nodePrototypes = [] } = graphState;
  const graphId = targetGraphId || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  const result = {
    action: 'createNode',
    graphId,
    name,
    color: resolvePaletteColor(palette, color),
    description: description || '',
    typeNodeId: typeNodeId || null,
    enrich: enrich !== false,
    overwriteDescription: overwriteDescription || false
  };

  // C1 — Reconcile before create. Exact name match already dedupes in the store;
  // this additionally catches synonym/abbreviation matches ("NYC" vs "New York
  // City") via the model. Never blocks creation — it attaches an OFFER the agent
  // /user can accept to reuse the existing prototype instead. substringMode:
  // 'none' so we never reuse on a mere substring guess. No model → exact-only.
  try {
    if (Array.isArray(nodePrototypes) && nodePrototypes.length > 0) {
      const res = await resolveNodeSmart(name, nodePrototypes, {
        substringMode: 'none',
        callSite: 'reconcilePrototype'
      });
      if (res.match && res.match.id && (res.method === 'exact' || res.method === 'model')) {
        result.reconcileSuggestion = {
          prototypeId: res.match.id,
          name: res.match.name,
          method: res.method,
          exact: res.exact
        };
      }
    }
  } catch { /* reconcile is best-effort; never disrupt creation */ }

  return result;
}
