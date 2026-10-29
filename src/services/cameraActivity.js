/**
 * When the canvas camera last moved: pan or zoom, from any input (pointer,
 * wheel, trackpad, touch, keyboard, controller, an animated move).
 * useCanvasTransform's applyTransform, the one place every camera move writes
 * through, marks it. SaveCoordinator reads it to hold a due save until the
 * camera has been still for a moment, so a save never lands mid-pan.
 *
 * Also when the universe was last changed (SaveCoordinator marks every store
 * change but a camera move). Together they say how long the person has been
 * idle: saves and Git commits wait for a stretch of that (msSinceActive).
 */

let lastMoveAt = 0;
let lastEditAt = 0;

/** The camera moved this frame. */
export function markCameraMoved() {
  lastMoveAt = Date.now();
}

/**
 * Milliseconds since `at` (Infinity if never). A clock set back reads as long
 * ago: as "just now", a save waiting on it would wait until the clock caught up.
 */
const since = (at) => {
  if (at === 0) return Infinity;
  const ms = Date.now() - at;
  return ms < 0 ? Infinity : ms;
};

/** Milliseconds since the camera last moved (Infinity if it never has). */
export function msSinceCameraMoved() {
  return since(lastMoveAt);
}

/** The universe changed: an edit, a drag frame, a web switch. */
export function markEdited() {
  lastEditAt = Date.now();
}

/** Milliseconds since the camera moved or the universe changed, whichever was later. */
export function msSinceActive() {
  return Math.min(since(lastMoveAt), since(lastEditAt));
}

/** Tests only. */
export function __resetCameraActivity() {
  lastMoveAt = 0;
  lastEditAt = 0;
}
