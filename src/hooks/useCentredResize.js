/**
 * A node resized where it stands (actions/resizeNode.js) moves its top-left
 * corner by half the change, so its middle stays put. The box's width and
 * height already transition (Node's SIZE_TRANSITION); this moves the node's
 * group along with them, from where it was to where it now is, on the same
 * curve, so it grows and shrinks around its middle instead of jumping to its
 * new corner. A FLIP on the group's CSS transform, which nothing else writes
 * while the node is at rest (useNodeDrag owns it during a drag).
 *
 * A node's image slot has no size transition of its own: its x/y/width/height
 * are drawn at the new size at once. Left alone it would arrive full size at
 * the old corner and slide over with the group, so an image node seemed to
 * move while it resized. Given the slot (its own group and its rect as drawn),
 * this FLIPs it too, from the old slot to the new one on the same curve: a
 * translate plus a scale about the origin, which keeps every edge on a straight
 * line between its two ends, as the box's own width/height transitions do. The
 * image's clip path is in the image's user space, so its rounded corners ride
 * along.
 */
import { useLayoutEffect, useRef } from 'react';

// Draw `el` at `from`, then transition its transform away on `transition`.
// Returns the effect cleanup.
function flip(el, from, transition) {
  el.style.transition = 'none';
  el.style.transform = from;
  // The start has to be drawn before the transition is set, or there is nothing to move from.
  el.getBoundingClientRect();
  el.style.transition = `transform ${transition}`;
  el.style.transform = '';
  const settle = () => { el.style.transition = ''; };
  // The box's own transitions end inside it and bubble here: only this element's move settles it.
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
}

const hasArea = (r) => Boolean(r) && r.width > 0 && r.height > 0;

/**
 * The transform that draws the slot `now` (absolute, as drawn at the new
 * corner x/y) where `before` was relative to its own corner, so under the
 * group's FLIP (which carries the new corner back to the old one) it lands
 * exactly on the old slot. `translate(t) scale(s)` with the origin at 0 0.
 */
export function slotFlipTransform(before, now, x, y) {
  const sx = before.slot.width / now.width;
  const sy = before.slot.height / now.height;
  const targetX = x + (before.slot.x - before.x);
  const targetY = y + (before.slot.y - before.y);
  const tx = targetX - sx * now.x;
  const ty = targetY - sy * now.y;
  return `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
}

/**
 * @param {React.RefObject<SVGGElement>} ref - the node's group
 * @param {number} x - the node's top-left, as drawn
 * @param {number} y
 * @param {number} sizeMul - the node's size
 * @param {boolean} dragging - a drag writes the transform itself
 * @param {string} transition - duration and easing, as the box's (e.g. '0.16s ease')
 * @param {{ ref: React.RefObject<SVGGElement>, x: number, y: number, width: number, height: number }} [slot]
 *   - the image slot's own group and its rect as drawn (absolute, like x/y)
 */
export default function useCentredResize(ref, x, y, sizeMul, dragging, transition, slot) {
  const slotRect = hasArea(slot) ? { x: slot.x, y: slot.y, width: slot.width, height: slot.height } : null;
  const last = useRef({ x, y, sizeMul, slot: slotRect });
  const slotRef = slot?.ref;
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { x, y, sizeMul, slot: slotRect };
    if (dragging || prev.sizeMul === sizeMul) return undefined;
    const cleanups = [];
    const el = ref.current;
    const dx = prev.x - x;
    const dy = prev.y - y;
    if (el && (dx || dy)) cleanups.push(flip(el, `translate(${dx}px, ${dy}px)`, transition));
    const slotEl = slotRef?.current;
    if (slotEl && slotRect && hasArea(prev.slot)) {
      cleanups.push(flip(slotEl, slotFlipTransform(prev, slotRect, x, y), transition));
    }
    if (!cleanups.length) return undefined;
    return () => cleanups.forEach(fn => fn());
    // slotRect is rebuilt each render from these four numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, slotRef, x, y, sizeMul, dragging, transition, slotRect?.x, slotRect?.y, slotRect?.width, slotRect?.height]);
}
