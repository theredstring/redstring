/**
 * createNode - Create a single node in a graph (defaults to active)
 */

import { resolvePaletteColor } from '../../ai/palettes.js';

/**
 * Create a node
 * @param {Object} args - { name, color?, description?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Node spec for UI application
 */
export async function createNode(args, graphState, cid, ensureSchedulerStarted) {
  const { name, color, description, targetGraphId, palette, typeNodeId } = args;
  if (!name) {
    throw new Error('name is required');
  }

  const { activeGraphId } = graphState;
  const graphId = targetGraphId || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  return {
    action: 'createNode',
    graphId,
    name,
    color: resolvePaletteColor(palette, color),
    description: description || '',
    typeNodeId: typeNodeId || null
  };
}
