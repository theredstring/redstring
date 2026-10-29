import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The live width of an element, for layouts that change shape with the panel
 * rather than with the window (the panels are user-resizable).
 *
 * Held while a panel is being dragged (PanelResizers' `panelWidthChanging`,
 * from a pointer or a controller) and measured once when it lets go
 * (`panelWidthChanged`). What reads this width lays itself out in script (a
 * connection row's SVG is laid out for its column), and redoing that on every
 * frame of a drag made resizing the right panel crawl on an iPad. The panel's
 * edge still moves live; its contents settle on release.
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
    let held = false;
    let settle = 0;
    const measure = () => {
      if (held) return;
      const next = Math.round(el.getBoundingClientRect().width);
      setWidth((prev) => (prev === next ? prev : next));
    };
    const onChanging = () => { held = true; };
    const onChanged = () => {
      held = false;
      // After the panel has taken its committed width.
      cancelAnimationFrame(settle);
      settle = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('panelWidthChanging', onChanging);
    window.addEventListener('panelWidthChanged', onChanged);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(settle);
      window.removeEventListener('panelWidthChanging', onChanging);
      window.removeEventListener('panelWidthChanged', onChanged);
      observer?.disconnect();
    };
  }, [ref]);

  return [ref, width];
}
