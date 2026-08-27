/**
 * Placing a floating box next to the thing that opened it.
 *
 * Extracted from ColorPicker.jsx's `getPositionStyle`, which was the only
 * implementation of this in the app. The behaviour is deliberately unchanged:
 * flip the horizontal alignment rather than let the box run off the side, flip
 * above the anchor rather than off the bottom, and clamp to the top edge.
 *
 * Anchors are `{x, y}` client coordinates from getBoundingClientRect(), not
 * element refs — the convention the rest of the app already follows (see the
 * comment in UnifiedBottomControlPanel.jsx where the palette is handed the
 * button's top-centre, "the same shape PieMenu passes from a touch").
 */

/**
 * @param {object} params
 * @param {{x: number, y: number}} params.position - client coords of the anchor
 * @param {'down-left'|'down-right'} [params.direction] - which edge aligns to position.x
 * @param {number} params.width - the box's width
 * @param {number} params.height - the box's height (an estimate is fine; it only
 *   decides whether to flip above the anchor)
 * @param {number} params.zIndex
 * @param {boolean} [params.isMobile] - centre on the viewport instead of anchoring
 * @param {number} [params.offset] - gap between anchor and box
 * @returns {object} a style object using `position: fixed`
 */
export function getAnchoredStyle({
  position,
  direction = 'down-left',
  width,
  height,
  zIndex,
  isMobile = false,
  offset = 8
}) {
  // On a phone the trigger is often near an edge, and an anchored box ends up
  // wedged into a corner. Centring is more usable.
  if (isMobile) {
    return {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex
    };
  }

  let left;
  let right;
  let top = position.y + offset;

  if (direction === 'down-right') {
    // Left edge of the box aligns with the anchor.
    left = position.x;
    if (left + width > window.innerWidth) {
      right = Math.max(offset, window.innerWidth - position.x - width);
      left = undefined;
    }
  } else {
    // 'down-left': right edge of the box aligns with the anchor.
    right = window.innerWidth - position.x;
    if (window.innerWidth - right < width) {
      left = position.x + offset;
      right = undefined;
      if (left + width > window.innerWidth) {
        left = window.innerWidth - width - offset;
      }
    }
  }

  // Not enough room below → put it above the anchor.
  if (top + height > window.innerHeight) {
    top = position.y - height - offset;
  }
  if (top < 0) {
    top = offset;
  }

  const style = { position: 'fixed', top: Math.max(0, top), zIndex };
  if (left !== undefined) style.left = Math.max(0, left);
  else style.right = Math.max(0, right);
  return style;
}
