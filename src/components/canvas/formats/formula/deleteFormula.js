/**
 * Delete a formula from its web: the equation's group, its Things, its parts
 * and every connection touching them, as one undo step
 * (graphStore.deleteGroupAndContents). What it was drawn as is kept to play
 * its exit (formulaSpawn.markFormulaLeaving): the entrance backwards.
 */
import useGraphStore from '../../../../store/graphStore.js';
import useFormatsStore, { selectStandard } from '../formatsStore.js';
import { computeFormulaObjects } from './formulaObjects.js';
import { markFormulaLeaving } from './formulaSpawn.js';

export function deleteFormula(graphId, groupId) {
  const st = useGraphStore.getState();
  if (!st.graphs.get(graphId)?.groups?.has(groupId)) return false;
  const fmt = useFormatsStore.getState();
  const drawn = computeFormulaObjects(st, { standard: selectStandard(fmt), namesShown: fmt.namesShown, flipped: fmt.flipped })
    .objects.find(o => o.groupId === groupId);
  markFormulaLeaving(drawn);
  st.deleteGroupAndContents(graphId, groupId);
  return true;
}
