/**
 * Camera maths shared by the canvas (P4.01).
 */

/**
 * Clamp a pan offset so the canvas covers the viewport at `zoom`: each axis
 * between (viewport - canvas * zoom) and 0. The inline copies of this formula
 * across NodeCanvas collapse into it.
 * @param {{ x: number, y: number }} pan
 * @param {number} zoom
 * @param {{ width: number, height: number }} viewportSize
 * @param {{ width: number, height: number }} canvasSize
 * @returns {{ x: number, y: number }}
 */
export function clampPan(pan, zoom, viewportSize, canvasSize) {
  const minX = viewportSize.width - canvasSize.width * zoom;
  const minY = viewportSize.height - canvasSize.height * zoom;
  return {
    x: Math.min(Math.max(pan.x, minX), 0),
    y: Math.min(Math.max(pan.y, minY), 0),
  };
}

/**
 * Client (viewport) coordinates to canvas coordinates: the inverse of the
 * canvas transform, `translate(pan) scale(zoom)` on a canvas whose origin sits
 * at `canvas.offsetX/Y`. Replaces the inline copies in NodeCanvas; the
 * arithmetic is theirs, in the same order, so results are bit-identical. A
 * missing canvas counts as offset 0.
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ left: number, top: number }} rect  the canvas container's client rect
 * @param {{ x: number, y: number }} pan
 * @param {number} zoom
 * @param {{ offsetX: number, offsetY: number }} [canvas]
 * @returns {{ x: number, y: number }}
 */
export function clientToCanvas(clientX, clientY, rect, pan, zoom, canvas) {
  return {
    x: (clientX - rect.left - pan.x) / zoom + (canvas?.offsetX || 0),
    y: (clientY - rect.top - pan.y) / zoom + (canvas?.offsetY || 0),
  };
}
