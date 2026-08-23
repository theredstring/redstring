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

/**
 * Map a point in canvas coordinates to client (viewport) coordinates — the
 * space `position: fixed` overlays live in.
 *
 * Deliberately NOT `getScreenCTM()`. That call maps into the *screen* space the
 * UA happens to be using, and the two spaces are only the same when the page
 * origin and the client origin coincide. Under Capacitor they don't: the
 * WKWebView is laid out full-screen (viewport-fit=cover) and the status-bar band
 * is applied as a content inset, so `getScreenCTM()` comes back offset from
 * `getBoundingClientRect()` by roughly safe-area-inset-top — which is exactly
 * how far a fixed overlay anchored off it lands below the node it belongs to.
 * Mobile browsers hide the difference: their inset-top is 0 in portrait, so the
 * bug only shows in the native shell.
 *
 * `getCTM()` maps the element's user space into its own SVG viewport (pan/zoom
 * included, nothing platform-dependent), and the SVG's client rect supplies the
 * one viewport→client offset. Both halves are client-space, so the result lines
 * up with `position: fixed` on every platform.
 *
 * @param {SVGSVGElement} svgEl        the <svg> the group lives in
 * @param {SVGGraphicsElement} group   the pan/zoom content <g>
 * @param {number} x                   canvas-space x
 * @param {number} y                   canvas-space y
 * @returns {{x: number, y: number} | null} client coords, or null if unmappable
 */
export function canvasPointToClient(svgEl, group, x, y) {
  if (!svgEl || !group || typeof group.getCTM !== 'function') return null;
  try {
    const ctm = group.getCTM();
    if (!ctm) return null;
    const rect = svgEl.getBoundingClientRect();
    // getCTM() already lands in the SVG's viewport coordinate system (CSS px —
    // the canvas SVG carries no viewBox), so the rect offset is all that's left.
    return {
      x: rect.left + (ctm.a * x + ctm.c * y + ctm.e),
      y: rect.top + (ctm.b * x + ctm.d * y + ctm.f)
    };
  } catch {
    return null;
  }
}

export default getAppViewportSize;
