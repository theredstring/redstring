/**
 * What formats replace in the active web: the Things (and groups) a format draws
 * its own way (a formula's terms, its operations' Things, its parts), so no
 * input path hits them. They aren't drawn; this keeps them from being clicked,
 * hovered, dropped on or swept up in a selection box where they used to be.
 *
 * Written by whatever works out the formats (formulaObjects.computeFormulaObjects,
 * which runs on every store change through the canvas's own subscription), read
 * by the hit tests (utils/canvas/geometryUtils, canvasHitTest) and by the drag's
 * connection updater (useNodeDrag), which draws a connection into a replaced
 * Thing to its stand-in. No imports, so those can read it without pulling the
 * stores in.
 */
const NONE = new Set();
const NO_STAND_INS = new Map();
let instanceIds = NONE;
let groupIds = NONE;
let standIns = NO_STAND_INS;

/**
 * @param {Set<string>} nextInstanceIds - replaced instances
 * @param {Set<string>} nextGroupIds - replaced groups
 * @param {Map<string, {x, y, w, h, rideOn}>} [nextStandIns] - where a replaced
 *   instance is drawn instead (its token), and which instance's drag moves
 *   that drawing (`rideOn`), so a connection into it is drawn there mid-drag too
 */
export function setReplaced(nextInstanceIds, nextGroupIds, nextStandIns) {
  instanceIds = nextInstanceIds?.size ? nextInstanceIds : NONE;
  groupIds = nextGroupIds?.size ? nextGroupIds : NONE;
  standIns = nextStandIns?.size ? nextStandIns : NO_STAND_INS;
}

/** Where a replaced instance is drawn instead, or null. */
export const standInFor = (id) => standIns.get(id) || null;

/** Whether an instance of the active web is replaced by a format. */
export const isReplacedInstance = (id) => instanceIds.has(id);
/** Whether a group of the active web is replaced by a format. */
export const isReplacedGroup = (id) => groupIds.has(id);
