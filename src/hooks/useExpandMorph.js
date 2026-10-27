import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../components/canvas/edges/edgeTransitions.js';

// Same timing and curve as the box morph (groups/boxMorph.js), so a node opening
// to its preview and a preview opening in place move alike.
const OPEN_MS = 380;
const CLOSE_MS = 320;
const easeInOutCubic = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * How far a node is between its resting box and its expanded preview card.
 *
 * `progress` runs 0 → 1 while opening and back while closing; `t` is the eased
 * value the drawing interpolates with. A reversal mid-flight carries on from where
 * it is, at a speed scaled to the distance left. A node that mounts already
 * expanded starts at 1, so remounting never replays the open. With reduced
 * motion it jumps straight to the end, like the box morph.
 */
export default function useExpandMorph(expanded) {
  const [progress, setProgress] = useState(expanded ? 1 : 0);
  const progressRef = useRef(progress);

  useEffect(() => {
    const from = progressRef.current;
    const to = expanded ? 1 : 0;
    if (from === to) return undefined;
    const ms = prefersReducedMotion() ? 0 : (expanded ? OPEN_MS : CLOSE_MS) * Math.abs(to - from);
    let raf = 0;
    let start = null;
    const frame = (now) => {
      if (start === null) start = now;
      const q = ms > 0 ? Math.min(1, (now - start) / ms) : 1;
      const p = q >= 1 ? to : from + (to - from) * q;
      progressRef.current = p;
      setProgress(p);
      if (q < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [expanded]);

  return { progress, t: easeInOutCubic(progress) };
}
