/**
 * How far the bottom control panel's top edge is from the bottom of the screen,
 * for whatever sits on top of it. Every kind of control panel is the same
 * component, so it reports for itself. While two overlap (one leaving, one
 * arriving) the taller wins.
 */

import { useLayoutEffect } from 'react';
import { create } from 'zustand';

const useBottomPanelTops = create(() => ({ tops: new Map() }));

const writeTop = (panel, top) => useBottomPanelTops.setState((state) => {
  const tops = new Map(state.tops);
  if (top === null) tops.delete(panel);
  else tops.set(panel, top);
  return { tops };
});

/** The panel's top edge in px from the screen's bottom, or null with none showing. */
export const useBottomPanelTop = () => useBottomPanelTops((state) => (
  state.tops.size ? Math.max(...state.tops.values()) : null
));

/**
 * Reports a panel's top edge, as it mounts and whenever it changes size. It's
 * worked out from layout, not the screen position, so the panel's own entrance
 * and exit animations don't move what rides on it. `bottomChangedBy` is what can
 * move the panel's bottom edge without resizing it.
 */
export function usePublishBottomPanelTop(ref, bottomChangedBy) {
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return undefined;
    const measure = () => writeTop(panel, (parseFloat(getComputedStyle(panel).bottom) || 0) + panel.offsetHeight);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(panel);
    return () => {
      observer?.disconnect();
      writeTop(panel, null);
    };
  }, [ref, bottomChangedBy]);
}
