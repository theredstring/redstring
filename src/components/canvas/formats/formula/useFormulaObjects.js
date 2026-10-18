import useGraphStore from '../../../../store/graphStore.js';
import useFormatsStore, { selectStandard, selectWords } from '../formatsStore.js';
import { computeFormulaObjects } from './formulaObjects.js';

/**
 * The formula objects for the active web. The same object comes back while
 * nothing they draw has changed, so subscribers re-render only for a change
 * of theirs.
 */
export function useFormulaObjects() {
  const standard = useFormatsStore(selectStandard);
  const words = useFormatsStore(selectWords);
  return useGraphStore(s => computeFormulaObjects(s, { standard, words }));
}
