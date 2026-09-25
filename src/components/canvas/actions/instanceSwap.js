/**
 * Swapping an instance onto another prototype, keeping its centre (moved
 * verbatim from NodeCanvas): the Swap prompt and the carousel both use it.
 */
import useGraphStore from '../../../store/graphStore.js';
import { getNodeDimensions } from '../../../utils.js';

/** Point `instanceId` at `newPrototypeId`, keeping the node's centre where it was. */
export function performInstanceSwapWith(ctx, instanceId, newPrototypeId) {
  const { nodes, activeGraphId, storeActions } = ctx;
  const instance = nodes.find(n => n.id === instanceId);
  if (!instance || !activeGraphId || !newPrototypeId) return;
  if (instance.prototypeId === newPrototypeId) return; // no-op
  // Read fresh from the store so a prototype created moments ago (new-Thing swap) resolves.
  const newPrototype = useGraphStore.getState().nodePrototypes.get(newPrototypeId);
  if (!newPrototype) return;

  const originalDimensions = getNodeDimensions(instance, false, null);
  const tempNodeWithNewPrototype = {
    ...instance,
    prototypeId: newPrototypeId,
    name: newPrototype.name || instance.name,
    color: newPrototype.color || instance.color,
    thumbnailSrc: newPrototype.thumbnailSrc || instance.thumbnailSrc,
    definitionGraphIds: newPrototype.definitionGraphIds || []
  };
  const newDimensions = getNodeDimensions(tempNodeWithNewPrototype, false, null);

  const centerX = instance.x + originalDimensions.currentWidth / 2;
  const centerY = instance.y + originalDimensions.currentHeight / 2;
  const newX = centerX - newDimensions.currentWidth / 2;
  const newY = centerY - newDimensions.currentHeight / 2;

  storeActions.updateNodeInstance(activeGraphId, instanceId, (inst) => {
    inst.prototypeId = newPrototypeId;
    inst.x = newX;
    inst.y = newY;
  }, { finalize: true });
}
