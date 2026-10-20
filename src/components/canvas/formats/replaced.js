/**
 * What formats replace in the active web: the Things (and groups) a format draws
 * its own way (a formula's terms, its operations' Things, its parts), so no
 * input path hits them. They aren't drawn; this keeps them from being clicked,
 * hovered, dropped on or swept up in a selection box where they used to be.
 *
 * The format itself is there for input in their place, the way a node group's
 * title is: each is held by its group's anchor (the instance connections to
 * the group attach to), with the box it is drawn in, so a connection can be
 * drawn from it and dropped on it (`anchorBoxOf`, `formatAnchorAt`).
 *
 * Written by whatever works out the formats (formulaObjects.computeFormulaObjects,
 * which runs on every store change through the canvas's own subscription), read
 * by the hit tests (utils/canvas/geometryUtils, canvasHitTest), the connection
 * draw (input/pointerHandlers, input/connectionDraw, ConnectionDrawOverlay) and
 * the drag's connection updater (useNodeDrag), which draws a connection into a
 * replaced Thing to its stand-in. No imports, so those can read it without
 * pulling the stores in.
 */
const NONE = new Set();
const NO_STAND_INS = new Map();
let instanceIds = NONE;
let groupIds = NONE;
let standIns = NO_STAND_INS;
let anchors = NO_STAND_INS;

/**
 * @param {Set<string>} nextInstanceIds - replaced instances
 * @param {Set<string>} nextGroupIds - replaced groups
 * @param {Map<string, {x, y, w, h, rideOn}>} [nextStandIns] - where a replaced
 *   instance is drawn instead (its token), and which instance's drag moves
 *   that drawing (`rideOn`), so a connection into it is drawn there mid-drag too
 * @param {Map<string, {x, y, w, h, groupId}>} [nextAnchors] - each format by its
 *   group's anchor: the box it is drawn in, the whole of it a connection's end
 */
export function setReplaced(nextInstanceIds, nextGroupIds, nextStandIns, nextAnchors) {
  instanceIds = nextInstanceIds?.size ? nextInstanceIds : NONE;
  groupIds = nextGroupIds?.size ? nextGroupIds : NONE;
  standIns = nextStandIns?.size ? nextStandIns : NO_STAND_INS;
  anchors = nextAnchors?.size ? nextAnchors : NO_STAND_INS;
}

/**
 * Where a group's anchor is on canvas, as a node group's title pill is
 * ({ x, y, width, height }): the format drawn for it, else the pill from
 * `titleRects` (NodeCanvas's anchorPositionUpdatesRef), else null.
 */
export function anchorBoxOf(anchorId, titleRects) {
  const format = anchors.get(anchorId);
  if (format) return { x: format.x, y: format.y, width: format.w, height: format.h, groupId: format.groupId };
  return titleRects?.get(anchorId) || null;
}

/** The format at a canvas point, as its group's anchor: { anchorInstanceId, groupId }, or null. */
export function formatAnchorAt(canvasX, canvasY) {
  for (const [anchorInstanceId, b] of anchors) {
    if (canvasX >= b.x && canvasX <= b.x + b.w && canvasY >= b.y && canvasY <= b.y + b.h) {
      return { anchorInstanceId, groupId: b.groupId };
    }
  }
  return null;
}

/** The box each format is drawn in ({ x, y, w, h }): what a connection's label steers around in place of its Things. */
export const formatBoxes = () => [...anchors.values()];

/** Where a replaced instance is drawn instead, or null. */
export const standInFor = (id) => standIns.get(id) || null;

/** Whether an instance of the active web is replaced by a format. */
export const isReplacedInstance = (id) => instanceIds.has(id);
/** Whether a group of the active web is replaced by a format. */
export const isReplacedGroup = (id) => groupIds.has(id);
