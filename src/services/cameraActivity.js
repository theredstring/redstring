/**
 * When the canvas camera last moved: pan or zoom, from any input (pointer,
 * wheel, trackpad, touch, keyboard, controller, an animated move).
 * useCanvasTransform's applyTransform, the one place every camera move writes
 * through, marks it. SaveCoordinator reads it to hold a due save until the
 * camera has been still for a moment, so a save never lands mid-pan.
 */

let lastMoveAt = 0;

/** The camera moved this frame. */
export function markCameraMoved() {
  lastMoveAt = Date.now();
}

/** Milliseconds since the camera last moved (Infinity if it never has). */
export function msSinceCameraMoved() {
  return lastMoveAt === 0 ? Infinity : Date.now() - lastMoveAt;
}

/** Tests only. */
export function __resetCameraActivity() {
  lastMoveAt = 0;
}
