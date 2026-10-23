/**
 * A node resized where it stands (actions/resizeNode.js) moves its top-left
 * corner by half the change, so its middle stays put. The box's width and
 * height already transition (Node's SIZE_TRANSITION); this moves the node's
 * group along with them, from where it was to where it now is, on the same
 * curve, so it grows and shrinks around its middle instead of jumping to its
 * new corner. A FLIP on the group's CSS transform, which nothing else writes
 * while the node is at rest (useNodeDrag owns it during a drag).
 */
import { useLayoutEffect, useRef } from 'react';

/**
 * @param {React.RefObject<SVGGElement>} ref - the node's group
 * @param {number} x - the node's top-left, as drawn
 * @param {number} y
 * @param {number} sizeMul - the node's size
 * @param {boolean} dragging - a drag writes the transform itself
 * @param {string} transition - duration and easing, as the box's (e.g. '0.16s ease')
 */
export default function useCentredResize(ref, x, y, sizeMul, dragging, transition) {
  const last = useRef({ x, y, sizeMul });
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { x, y, sizeMul };
    const el = ref.current;
    if (!el || dragging || prev.sizeMul === sizeMul) return undefined;
    const dx = prev.x - x;
    const dy = prev.y - y;
    if (!dx && !dy) return undefined;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    // The start has to be drawn before the transition is set, or there is nothing to move from.
    el.getBoundingClientRect();
    el.style.transition = `transform ${transition}`;
    el.style.transform = '';
    const settle = () => { el.style.transition = ''; };
    // The box's own transitions end inside it and bubble here: only the group's move settles it.
    const onEnd = (e) => {
      if (e.target !== el || e.propertyName !== 'transform') return;
      el.removeEventListener('transitionend', onEnd);
      settle();
    };
    el.addEventListener('transitionend', onEnd);
    return () => {
      el.removeEventListener('transitionend', onEnd);
      settle();
    };
  }, [ref, x, y, sizeMul, dragging, transition]);
}
