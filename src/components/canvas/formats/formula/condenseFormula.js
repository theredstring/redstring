/**
 * Combine a formula into its Thing, as a Thing-group's Combine Into Thing does
 * (graphStore.collapseNodeGroupIntoDefinition: its definition saved, one undo
 * step). The node remembers it was a formula, so opening it shows the formula
 * again. What it was drawn as folds into that node (formulaSpawn's exit, aimed
 * at the node), the way a Thing-group's box folds (groups/boxMorph.js).
 */
import useGraphStore from '../../../../store/graphStore.js';
import useFormatsStore, { selectStandard } from '../formatsStore.js';
import { anchorIdFromOpenGroupId, projectGraphView } from '../../../../core/openDefinitions.js';
import { storeNodeRect } from '../../groups/boxMorphConnections.js';
import { computeFormulaObjects } from './formulaObjects.js';
import { markFormulaLeaving } from './formulaSpawn.js';

// Node.jsx insets a node's painted background this far inside its box.
const NODE_BG_INSET = 6;

/** @returns {string|null} The node it became. */
export function condenseFormula(graphId, groupId) {
  const st = useGraphStore.getState();
  const fmt = useFormatsStore.getState();
  const drawn = computeFormulaObjects(st, { standard: selectStandard(fmt), namesShown: fmt.namesShown, flipped: fmt.flipped })
    .objects.find(o => o.groupId === groupId);
  // Kept from before the write, so the drawing never misses a frame; aimed once the node is placed.
  const leaving = markFormulaLeaving(drawn);
  const nodeId = st.collapseNodeGroupIntoDefinition(graphId, groupId) || anchorIdFromOpenGroupId(groupId);
  const rect = nodeId ? storeNodeRect(graphId, nodeId) : null;
  if (leaving && rect) {
    const s = useGraphStore.getState();
    const node = projectGraphView(s, graphId)?.instances?.get(nodeId);
    leaving.into({
      x: rect.x + NODE_BG_INSET, y: rect.y + NODE_BG_INSET,
      w: rect.w - 2 * NODE_BG_INSET, h: rect.h - 2 * NODE_BG_INSET,
      r: Math.max(0, rect.r - NODE_BG_INSET),
      color: s.nodePrototypes.get(node?.prototypeId)?.color || drawn.color,
    });
  }
  return nodeId;
}
