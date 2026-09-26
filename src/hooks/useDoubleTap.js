import { useRef } from 'react';

const DOUBLE_TAP_MS = 400;
const TAP_SLOP_PX = 10;

/**
 * Touch fallback for onDoubleClick, which mobile browsers don't fire reliably.
 * Spread the returned handlers onto the element alongside onDoubleClick.
 * A touch that moved (a scroll) doesn't count as a tap.
 */
export default function useDoubleTap(onDoubleTap) {
  const lastTapRef = useRef(0);
  const startRef = useRef(null);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    startRef.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
  };

  const onTouchEnd = (e) => {
    const start = startRef.current;
    startRef.current = null;
    const t = e.changedTouches[0];
    if (!onDoubleTap || !start || !t
      || Math.abs(t.clientX - start.x) > TAP_SLOP_PX
      || Math.abs(t.clientY - start.y) > TAP_SLOP_PX) {
      lastTapRef.current = 0;
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      // Stops the synthetic click and the browser's double-tap zoom.
      e.preventDefault();
      onDoubleTap(e);
    } else {
      lastTapRef.current = now;
    }
  };

  return { onTouchStart, onTouchEnd };
}
