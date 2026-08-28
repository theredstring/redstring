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
 * @param {number} params.height - the height the box would like. Only a
 *   preference: the returned `maxHeight` is what actually fits, so content
 *   taller than this scrolls rather than running off the screen.
 * @param {number} params.zIndex
 * @param {boolean} [params.isMobile] - centre on the viewport instead of anchoring
 * @param {number} [params.offset] - gap between anchor and box
 * @returns {object} a style object using `position: fixed`, including a
 *   `maxHeight` the caller must not override
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
      maxHeight: `calc(100vh - ${offset * 4}px)`,
      zIndex
    };
  }

  let left;
  let right;

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

  /**
   * Vertical placement is decided by the room that exists, not by the caller's
   * guess at how tall the box will be.
   *
   * The earlier version placed the box at `position.y + offset` and only
   * flipped above when `height` said it wouldn't fit. A list whose length
   * depends on what a search returned is always taller than its estimate
   * sometimes, and when it was, the box ran off the bottom of the screen with
   * no way to reach the rest. So: pick the side with more room, then cap to
   * that side. The box scrolls internally instead of overflowing.
   */
  const roomBelow = window.innerHeight - position.y - offset * 2;
  const roomAbove = position.y - offset * 2;
  const placeAbove = height > roomBelow && roomAbove > roomBelow;

  const maxHeight = Math.max(120, placeAbove ? roomAbove : roomBelow);
  const top = placeAbove
    ? Math.max(offset, position.y - Math.min(height, roomAbove) - offset)
    : position.y + offset;

  const style = { position: 'fixed', top: Math.max(0, top), maxHeight, zIndex };
  if (left !== undefined) style.left = Math.max(0, left);
  else style.right = Math.max(0, right);
  return style;
}
