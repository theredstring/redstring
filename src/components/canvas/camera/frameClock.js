/**
 * A clock for short rAF animations (the drag-zoom, its drop settle, camera
 * framing) that counts painted frames' time rather than wall time.
 *
 * Wall time is what a busy main thread takes away. On a big universe a lift or
 * a drop is followed by React commits of 100-300 ms; a 250 ms animation timed
 * by the wall clock spends its whole length inside those stalls and reaches the
 * screen as one jump. Here a STALLED frame advances the clock by at most
 * MAX_STEP_MS, so a stall pauses the animation instead of skipping it, and on a
 * heavy web it takes longer in wall time rather than disappearing.
 *
 * A stall is a frame far longer than the frames around it, not any frame
 * longer than MAX_STEP_MS. A device whose every frame takes 50-70 ms (an
 * Android phone on a moderate web) is not stalling, it is slow; capping each of
 * its frames at MAX_STEP_MS put every animation in slow motion there: a 320 ms
 * framing move always took about ten frames, so at 67 ms a frame it took 850 ms
 * (measured at 10x CPU throttle, select a Thing on the stress web). So the cap
 * follows the device's steady frame time: the shortest of the last few frames,
 * plus half again. On a 60 or 120 Hz device that is still MAX_STEP_MS; on a
 * slow one a steady frame counts in full and only a frame well past the steady
 * rate is held back. The steady rate is read only once STEADY_WINDOW frames
 * have been seen, so the run of commits that can follow the very start of an
 * animation (the drop on a big web) is still capped, frame by frame.
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
/** How many recent frames the steady frame time is read from. */
const STEADY_WINDOW = 3;
/** How far past the steady frame time a frame may run and still count in full. */
const STALL_RATIO = 1.5;

/** Returns `tick(now)`: call once per frame with rAF's timestamp; returns elapsed ms. */
export function createFrameClock() {
  let elapsed = 0;
  let last = null;
  const recent = [];
  return (now) => {
    if (last === null) {
      elapsed += FIRST_STEP_MS;
      last = now;
      return elapsed;
    }
    const dt = Math.max(0, now - last);
    last = now;
    const steady = recent.length === STEADY_WINDOW ? Math.min(...recent) : 0;
    elapsed += Math.min(dt, Math.max(MAX_STEP_MS, steady * STALL_RATIO));
    recent.push(dt);
    if (recent.length > STEADY_WINDOW) recent.shift();
    return elapsed;
  };
}
