/**
 * A Thing's size (instance.sizeMul, the node pie's Size) changed where it
 * stands: its middle stays put and it grows or shrinks around it. The
 * instance's x/y is its top-left corner, so it moves by half the change; Node
 * animates that move along with the box (useCentredResize).
 */
import useGraphStore from '../../../store/graphStore.js';
import { getNodeDimensions } from '../../../utils.js';

/**
 * @param {string} graphId
 * @param {object} node - the hydrated node, as the canvas measures it
 * @param {number} sizeMul - the new size
 */
export function resizeNodeInPlace(graphId, node, sizeMul) {
  const before = getNodeDimensions(node, false, null);
  const after = getNodeDimensions({ ...node, sizeMul }, false, null);
  const dx = (after.currentWidth - before.currentWidth) / 2;
  const dy = (after.currentHeight - before.currentHeight) / 2;
  useGraphStore.getState().updateNodeInstance(graphId, node.id, (inst) => {
    inst.sizeMul = sizeMul;
    inst.x = (inst.x ?? 0) - dx;
    inst.y = (inst.y ?? 0) - dy;
  }, { type: 'node_resize', finalize: true });
}
