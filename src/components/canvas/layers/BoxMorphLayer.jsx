/**
 * Owns the group the box morphs draw into (groups/boxMorph.js): a Thing opening
 * into its thing group, and folding back. The group renders no React children, so
 * React never touches what is put in it. Rendered last in EdgeLayer, inside the
 * canvas content group: over every thing-group shell and connection, under the
 * nodes, which is where the shell it stands in for is drawn (so a node outside the
 * box still paints over it, as over the real shell).
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
