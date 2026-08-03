/**
 * Pointer-anchored zoom math.
 *
 * Pure arithmetic — a few multiplications — deliberately kept out of
 * canvasWorker.js. It once lived there and callers `await`ed the round-trip,
 * which cost a frame of latency per wheel event to compute microseconds of
 * work, and forced callers to reconcile a stale pre-await snapshot against live
 * state on the way back. Both the worker and the main thread now call this
 * directly so there is one formula and no round-trip.
 */

const ZOOM_SENSITIVITY_SCALE = 0.005;

/**
 * @param {object} p
 * @param {number} p.deltaY      normalized wheel delta (negative = zoom in)
 * @param {number} p.currentZoom
 * @param {{x:number,y:number}} p.mousePos  pointer, container-relative — the fixed point
 * @param {{x:number,y:number}} p.panOffset
 * @param {{width:number,height:number}} p.viewportSize
 * @param {{width:number,height:number}} p.canvasSize
 * @param {number} p.MIN_ZOOM
 * @param {number} p.MAX_ZOOM
 * @returns {{zoomLevel:number, panOffset:{x:number,y:number}}}
 */
export function calculateZoom({
  deltaY,
  currentZoom,
  mousePos,
  panOffset,
  viewportSize,
  canvasSize,
  MIN_ZOOM,
  MAX_ZOOM
}) {
  const zoomFactor = deltaY !== 0 ? Math.pow(2, -deltaY * ZOOM_SENSITIVITY_SCALE) : 1;
  if (zoomFactor === 1) return { zoomLevel: currentZoom, panOffset };

  const newZoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom * zoomFactor));

  // Factor actually realised after clamping — anchoring must use this, not the
  // requested factor, or the pointer drifts once zoom is pinned at a limit.
  const actualZoomFactor = newZoomLevel / currentZoom;

  // Hold the point under the cursor still while the scale changes.
  const newPanOffsetX = panOffset.x + (mousePos.x - panOffset.x) * (1 - actualZoomFactor);
  const newPanOffsetY = panOffset.y + (mousePos.y - panOffset.y) * (1 - actualZoomFactor);

  const minPanOffsetX = viewportSize.width - canvasSize.width * newZoomLevel;
  const minPanOffsetY = viewportSize.height - canvasSize.height * newZoomLevel;

  return {
    zoomLevel: newZoomLevel,
    panOffset: {
      x: Math.min(Math.max(newPanOffsetX, minPanOffsetX), 0),
      y: Math.min(Math.max(newPanOffsetY, minPanOffsetY), 0)
    }
  };
}
