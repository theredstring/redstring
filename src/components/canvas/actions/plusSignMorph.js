/**
 * The plus sign turning into a Thing (moved verbatim from NodeCanvas): the morph
 * finishing, and the session-only video effect finishing.
 */
import { v4 as uuidv4 } from 'uuid';
import { getNodeDimensions } from '../../../utils.js';
import { findGroupDropTarget, groupDropDialogFor } from '../groups/groupDropTarget.js';
import { setAddToGroupDialog } from '../dialogs/canvasDialogs.js';

/** The plus sign has finished morphing: create or place the Thing it became. */
export function finishPlusSignMorph(ctx) {
  const { plusSign, activeGraphId, getPlusSignMorphTarget, storeActions, setPlusSign } = ctx;
  if (!plusSign || !activeGraphId) return;

  // Same target the morph animated to, so the node lands exactly under it.
  const { dims, center } = getPlusSignMorphTarget(plusSign);
  const position = {
    x: center.x - dims.currentWidth / 2,
    y: center.y - dims.currentHeight / 2,
  };

  const newInstanceId = uuidv4();
  let added = false;
  if (plusSign.selectedPrototype) {
    // A prototype was selected from the grid - create instance of existing prototype
    storeActions.addNodeInstance(activeGraphId, plusSign.selectedPrototype.id, position, newInstanceId);
    added = true;
  } else if (plusSign.tempName) {
    // A custom name was entered - create new prototype
    const name = plusSign.tempName;
    const newPrototypeId = uuidv4();

    // 1. Create the new prototype
    const newPrototypeData = {
      id: newPrototypeId,
      name: name,
      description: '',
      color: plusSign.selectedColor || 'maroon', // Use selected color or default
      definitionGraphIds: [],
      typeNodeId: 'base-thing-prototype', // Type all new nodes as "Thing"
    };
    storeActions.addNodePrototype(newPrototypeData);

    // 2. Create the first instance of this prototype on the canvas
    storeActions.addNodeInstance(activeGraphId, newPrototypeId, position, newInstanceId);
    added = true;
  }

  setPlusSign(added ? { ...plusSign, mode: 'landed', landedInstanceId: newInstanceId } : null);
  if (added) offerGroupForLandedThing(ctx, newInstanceId, center);
}

// A Thing made inside a group gets the same "Add to group?" a Thing dragged to
// that point would. If the drop test misses but the plus sign was opened on a
// node-group's interior (its border strip is wider than the drop margin), that
// group is still the one the user clicked into.
function offerGroupForLandedThing(ctx, newInstanceId, center) {
  const { plusSign, nodes, groupStructure, gridSize } = ctx;
  const groupsById = groupStructure?.groupsById;
  if (!groupsById?.size) return;
  const targetGroup = findGroupDropTarget({
    point: center, excludeNodeId: newInstanceId, groups: Array.from(groupsById.values()),
    nodes, groupDepths: groupStructure.groupDepths, gridSize,
  }) || (plusSign.groupInteriorId ? groupsById.get(plusSign.groupInteriorId) : null);
  if (!targetGroup) return;
  const position = plusSign.clientX != null ? { x: plusSign.clientX, y: plusSign.clientY } : undefined;
  setAddToGroupDialog(groupDropDialogFor(targetGroup, [newInstanceId], groupStructure.parentGroupIds, position));
}

/** The Y-key video animation has finished. */
export function finishVideoAnimation(ctx) {
  const { videoAnimation, activeGraphId, gridMode, snapToGridAnimated, storeActions, setVideoAnimation } = ctx;
  if (!videoAnimation || !activeGraphId) return;

  // Calculate position (centered)
  const mockNode = { name: "Hello, World" };
  const dims = getNodeDimensions(mockNode, false, null);
  const position = {
    x: videoAnimation.x - dims.currentWidth / 2,
    y: videoAnimation.y - dims.currentHeight / 2
  };

  // Apply smooth grid snapping when creating new nodes if grid is enabled
  if (gridMode !== 'off') {
    const snapped = snapToGridAnimated(videoAnimation.x, videoAnimation.y, dims.currentWidth, dims.currentHeight, null);
    position.x = snapped.x;
    position.y = snapped.y;
  }

  // Create node prototype and instance
  const newPrototypeId = uuidv4();
  storeActions.addNodePrototype({
    id: newPrototypeId,
    name: "Hello, World",
    description: '',
    color: 'maroon',
    definitionGraphIds: [],
    typeNodeId: 'base-thing-prototype'
  });
  storeActions.addNodeInstance(activeGraphId, newPrototypeId, position);

  setVideoAnimation(null);
}
