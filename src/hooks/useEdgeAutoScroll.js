import { useEffect, useMemo, useRef } from 'react';
import { useDragDropManager } from 'react-dnd';
import { createEdgeAutoScroll } from '../utils/edgeAutoScroll.js';
import { createEdgeScrollIndicator } from '../utils/edgeScrollIndicator.js';

/**
 * Edge auto-scroll for a react-dnd drop target (see utils/edgeAutoScroll.js).
 *
 * Armed by the target's `hover` calling `update(clientOffset)`. From then on it
 * follows the drag's own position, not the target's hovers: past the scroller's
 * edge the drag is usually over something else (a panel's tab bar, the header's
 * buttons), which is exactly where the scroll has to keep going. It disarms
 * when the drag ends or leaves the corridor across the scroll axis — out of
 * the panel's column, down out of the header — and re-arms on the next hover.
 *
 * Callbacks are read fresh every frame, so they may change between renders;
 * `axis`, `zones` and speeds are fixed at mount. Stops on unmount.
 *
 * @param {Object} options - As createEdgeAutoScroll, plus:
 * @param {() => {lo: number, hi: number}|null} [options.getCorridor] - The span
 *   across the scroll axis the drag must stay within; defaults to the scroller's rect.
 * @param {Object} [options.indicator] - Draws the scroll position while it
 *   runs: createEdgeScrollIndicator's options, less `axis`. Fixed at mount.
 * @returns {{ update: (clientOffset: {x: number, y: number}) => void, stop: () => void,
 *   indicate: () => void }} `indicate` shows the same thumb for a scroll that
 *   isn't the drag's — the wheel, a trackpad, a finger pan — so every way of
 *   scrolling the surface reads the same.
 */
export function useEdgeAutoScroll(options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const monitor = useDragDropManager().getMonitor();

  const handle = useMemo(() => {
    const { axis } = optionsRef.current;
    const along = (offset) => (axis === 'x' ? offset.x : offset.y);
    const across = (offset) => (axis === 'x' ? offset.y : offset.x);
    let unsubscribers = [];
    const indicator = optionsRef.current.indicator
      ? createEdgeScrollIndicator({ ...optionsRef.current.indicator, axis })
      : null;

    // The span the scroller shows on its axis: its own rect unless the caller
    // knows part of it is covered.
    const visibleBounds = (el) => {
      const given = optionsRef.current.getBounds?.();
      if (given) return given;
      const rect = el.getBoundingClientRect();
      return axis === 'x' ? { lo: rect.left, hi: rect.right } : { lo: rect.top, hi: rect.bottom };
    };

    const indicate = () => {
      const el = optionsRef.current.getElement();
      if (indicator && el) indicator.show(el, visibleBounds(el));
    };

    const scroller = createEdgeAutoScroll({
      ...optionsRef.current,
      getElement: () => optionsRef.current.getElement(),
      getBounds: () => optionsRef.current.getBounds?.() || null,
      onScroll: (pointer) => {
        optionsRef.current.onScroll?.(pointer);
        indicate();
      },
      onStop: () => optionsRef.current.onStop?.(),
    });

    const inCorridor = (offset) => {
      let corridor = optionsRef.current.getCorridor?.();
      if (!corridor) {
        const rect = optionsRef.current.getElement()?.getBoundingClientRect();
        if (!rect) return false;
        corridor = axis === 'x' ? { lo: rect.top, hi: rect.bottom } : { lo: rect.left, hi: rect.right };
      }
      const c = across(offset);
      return c >= corridor.lo && c <= corridor.hi;
    };

    const stop = () => {
      unsubscribers.forEach(off => off());
      unsubscribers = [];
      scroller.stop();
      indicator?.hide();
    };

    const follow = () => {
      const offset = monitor.getClientOffset();
      if (!monitor.isDragging() || !offset || !inCorridor(offset)) { stop(); return; }
      scroller.update(along(offset));
    };

    return {
      update(offset) {
        if (!offset) return;
        if (!unsubscribers.length) {
          unsubscribers = [
            monitor.subscribeToOffsetChange(follow),
            // The drag ending moves no pointer, so it needs its own listener.
            monitor.subscribeToStateChange(() => { if (!monitor.isDragging()) stop(); }),
          ];
        }
        scroller.update(along(offset));
      },
      stop,
      indicate,
      destroy() {
        stop();
        indicator?.destroy();
      },
    };
  }, [monitor]);

  useEffect(() => () => handle.destroy(), [handle]);
  return handle;
}
