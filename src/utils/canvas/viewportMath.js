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
