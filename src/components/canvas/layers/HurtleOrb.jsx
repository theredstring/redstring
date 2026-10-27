/**
 * The hurtle orb: the particle that flies from a node (or a panel icon) to the
 * header's active tab when a definition web opens.
 *
 * NodeCanvas refactor P1.06 (FINDINGS F-05). The flight used to live in
 * NodeCanvas state, rewritten on every animation frame, so a ~400 ms hurtle
 * cost the whole canvas a commit per frame. Now NodeCanvas sets `flight` once
 * at launch and clears it after `onLand`; this component flies the orb.
 *
 * The flight is known whole at launch, so it is handed to the browser as one
 * animation of transform and opacity (`flightKeyframes`), which runs on the
 * compositor however busy the canvas is opening the web. The orb is drawn at
 * its peak size and scaled. The frame loop is left only the z-index steps,
 * the haptic detents and the landing. Without element.animate (jsdom) the
 * loop paints the box itself, as it used to.
 *
 *   flight = {
 *     startTime, duration,          // performance.now() ms
 *     startPos, targetPos,          // viewport px (the orb is position:fixed)
 *     orbSize, nodeColor,
 *     fromPanel,                    // launched from a panel button
 *     land,                         // optional: NodeCanvas calls it instead of its own landing
 *     ...                           // anything else is passed back to onLand
 *   }
 *
 * A new `flight` object restarts the loop; onLand(flight) fires exactly once,
 * when progress reaches 1. Unmounting mid-flight cancels it without landing.
 */
import { useEffect, useLayoutEffect, useRef, memo } from 'react';
import { createDetentTrack } from '../../../services/haptics.js';

// Detent spacing along the orb's eased progress (0→1), so 0.25 means three
// ticks in flight. Sized against the shared 40 ms haptic rate limit: the orb's
// ease-in-out peaks at twice its average speed, and at this spacing even the
// fastest pair of crossings lands ~58 ms apart. Halving it to 1/6 would put the
// middle crossings ~37 ms apart and silently drop one.
const HURTLE_DETENT_STEP = 0.25;

// Between the side panels (10000) and the header (11000).
const HURTLE_OVER_PANELS_Z = 10500;

/**
 * The orb at `progress` (0→1): centre, diameter, z-index and opacity. Pure, so
 * the flight's shape can be tested without a browser.
 */
export function hurtleFrame(flight, progress) {
  // Gentle ease-in-out.
  const eased = progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  const x = Math.round(flight.startPos.x + (flight.targetPos.x - flight.startPos.x) * eased);
  const y = Math.round(flight.startPos.y + (flight.targetPos.y - flight.startPos.y) * eased);
  // Starts at 1 px, balloons to 1.9x the orb size mid-flight, contracts to 1 px.
  const peak = flight.orbSize * 1.9;
  const size = Math.max(1, Math.round(1 + (peak - 1) * Math.sin(progress * Math.PI)));
  // Under the (elevated) node first, then over the header, then just under it.
  // Always over the panels (10000) otherwise: one launched from a panel button
  // starts above it rather than under the node, and the landing stays above
  // them under the header (11000).
  const zIndex = progress < 0.45 ? (flight.fromPanel ? HURTLE_OVER_PANELS_Z : 500)
    : progress < 0.85 ? 15000 : HURTLE_OVER_PANELS_Z;
  // Fades out over the last 10%.
  const opacity = progress > 0.9 ? 1 - (progress - 0.9) * 10 : 1;
  return { eased, x, y, size, zIndex, opacity };
}

// Linear between samples, so the curve is the eased path and the sin bump.
const FLIGHT_SAMPLES = 32;

/** The flight as Web Animations keyframes: its centre and diameter by
 *  transform, on a box `peak` px square at the viewport's origin. */
export function flightKeyframes(flight) {
  const peak = flight.orbSize * 1.9;
  const frames = [];
  for (let i = 0; i <= FLIGHT_SAMPLES; i++) {
    const progress = i / FLIGHT_SAMPLES;
    const f = hurtleFrame(flight, progress);
    frames.push({
      offset: progress,
      transform: `translate(${f.x - peak / 2}px, ${f.y - peak / 2}px) scale(${f.size / peak})`,
      opacity: f.opacity,
    });
  }
  return { peak, frames };
}

function paint(el, flight, progress) {
  const f = hurtleFrame(flight, progress);
  const s = el.style;
  s.left = `${f.x - f.size / 2}px`;
  s.top = `${f.y - f.size / 2}px`;
  s.width = `${f.size}px`;
  s.height = `${f.size}px`;
  s.zIndex = String(f.zIndex);
  s.opacity = String(f.opacity);
  return f;
}

function HurtleOrb({ flight, onLand }) {
  const elRef = useRef(null);
  const onLandRef = useRef(onLand);
  onLandRef.current = onLand;
  // One track reused across launches; each flight reseeds it.
  const trackRef = useRef(null);
  if (!trackRef.current) trackRef.current = createDetentTrack('hurtleTravel', HURTLE_DETENT_STEP);

  const animatedRef = useRef(false);

  // Launched before paint, so the orb never shows unpositioned. Caught up to
  // the flight's start, which may be a frame or two back.
  useLayoutEffect(() => {
    const el = elRef.current;
    animatedRef.current = false;
    if (!flight || !el) return undefined;
    if (typeof el.animate !== 'function') { paint(el, flight, 0); return undefined; }
    const { peak, frames } = flightKeyframes(flight);
    Object.assign(el.style, { left: '0px', top: '0px', width: `${peak}px`, height: `${peak}px`, transformOrigin: '50% 50%' });
    el.style.zIndex = String(hurtleFrame(flight, 0).zIndex);
    const anim = el.animate(frames, { duration: flight.duration, fill: 'forwards' });
    anim.currentTime = Math.max(0, Math.min(flight.duration, performance.now() - flight.startTime));
    animatedRef.current = true;
    return () => anim.cancel();
  }, [flight]);

  useEffect(() => {
    if (!flight) return undefined;
    trackRef.current.reset(0);
    let rafId = 0;
    let landed = false;
    const step = (now) => {
      const progress = Math.min((now - flight.startTime) / flight.duration, 1);
      const el = elRef.current;
      let f;
      if (el && animatedRef.current) {
        f = hurtleFrame(flight, progress);
        // Two steps a flight, so only when it changes.
        const z = String(f.zIndex);
        if (el.style.zIndex !== z) el.style.zIndex = z;
      } else {
        f = el ? paint(el, flight, progress) : hurtleFrame(flight, progress);
      }
      // Detents follow the eased progress, so they bunch where the orb is
      // visibly fastest. The landing gets its own, heavier event (onLand), so
      // no tick is fired at 1.
      if (progress < 1) {
        trackRef.current.update(f.eased);
        rafId = requestAnimationFrame(step);
      } else if (!landed) {
        landed = true;
        onLandRef.current?.(flight);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [flight]);

  if (!flight) return null;
  return (
    <div
      ref={elRef}
      data-hurtle-orb=""
      style={{
        position: 'fixed',
        backgroundColor: flight.nodeColor,
        borderRadius: '50%',
        pointerEvents: 'none',
        transition: 'none',
      }}
    />
  );
}

// Memoized (render sweep): its props only change when a flight starts or ends.
export default memo(HurtleOrb);
