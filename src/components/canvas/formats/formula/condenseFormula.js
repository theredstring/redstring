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
import { markFormulaLeaving, nodeBackgroundOf } from './formulaSpawn.js';
import { storeNodeRect } from '../../groups/boxMorphConnections.js';

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
  // The node comes in under the formula as it fades off it.
  if (leaving && into) leaving.into(into, { reveal: `svg.canvas g.node[data-instance-id=${JSON.stringify(nodeId)}]` });
  return nodeId;
}
