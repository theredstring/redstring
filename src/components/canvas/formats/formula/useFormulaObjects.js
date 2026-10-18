import useGraphStore from '../../../../store/graphStore.js';
import { computeFormulaObjects } from './formulaObjects.js';

/**
 * The formula objects for the active web. The same object comes back while
 * nothing they draw has changed, so subscribers re-render only for a change
 * of theirs.
 */
export function useFormulaObjects() {
  return useGraphStore(computeFormulaObjects);
}
