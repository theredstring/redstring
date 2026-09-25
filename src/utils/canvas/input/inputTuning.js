/**
 * Input tuning: platform detection and the touch, pan-momentum, zoom-momentum
 * and trackpad constants, plus the trackpad zoom velocity sampler (P4.01;
 * moved verbatim from NodeCanvas.jsx). Values are unchanged; reconciling the
 * touch constants waits on Q5 (F-44).
 */

// Platform detection (guarded for SSR)
export const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0;
export const isMac = /Mac/i.test(userAgent);
export const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (isMac && maxTouchPoints > 1);

// Sensitivity constants
export const TOUCH_PAN_DRAG_SENSITIVITY = isIOS ? 0.75 : 1.05;        // per-move multiplier for single-finger touch panning
export const PAN_MOMENTUM_MIN_SPEED = 0.01;            // px/ms threshold before momentum stops (lowered for touch)
export const TOUCH_MOMENTUM_VELOCITY_WINDOW_MS = 80;   // how far back from the last touchmove to sample for release velocity
export const TOUCH_MOMENTUM_STATIONARY_GAP_MS = 60;    // if the gap between last touchmove and touchend exceeds this, treat the finger as held still — no momentum
export const TOUCH_MOMENTUM_LAUNCH_MIN_SPEED = 0.25;   // px/ms — touch must be moving this fast at release to launch momentum (prevents slip when finger slows to a stop)
// --- "Is the view moving?" (touch catch) ---
// While the view is moving, a finger coming down is catching it, not pressing
// what happens to be under it (see isViewMoving / handleNodeTouchStart).
// Measured from the transform itself rather than from momentum state, because
// every way the view moves matters equally to that finger: a launched glide, a
// pinch settling, an animated navigation, and — the common one — the tail of a
// drag the user is about to continue with the next plant. Momentum only exists
// above TOUCH_MOMENTUM_LAUNCH_MIN_SPEED, so a drag-lift-replant traversal has
// none, which is exactly when nodes were stealing the gesture.
export const VIEW_MOTION_MIN_SPEED = 0.001;        // px/ms — a standstill is the only thing this excludes
export const VIEW_MOTION_STALE_MS = 120;           // no transform write in this long = the view is parked
export const VIEW_MOTION_SAMPLE_MAX_GAP_MS = 120;  // a longer gap between writes restarts the measurement rather than averaging across the pause
export const VIEW_MOTION_MIN_SAMPLES = 2;          // consecutive moving frames before the view counts as moving, so a one-off jump (a viewport clamp, a graph-switch restore) doesn't swallow the next tap
export const TOUCH_PAN_FRICTION = 0.92;                // per-frame retention for touch glide (higher = longer glide)
export const TOUCH_PAN_FRICTION_HIGH_VELOCITY = 0.955; // higher retention for fast flicks — extends glide for "throws" without affecting low/mid precision
export const TOUCH_HIGH_VELOCITY_THRESHOLD = 1.2;      // px/ms — speed above which the high-velocity friction starts ramping in
export const TOUCH_HIGH_VELOCITY_RAMP = 1.5;           // px/ms — speed range over which friction lerps from base to high
export const TRACKPAD_PAN_FRICTION = 0.94;             // per-frame retention for trackpad glide
// Per-frame retention for click-drag glide. Its own base rather than touch's,
// so the Mouse slider's default can sit at the midpoint like every other glide
// slider instead of pinned to the floor: this is exactly what the old scale
// produced at 0.1 (TOUCH_PAN_FRICTION - 0.4 * GLIDE_STRENGTH_FRICTION_RANGE).
export const MOUSE_PAN_FRICTION = 0.872;
export const PAN_MOMENTUM_FRAME = 16.67;               // baseline frame duration (ms) for damping scaling
export const TOUCH_PAN_MOMENTUM_BOOST = 1.0;           // no amplification — launch momentum at the actual finger release velocity (boost made low/mid flicks feel jumpy)
export const TRACKPAD_PAN_MOMENTUM_BOOST = 1.1;        // marginally higher boost for precision trackpads
export const GLIDE_STRENGTH_FRICTION_RANGE = 0.12;     // total friction span the glide-strength slider sweeps (±0.06 around the default; 0.5 = no change)
export const GLIDE_FRICTION_MIN = 0.80;                // clamp floor for glide friction (very short coast)
export const GLIDE_FRICTION_MAX = 0.985;               // clamp ceiling for glide friction (long coast, never near-perpetual)

// --- Pinch-zoom glide (touch only) ---
// After the fingers lift from a pinch, the zoom coasts briefly in the same
// direction, anchored to the last pinch midpoint. Velocity is tracked in
// log-zoom space (d(ln zoom)/dt) so it decays multiplicatively like the pinch
// itself. Kept deliberately "slight": low boost + heavy friction = a short tail.
export const ZOOM_MOMENTUM_BOOST = 0.8;                // scales the release velocity into the glide (<1 = coast launches gentler than the fingers)
export const ZOOM_MOMENTUM_FRICTION = 0.86;            // per-frame retention of zoom velocity for gentle releases (short coast)
export const ZOOM_MOMENTUM_FRICTION_HIGH_VELOCITY = 0.91; // retention for violent flicks — same fast-flick ramp idea as TOUCH_PAN_FRICTION_HIGH_VELOCITY
export const ZOOM_HIGH_VELOCITY_THRESHOLD = 0.003;     // |d(ln zoom)/dt| above which the high-velocity friction starts ramping in
export const ZOOM_HIGH_VELOCITY_RAMP = 0.005;          // velocity range over which friction lerps from base to high
export const ZOOM_MOMENTUM_MIN_SPEED = 0.0004;         // |d(ln zoom)/dt| threshold to launch and to stop the glide (deliberate slow releases stay put)
export const ZOOM_MOMENTUM_MAX_SPEED = 0.009;          // cap on launch velocity so a fast pinch can't fling the zoom
export const PINCH_GLIDE_STRENGTH_VEL_RANGE = 0.8;     // velocity multiplier sweep for the strength slider: 0.6× at 0 → 1.4× at 1 (0.5 = 1×)
export const PINCH_GLIDE_STRENGTH_FRICTION_RANGE = 0.08; // friction offset sweep for the strength slider (±0.04 around default)

// --- Trackpad zoom smoothing + glide ---
// Trackpad zoom does not apply each event's delta straight to the view. Wheel
// events arrive on their own clock, not the compositor's, so a raw application
// lands two steps in one frame and none in the next — visible chop. Instead
// events accumulate into a TARGET zoom and a rAF loop eases the view toward it,
// which decouples motion from event timing and smooths the bunching out.
//
// The glide is not launched at the release, because there is no release to
// launch it at: a trackpad pinch has no "fingers lifted" event, only an event
// stream that stops. Every version that waited to DETECT the stop had dead time
// in front of the coast — the target frozen for as long as detection took while
// the ease drained its lag, so the view decayed toward a standstill and then
// re-accelerated when the coast finally launched. At the shipped idle gap that
// was 0.090 → 0.036 → 0.014 → 0.060 ln/frame. No amount of tuning removes it;
// it is what waiting costs.
//
// So the target carries momentum the WHOLE time. Each event corrects the target
// to where the fingers actually are and re-measures their velocity; between
// events the target keeps moving at that velocity under friction. A stop is
// then not an event to detect but the absence of the next correction — the
// velocity simply stops being refreshed and decays. Gesture and coast are the
// same motion, and the handoff cannot be choppy because there isn't one.
//
// The cost is that the target LEADS the fingers by roughly the time since the
// last event (about a frame). Each event rewinds that prediction before
// applying its own step (see `predictLn`), so the lead never accumulates, and
// it very nearly cancels the ease's own lag rather than adding to it. Below
// TRACKPAD_ZOOM_GLIDE_MIN_SPEED nothing is predicted at all, so a slow,
// deliberate gesture still lands exactly where it was aimed.
//
// (The touch pinch keeps its own momentum glide in startZoomMomentum; its
// gesture applies zoom directly from finger distance and has a real release.)
export const TRACKPAD_ZOOM_MAX_STEP_DELTA = 40;        // |deltaY| above this in pixel mode is a mouse wheel detent, not a trackpad
// The Settings zoom-sensitivity slider (0.1..1) is multiplied by this to get the
// per-event delta scale, so the slider's midpoint is half of it.
//
// Recentred: the scale was 13, putting the default at 6.5 — the value inherited
// from constants.js when the slider was added around a fixed constant rather
// than tuned as a range. The comfortable setting sits nearer 0.40 on that old
// slider, i.e. 5.2, so the range is rescaled to put 5.2 in the middle where the
// default belongs. The top of the slider still offers 2x the default.
export const TRACKPAD_ZOOM_SENSITIVITY_SLIDER_SCALE = 10.4;
// Per-frame fraction of the remaining gap to close (log space). This is the
// latency dial: the view trails the target by about (1 − s)/s frames, so 0.35
// costs ~1.9 frames (~31ms) and 0.6 costs ~0.67 (~11ms) — low enough to read as
// direct while still absorbing the frame-to-frame bunching that made raw
// application choppy. Below ~0.3 the lag becomes felt as sluggishness; at 1.0
// there is no smoothing left at all.
export const TRACKPAD_ZOOM_SMOOTHING = 0.6;
export const TRACKPAD_ZOOM_SETTLE_EPSILON = 0.0004;    // |ln(target/current)| below which the ease snaps and stops
// The gesture-end idle gap is measured against the gesture's OWN event rate
// rather than fixed. Pinch/scroll events are frame-locked, so a stream running
// at 60fps is called stopped after ~40ms while one throttled to 30fps by a heavy
// canvas gets ~80ms. A fixed threshold either ends late on fast streams or
// false-ends constantly on slow ones. A false end is cheap here: the target
// merely extends early, and the next event moves it again.
export const TRACKPAD_ZOOM_IDLE_GAP_MULTIPLE = 2.4;    // idle gap = this × the gesture's recent inter-event interval
export const TRACKPAD_ZOOM_IDLE_END_MIN_MS = 34;       // floor: two frames at 60fps
export const TRACKPAD_ZOOM_IDLE_END_MAX_MS = 110;      // ceiling: past this the "release" is too stale to coast from
export const TRACKPAD_ZOOM_VELOCITY_WINDOW_MS = 90;    // how far back from the last zoom event to sample release velocity
// A velocity sample spanning less than this is jitter, not motion. Wheel events
// queue and then arrive in a burst whenever a frame runs long on a heavy graph,
// and the peak-biased pick in endTrackpadZoomGesture would otherwise select
// exactly those bursts: three steps measured across two milliseconds reads as an
// enormous velocity and flung the zoom to its bound.
export const TRACKPAD_ZOOM_VELOCITY_MIN_SPAN_MS = 10;
// --- The coast itself ---
// Per-frame retention of the coast's velocity. The coast moves the TARGET; it is
// not a single extension of it. Two properties follow from that, and both were
// missing from the one-shot throw this replaced:
//
//   1. The handoff is seamless. Easing toward a fixed target moves the view at a
//      speed proportional to the REMAINING gap, so extending the target once
//      steps that speed up the instant the gesture ends — at the shipped numbers
//      the coast launched at roughly twice the speed of the gesture that spawned
//      it. That is a lurch, and it is what the release read as.
//   2. The coast has a decay rate of its own. Against a fixed target the only
//      available rate is the SMOOTHING rate — 60% per frame, over inside four —
//      so the strength slider could only make the throw bigger, never longer.
//      Turning it up bought a harder pop rather than a longer glide.
//
// Note the sense: this is per-frame RETENTION, so a HIGHER number is LESS
// friction and a longer coast (matching TOUCH_PAN_FRICTION above). The Settings
// slider is the other way round — see the mapping in recordTrackpadZoomSample.
//
// Total travel is (velocity x frame) / (1 - retention), so 0.72 coasts about
// three and a half frames' worth of gesture motion and decays to nothing in ~8:
// a settle you can watch, well short of the touch pinch's throw.
export const TRACKPAD_ZOOM_GLIDE_FRICTION = 0.72;
// How far the Settings slider sweeps the retention either side of the default.
// Sized so the low-friction end of the slider lands exactly on _MAX rather than
// clamping short of it, which would leave the first few percent of the travel
// dead. The high-friction end stops above _MIN, so that clamp is only a guard.
export const TRACKPAD_ZOOM_GLIDE_FRICTION_SLIDER_RANGE = 0.40;
export const TRACKPAD_ZOOM_GLIDE_FRICTION_MIN = 0.45;  // most friction — barely a settle
export const TRACKPAD_ZOOM_GLIDE_FRICTION_MAX = 0.88;  // least friction — a real throw, still bounded
// The slider moves friction only, never the launch speed: the coast has to
// leave at exactly the speed the gesture arrived at, or the seam comes back as
// a step up at one end of the slider and a step down at the other.
//
// Below this release speed there is no coast at all — a gesture deliberately
// slowed to a stop should stay exactly where it was left.
export const TRACKPAD_ZOOM_GLIDE_MIN_SPEED = 0.0015;
// Ceiling on launch velocity, restoring the cap the momentum-based coast had.
// Sized just above the fastest frame-locked pinch (|deltaY| ~10 per event).
// TRACKPAD_ZOOM_VELOCITY_MIN_SPAN_MS is the first line of defence against a
// mismeasured burst; this is the backstop.
export const TRACKPAD_ZOOM_GLIDE_MAX_SPEED = 0.010;
// Velocity floor at which the coast stops advancing the target and hands the
// last percent or two to the ease's own settle.
export const TRACKPAD_ZOOM_GLIDE_STOP_SPEED = 0.0004;

/**
 * Measure a trackpad zoom gesture's current velocity, in log-zoom space per ms,
 * from the recent target samples. Called on every step (not just at a release)
 * because the coast runs continuously — see the trackpad zoom notes above.
 *
 * Peak-biased: a gesture still accelerating when it is sampled is undersold by
 * the full window, so a short recent slice is measured too and the faster of the
 * two wins — but only when both agree on direction, or a late reversal would
 * drive the coast in the stale direction.
 */
export const measureTrackpadZoomVelocity = (hist) => {
  if (!hist || hist.length < 2) return 0;
  const last = hist[hist.length - 1];
  const velOverWindow = (windowMs) => {
    let first = null;
    for (let i = hist.length - 2; i >= 0; i--) {
      if (last.t - hist[i].t <= windowMs) first = hist[i];
      else break;
    }
    if (!first) return 0;
    const span = last.t - first.t;
    // Too short a span is a delivery burst, not motion — see
    // TRACKPAD_ZOOM_VELOCITY_MIN_SPAN_MS. Returning 0 lets the wider window
    // stand in rather than letting the burst win the peak-biased pick.
    return span >= TRACKPAD_ZOOM_VELOCITY_MIN_SPAN_MS ? (last.lz - first.lz) / span : 0;
  };
  const fullVel = velOverWindow(TRACKPAD_ZOOM_VELOCITY_WINDOW_MS);
  const recentVel = velOverWindow(TRACKPAD_ZOOM_VELOCITY_WINDOW_MS / 2.5);
  return (Math.abs(recentVel) > Math.abs(fullVel) && recentVel * fullVel >= 0)
    ? recentVel
    : fullVel;
};
