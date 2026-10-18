import useGraphStore from '../../../../store/graphStore.js';
import useFormatsStore, { selectStandard } from '../formatsStore.js';
import { computeFormulaObjects } from './formulaObjects.js';

/**
 * The formula objects for the active web. The same object comes back while
 * nothing they draw has changed, so subscribers re-render only for a change
 * of theirs.
 */
export function useFormulaObjects() {
  const standard = useFormatsStore(selectStandard);
  const namesShown = useFormatsStore(s => s.namesShown);
  const flipped = useFormatsStore(s => s.flipped);
  return useGraphStore(s => computeFormulaObjects(s, { standard, namesShown, flipped }));
}
