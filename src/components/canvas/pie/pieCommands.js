/**
 * The pie machine's commands that reach outside the store (P5.02b): camera
 * framing, the carousel Swap and resets of state that still lives in NodeCanvas.
 * Moved verbatim from NodeCanvas, which registers a handler that calls this with
 * its current setters and values.
 */
import { getNodeDimensions } from '../../../utils.js';
import { closePieMenuColorPicker } from '../colorPickers/colorPickers.js';

/** Run one `frame`, `graph` or `local` command from the pie machine. */
export function handlePieCommandWith(ctx, cmd) {
  const {
    focusNodeInView, storeActions, setEditingGroupId, setTempGroupName, setPlusSign, selectionStartRef,
    setSelectionStart, setDrawingConnectionFrom,
    setCarouselFocusedNodeScale, setCarouselFocusedNodeDimensions, setCarouselFocusedNode,
    setAbstractionControlPanelVisible, setAbstractionControlPanelShouldShow, setNodeControlPanelVisible,
    setConnectionControlPanelVisible, setGroupControlPanelVisible, setCarouselFocusPrototypeRequest,
  } = ctx;
  if (cmd.type === 'frame') {
    // Only the return to the carousel's node so far. The other kinds still come
    // from NodeCanvas's own framing effects until later steps remove them.
    if (cmd.kind === 'returnFocus' && cmd.nodeId) focusNodeInView(cmd.nodeId);
    return;
  }
  if (cmd.type === 'graph' && cmd.action === 'applyCarouselSwap') {
    const { swap, graphId } = cmd.args;
    if (swap) {
      const { originalNodeId, originalInstance, focusedPrototypeId, newPrototype } = swap;

      // Calculate original dimensions before the swap
      const originalDimensions = getNodeDimensions(originalInstance, false, null);

      // Create a temporary node with the new prototype to calculate new dimensions
      const tempNodeWithNewPrototype = {
        ...originalInstance,
        prototypeId: focusedPrototypeId,
        name: newPrototype?.name || originalInstance.name,
        color: newPrototype?.color || originalInstance.color,
        thumbnailSrc: newPrototype?.thumbnailSrc || originalInstance.thumbnailSrc,
        definitionGraphIds: newPrototype?.definitionGraphIds || []
      };
      const newDimensions = getNodeDimensions(tempNodeWithNewPrototype, false, null);

      // Calculate the center point of the original node
      const originalCenterX = originalInstance.x + (originalDimensions.currentWidth / 2);
      const originalCenterY = originalInstance.y + (originalDimensions.currentHeight / 2);

      // Calculate new position to keep the same center point
      const newX = originalCenterX - (newDimensions.currentWidth / 2);
      const newY = originalCenterY - (newDimensions.currentHeight / 2);

      console.log(`[NodeCanvas] Adjusting position for dimension change:`, {
        originalPos: { x: originalInstance.x, y: originalInstance.y },
        originalDims: { w: originalDimensions.currentWidth, h: originalDimensions.currentHeight },
        newDims: { w: newDimensions.currentWidth, h: newDimensions.currentHeight },
        newPos: { x: newX, y: newY }
      });

      // Update the instance to use the focused node's prototype and adjust position
      storeActions.updateNodeInstance(graphId, originalNodeId, (instance) => {
        instance.prototypeId = focusedPrototypeId;
        instance.x = newX;
        instance.y = newY;
      }, { finalize: true });
    }
    return;
  }
  if (cmd.type !== 'local') return;
  switch (cmd.action) {
    case 'fullReset':
      setEditingGroupId(null);
      setTempGroupName('');
      setPlusSign(null);
      selectionStartRef.current = null; // a pending marquee pass must not outlive the graph
      setSelectionStart(null);
      setDrawingConnectionFrom(null);
      closePieMenuColorPicker();
      setCarouselFocusedNodeScale(1.2);
      setCarouselFocusedNodeDimensions(null);
      setCarouselFocusedNode(null);
      setAbstractionControlPanelVisible(false);
      setAbstractionControlPanelShouldShow(false);
      break;
    case 'closeAllPanels':
      setNodeControlPanelVisible(false);
      setConnectionControlPanelVisible(false);
      setAbstractionControlPanelVisible(false);
      setGroupControlPanelVisible(false);
      break;
    case 'closePieColorPicker':
      closePieMenuColorPicker();
      break;
    case 'clearCarouselFocus':
      setCarouselFocusedNode(null);
      setCarouselFocusedNodeDimensions(null);
      break;
    case 'carouselFocusPrototypeRequest':
      setCarouselFocusPrototypeRequest(cmd.args?.prototypeId ?? null);
      break;
    default:
      break;
  }
}
