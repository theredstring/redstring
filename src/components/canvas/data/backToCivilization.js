import { getNodeDimensions } from '../../../utils.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { analyzeNodeDistribution } from '../../../utils/clusterAnalysis.js';
import { backToCivilization } from '../camera/backToCivilization.js';
import { MAX_ZOOM } from '../../../constants';
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

/** Back to Civilization: when the button shows (after the startup and appearance delays), the optional cluster analysis it aims at, and the click (moved verbatim from NodeCanvas, wave 6). */
export function useBackToCivilization({
  transform, // the settled view, and the camera the click animates
  nodeDrag, // the drag in flight (hide while dragging; don't fly mid-drag)
  // NodeCanvas state that hides the button while the user is busy.
  canvasState, // { isViewReady, isPanning, selectionStart, drawingConnectionFrom, plusSign }
  baseDimsById, canvasSize, containerRef, nodes, viewportSize,
}) {
  const { settledPan: panOffset, settledZoom: zoomLevel } = transform;
  const { draggingNodeInfo, draggingNodeInfoRef, isAnimatingZoomRef } = nodeDrag;
  const { isViewReady, isPanning, selectionStart, drawingConnectionFrom, plusSign } = canvasState;
  // Store-backed inputs, subscribed here with NodeCanvas's selectors (P4).
  const activeGraphId = useGraphStore(state => state.activeGraphId);
  const hasUniverseFile = useGraphStore(state => state.hasUniverseFile);
  const isUniverseLoaded = useGraphStore(state => state.isUniverseLoaded);
  const abstractionCarouselVisible = useCanvasUIStore(s => s.abstractionCarouselVisible);
  const abstractionPrompt = useCanvasUIStore(s => s.abstractionPrompt);
  const connectionNamePrompt = useCanvasUIStore(s => s.connectionNamePrompt);
  const nodeNamePrompt = useCanvasUIStore(s => s.nodeNamePrompt);
  const selectedNodeIdForPieMenu = useCanvasUIStore(s => s.selectedNodeIdForPieMenu);
  // Track if the component has been mounted long enough to show BackToCivilization
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [backToCivilizationDelayComplete, setBackToCivilizationDelayComplete] = useState(false);

  // Add startup delay to prevent showing during initial load
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitialLoadComplete(true);
    }, 2000); // 2 second delay after mount

    return () => clearTimeout(timer);
  }, []);

  // Optional clustering feature - disabled by default to avoid computational overhead
  const [enableClustering, setEnableClustering] = useState(false);

  // Cluster analysis for the current graph (only when enabled)
  const clusterAnalysis = useMemo(() => {
    if (!enableClustering || !nodes || nodes.length === 0) {
      return { clusters: [], outliers: [], mainCluster: null, statistics: {}, civilizationCenter: null };
    }

    return analyzeNodeDistribution(
      nodes,
      (node) => baseDimsById.get(node.id) || getNodeDimensions(node, false, null),
      {
        adaptiveEpsilon: true,
        minPoints: 2
      }
    );
  }, [enableClustering, nodes, baseDimsById]);

  // Calculate if relevant nodes are visible in strict viewport
  // Uses main cluster if clustering is enabled, otherwise all nodes
  const relevantNodesVisibleInStrictViewport = useMemo(() => computeRelevantNodesVisible({
    enableClustering, clusterAnalysis, nodes, panOffset, zoomLevel, viewportSize, canvasSize, baseDimsById,
  }), [enableClustering, clusterAnalysis.mainCluster, nodes, panOffset, zoomLevel, viewportSize, canvasSize, baseDimsById]);

  // Determine if BackToCivilization should be shown
  const shouldShowBackToCivilization = useMemo(() => computeShouldShowBackToCivilization({
    isInitialLoadComplete, isUniverseLoaded, hasUniverseFile, activeGraphId, isViewReady, nodeNamePrompt,
    connectionNamePrompt, abstractionPrompt, abstractionCarouselVisible, selectedNodeIdForPieMenu, plusSign,
    draggingNodeInfo, drawingConnectionFrom, isPanning, selectionStart, nodes,
    relevantNodesVisibleInStrictViewport,
  }), [isInitialLoadComplete, isUniverseLoaded, hasUniverseFile, activeGraphId, isViewReady, nodes, relevantNodesVisibleInStrictViewport, nodeNamePrompt.visible, connectionNamePrompt.visible, abstractionPrompt.visible, abstractionCarouselVisible, selectedNodeIdForPieMenu, plusSign, draggingNodeInfo, drawingConnectionFrom, isPanning, selectionStart]);

  // Expose clustering functions to window for manual use (for debugging/testing)
  useEffect(() => {
    // Expose clustering functions for other parts of the codebase
    window.enableNodeClustering = () => setEnableClustering(true);
    window.disableNodeClustering = () => setEnableClustering(false);
    window.getClusterAnalysis = () => clusterAnalysis;
    window.isClusteringEnabled = () => enableClustering;

    return () => {
      delete window.enableNodeClustering;
      delete window.disableNodeClustering;
      delete window.getClusterAnalysis;
      delete window.isClusteringEnabled;
    };
  }, [clusterAnalysis, enableClustering]);

  // Add appearance delay when conditions are met
  useEffect(() => {
    if (shouldShowBackToCivilization) {
      setBackToCivilizationDelayComplete(false);
      const timer = setTimeout(() => {
        setBackToCivilizationDelayComplete(true);
      }, 800); // 800ms delay before appearing

      return () => clearTimeout(timer);
    } else {
      setBackToCivilizationDelayComplete(false);
    }
  }, [shouldShowBackToCivilization]);

  // Handler for BackToCivilization click - center view on relevant nodes
  const handleBackToCivilizationClick = useCallback(() => backToCivilization({
    baseDimsById, canvasSize, clusterAnalysis, containerRef, draggingNodeInfoRef, enableClustering,
    isAnimatingZoomRef, nodes, transform, viewportSize,
  }), [enableClustering, clusterAnalysis, nodes, baseDimsById, viewportSize, canvasSize, MAX_ZOOM]);

  return { backToCivilizationDelayComplete, enableClustering, clusterAnalysis, shouldShowBackToCivilization, handleBackToCivilizationClick };
}
