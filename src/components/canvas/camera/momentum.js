/**
 * Pan and zoom momentum, and the trackpad zoom sampler (moved verbatim from
 * NodeCanvas's callbacks). NodeCanvas passes the refs and setters they use as
 * `ctx`. The camera controller (P4.02) is their eventual home.
 */
import { GLIDE_FRICTION_MAX, GLIDE_FRICTION_MIN, GLIDE_STRENGTH_FRICTION_RANGE, MOUSE_PAN_FRICTION, PAN_MOMENTUM_FRAME, PAN_MOMENTUM_MIN_SPEED, PINCH_GLIDE_STRENGTH_FRICTION_RANGE, PINCH_GLIDE_STRENGTH_VEL_RANGE, TOUCH_HIGH_VELOCITY_RAMP, TOUCH_HIGH_VELOCITY_THRESHOLD, TOUCH_PAN_FRICTION, TOUCH_PAN_FRICTION_HIGH_VELOCITY, TOUCH_PAN_MOMENTUM_BOOST, TRACKPAD_PAN_FRICTION, TRACKPAD_PAN_MOMENTUM_BOOST, TRACKPAD_ZOOM_GLIDE_FRICTION, TRACKPAD_ZOOM_GLIDE_FRICTION_MAX, TRACKPAD_ZOOM_GLIDE_FRICTION_MIN, TRACKPAD_ZOOM_GLIDE_FRICTION_SLIDER_RANGE, TRACKPAD_ZOOM_GLIDE_MAX_SPEED, TRACKPAD_ZOOM_GLIDE_MIN_SPEED, TRACKPAD_ZOOM_IDLE_END_MAX_MS, TRACKPAD_ZOOM_IDLE_END_MIN_MS, TRACKPAD_ZOOM_IDLE_GAP_MULTIPLE, TRACKPAD_ZOOM_VELOCITY_WINDOW_MS, ZOOM_HIGH_VELOCITY_RAMP, ZOOM_HIGH_VELOCITY_THRESHOLD, ZOOM_MOMENTUM_BOOST, ZOOM_MOMENTUM_FRICTION, ZOOM_MOMENTUM_FRICTION_HIGH_VELOCITY, ZOOM_MOMENTUM_MAX_SPEED, ZOOM_MOMENTUM_MIN_SPEED, measureTrackpadZoomVelocity } from '../../../utils/canvas/input/inputTuning.js';
import { MAX_ZOOM } from '../../../constants';
import useGraphStore from '../../../store/graphStore.js';

export function recordTrackpadZoom(zoom, sensitivity = null, eventTime = null, ctx) {
  const {
    endTrackpadZoomGesture, trackpadZoomRef,
  } = ctx;
  if (!Number.isFinite(zoom) || zoom <= 0) return;
  const ref = trackpadZoomRef.current;
  const isGestureStart = ref.hist.length === 0;
  if (sensitivity != null && isGestureStart) ref.sensitivity = sensitivity;
  // Latch the glide preferences for the gesture, like `sensitivity` — the
  // coast is continuous with the gesture now, so its friction has to be too.
  if (isGestureStart) {
    const prefs = useGraphStore.getState().touchSettings;
    ref.glideEnabled = prefs?.trackpadZoomGlideEnabled !== false;
    // The slider reads as strength, like every other glide slider — turn it
    // up, the coast runs longer — which is the same sense as the retention
    // coefficient it sets, hence the addition. The slider moves this and
    // nothing else: the coast's launch speed is always the gesture's, or the
    // seam comes back.
    const strength = Math.max(0, Math.min(1, prefs?.trackpadZoomGlideStrength ?? 0.5));
    ref.glideFriction = Math.max(
      TRACKPAD_ZOOM_GLIDE_FRICTION_MIN,
      Math.min(
        TRACKPAD_ZOOM_GLIDE_FRICTION_MAX,
        TRACKPAD_ZOOM_GLIDE_FRICTION + (strength - 0.5) * TRACKPAD_ZOOM_GLIDE_FRICTION_SLIDER_RANGE
      )
    );
  }
  const clock = performance.now();
  const now = (Number.isFinite(eventTime) && Math.abs(clock - eventTime) < 1000) ? eventTime : clock;
  const lz = Math.log(zoom);

  // Reversing mid-gesture drops the samples from the other direction. Without
  // this the velocity windows straddle the turn: the wide one still averages
  // out to the OLD direction, wins the peak-biased pick against a short new
  // slice, and the target keeps being carried the way the user just stopped
  // going. Two samples in the new direction measure it honestly instead.
  const prev = ref.hist[ref.hist.length - 1];
  if (prev && ref.hist.length >= 2) {
    const stepLn = lz - prev.lz;
    const prevStepLn = prev.lz - ref.hist[ref.hist.length - 2].lz;
    if (stepLn * prevStepLn < 0) ref.hist = [prev];
  }

  ref.hist.push({ t: now, lz });
  while (ref.hist.length > 2 && now - ref.hist[0].t > TRACKPAD_ZOOM_VELOCITY_WINDOW_MS * 2) {
    ref.hist.shift();
  }

  // Re-arm the momentum the ease loop carries the target forward with. Doing
  // this on every step rather than once at the end is what removes the seam:
  // the velocity is already correct when the events stop, so nothing has to
  // notice that they did. Below the launch floor nothing is predicted at all,
  // which is what keeps a slow, deliberate gesture landing where it was aimed.
  if (ref.glideEnabled) {
    const vel = measureTrackpadZoomVelocity(ref.hist);
    ref.glideVel = Math.abs(vel) < TRACKPAD_ZOOM_GLIDE_MIN_SPEED
      ? 0
      : Math.sign(vel) * Math.min(Math.abs(vel), TRACKPAD_ZOOM_GLIDE_MAX_SPEED);
  }

  // Idle gap scaled to this gesture's own cadence — see the constants. Median
  // of the recent intervals, so one dropped frame doesn't stretch the gap.
  let idleMs = TRACKPAD_ZOOM_IDLE_END_MAX_MS;
  if (ref.hist.length >= 3) {
    const gaps = [];
    for (let i = Math.max(1, ref.hist.length - 5); i < ref.hist.length; i++) {
      gaps.push(ref.hist[i].t - ref.hist[i - 1].t);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    idleMs = Math.min(
      TRACKPAD_ZOOM_IDLE_END_MAX_MS,
      Math.max(TRACKPAD_ZOOM_IDLE_END_MIN_MS, median * TRACKPAD_ZOOM_IDLE_GAP_MULTIPLE)
    );
  }

  if (ref.endTimerId) clearTimeout(ref.endTimerId);
  ref.endTimerId = setTimeout(() => endTrackpadZoomGesture(), idleMs);
}

export function runPanMomentum(initialVx, initialVy, source = 'touch', strength = 0.5, ctx) {
  const {
    canvasSizeRef, isPanningOrZooming, panMomentumRef, setPanOffset, stopPanMomentum, viewportSizeRef,
    zoomLevelRef,
  } = ctx;
  if (!Number.isFinite(initialVx) || !Number.isFinite(initialVy)) {
    return false;
  }
  stopPanMomentum();
  const boost = source === 'trackpad' ? TRACKPAD_PAN_MOMENTUM_BOOST : TOUCH_PAN_MOMENTUM_BOOST;
  let frictionBase = source === 'trackpad' ? TRACKPAD_PAN_FRICTION
    : source === 'mouse' ? MOUSE_PAN_FRICTION
    : TOUCH_PAN_FRICTION;
  const vx = initialVx * boost;
  const vy = initialVy * boost;
  const launchSpeed = Math.hypot(vx, vy);
  if (launchSpeed < PAN_MOMENTUM_MIN_SPEED) {
    return false;
  }
  // For touch fast flicks: lerp friction toward a higher value so the glide
  // travels farther. Slow/precise flicks keep the original friction so they
  // don't drift past the user's intended target.
  if (source === 'touch' && launchSpeed > TOUCH_HIGH_VELOCITY_THRESHOLD) {
    const overshoot = Math.min(1, (launchSpeed - TOUCH_HIGH_VELOCITY_THRESHOLD) / TOUCH_HIGH_VELOCITY_RAMP);
    frictionBase = TOUCH_PAN_FRICTION + (TOUCH_PAN_FRICTION_HIGH_VELOCITY - TOUCH_PAN_FRICTION) * overshoot;
  }
  // Apply the user's glide-strength slider (0..1, 0.5 = default): higher
  // strength retains more velocity per frame, so the glide coasts farther.
  // Offsets whatever friction was computed above, then clamps so it stays bounded.
  const strengthOffset = (Math.max(0, Math.min(1, strength)) - 0.5) * GLIDE_STRENGTH_FRICTION_RANGE;
  frictionBase = Math.max(GLIDE_FRICTION_MIN, Math.min(GLIDE_FRICTION_MAX, frictionBase + strengthOffset));

  panMomentumRef.current.vx = vx;
  panMomentumRef.current.vy = vy;
  panMomentumRef.current.lastTime = performance.now();
  panMomentumRef.current.source = source;
  panMomentumRef.current.active = true;

  const step = (time) => {
    const ref = panMomentumRef.current;
    if (!ref.active) {
      return;
    }
    const lastTime = ref.lastTime || time;
    const dt = Math.min(32, Math.max(1, time - lastTime));
    ref.lastTime = time;

    const moveX = ref.vx * dt;
    const moveY = ref.vy * dt;

    // Calculate the new pan offset and track what actually got applied
    const viewport = viewportSizeRef.current;
    const canvas = canvasSizeRef.current;
    const z = zoomLevelRef.current;

    if (!viewport || !canvas || !z) {
      stopPanMomentum();
      return;
    }

    // Track if we hit bounds to stop momentum in that direction
    let hitBoundsX = false;
    let hitBoundsY = false;

    setPanOffset(prev => {
      const minX = viewport.width - canvas.width * z;
      const minY = viewport.height - canvas.height * z;
      const maxX = 0;
      const maxY = 0;
      const targetX = prev.x + moveX;
      const targetY = prev.y + moveY;
      const clampedX = Math.min(Math.max(targetX, minX), maxX);
      const clampedY = Math.min(Math.max(targetY, minY), maxY);

      // Check if we hit bounds
      hitBoundsX = Math.abs(clampedX - targetX) > 0.01;
      hitBoundsY = Math.abs(clampedY - targetY) > 0.01;

      return { x: clampedX, y: clampedY };
    });

    const damping = Math.pow(frictionBase, dt / PAN_MOMENTUM_FRAME);

    // If we hit bounds, stop momentum in that direction
    if (hitBoundsX) {
      ref.vx = 0;
    } else {
      ref.vx *= damping;
    }
    if (hitBoundsY) {
      ref.vy = 0;
    } else {
      ref.vy *= damping;
    }

    const speed = Math.hypot(ref.vx, ref.vy);
    if (speed < PAN_MOMENTUM_MIN_SPEED) {
      stopPanMomentum();
      isPanningOrZooming.current = false;
      return;
    }

    ref.animationId = requestAnimationFrame(step);
  };

  isPanningOrZooming.current = true;
  panMomentumRef.current.animationId = requestAnimationFrame(step);
  return true;
}

export function runZoomMomentum(initialVel, anchorClient, anchorWorld, minZoomBound, maxZoomBound, ctx) {
  const {
    MIN_ZOOM, canvasSizeRef, containerRef, isPanningOrZooming, setPanAndZoom, stopPanMomentum,
    stopZoomMomentum, zoomLevelRef, zoomMomentumRef,
  } = ctx;
  if (!Number.isFinite(initialVel) || !anchorClient || !anchorWorld) return false;

  // Pinch glide is opt-out and strength-adjustable in Settings → Input → Touch.
  const touchPrefs = useGraphStore.getState().touchSettings;
  if (touchPrefs?.pinchGlideEnabled === false) return false;
  const strength = Math.max(0, Math.min(1, touchPrefs?.pinchGlideStrength ?? 0.5));

  // A new inertial gesture supersedes any in-flight pan/zoom glide.
  stopPanMomentum();
  stopZoomMomentum();

  // The glide must stop exactly where a manual pinch would — the caller (the
  // touch pinch handler) owns the authoritative zoom bounds and passes them
  // in. Without this the glide clamps to the dynamic fit-to-canvas MIN_ZOOM,
  // which on a large canvas floors below the pinch's limit and lets the coast
  // sail past the max zoom-out point. Fall back to the dynamic bounds.
  const effMinZoom = Number.isFinite(minZoomBound) ? minZoomBound : MIN_ZOOM;
  const effMaxZoom = Number.isFinite(maxZoomBound) ? maxZoomBound : MAX_ZOOM;

  // Strength scales the launch kick around 1× at the 0.5 default.
  const strengthVelScale = 1 + (strength - 0.5) * PINCH_GLIDE_STRENGTH_VEL_RANGE;
  let vel = initialVel * ZOOM_MOMENTUM_BOOST * strengthVelScale;
  vel = Math.max(-ZOOM_MOMENTUM_MAX_SPEED, Math.min(ZOOM_MOMENTUM_MAX_SPEED, vel));
  if (Math.abs(vel) < ZOOM_MOMENTUM_MIN_SPEED) return false;

  // Violent flicks coast farther: lerp friction toward the high-velocity
  // retention as launch speed rises (same shape as the touch pan glide).
  let friction = ZOOM_MOMENTUM_FRICTION;
  const launchSpeed = Math.abs(vel);
  if (launchSpeed > ZOOM_HIGH_VELOCITY_THRESHOLD) {
    const overshoot = Math.min(1, (launchSpeed - ZOOM_HIGH_VELOCITY_THRESHOLD) / ZOOM_HIGH_VELOCITY_RAMP);
    friction = ZOOM_MOMENTUM_FRICTION + (ZOOM_MOMENTUM_FRICTION_HIGH_VELOCITY - ZOOM_MOMENTUM_FRICTION) * overshoot;
  }
  // Strength also stretches/shrinks the coast, mirroring the pan glide's
  // GLIDE_STRENGTH_FRICTION_RANGE treatment. Clamped well below 1.
  friction = Math.max(0.78, Math.min(0.95, friction + (strength - 0.5) * PINCH_GLIDE_STRENGTH_FRICTION_RANGE));

  // Measured once, here, before the coast starts writing transforms. Reading
  // it inside the loop forces a synchronous layout of an SVG subtree the
  // previous frame just dirtied, and a SCALE change (which is all this loop
  // does) invalidates text layout — so the flush re-resolves every label.
  // Same reflow the trackpad ease caches away; see trackpadZoomRef.rect. The
  // container is viewport-fixed, so one read per gesture is all it can need.
  const coastRect = containerRef.current?.getBoundingClientRect();
  if (!coastRect) return false;

  zoomMomentumRef.current.vel = vel;
  zoomMomentumRef.current.anchorClient = { x: anchorClient.x, y: anchorClient.y };
  zoomMomentumRef.current.anchorWorld = { x: anchorWorld.x, y: anchorWorld.y };
  zoomMomentumRef.current.lastTime = performance.now();
  zoomMomentumRef.current.active = true;
  isPanningOrZooming.current = true;

  const step = (time) => {
    const ref = zoomMomentumRef.current;
    if (!ref.active) return;
    const lastTime = ref.lastTime || time;
    const dt = Math.min(32, Math.max(1, time - lastTime));
    ref.lastTime = time;

    const container = containerRef.current;
    const canvas = canvasSizeRef.current;
    if (!container || !canvas) {
      stopZoomMomentum();
      isPanningOrZooming.current = false;
      return;
    }

    // Re-assert every frame: the duplicated touchend run (React + document
    // listener) goes through handleMouseUp → stopPanMomentum, which clears
    // this flag right after the glide launches.
    isPanningOrZooming.current = true;

    const prevZoom = zoomLevelRef.current;
    let newZoom = prevZoom * Math.exp(ref.vel * dt);
    const clampedZoom = Math.max(effMinZoom, Math.min(effMaxZoom, newZoom));

    const rect = coastRect;
    const world = ref.anchorWorld;
    const client = ref.anchorClient;
    const newPan = {
      x: client.x - rect.left - (world.x - canvas.offsetX) * clampedZoom,
      y: client.y - rect.top - (world.y - canvas.offsetY) * clampedZoom,
    };
    setPanAndZoom(newPan, clampedZoom);

    // Decay velocity, frame-time compensated like the pan glide.
    ref.vel *= Math.pow(friction, dt / PAN_MOMENTUM_FRAME);

    // Stop once the coast is imperceptible or we've hit a zoom bound.
    const hitBound = clampedZoom !== newZoom;
    if (hitBound || Math.abs(ref.vel) < ZOOM_MOMENTUM_MIN_SPEED) {
      stopZoomMomentum();
      isPanningOrZooming.current = false;
      return;
    }
    ref.animationId = requestAnimationFrame(step);
  };

  zoomMomentumRef.current.animationId = requestAnimationFrame(step);
  return true;
}
