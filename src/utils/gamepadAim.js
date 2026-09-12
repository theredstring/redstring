/**
 * gamepadAim — target resolution and camera drift for the controller crosshair.
 *
 * WHY THIS IS ONE MODULE AND NOT THREE BITS OF useGamepad.
 *
 * "What is under the crosshair" is asked by three different things — the hover
 * preview, the A button, and the drift — and they must never disagree. If the
 * preview shows a connection while A selects the node behind it, or the drift
 * pulls toward something neither of them picked, the whole mode feels broken in
 * a way that is very hard to attribute. So resolution happens ONCE per frame,
 * in one place, and all three read the same answer.
 *
 * WHY THE DRIFT OWNS ITS OWN ANIMATION HANDLE.
 *
 * The camera has several claimants: drag-zoom on node lift, focus-on-select,
 * carousel framing, pan/zoom momentum, and the trackpad glide. Most of them
 * announce themselves through the SHARED `isAnimatingZoomRef`. The drift
 * originally rode on animateCanvasView, which sets that flag — so cancelling a
 * drift cleared a flag that, by then, belonged to the drag-zoom that had just
 * started on lift. The drag read its own flag as false for a frame or two and
 * visibly glitched.
 *
 * The fix is ownership, not more cancellation. The drift keeps its own rAF and
 * touches no shared flag. It never has to be cancelled from outside, because it
 * re-asks permission every frame (`shouldContinue`) and stands down the instant
 * anything else wants the camera. Nothing else has to know it exists.
 *
 * WHY NO ROUTING GEOMETRY LIVES IN HERE.
 *
 * A connection's aim point has to be a point on the line as DRAWN. There are
 * six routing styles and their geometry is centralised in utils/canvas; an
 * approximation here — the chord between the endpoints was the obvious one —
 * is correct only for a plain straight line and is a fiction for every curved
 * or routed style, which is worse than no auto-aim at all, because the camera
 * then confidently walks to a place with nothing drawn on it. So the hit test
 * returns the point it measured to, and this module only moves the camera.
 */

/**
 * Where the reticle sits, in the app-box coordinates `viewportBounds` is
 * measured in.
 *
 * The ABSOLUTE centre of the app box — deliberately NOT the centre of the
 * usable canvas. Panels opening, closing and being resized would otherwise
 * slide the reticle around mid-session, and the reticle IS the cursor: one
 * that wanders because a panel appeared is one you have to go and find again.
 * Pinned to the screen centre it becomes the single thing on screen that never
 * moves, which is what makes "the world moves under the sight" legible.
 *
 * Three things have to agree on this point or the mode quietly breaks: what is
 * drawn (GamepadCrosshair), what is aimed (useGamepad's getCrosshair) and what
 * the zoom is anchored at (the camera loop in useCanvasKeyboard). Hence one
 * function rather than three copies of `/ 2`.
 *
 * @param {object|null} bounds a useViewportBounds result
 * @returns {{x: number, y: number} | null}
 */
export const crosshairCenter = (bounds) => {
  if (!bounds) return null;
  // windowWidth/Height are the padded app box; the width/height fallbacks are
  // for a bounds object measured before the panels reported in.
  const w = bounds.windowWidth ?? bounds.width;
  const h = bounds.windowHeight ?? bounds.height;
  return { x: w / 2, y: h / 2 };
};

/**
 * Closest point to (px, py) on the segment (x1,y1)-(x2,y2).
 * @returns {{x: number, y: number, t: number}} t is the normalised position
 *   along the segment, clamped to [0, 1].
 */
export const nearestPointOnSegment = (px, py, x1, y1, x2, y2) => {
  const cx = x2 - x1;
  const cy = y2 - y1;
  const lenSq = cx * cx + cy * cy;
  if (lenSq === 0) return { x: x1, y: y1, t: 0 };
  let t = ((px - x1) * cx + (py - y1) * cy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: x1 + t * cx, y: y1 + t * cy, t };
};

/**
 * The pan offset that would put canvas point (worldX, worldY) under client
 * point (clientX, clientY) at the current zoom. The inverse of the screen→canvas
 * transform used throughout the canvas, written out once rather than inline.
 */
export const panToPlacePointAt = (worldX, worldY, clientX, clientY, rect, pan, zoom, canvasSize) => ({
  x: (clientX - rect.left) - (worldX - canvasSize.offsetX) * zoom,
  y: (clientY - rect.top) - (worldY - canvasSize.offsetY) * zoom,
});

/**
 * A self-cancelling pan tween.
 *
 * `shouldContinue` is re-asked every frame rather than being checked once at
 * the start — that is what lets the drift yield mid-flight to a node lift or a
 * stick nudge without anyone having to reach in and stop it. See the header.
 *
 * Pan only: nothing here zooms, so it deliberately does not touch any
 * "animating zoom" state.
 *
 * @param {object} opts
 * @param {{current: {x: number, y: number}}} opts.panRef live pan offset
 * @param {(pan: {x: number, y: number}) => void} opts.setPan the canvas pan mutator
 * @param {() => boolean} opts.shouldContinue permission, re-asked per frame
 */
export function createDriftController({ panRef, setPan, shouldContinue }) {
  let rafId = null;
  let from = null;
  let to = null;
  let startedAt = 0;
  let duration = 0;

  const stop = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const step = (now) => {
    rafId = null;
    if (!shouldContinue()) return;

    const progress = duration > 0 ? Math.min(1, (now - startedAt) / duration) : 1;
    // easeOutCubic — the same curve the rest of the canvas's camera moves use,
    // so a drift reads as the same kind of motion as a focus or a framing.
    const eased = 1 - Math.pow(1 - progress, 3);
    setPan({
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
    });

    if (progress < 1) rafId = requestAnimationFrame(step);
  };

  return {
    start(targetPan, durationMs) {
      stop();
      from = { ...panRef.current };
      to = targetPan;
      startedAt = performance.now();
      duration = durationMs;
      rafId = requestAnimationFrame(step);
    },
    stop,
    isActive: () => rafId !== null,
  };
}
