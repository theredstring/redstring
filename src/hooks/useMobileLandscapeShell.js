import { useEffect, useState } from 'react';
import { isCapacitor } from '../utils/capacitorAdapter.js';

/**
 * "Fullscreen shell" mode: a phone-sized Capacitor build held in landscape.
 *
 * Landscape on a phone leaves so little vertical room that the header bar and
 * the TypeList footer together eat a third of the screen, so in this one mode
 * the app drops both and hands the whole box to the canvas. The panels stay
 * (they're the only navigation left) and slide over the canvas from the edges,
 * starting at y=0 rather than below a header that no longer exists.
 *
 * The safe-area treatment changes with it — see the `.rs-fullscreen-landscape`
 * rule in App.css. Every inset is released, notch side included, so the canvas
 * runs to the physical edges on all four sides.
 *
 * Deliberately narrow: Capacitor only (a desktop browser resized to a landscape
 * strip should keep its chrome), and phones only. An iPad's short side is 744pt
 * (mini) or more, so the threshold below keeps tablets — which have plenty of
 * height in landscape — on the normal layout.
 */
export const MOBILE_SHELL_SHORT_SIDE_MAX = 600;

export const isMobileLandscapeShell = () => {
  if (typeof window === 'undefined') return false;
  try {
    if (!isCapacitor()) return false;
    // Raw window dims, not getAppViewportSize(): this decides what the safe-area
    // padding should be, so it must not be measured through that padding.
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!(w > h)) return false;
    return Math.min(w, h) <= MOBILE_SHELL_SHORT_SIDE_MAX;
  } catch {
    return false;
  }
};

export const SHELL_BODY_CLASS = 'rs-fullscreen-landscape';

/**
 * Keep <body>'s safe-area padding in step with the mode — see the
 * `.rs-fullscreen-landscape` rule in App.css.
 *
 * This deliberately runs from a module-level listener rather than a React
 * effect. The padding changes the size of #root, and #root is what
 * getAppViewportSize() measures, so every consumer that re-measures on `resize`
 * (useViewportBounds, NodeCanvas's viewportSize) must see the NEW padding.
 * React effects run child-first, so a toggle inside App's effect would land
 * after those consumers had already measured the old box and would leave the
 * canvas short by the inset until the next resize. A listener registered at
 * import time — before any component mounts — runs ahead of all of them.
 */
const syncShellClass = () => {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.classList.toggle(SHELL_BODY_CLASS, isMobileLandscapeShell());
};

if (typeof window !== 'undefined') {
  syncShellClass();
  window.addEventListener('resize', syncShellClass);
  window.addEventListener('orientationchange', syncShellClass);
}

/**
 * Reactive form of isMobileLandscapeShell(). Every consumer calls this directly
 * rather than receiving it as a prop — the value is derived from the window, so
 * threading it through the tree would only add a way for the copies to disagree.
 */
export const useMobileLandscapeShell = () => {
  const [active, setActive] = useState(isMobileLandscapeShell);

  useEffect(() => {
    let frameId = null;
    const update = () => {
      syncShellClass();
      setActive(isMobileLandscapeShell());
      // iOS fires orientationchange before innerWidth/innerHeight have swapped,
      // so re-read once the rotation has actually committed.
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        syncShellClass();
        setActive(isMobileLandscapeShell());
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return active;
};

export default useMobileLandscapeShell;
