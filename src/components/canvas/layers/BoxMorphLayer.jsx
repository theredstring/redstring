/**
 * Owns the group the box morphs draw into (groups/boxMorph.js): a Thing opening
 * into its thing group, and folding back. The group renders no React children, so
 * React never touches what is put in it. Rendered with DeletionGhostLayer, inside
 * the canvas content group above the group titles.
 */
import { memo, useLayoutEffect, useSyncExternalStore } from 'react';
import { setBoxMorphHost, flushBoxMorphs, subscribeBoxMorphs, boxMorphVersion } from '../groups/boxMorph.js';

function BoxMorphLayer() {
  // Re-render when a morph is queued, so the effect below runs in the commit that
  // brings its far shape into the DOM, before that commit paints.
  const version = useSyncExternalStore(subscribeBoxMorphs, boxMorphVersion, boxMorphVersion);
  useLayoutEffect(() => { flushBoxMorphs(); }, [version]);
  return <g ref={setBoxMorphHost} data-box-morphs style={{ pointerEvents: 'none' }} />;
}

export default memo(BoxMorphLayer);
