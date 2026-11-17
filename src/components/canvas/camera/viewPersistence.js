/**
 * Per-web view persistence (moved verbatim from NodeCanvas): restoring the saved
 * pan and zoom when the active web changes, and saving them once the view
 * settles.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import useGraphStore from '../../../store/graphStore.js';
import { MAX_ZOOM } from '../../../constants';
import { computeRelevantNodesVisible } from '../data/backToCivilization.js';
import { civilizationView } from './backToCivilization.js';

// Zoom ceiling when framing a web as it opens, so a web of one or two Things
// doesn't open at the deepest zoom.
const OPEN_FRAMING_MAX_ZOOM = 1;

/** Restore the web's view from this session when the active web changes (skipped mid-drag or mid-zoom).
 * Views are never saved with the universe (see graphViews in graphStore), so a
 * web first seen this session, and a web just added to the header
 * (`newlyOpenedRef`), opens framed on its largest cluster, the way Back to
 * Civilization frames it, zoomed in no further than OPEN_FRAMING_MAX_ZOOM.
 * So does a remembered view that would show none of its nodes, before the
 * first paint, so the empty view is never seen. */
export function restoreViewForGraph(ctx) {
  const {
    draggingNodeInfoRef, isAnimatingZoomRef, wasDraggingRef, setIsViewReady, activeGraphId, viewportSize,
    canvasSize, transform, nodes, baseDimsById, openedGraphRef, newlyOpenedRef, connections,
  } = ctx;
  // If we're dragging a node or animating zoom, DO NOT restore view from store
  // This prevents the "teleportation" where store state overrides our local interaction state
  if (draggingNodeInfoRef.current || isAnimatingZoomRef.current || wasDraggingRef.current) {
    return;
  }

  setIsViewReady(false); // Set to not ready on graph change

  // Ensure we have valid sizes and an active graph
  if (activeGraphId && viewportSize.width > 0 && viewportSize.height > 0 && canvasSize.width > 0 && canvasSize.height > 0) {

    // Read imperatively (not from deps) so store mutations don't re-trigger this effect.
    const storedView = useGraphStore.getState().graphViews?.get(activeGraphId);
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
    } else if (nodes.length > 0) {
      // No view this session: frame the largest cluster. Every time, not only
      // on opening: a resize before the first view is recorded must not drop
      // the camera on the empty middle of the canvas.
      view = civilizationView({ nodes, baseDimsById, viewportSize, canvasSize, connections, maxZoom: OPEN_FRAMING_MAX_ZOOM });
    } else {
      // An empty web: the middle of the canvas.

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
    const newlyOpened = justOpened && newlyOpenedRef?.current === activeGraphId;
    if (newlyOpened) newlyOpenedRef.current = null;
    if (justOpened && nodes.length > 0 && storedView) {
      if (newlyOpened) {
        view = civilizationView({ nodes, baseDimsById, viewportSize, canvasSize, connections, maxZoom: OPEN_FRAMING_MAX_ZOOM });
      } else {
        const anyNodeVisible = computeRelevantNodesVisible({
          enableClustering: false, nodes, panOffset: view.pan, zoomLevel: view.zoom, viewportSize, canvasSize, baseDimsById,
        });
        if (!anyNodeVisible) view = civilizationView({ nodes, baseDimsById, viewportSize, canvasSize, connections });
      }
    }

    // Apply the view immediately (jumpTo flushes settled state synchronously).
    transform.jumpTo(view.pan, view.zoom);

    // Set view to ready immediately - no delay
    setIsViewReady(true);

  } else if (!activeGraphId) {
    setIsViewReady(true); // No graph, so "ready" to show nothing
  }
}

/** The web that just became active by being added to the header (the plus
 * sign, opening a web from a panel), as opposed to switching to a tab already
 * there or loading a universe. Read once by restoreViewForGraph. */
export function watchNewlyOpenedWeb(newlyOpenedRef) {
  return useGraphStore.subscribe((state, prev) => {
    if (state.activeGraphId === prev.activeGraphId || !state.activeGraphId) return;
    if (prev._isLoadingUniverse || prev.openGraphIds?.includes(state.activeGraphId)) return;
    newlyOpenedRef.current = state.activeGraphId;
  });
}

/** Restore (or orient) the view on graph change. Does NOT depend on graphsMap or nodes, so graph mutations never snap the view back. */
export function useViewRestore(ctx) {
  const openedGraphRef = useRef(null); // the web the last restore opened, so orienting happens once per opening
  const newlyOpenedRef = useRef(null);
  useEffect(() => watchNewlyOpenedWeb(newlyOpenedRef), []);
  useLayoutEffect(() => restoreViewForGraph({ ...ctx, openedGraphRef, newlyOpenedRef }),
    [ctx.activeGraphId, ctx.viewportSize, ctx.canvasSize]);
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
