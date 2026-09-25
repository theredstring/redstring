/**
 * "Back to civilization": frame the nearest cluster when the view has wandered
 * off (moved verbatim from NodeCanvas's handleBackToCivilizationClick).
 * NodeCanvas passes the render values it used as `ctx`.
 */
import { MAX_ZOOM } from '../../../constants';
import { getNodeDimensions } from '../../../utils.js';

export function backToCivilization(ctx) {
  const {
    baseDimsById, canvasSize, clusterAnalysis, containerRef, draggingNodeInfoRef, enableClustering,
    isAnimatingZoomRef, nodes, transform, viewportSize,
  } = ctx;
  // Skip navigation during drag to prevent interference with drag zoom animation
  if (draggingNodeInfoRef.current || isAnimatingZoomRef.current) return;
  if (!nodes || nodes.length === 0 || !containerRef.current) return;

  // Determine which nodes to navigate to based on clustering settings
  const nodesToNavigateTo = enableClustering && clusterAnalysis.mainCluster && clusterAnalysis.mainCluster.length > 0
    ? clusterAnalysis.mainCluster
    : nodes;

  const navigationMode = enableClustering && clusterAnalysis.mainCluster
    ? 'main-cluster'
    : 'all-nodes';

  console.log('[BackToCivilization] Starting navigation...', {
    navigationMode,
    totalNodes: nodes.length,
    nodesToNavigate: nodesToNavigateTo.length,
    clusteringEnabled: enableClustering,
    outlierCount: clusterAnalysis.statistics?.outlierCount || 0
  });

  // Calculate bounding box of relevant nodes
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  nodesToNavigateTo.forEach(node => {
    const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + dims.currentWidth);
    maxY = Math.max(maxY, node.y + dims.currentHeight);
  });

  // Calculate the center of relevant nodes
  const nodesCenterX = (minX + maxX) / 2;
  const nodesCenterY = (minY + maxY) / 2;
  const nodesWidth = maxX - minX;
  const nodesHeight = maxY - minY;

  console.log('[BackToCivilization] Target area:', {
    center: { x: Math.round(nodesCenterX), y: Math.round(nodesCenterY) },
    size: { width: Math.round(nodesWidth), height: Math.round(nodesHeight) },
    bounds: { minX: Math.round(minX), minY: Math.round(minY), maxX: Math.round(maxX), maxY: Math.round(maxY) }
  });

  // Calculate appropriate zoom level with padding
  const padding = 150;
  const targetZoomX = viewportSize.width / (nodesWidth + padding * 2);
  const targetZoomY = viewportSize.height / (nodesHeight + padding * 2);
  let targetZoom = Math.min(targetZoomX, targetZoomY);

  // Clamp zoom to reasonable bounds
  targetZoom = Math.max(Math.min(targetZoom, MAX_ZOOM), 0.2);

  // Calculate pan to center the target area (accounting for canvas offset)
  const targetPanX = (viewportSize.width / 2) - (nodesCenterX - canvasSize.offsetX) * targetZoom;
  const targetPanY = (viewportSize.height / 2) - (nodesCenterY - canvasSize.offsetY) * targetZoom;

  // Apply bounds constraints
  const maxPanX = 0;
  const minPanX = viewportSize.width - canvasSize.width * targetZoom;
  const maxPanY = 0;
  const minPanY = viewportSize.height - canvasSize.height * targetZoom;

  const finalPanX = Math.min(Math.max(targetPanX, minPanX), maxPanX);
  const finalPanY = Math.min(Math.max(targetPanY, minPanY), maxPanY);

  console.log('[BackToCivilization] Applying navigation:', {
    targetZoom: Math.round(targetZoom * 1000) / 1000,
    finalPan: { x: Math.round(finalPanX), y: Math.round(finalPanY) }
  });

  // Apply the new view state
  transform.jumpTo({ x: finalPanX, y: finalPanY }, targetZoom);
}
