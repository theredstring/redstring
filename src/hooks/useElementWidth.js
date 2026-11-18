import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The live width of an element, for layouts that change shape with the panel
 * rather than with the window (the panels are user-resizable).
 *
 * Follows a panel resize drag as it happens: what reads this width lays itself
 * out in script (a connection row's SVG, its nodes sized to its column), and it
 * should rewrap and resize with the panel's edge, not jump when the drag ends.
 * A ResizeObserver reports at most once per frame.
 *
 * @param {number} [initial=0] - the width assumed before the first measurement
 * @param {React.RefObject} [externalRef] - measure this element instead of a new ref
 * @returns {[React.RefObject, number]} a ref to attach, and its width in px
 */
export default function useElementWidth(initial = 0, externalRef = null) {
  const ownRef = useRef(null);
  const ref = externalRef || ownRef;
  const [width, setWidth] = useState(initial);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      setWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [ref]);

  return [ref, width];
}
