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
 * The client-space point that a `position: fixed` left/top of (0, 0) actually
 * lands on inside this app.
 *
 * Normally that is the viewport origin and this whole question is moot. Not
 * here: `#root` carries an identity transform (App.css), deliberately, so the
 * fixed panels measure from the app box instead of from behind the Dynamic
 * Island — and a transform makes an element the containing block for its fixed
 * descendants. Under viewport-fit=cover <body> pads by the safe-area insets, so
 * #root starts one inset in from the physical edges, and every fixed descendant
 * measures from there.
 *
 * That is what an overlay wants when it positions itself in app terms
 * (`left: 0`, `bottom: 0`). It is exactly wrong for one positioned from a
 * MEASUREMENT — getBoundingClientRect(), a touch's clientX/Y, an SVG client
 * rect — because those are client-space, and handing them to a fixed element's
 * left/top lands it one inset further down and to the right than the thing it
 * is anchored to. Subtract this from such coordinates first.
 *
 * Zero on any display without insets (every env() resolves to 0, so #root sits
 * at the origin), which is why the desktop path never showed the drift.
 */
export function getFixedOverlayOrigin() {
  if (typeof document === 'undefined') return { x: 0, y: 0 };
  try {
    const root = document.getElementById('root');
    if (root) {
      // The containing block is the transformed ancestor's PADDING box; #root
      // carries no padding or border (App.css), so its client rect is it.
      const rect = root.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    }
  } catch {
    // Fall through to the viewport origin.
  }
  return { x: 0, y: 0 };
}

/**
 * Map a point in canvas coordinates to client (viewport) coordinates — the
 * space `position: fixed` overlays live in.
 *
 * DEPRECATED for the NodeCanvas pan/zoom transform, and currently unused.
 * `getCTM()` forces a layout read and reflects only what has been committed to
 * the content group, which callers on a per-frame path had to work around.
 * Prefer the container rect plus the live pan/zoom refs — the exact inverse of
 * the client→canvas math the input handlers use, with no layout read of the
 * transformed subtree at all:
 *
 *   clientX = containerRect.left + x * zoom + (pan.x - canvasSize.offsetX * zoom)
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
