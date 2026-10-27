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
 * @param {Map<string, {x, y, w, h, groupId, memberIds}>} [nextAnchors] - each format by its
 *   group's anchor: the box it is drawn in, the whole of it a connection's end,
 *   and the Things it draws (which move when it is dragged among a selection)
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

/**
 * One end of a connection on a replaced instance, as a group anchor's record
 * (anchorPositions: x, y, width, height, outerBounds, shellRect): its stand-in
 * (a token, or a formula's title), with the format's band as the box the
 * connection stops at and its arrowhead lands on, as a Thing-group's shell is.
 * `dx`/`dy`: how far a drag has carried it. Null when it isn't replaced.
 */
export function formatEndOf(id, dx = 0, dy = 0) {
  const s = standIns.get(id);
  if (!s) return null;
  const f = s.frame;
  return {
    x: s.x + dx, y: s.y + dy, width: s.w, height: s.h,
    outerBounds: f ? { x: f.x + dx, y: f.y + dy, width: f.w, height: f.h } : null,
    shellRect: f ? { x: f.x + dx, y: f.y + dy, w: f.w, h: f.h, r: f.r ?? 0 } : null,
  };
}

/**
 * The record a connection's end is drawn against, the one every reader takes
 * (the render, the drag, routing, label placement, the edge pie): a format's
 * (formatEndOf), else a group anchor's from `anchors` (anchorPositions), else
 * null for a plain node, drawn as itself.
 */
export function connectionEndInfo(node, anchors) {
  if (!node) return null;
  return formatEndOf(node.id) || (node.isGroupAnchor ? anchors?.get(node.id) || null : null);
}

/** The format whose group's anchor is `id` ({ x, y, w, h, groupId, memberIds }), or null. */
export const formatOfAnchor = (id) => anchors.get(id) || null;
/** The group a format is drawn for, if `id` is that group's anchor; else null. */
export const formatGroupOfAnchor = (id) => anchors.get(id)?.groupId || null;
/** A format's group's anchor, by its group id; else null. */
export function formatAnchorOfGroup(groupId) {
  if (!groupId) return null;
  for (const [anchorId, b] of anchors) if (b.groupId === groupId) return anchorId;
  return null;
}
/** Each format by its anchor: [anchorId, { x, y, w, h, groupId, memberIds }]. */
export const formatAnchorEntries = () => anchors.entries();

/** Whether an instance of the active web is replaced by a format. */
export const isReplacedInstance = (id) => instanceIds.has(id);
/** Whether a group of the active web is replaced by a format. */
export const isReplacedGroup = (id) => groupIds.has(id);
