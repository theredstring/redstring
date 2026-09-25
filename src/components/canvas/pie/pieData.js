/**
 * Building the node pie's data (node, buttons, dimensions) for its target,
 * moved verbatim from NodeCanvas. Held while the menu shrinks or its node is
 * dragged, so the exit animation plays on what it was showing (P5.04a).
 */
import { getNodeDimensions } from '../../../utils.js';

/** Rebuild (or deliberately hold) the node pie's data. */
export function rebuildPieMenuDataWith(ctx) {
  const {
    selectedNodeIdForPieMenu, isTransitioningPieMenu, semanticOrbitActive, draggingNodeInfo, nodes,
    abstractionCarouselVisible, abstractionCarouselNode, carouselFocusedNodeDimensionsRef, previewingNodeId,
    setCurrentPieMenuData, targetPieMenuButtons, setIsPieMenuRendered,
  } = ctx;
  if (selectedNodeIdForPieMenu && !isTransitioningPieMenu && !semanticOrbitActive) {
    // If the pie-menu node is being lifted/dragged, FREEZE currentPieMenuData so the
    // shrink-out animation keeps playing from where the menu was. `nodes` is a dep of
    // this effect and the lift writes a LIFT_SCALE onto the node every frame, so without
    // this early return we'd rebuild the menu data mid-shrink and re-pop the bubbles.
    const isDraggingThisNode = draggingNodeInfo &&
      (draggingNodeInfo.primaryId === selectedNodeIdForPieMenu ||
       draggingNodeInfo.instanceId === selectedNodeIdForPieMenu);
    if (isDraggingThisNode) {
      return;
    }
    const node = nodes.find(n => n.id === selectedNodeIdForPieMenu);
    if (node) {
      // Check if we're in carousel mode and have dynamic dimensions
      const isInCarouselMode = abstractionCarouselVisible && abstractionCarouselNode && node.id === abstractionCarouselNode.id;

      // Use dynamic carousel dimensions if available, otherwise calculate from the actual node
      const carouselDims = carouselFocusedNodeDimensionsRef.current;
      const dimensions = isInCarouselMode && carouselDims
        ? carouselDims
        : getNodeDimensions(node, previewingNodeId === node.id, null);

      // In carousel mode, create a virtual node positioned at the carousel center
      // Keep the original node for PieMenu, but store focused node info for button actions
      let nodeForPieMenu = node;

      if (isInCarouselMode && abstractionCarouselNode) {
        // Calculate carousel center position in canvas coordinates
        const originalNodeDimensions = getNodeDimensions(abstractionCarouselNode, false, null);
        const carouselCenterX = abstractionCarouselNode.x + originalNodeDimensions.currentWidth / 2;
        const carouselCenterY = abstractionCarouselNode.y + originalNodeDimensions.currentHeight / 2; // Perfect center alignment

        // Create virtual node at carousel center
        nodeForPieMenu = {
          ...nodeForPieMenu,
          x: carouselCenterX - dimensions.currentWidth / 2,
          y: carouselCenterY - dimensions.currentHeight / 2
        };
      }

      setCurrentPieMenuData({
        node: nodeForPieMenu,
        buttons: targetPieMenuButtons,
        nodeDimensions: dimensions
      });
      setIsPieMenuRendered(true); // Ensure PieMenu is in DOM to animate in
    } else {
      setCurrentPieMenuData(null); // Keep this for safety if node genuinely disappears
      // isPieMenuRendered will be set to false by onExitAnimationComplete if it was visible
    }
  }
  // With no target, or mid-transition, currentPieMenuData is left alone: PieMenu needs it to
  // animate out (isVisible hides it), and onExitAnimationComplete nulls it.
}
