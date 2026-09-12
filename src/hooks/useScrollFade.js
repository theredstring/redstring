import { useCallback, useEffect, useState } from 'react';
import './scrollFade.css';

// Enough slack that a sub-pixel layout (a fractional device pixel ratio, a
// half-pixel border) never reads as "there is more content down there".
const EDGE_SLACK = 4;

/**
 * Turn an element into a scroll region whose only affordance is a faded edge.
 *
 * Returns a ref to put on the scroller and the className it should carry; the
 * modifiers appear and disappear as the content and the scroll position change,
 * so a list that fits looks exactly like it did before there was any scrolling.
 *
 * The ref is a CALLBACK ref, deliberately. A dialog that renders `null` while
 * closed stays mounted, so an effect keyed on a plain ref's `.current` would run
 * once against nothing and never attach a listener to the element that turns up
 * later. The callback re-runs the effect the moment the node exists.
 *
 * Both observers earn their place: the element's own box changes when the panel
 * or the window resizes, and its CONTENT changes without the box changing at all
 * — an option list re-wrapping, a free-text box opening underneath it — which a
 * ResizeObserver on the scroller alone never sees.
 *
 * @returns {{ ref: (el: Element|null) => void, className: string, measure: () => void }}
 */
export default function useScrollFade() {
  const [el, setEl] = useState(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const measure = useCallback(() => {
    if (!el) return;
    const overflowing = el.scrollHeight - el.clientHeight > EDGE_SLACK;
    const top = overflowing && el.scrollTop > EDGE_SLACK;
    const bottom = overflowing && el.scrollTop + el.clientHeight < el.scrollHeight - EDGE_SLACK;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, [el]);

  useEffect(() => {
    if (!el) {
      // Nothing to fade while the region is gone; don't leave a stale edge behind
      // for when it comes back with different content.
      setEdges((prev) => (prev.top || prev.bottom ? { top: false, bottom: false } : prev));
      return undefined;
    }

    measure();
    el.addEventListener('scroll', measure, { passive: true });

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(el);
    }

    let mutationObserver;
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(measure);
      mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });
    }

    return () => {
      el.removeEventListener('scroll', measure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [el, measure]);

  const className = [
    'scroll-fade',
    edges.top ? 'scroll-fade--top' : null,
    edges.bottom ? 'scroll-fade--bottom' : null
  ].filter(Boolean).join(' ');

  return { ref: setEl, className, measure };
}
