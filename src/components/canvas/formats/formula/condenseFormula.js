/**
 * Combine a formula into its Thing, as a Thing-group's Combine Into Thing does
 * (graphStore.collapseNodeGroupIntoDefinition: its definition saved, one undo
 * step). The node remembers it was a formula, so opening it shows the formula
 * again. What it was drawn as folds into that node (formulaSpawn's exit, aimed
 * at the node), the way a Thing-group's box folds (groups/boxMorph.js).
 */
import useGraphStore from '../../../../store/graphStore.js';
import useFormatsStore, { selectStandard } from '../formatsStore.js';
import { anchorIdFromOpenGroupId } from '../../../../core/openDefinitions.js';
import { computeFormulaObjects } from './formulaObjects.js';
import { markFormulaLeaving, nodeBackgroundOf, nodeLookOf } from './formulaSpawn.js';
import { storeNodeRect } from '../../groups/boxMorphConnections.js';

// Frames to wait for the node to be drawn after the write.
const MAX_WAIT_FRAMES = 12;

/** @returns {string|null} The node it became. */
export function condenseFormula(graphId, groupId) {
  const st = useGraphStore.getState();
  const fmt = useFormatsStore.getState();
  const drawn = computeFormulaObjects(st, { standard: selectStandard(fmt), namesShown: fmt.namesShown, flipped: fmt.flipped })
    .objects.find(o => o.groupId === groupId);
  // Kept from before the write, so the drawing never misses a frame; aimed once the node is placed.
  const leaving = markFormulaLeaving(drawn);
  // In the same step, the node stands centred where the formula was (a
  // Thing-group's combine puts it where its Things' corners average), so the
  // formula shrinks into it where it stands.
  const nodeId = st.withHistoryTransaction('Collapsed into definition', () => {
    const id = st.collapseNodeGroupIntoDefinition(graphId, groupId) || anchorIdFromOpenGroupId(groupId);
    const rect = id && drawn ? storeNodeRect(graphId, id) : null;
    if (rect) {
      const dx = drawn.center.x - (rect.x + rect.w / 2);
      const dy = drawn.center.y - (rect.y + rect.h / 2);
      if (dx || dy) useGraphStore.getState().updateNodeInstance(graphId, id, (draft) => { draft.x += dx; draft.y += dy; });
    }
    return id;
  });
  const into = nodeId ? nodeBackgroundOf(graphId, nodeId, drawn?.color) : null;
  if (leaving && into) {
    // The node is held hidden until the formula has become it; its title is
    // read once it is drawn, the frame after the write.
    leaving.into(into, { reveal: `svg.canvas g.node[data-instance-id=${JSON.stringify(nodeId)}]` });
    let frames = 0;
    const aim = () => {
      const look = nodeLookOf(graphId, nodeId, drawn?.color);
      if (look?.title) leaving.into(look);
      else if (frames++ < MAX_WAIT_FRAMES) requestAnimationFrame(aim);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(aim);
  }
  return nodeId;
}
