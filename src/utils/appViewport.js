/**
 * The app's usable viewport — the box the UI actually lays out in.
 *
 * With `viewport-fit=cover`, `window.innerHeight` becomes the FULL screen,
 * including the areas behind the Dynamic Island / notch and the home indicator.
 * The app deliberately does not lay out there: <body> carries the safe-area
 * insets as padding so those bands show the page background (the header colour)
 * instead of app content.
 *
 * That makes `window.innerHeight` the wrong number for anything positioning UI —
 * the canvas coordinate system in particular, which places the canvas at
 * HEADER_HEIGHT from the top of the app box and sizes it by the remaining
 * height. Measuring #root gives the padded box, so those calculations keep
 * meaning what they meant before cover was enabled.
 *
 * Falls back to the window on any platform without insets, where the two are
 * identical anyway (env(safe-area-inset-*) resolves to 0).
 */
export function getAppViewportSize() {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  try {
    const root = document.getElementById('root');
    if (root) {
      const width = root.clientWidth;
      const height = root.clientHeight;
      // A hidden or not-yet-laid-out root measures 0; the window is the better
      // answer then, and the next resize will correct it.
      if (width > 0 && height > 0) return { width, height };
    }
  } catch {
    // Fall through to the window.
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

export default getAppViewportSize;
