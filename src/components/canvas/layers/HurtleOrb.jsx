/**
 * The hurtle orb: the particle that flies from a node (or a panel icon) to the
 * header's active tab when a definition web opens.
 *
 * NodeCanvas refactor P1.06 (FINDINGS F-05). The flight used to live in
 * NodeCanvas state, rewritten on every animation frame, so a ~400 ms hurtle
 * cost the whole canvas a commit per frame. Now NodeCanvas sets `flight` once
 * at launch and clears it after `onLand`; this component runs the rAF loop and
 * writes the orb's box, z-index and opacity straight to its <div>.
 *
 *   flight = {
 *     startTime, duration,          // performance.now() ms
 *     startPos, targetPos,          // viewport px (the orb is position:fixed)
 *     orbSize, nodeColor,
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
  const zIndex = progress < 0.45 ? 500 : progress < 0.85 ? 15000 : 5000;
  // Fades out over the last 10%.
  const opacity = progress > 0.9 ? 1 - (progress - 0.9) * 10 : 1;
  return { eased, x, y, size, zIndex, opacity };
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

  // First frame before paint, so the orb never shows unpositioned.
  useLayoutEffect(() => {
    if (flight && elRef.current) paint(elRef.current, flight, 0);
  }, [flight]);

  useEffect(() => {
    if (!flight) return undefined;
    trackRef.current.reset(0);
    let rafId = 0;
    let landed = false;
    const step = (now) => {
      const progress = Math.min((now - flight.startTime) / flight.duration, 1);
      const el = elRef.current;
      const f = el ? paint(el, flight, progress) : hurtleFrame(flight, progress);
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
