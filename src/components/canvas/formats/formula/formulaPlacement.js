/**
 * Where a formula goes in a web when nobody points: under what the web has,
 * centred on it. For the wizard (formulaWizard.js) and the formula starter
 * (bank/formulaStarter.js), which place what they build without a canvas.
 */
import { getNodeDimensions } from '../../../../utils.js';

// Below what the web has already, this far.
const BELOW = 600;

/** Where the next thing goes: under what the web has (`centre`: a middle; else a top-left corner). */
export function spotBelow(state, graphId, { centre = true } = {}) {
  const graph = state.graphs.get(graphId);
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const inst of graph?.instances?.values() || []) {
    if (!Number.isFinite(inst.x) || !Number.isFinite(inst.y)) continue;
    let w = 200, h = 100;
    try {
      const dims = getNodeDimensions({ name: state.nodePrototypes.get(inst.prototypeId)?.name || '' }, false, null);
      w = dims.currentWidth; h = dims.currentHeight;
    } catch { /* no text measuring here: the estimate stands */ }
    minX = Math.min(minX, inst.x); maxX = Math.max(maxX, inst.x + w); maxY = Math.max(maxY, inst.y + h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0 };
  const x = (minX + maxX) / 2;
  const y = maxY + BELOW;
  return centre ? { x, y } : { x: x - 100, y };
}


/**
 * Where a node goes for its definition, opened in place, to be centred on
 * `at`: an open box's top-left sits on its node (core/openDefinitions.js
 * initialOpenOffset), and a formula's row runs far wider than one Thing.
 */
export function anchorToCentre(state, defGraphId, at) {
  const def = state.graphs.get(defGraphId);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const inst of def?.instances?.values() || []) {
    let w = 200, h = 100;
    try {
      const dims = getNodeDimensions({ name: state.nodePrototypes.get(inst.prototypeId)?.name || '' }, false, null);
      w = dims.currentWidth; h = dims.currentHeight;
    } catch { /* no text measuring here: the estimate stands */ }
    minX = Math.min(minX, inst.x); minY = Math.min(minY, inst.y);
    maxX = Math.max(maxX, inst.x + w); maxY = Math.max(maxY, inst.y + h);
  }
  if (!Number.isFinite(minX)) return { x: at.x - 100, y: at.y - 50 };
  return { x: at.x - (maxX - minX) / 2, y: at.y - (maxY - minY) / 2 };
}
