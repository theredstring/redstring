/**
 * A short cooldown after a node drag drops. Lifting a dragged node often
 * brushes the screen a second time, which otherwise reads as a tap and
 * selects whatever is under the finger: the node itself or a connection.
 * The drop is marked once per real release by useNodeDrag's handleDragEnd;
 * tap-select paths for nodes and connections skip while it is running.
 */
export const TAP_AFTER_DROP_MS = 300;

let lastDropAt = -Infinity;

export function markNodeDrop() {
  lastDropAt = performance.now();
}

export function isJustAfterNodeDrop() {
  return performance.now() - lastDropAt < TAP_AFTER_DROP_MS;
}
