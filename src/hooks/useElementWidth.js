import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The live width of an element, for layouts that change shape with the panel
 * rather than with the window (the panels are user-resizable).
 *
 * @param {number} [initial=0] - the width assumed before the first measurement
 * @returns {[React.RefObject, number]} a ref to attach, and its width in px
 */
export default function useElementWidth(initial = 0) {
  const ref = useRef(null);
  const [width, setWidth] = useState(initial);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      setWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
