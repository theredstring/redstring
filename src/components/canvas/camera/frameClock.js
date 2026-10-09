/**
 * A clock for short rAF animations (the drag-zoom, its drop settle, camera
 * framing) that counts painted frames' time rather than wall time.
 *
 * Wall time is what a busy main thread takes away. On a big universe a lift or
 * a drop is followed by React commits of 100-300 ms; a 250 ms animation timed
 * by the wall clock spends its whole length inside those stalls and reaches the
 * screen as one jump. Here each frame advances the clock by at most
 * MAX_STEP_MS, so a stall pauses the animation instead of skipping it: every
 * animation paints at least duration / MAX_STEP_MS frames, and on a heavy web
 * it takes longer in wall time rather than disappearing.
 *
 * The clock also starts at the first frame drawn, not when the animation was
 * asked for. rAF hands a step the time its frame BEGAN, which is earlier than a
 * performance.now() taken in the long task that asked; that negative elapsed
 * through an ease-out curve threw the camera backwards for a frame (the drop's
 * first frame painted a 500 MB universe at zoom -0.29). The first frame is
 * counted as one frame's time, so it already moves.
 */
export const FIRST_STEP_MS = 1000 / 60;
export const MAX_STEP_MS = 1000 / 30;

/** Returns `tick(now)`: call once per frame with rAF's timestamp; returns elapsed ms. */
export function createFrameClock() {
  let elapsed = 0;
  let last = null;
  return (now) => {
    elapsed += last === null
      ? FIRST_STEP_MS
      : Math.min(Math.max(0, now - last), MAX_STEP_MS);
    last = now;
    return elapsed;
  };
}
