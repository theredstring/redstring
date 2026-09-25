/**
 * The plus sign turning into a Thing (moved verbatim from NodeCanvas): the morph
 * finishing, and the session-only video effect finishing.
 */
import { v4 as uuidv4 } from 'uuid';
import { getNodeDimensions } from '../../../utils.js';

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
