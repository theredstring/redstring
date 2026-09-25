import { getNodeDimensions } from '../../../utils.js';
/**
 * Back to Civilization (moved verbatim from NodeCanvas): which nodes count as
 * "the content", and whether none of them is on screen.
 */

/** True when none of the relevant nodes is on screen. */
export function computeShouldShowBackToCivilization(ctx) {
  const {
    isInitialLoadComplete, isUniverseLoaded, hasUniverseFile, activeGraphId, isViewReady, nodeNamePrompt,
    connectionNamePrompt, abstractionPrompt, abstractionCarouselVisible, selectedNodeIdForPieMenu, plusSign,
    draggingNodeInfo, drawingConnectionFrom, isPanning, selectionStart, nodes,
    relevantNodesVisibleInStrictViewport,
  } = ctx;
  // Only show if:
  // 1. Initial load is complete (startup delay)
  // 2. Universe is loaded and has a file
  // 3. There's an active graph
  // 4. View is ready (pan/zoom initialized)
  // 5. No nodes are visible in strict viewport
  // 6. There are actually nodes in the graph (just not visible)
  // 7. No UI overlays are active (pie menu, carousels, prompts, etc.)

  if (!isInitialLoadComplete || !isUniverseLoaded || !hasUniverseFile || !activeGraphId || !isViewReady) {
    return false;
  }

  // Don't show if any prompts or overlays are visible
  if (nodeNamePrompt.visible || connectionNamePrompt.visible || abstractionPrompt.visible ||
    abstractionCarouselVisible || selectedNodeIdForPieMenu || plusSign) {
    return false;
  }

  // Don't show if dragging or other interactions are active
  if (draggingNodeInfo || drawingConnectionFrom || isPanning || selectionStart) {
    return false;
  }

  // Check if there are nodes in the graph but none are visible in strict viewport
  // Use cluster-aware visibility if clustering is enabled
  const hasNodesInGraph = nodes && nodes.length > 0;
  const hasNoVisibleNodesInViewport = !relevantNodesVisibleInStrictViewport;

  return hasNodesInGraph && hasNoVisibleNodesInViewport;
}

/** Which of the relevant nodes are inside the strict viewport. */
export function computeRelevantNodesVisible(ctx) {
  const {
    enableClustering, clusterAnalysis, nodes, panOffset, zoomLevel, viewportSize, canvasSize, baseDimsById,
  } = ctx;
  const nodesToCheck = enableClustering && clusterAnalysis.mainCluster && clusterAnalysis.mainCluster.length > 0
    ? clusterAnalysis.mainCluster
    : nodes;

  if (!nodesToCheck || nodesToCheck.length === 0 || !panOffset || !zoomLevel || !viewportSize || !canvasSize) {
    return false;
  }

  // Calculate strict viewport bounds in canvas coordinates
  const viewportMinX = (-panOffset.x) / zoomLevel + canvasSize.offsetX;
  const viewportMinY = (-panOffset.y) / zoomLevel + canvasSize.offsetY;
  const viewportMaxX = viewportMinX + viewportSize.width / zoomLevel;
  const viewportMaxY = viewportMinY + viewportSize.height / zoomLevel;

  // Check if any relevant node intersects with the strict viewport
  for (const node of nodesToCheck) {
    const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
    const nodeLeft = node.x;
    const nodeTop = node.y;
    const nodeRight = node.x + dims.currentWidth;
    const nodeBottom = node.y + dims.currentHeight;

    // Check if node intersects with strict viewport
    const intersects = !(nodeRight < viewportMinX || nodeLeft > viewportMaxX ||
      nodeBottom < viewportMinY || nodeTop > viewportMaxY);

    if (intersects) {
      return true; // At least one relevant node is visible
    }
  }

  return false; // No relevant nodes are visible
}
