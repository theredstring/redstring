import useGraphStore from '../../../../store/graphStore.js';
import useFormatsStore from '../formatsStore.js';
import { computeFormulaObjects } from './formulaObjects.js';

/**
 * The formula objects for the active web. The same object comes back while
 * nothing they draw has changed, so subscribers re-render only for a change
 * of theirs.
 */
export function useFormulaObjects() {
  const raised = useFormatsStore(s => s.raisedExponents);
  return useGraphStore(s => computeFormulaObjects(s, { raised }));
}
