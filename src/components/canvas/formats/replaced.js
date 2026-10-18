/**
 * What formats replace in the active web: the Things (and groups) a format draws
 * its own way (a formula's terms, its operations' Things, its parts), so no
 * input path hits them. They aren't drawn; this keeps them from being clicked,
 * hovered, dropped on or swept up in a selection box where they used to be.
 *
 * Written by whatever works out the formats (formulaObjects.computeFormulaObjects,
 * which runs on every store change through the canvas's own subscription), read
 * by the hit tests (utils/canvas/geometryUtils, canvasHitTest). No imports, so
 * the hit tests can read it without pulling the stores in.
 */
const NONE = new Set();
let instanceIds = NONE;
let groupIds = NONE;

export function setReplaced(nextInstanceIds, nextGroupIds) {
  instanceIds = nextInstanceIds?.size ? nextInstanceIds : NONE;
  groupIds = nextGroupIds?.size ? nextGroupIds : NONE;
}

/** Whether an instance of the active web is replaced by a format. */
export const isReplacedInstance = (id) => instanceIds.has(id);
/** Whether a group of the active web is replaced by a format. */
export const isReplacedGroup = (id) => groupIds.has(id);
