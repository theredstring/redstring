/**
 * Per-web view persistence (moved verbatim from NodeCanvas): restoring the saved
 * pan and zoom when the active web changes, and saving them once the view
 * settles.
 */
import useGraphStore from '../../../store/graphStore.js';
import { MAX_ZOOM } from '../../../constants';
import { computeRelevantNodesVisible } from '../data/backToCivilization.js';
import { civilizationView } from './backToCivilization.js';

/** Restore the web's saved view, or centre it, when the active web changes (skipped mid-drag or mid-zoom).
 * Opening a web whose view would show none of its nodes (the view Back to
 * Civilization would appear over) lands on that button's framing instead,
 * before the first paint, so the empty view is never seen. */
export function restoreViewForGraph(ctx) {
  const {
    draggingNodeInfoRef, isAnimatingZoomRef, wasDraggingRef, setIsViewReady, activeGraphId, viewportSize,
    canvasSize, transform, nodes, baseDimsById, openedGraphRef,
  } = ctx;
  // If we're dragging a node or animating zoom, DO NOT restore view from store
  // This prevents the "teleportation" where store state overrides our local interaction state
  if (draggingNodeInfoRef.current || isAnimatingZoomRef.current || wasDraggingRef.current) {
    return;
  }

  setIsViewReady(false); // Set to not ready on graph change

  // Ensure we have valid sizes and an active graph
  if (activeGraphId && viewportSize.width > 0 && viewportSize.height > 0 && canvasSize.width > 0 && canvasSize.height > 0) {

    // Read graph data imperatively (not from deps) so store mutations don't re-trigger this effect
    const liveState = useGraphStore.getState();
    const graphData = liveState.graphs.get(activeGraphId);
    // Live viewport comes from the graphViews slice; the graph's own fields are
    // the fallback for a graph loaded from file whose camera hasn't moved yet.
    // See graphViews in graphStore for why the two are separate.
    const storedView = liveState.graphViews?.get(activeGraphId) || graphData;
    let view;

    if (storedView && storedView.panOffset && typeof storedView.zoomLevel === 'number') {
      // A view saved deeper than today's zoom ceiling comes back at the ceiling,
      // scaled about the viewport's centre so the same place stays in view.
      const { panOffset: savedPan, zoomLevel: savedZoom } = storedView;
      if (savedZoom > MAX_ZOOM) {
        const ratio = MAX_ZOOM / savedZoom;
        const cx = viewportSize.width / 2;
        const cy = viewportSize.height / 2;
        view = { pan: { x: cx - (cx - savedPan.x) * ratio, y: cy - (cy - savedPan.y) * ratio }, zoom: MAX_ZOOM };
      } else {
        view = { pan: savedPan, zoom: savedZoom };
      }
    } else {
      // No stored state, center the view as before

      // Target the center of the canvas
      const targetCanvasX = canvasSize.width / 2;
      const targetCanvasY = canvasSize.height / 2;

      // Use default zoom level
      const defaultZoom = 1;

      // Calculate pan needed to place targetCanvas coords at viewport center
      const initialPanX = viewportSize.width / 2 - targetCanvasX * defaultZoom;
      const initialPanY = viewportSize.height / 2 - targetCanvasY * defaultZoom;

      // Clamp the initial pan to valid bounds
      const maxX = 0;
      const maxY = 0;
      const minX = viewportSize.width - canvasSize.width * defaultZoom;
      const minY = viewportSize.height - canvasSize.height * defaultZoom;
      const clampedX = Math.min(Math.max(initialPanX, minX), maxX);
      const clampedY = Math.min(Math.max(initialPanY, minY), maxY);

      view = { pan: { x: clampedX, y: clampedY }, zoom: defaultZoom };
    }

    // Orient once per opening, so a resize later doesn't pull the camera off
    // empty space the user panned to on purpose.
    const justOpened = openedGraphRef.current !== activeGraphId;
    openedGraphRef.current = activeGraphId;
    if (justOpened && nodes.length > 0) {
      const anyNodeVisible = computeRelevantNodesVisible({
        enableClustering: false, nodes, panOffset: view.pan, zoomLevel: view.zoom, viewportSize, canvasSize, baseDimsById,
      });
      if (!anyNodeVisible) view = civilizationView({ nodes, baseDimsById, viewportSize, canvasSize });
    }

    // Apply the view immediately (jumpTo flushes settled state synchronously).
    transform.jumpTo(view.pan, view.zoom);

    // Set view to ready immediately - no delay
    setIsViewReady(true);

  } else if (!activeGraphId) {
    setIsViewReady(true); // No graph, so "ready" to show nothing
  }
}

/** Save the view once panning and zooming stop. */
export function saveViewWhenSettled(ctx) {
  const {
    activeGraphId, panOffset, zoomLevel, saveViewStateTimeout, pinchRef, draggingNodeInfo,
    isAnimatingZoomRef, isPanningOrZooming, draggingNodeInfoRef, updateGraphViewInStore,
  } = ctx;
  if (activeGraphId && panOffset && zoomLevel) {
    // Clear any existing timeout
    if (saveViewStateTimeout.current) {
      clearTimeout(saveViewStateTimeout.current);
    }

    // Set a timeout to save after operations stop
    // Completely prevent store updates during active pinch operations to eliminate Panel jitter
    if (pinchRef.current.active) {
      // Don't save to store during active pinch - this prevents Panel re-renders
      return;
    }

    // CRITICAL: Don't save during node drag or drag zoom animations
    if (draggingNodeInfo || isAnimatingZoomRef.current) {
      return;
    }

    const saveDelay = 300; // Standard delay for non-pinch operations
    saveViewStateTimeout.current = setTimeout(() => {
      if (!isPanningOrZooming.current && !draggingNodeInfoRef.current && !isAnimatingZoomRef.current) {
        updateGraphViewInStore();
      } else {
      }
    }, saveDelay);
  }

  return () => {
    if (saveViewStateTimeout.current) {
      clearTimeout(saveViewStateTimeout.current);
    }
  };
}
