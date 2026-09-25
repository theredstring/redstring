/**
 * Keeps the browser from zooming the page (keyboard shortcuts, ctrl+wheel,
 * Safari gestures) so the canvas owns zoom. Moved verbatim from NodeCanvas.
 */

/** Attach the page-zoom guards; returns their cleanup. */
export function preventPageZoom(ctx) {
  const { trackpadZoomEnabled } = ctx;
  const preventPageZoom = (e) => {
    // Detect zoom keyboard shortcuts
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const isZoomKey = e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0';
    const isNumpadZoom = e.key === 'Add' || e.key === 'Subtract';

    // Prevent keyboard zoom shortcuts
    if (isCtrlOrCmd && (isZoomKey || isNumpadZoom)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Prevent F11 fullscreen (can interfere with zoom perception)
    if (e.key === 'F11') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  };

  const preventWheelZoom = (e) => {
    if (trackpadZoomEnabled) return;
    // Prevent Ctrl+wheel zoom (both Mac and Windows)
    if (e.ctrlKey || e.metaKey) {
      // Only prevent if this wheel event is NOT over our canvas or panel tab bar
      const isOverCanvas = e.target.closest('.canvas-area') || e.target.closest('.canvas');
      const isOverPanelTabBar = e.target.closest('[data-panel-tabs="true"]');
      if (!isOverCanvas && !isOverPanelTabBar) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  };

  const preventGestureZoom = (e) => {
    if (trackpadZoomEnabled) return;
    // Allow gestures within our canvas so we can handle them ourselves
    const isOverCanvas = e.target && (e.target.closest && (e.target.closest('.canvas-area') || e.target.closest('.canvas')));
    if (isOverCanvas) return; // let container-level handlers process
    // Prevent page-level gesture zoom elsewhere
    if (e.scale && e.scale !== 1) {
      e.preventDefault();
      try { e.stopPropagation(); } catch { }
      return false;
    }
  };

  // Add global event listeners
  document.addEventListener('keydown', preventPageZoom, { passive: false, capture: true });
  document.addEventListener('wheel', preventWheelZoom, { passive: false, capture: true });
  document.addEventListener('gesturestart', preventGestureZoom, { passive: false, capture: true });
  document.addEventListener('gesturechange', preventGestureZoom, { passive: false, capture: true });
  document.addEventListener('gestureend', preventGestureZoom, { passive: false, capture: true });

  return () => {
    document.removeEventListener('keydown', preventPageZoom, { capture: true });
    document.removeEventListener('wheel', preventWheelZoom, { capture: true });
    document.removeEventListener('gesturestart', preventGestureZoom, { capture: true });
    document.removeEventListener('gesturechange', preventGestureZoom, { capture: true });
    document.removeEventListener('gestureend', preventGestureZoom, { capture: true });
  };
}
