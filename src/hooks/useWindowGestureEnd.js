import { useEffect, useRef } from 'react';

// Window-level capture-phase pointer/touch release listener. Active while
// `active` is truthy. Use for any gesture (node drag, connection draw, etc.)
// that must finalize on release regardless of where the finger/cursor ended
// up — element-routed handlers stop firing once the pointer leaves the
// originating element (or that element is unmounted/re-rendered into a
// different render path), and bubble-phase document listeners can be
// short-circuited by element-level stopPropagation.
//
// Capture phase on `window` ensures we hear the release first, before any
// element handler can stop it. Pairs with `useNodeDrag`'s window pointermove
// effect to make drag/connection lifecycle fully window-scoped.
export function useWindowGestureEnd(active, onEnd) {
  const onEndRef = useRef(onEnd);
  useEffect(() => { onEndRef.current = onEnd; });

  useEffect(() => {
    if (!active) return;

    const fire = (clientX, clientY, modifiers) => {
      onEndRef.current?.({
        clientX,
        clientY,
        changedTouches: [{ clientX, clientY }],
        shiftKey: !!modifiers?.shiftKey,
        metaKey: !!modifiers?.metaKey,
        ctrlKey: !!modifiers?.ctrlKey,
        stopPropagation: () => {},
        preventDefault: () => {},
        __source: 'window-capture',
      });
    };

    const onPointerEnd = (e) => {
      if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return;
      fire(e.clientX, e.clientY, e);
    };

    const onTouchEnd = (e) => {
      const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
      if (!t) return;
      fire(t.clientX, t.clientY, e);
    };

    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('touchend', onTouchEnd, true);
    window.addEventListener('touchcancel', onTouchEnd, true);
    return () => {
      window.removeEventListener('pointerup', onPointerEnd, true);
      window.removeEventListener('pointercancel', onPointerEnd, true);
      window.removeEventListener('touchend', onTouchEnd, true);
      window.removeEventListener('touchcancel', onTouchEnd, true);
    };
  }, [active]);
}
