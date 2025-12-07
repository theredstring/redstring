/**
 * Canvas Navigation Service
 * 
 * Provides a clean API for programmatic navigation of the canvas viewport.
 * Used by the Wizard and other systems to guide users to relevant content.
 * 
 * Navigation events are handled by NodeCanvas listeners.
 */

// Navigation modes
export const NavigationMode = {
  // Navigate to fit all content in view
  FIT_CONTENT: 'fit-content',
  // Navigate to specific nodes
  FOCUS_NODES: 'focus-nodes',
  // Navigate to specific coordinates
  COORDINATES: 'coordinates',
  // Navigate to center of canvas (origin)
  CENTER: 'center'
};

// Default navigation options
const DEFAULT_OPTIONS = {
  // Delay before navigating (ms) - allows content to render
  delay: 150,
  // Padding around content (px)
  padding: 100,
  // Maximum zoom level when focusing
  maxZoom: 1.5,
  // Minimum zoom level when fitting content
  minZoom: 0.3,
  // Whether navigation is "courteous" (deferred, gentle)
  courteous: true,
  // Graph ID to navigate within (defaults to active graph)
  graphId: null
};

/**
 * Dispatch a navigation event that NodeCanvas will handle
 */
function dispatchNavigationEvent(mode, options = {}) {
  const eventDetail = {
    mode,
    ...DEFAULT_OPTIONS,
    ...options,
    timestamp: Date.now()
  };

  // If delay is specified and courteous mode is on, use setTimeout
  const effectiveDelay = options.courteous !== false ? (options.delay || DEFAULT_OPTIONS.delay) : 0;

  if (effectiveDelay > 0) {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('rs-navigate-to', { detail: eventDetail }));
    }, effectiveDelay);
  } else {
    window.dispatchEvent(new CustomEvent('rs-navigate-to', { detail: eventDetail }));
  }
}

/**
 * Navigate to fit all content in the current graph
 * 
 * @param {Object} options - Navigation options
 * @param {number} options.padding - Padding around content
 * @param {number} options.delay - Delay before navigation
 * @param {string} options.graphId - Specific graph to navigate within
 */
export function navigateToFitContent(options = {}) {
  dispatchNavigationEvent(NavigationMode.FIT_CONTENT, options);
}

/**
 * Navigate to focus on specific nodes
 * 
 * @param {string|string[]} nodeIds - Node ID(s) to focus on
 * @param {Object} options - Navigation options
 */
export function navigateToNodes(nodeIds, options = {}) {
  const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
  if (ids.length === 0) {
    console.warn('[CanvasNav] navigateToNodes called with empty node list');
    return;
  }
  dispatchNavigationEvent(NavigationMode.FOCUS_NODES, {
    ...options,
    nodeIds: ids
  });
}

/**
 * Navigate to specific canvas coordinates
 * 
 * @param {number} x - X coordinate (canvas space)
 * @param {number} y - Y coordinate (canvas space)
 * @param {Object} options - Navigation options
 * @param {number} options.zoom - Target zoom level
 */
export function navigateToCoordinates(x, y, options = {}) {
  dispatchNavigationEvent(NavigationMode.COORDINATES, {
    ...options,
    targetX: x,
    targetY: y,
    targetZoom: options.zoom || 1
  });
}

/**
 * Navigate to canvas center (origin)
 * 
 * @param {Object} options - Navigation options
 */
export function navigateToCenter(options = {}) {
  dispatchNavigationEvent(NavigationMode.CENTER, options);
}

/**
 * Navigate after new content is created
 * This is the primary method for the Wizard to guide users after mutations
 * 
 * @param {Object} context - Context about what was created
 * @param {string[]} context.nodeIds - IDs of newly created nodes
 * @param {string} context.graphId - Graph where content was created
 * @param {string} context.action - What action was performed
 */
export function navigateAfterCreation(context = {}) {
  const { nodeIds, graphId, action } = context;

  // If we have specific new nodes, focus on them
  if (nodeIds && nodeIds.length > 0) {
    navigateToNodes(nodeIds, {
      graphId,
      delay: 200, // Slightly longer delay for new content to render
      padding: 150
    });
  } else {
    // Otherwise fit all content
    navigateToFitContent({
      graphId,
      delay: 200,
      padding: 150
    });
  }

  console.log('[CanvasNav] navigateAfterCreation:', { action, nodeCount: nodeIds?.length || 0, graphId });
}

/**
 * Navigate to show a newly switched-to graph
 * 
 * @param {string} graphId - The graph that was switched to
 */
export function navigateOnGraphSwitch(graphId) {
  navigateToFitContent({
    graphId,
    delay: 100,
    courteous: true
  });
  console.log('[CanvasNav] navigateOnGraphSwitch:', graphId);
}

/**
 * Navigate after layout is applied
 * 
 * @param {string} graphId - Graph that was laid out
 * @param {number} nodeCount - Number of nodes in layout
 */
export function navigateAfterLayout(graphId, nodeCount) {
  navigateToFitContent({
    graphId,
    delay: 100,
    padding: 150
  });
  console.log('[CanvasNav] navigateAfterLayout:', { graphId, nodeCount });
}

/**
 * Calculate navigation parameters to fit given bounds
 * This is a pure utility function used by NodeCanvas
 * 
 * @param {Object} bounds - Bounding box { minX, minY, maxX, maxY }
 * @param {Object} viewportSize - { width, height }
 * @param {Object} canvasSize - { width, height, offsetX, offsetY }
 * @param {Object} options - { padding, minZoom, maxZoom }
 * @returns {Object} { panX, panY, zoom }
 */
export function calculateNavigationParams(bounds, viewportSize, canvasSize, options = {}) {
  const { padding = 100, minZoom = 0.3, maxZoom = 1.5 } = options;

  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  const contentCenterX = (bounds.minX + bounds.maxX) / 2;
  const contentCenterY = (bounds.minY + bounds.maxY) / 2;

  // Calculate zoom to fit content with padding
  const targetZoomX = viewportSize.width / (contentWidth + padding * 2);
  const targetZoomY = viewportSize.height / (contentHeight + padding * 2);
  let targetZoom = Math.min(targetZoomX, targetZoomY);

  // Clamp zoom
  targetZoom = Math.max(Math.min(targetZoom, maxZoom), minZoom);

  // Calculate pan to center content
  const targetPanX = (viewportSize.width / 2) - (contentCenterX - canvasSize.offsetX) * targetZoom;
  const targetPanY = (viewportSize.height / 2) - (contentCenterY - canvasSize.offsetY) * targetZoom;

  // Apply bounds constraints
  const maxPanX = 0;
  const minPanX = viewportSize.width - canvasSize.width * targetZoom;
  const maxPanY = 0;
  const minPanY = viewportSize.height - canvasSize.height * targetZoom;

  return {
    panX: Math.min(Math.max(targetPanX, minPanX), maxPanX),
    panY: Math.min(Math.max(targetPanY, minPanY), maxPanY),
    zoom: targetZoom
  };
}

// Expose navigation utilities on window for debugging and cross-component access
if (typeof window !== 'undefined') {
  window.rsNavigate = {
    toFitContent: navigateToFitContent,
    toNodes: navigateToNodes,
    toCoordinates: navigateToCoordinates,
    toCenter: navigateToCenter,
    afterCreation: navigateAfterCreation,
    onGraphSwitch: navigateOnGraphSwitch,
    afterLayout: navigateAfterLayout,
    NavigationMode
  };
}

// Export all navigation utilities
export default {
  NavigationMode,
  navigateToFitContent,
  navigateToNodes,
  navigateToCoordinates,
  navigateToCenter,
  navigateAfterCreation,
  navigateOnGraphSwitch,
  navigateAfterLayout,
  calculateNavigationParams
};

