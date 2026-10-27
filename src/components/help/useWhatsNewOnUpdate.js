import { useEffect } from 'react';
import useGraphStore from '../../store/graphStore.js';
import useCanvasUIStore from '../../store/canvasUIStore.js';
import { getEffectiveVersion, markWhatsNewSeen, shouldShowWhatsNewOnLaunch } from './whatsNewVersion.js';

/** Time for the canvas to draw the universe before Help opens over it. */
const SETTLE_MS = 900;

/**
 * The first launch after an update opens Help, which opens on What's New. It
 * waits for a universe (or the universe list) to load, so it never covers
 * onboarding or the load itself. The version counts as seen once Help opens,
 * so a launch closed before then asks again next time.
 */
export default function useWhatsNewOnUpdate() {
  useEffect(() => {
    const version = getEffectiveVersion();
    if (!shouldShowWhatsNewOnLaunch(version)) {
      markWhatsNewSeen(version);
      return undefined;
    }

    let timer = null;
    let unsubscribe = null;
    const open = () => {
      timer = setTimeout(() => {
        markWhatsNewSeen(version);
        useCanvasUIStore.getState().setShowHelpModal(true);
      }, SETTLE_MS);
    };

    if (useGraphStore.getState().isUniverseLoaded) {
      open();
    } else {
      unsubscribe = useGraphStore.subscribe((s) => {
        if (!s.isUniverseLoaded || timer) return;
        unsubscribe();
        unsubscribe = null;
        open();
      });
    }
    return () => {
      unsubscribe?.();
      clearTimeout(timer);
    };
  }, []);
}
