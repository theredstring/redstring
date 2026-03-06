import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';

/**
 * Create an empty graph
 * @param {Object} args - { name, description?, color?, palette? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Graph spec for UI application
 */
export async function createGraph(args, graphState, cid, ensureSchedulerStarted) {
  const { name, description = '', color, palette } = args;
  if (!name) {
    throw new Error('name is required');
  }

  const graphId = `graph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const activePalette = palette || getRandomPalette();

  return {
    action: 'createGraph',
    graphId,
    graphName: name,
    description,
    color: resolvePaletteColor(activePalette, color),
    goalId: null
  };
}

