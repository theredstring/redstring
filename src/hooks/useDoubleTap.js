import { useRef } from 'react';

const DOUBLE_TAP_MS = 400;
const TAP_SLOP_PX = 10;
// A dblclick this soon after a touch on the element came from that touch.
const TOUCH_DBLCLICK_MS = 1000;

/**
 * Double-click and double-tap on one element. Spread the returned handlers
 * onto it; it owns onDoubleClick, so don't set one beside it.
 *
 * Touch is counted here, per element. The browser's own dblclick is only
 * trusted from a mouse: with zoom off, iOS fires one for any two quick taps
 * near each other, even on two different rows, and sends it to the second.
 * A touch that moved (a scroll) doesn't count as a tap.
 */
export default function useDoubleTap(onDoubleTap) {
  const lastTapRef = useRef(0);
  const lastTouchEndRef = useRef(0);
  const startRef = useRef(null);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    startRef.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
  };

  const onTouchEnd = (e) => {
    lastTouchEndRef.current = Date.now();
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

  const onDoubleClick = (e) => {
    if (Date.now() - lastTouchEndRef.current < TOUCH_DBLCLICK_MS) return;
    onDoubleTap?.(e);
  };

  return { onTouchStart, onTouchEnd, onDoubleClick };
}
