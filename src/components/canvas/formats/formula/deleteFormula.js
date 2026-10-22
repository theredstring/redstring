/**
 * Delete a formula from its web: the equation's group, its Things, its parts
 * and every connection touching them, as one undo step
 * (graphStore.deleteGroupAndContents). A formula shown open in place is the
 * view of one placed Thing (`open:<anchorId>`), so deleting it deletes that
 * node, as deleteNodeGroup does. What it was drawn as is kept to play its
 * exit (formulaSpawn.markFormulaLeaving): the entrance backwards.
 */
import useGraphStore from '../../../../store/graphStore.js';
import { anchorIdFromOpenGroupId, projectGraphView } from '../../../../core/openDefinitions.js';
import useFormatsStore, { selectStandard } from '../formatsStore.js';
import { computeFormulaObjects } from './formulaObjects.js';
import { markFormulaLeaving } from './formulaSpawn.js';

export function deleteFormula(graphId, groupId) {
  const st = useGraphStore.getState();
  const openAnchorId = anchorIdFromOpenGroupId(groupId);
  const exists = openAnchorId
    ? projectGraphView(st, graphId)?.groups?.has(groupId)
    : st.graphs.get(graphId)?.groups?.has(groupId);
  if (!exists) return false;
  const fmt = useFormatsStore.getState();
  const drawn = computeFormulaObjects(st, { standard: selectStandard(fmt), namesShown: fmt.namesShown, flipped: fmt.flipped })
    .objects.find(o => o.groupId === groupId);
  markFormulaLeaving(drawn);
  if (openAnchorId) st.removeNodeInstance(graphId, openAnchorId);
  else st.deleteGroupAndContents(graphId, groupId);
  return true;
}
