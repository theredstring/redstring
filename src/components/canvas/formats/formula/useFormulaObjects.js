import { useSyncExternalStore } from 'react';
import useGraphStore from '../../../../store/graphStore.js';
import useFormatsStore, { selectStandard } from '../formatsStore.js';
import { computeFormulaObjects, formulaFontsReady } from './formulaObjects.js';

/** Hear when the page's fonts finish loading (EmOne, which formulas are measured in). */
function subscribeFonts(onChange) {
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (!fonts) return () => {};
  fonts.addEventListener?.('loadingdone', onChange);
  fonts.ready?.then(onChange);
  return () => fonts.removeEventListener?.('loadingdone', onChange);
}

/**
 * The formula objects for the active web. The same object comes back while
 * nothing they draw has changed, so subscribers re-render only for a change
 * of theirs, and once more when the font they are measured in has loaded.
 */
export function useFormulaObjects() {
  useSyncExternalStore(subscribeFonts, formulaFontsReady, () => true);
  const standard = useFormatsStore(selectStandard);
  const namesShown = useFormatsStore(s => s.namesShown);
  const flipped = useFormatsStore(s => s.flipped);
  return useGraphStore(s => computeFormulaObjects(s, { standard, namesShown, flipped }));
}
