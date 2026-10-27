/**
 * Where a connection ends on a Thing-group's title pill.
 *
 * A straight connection's arrowhead is placed from the box it ends on with its
 * front half past the box's edge (straightArrowHeads), which a node's own body
 * covers. The pill is filled edge to edge and drawn above connections, so the
 * same placement put the front of the arrow, and the hover dot on the edge,
 * under the title. So a connection ends on the pill grown by that overshoot:
 * the arrow tip, its stroke and the hover dot all land outside the title, and
 * the line stops short of it on hover and on an arrow end.
 */
import { POLY_TIP } from './edgeRouting.js';
import { STRAIGHT_ARROW_OFFSET, VISUAL_INSET } from './nodeHitbox.js';
import { CONNECTION_WIDTH_BASE_SCALE } from '../../constants.js';

/**
 * The box a connection ends on for a title pill at (x, y, width, height), as
 * an anchorPositions record's `end` ({ x, y, width, height }). Same centre.
 * `textSettings` sets the arrowhead's size (connectionWidth).
 */
export function anchorPillEndBox(x, y, width, height, textSettings) {
  const cw = (textSettings?.connectionWidth ?? 1.0) * CONNECTION_WIDTH_BASE_SCALE;
  // The tip overshoots the box by POLY_TIP less the arrow's offset back off it
  // (shortest on a side-on hit, 0.6 of it), plus half the arrow's stroke; and
  // getNodeHitbox reads VISUAL_INSET in from the box, so add that back too.
  const grow = POLY_TIP * cw - STRAIGHT_ARROW_OFFSET * 0.6 + 3 * cw + VISUAL_INSET;
  return { x: x - grow, y: y - grow, width: width + grow * 2, height: height + grow * 2 };
}

/** The box a connection ends on for an anchorPositions record: its `end`, else the record. */
export const anchorEndBox = (info) => info?.end || info;
