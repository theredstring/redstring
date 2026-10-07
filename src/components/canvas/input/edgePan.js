/**
 * Edge-pan for pointer gestures that hold something under the cursor: drawing a
 * connection and dragging a marquee. While the gesture is live and the pointer
 * sits near the viewport edge, the view pans toward it, and the gesture's moving
 * end is re-projected so it stays under a pointer that isn't moving.
 *
 * Works for mouse and touch because `mousePositionRef` is updated by the
 * document-level mousemove and by handleMouseMove (which the touch hook calls
 * through window pointermove during a connection draw). Keyboard-safe: it waits
 * out a zoom animation and only reacts to the pointer's distance from the edge,
 * so keyboard pan/zoom still drive the canvas on their own. The node-drag
 * edge-pan in useNodeDrag uses the same margin and speed curve.
 *
 * A pad marquee never pans here: its crosshair is fixed in the middle of the
 * screen, never near an edge.
 */
import useGraphStore from '../../../store/graphStore.js';
import { clientToCanvas } from '../../../utils/canvas/viewportMath.js';
import * as GeometryUtils from '../../../utils/canvas/geometryUtils.js';

const MARGIN = 75;
const MAX_SPEED = 15;

/** Pan speed along one axis: zero outside the margin, easing up to MAX_SPEED at the edge. */
const axisSpeed = (pos, start, size) => {
  if (pos < start + MARGIN) return -MAX_SPEED * Math.pow(Math.min(1, (start + MARGIN - pos) / MARGIN), 1.5);
  if (pos > start + size - MARGIN) return MAX_SPEED * Math.pow(Math.min(1, (pos - (start + size - MARGIN)) / MARGIN), 1.5);
  return 0;
};

/**
 * The shared loop. Each frame it asks `isLive()` and the `settingKey` in
 * mouseSettings, pans, and hands the new pan to `onPanned(clientX, clientY, pan, zoom)`.
 * Returns the cleanup, so an effect can return it directly.
 */
export function runEdgePan(ctx) {
  const {
    isLive, settingKey, onPanned, isAnimatingZoomRef, mousePositionRef, viewportBoundsRef,
    panOffsetRef, zoomLevelRef, canvasSizeRef, viewportSizeRef, setPanOffset,
  } = ctx;
  let animationFrameId;
  const panLoop = () => {
    animationFrameId = requestAnimationFrame(panLoop);
    if (isAnimatingZoomRef.current || !isLive()) return;
    if (useGraphStore.getState().mouseSettings?.[settingKey] === false) return;

    const { x: mouseX, y: mouseY } = mousePositionRef.current;
    const bounds = viewportBoundsRef.current;
    const dx = axisSpeed(mouseX, bounds.x, bounds.width);
    const dy = axisSpeed(mouseY, bounds.y, bounds.height);
    if (dx === 0 && dy === 0) return;

    const currentPan = panOffsetRef.current;
    const currentZoom = zoomLevelRef.current;
    const minX = viewportSizeRef.current.width - canvasSizeRef.current.width * currentZoom;
    const minY = viewportSizeRef.current.height - canvasSizeRef.current.height * currentZoom;
    const newX = Math.min(Math.max(currentPan.x - dx, minX), 0);
    const newY = Math.min(Math.max(currentPan.y - dy, minY), 0);
    if (newX === currentPan.x && newY === currentPan.y) return;

    const newPan = { x: newX, y: newY };
    panOffsetRef.current = newPan;
    setPanOffset(newPan);
    onPanned(mouseX, mouseY, newPan, currentZoom);
  };
  animationFrameId = requestAnimationFrame(panLoop);
  return () => cancelAnimationFrame(animationFrameId);
}

/** While a draw is held near the viewport edge, pan the view and keep the endpoint under the pointer. */
export function runConnectionEdgePan(ctx) {
  const { drawingConnectionFrom, drawingConnectionFromRef, reprojectDrawingConnectionEnd } = ctx;
  if (!drawingConnectionFrom) return undefined;
  return runEdgePan({
    ...ctx,
    isLive: () => !!drawingConnectionFromRef.current,
    settingKey: 'connectionDrawEdgePanEnabled',
    // Without this the endpoint visibly drifts while the pointer is held still at the edge.
    onPanned: reprojectDrawingConnectionEnd,
  });
}

/**
 * While a marquee is held near the viewport edge, pan the view and keep the box's
 * moving corner under the pointer, so a selection can reach past the screen.
 * Waits for the pointer to have actually moved, so a Cmd+click that happens to
 * land near the edge doesn't start the view sliding.
 */
export function runMarqueeEdgePan(ctx) {
  const { selectionStart, selectionStartRef, isMouseDown, mouseMoved, containerRef, updateMarquee } = ctx;
  if (!selectionStart) return undefined;
  return runEdgePan({
    ...ctx,
    isLive: () => !!selectionStartRef.current && isMouseDown.current && mouseMoved.current,
    settingKey: 'marqueeEdgePanEnabled',
    onPanned: (clientX, clientY, pan, zoom) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cs = ctx.canvasSizeRef.current;
      const { x: rawX, y: rawY } = clientToCanvas(clientX, clientY, rect, pan, zoom, cs);
      const { x, y } = GeometryUtils.clampCoordinates(rawX, rawY, cs);
      updateMarquee(x, y);
    },
  });
}
