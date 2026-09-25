import { useEffect, useMemo, useState } from 'react';
import { HEADER_HEIGHT, EXCLUSIVE_PANEL_MODE_THRESHOLD } from '../constants';
import { getAppViewportSize } from '../utils/appViewport.js';
import { useMobileLandscapeShell } from './useMobileLandscapeShell.js';
import useCanvasUIStore from '../store/canvasUIStore.js';

/**
 * Computes the central usable viewport bounds by subtracting left/right panel widths
 * and the bottom TypeList bar from window dimensions.
 * Accounts for collapsed panels by using 0 width when panels are not expanded.
 * Includes space for resizer handles when panels are expanded.
 *
 * In exclusive panel mode (narrow viewport — see EXCLUSIVE_PANEL_MODE_THRESHOLD),
 * panels render as fixed overlays on top of the canvas rather than as flex
 * siblings, so their widths must NOT be subtracted from the usable viewport.
 *
 * Listens to window resize; the panel widths are canvasUIStore's committed
 * widths (P2.12), which PanelResizers keeps in step with panelWidthChanged.
 */
export const useViewportBounds = (leftExpanded = true, rightExpanded = true, typeListVisible = false) => {
  // The committed panel widths, from canvasUIStore (P2.12). Updated when a
  // resize ends, not per drag frame, so consumers don't re-render mid-drag.
  // (This hook kept its own copy with a 280 px fallback, 30 px wider than the
  // panels' real 250 on a fresh profile: B-15.)
  const leftWidth = useCanvasUIStore(s => s.leftPanelWidth);
  const rightWidth = useCanvasUIStore(s => s.rightPanelWidth);
  // The padded app box, not the raw window — see utils/appViewport.js.
  const [windowSize, setWindowSize] = useState(() => {
    const { width, height } = getAppViewportSize();
    return { w: width, h: height };
  });
  
  // In the fullscreen landscape shell there is no header bar, so the canvas
  // starts at the top of the app box rather than below one.
  const mobileLandscapeShell = useMobileLandscapeShell();
  const headerHeight = mobileLandscapeShell ? 0 : HEADER_HEIGHT;

  // TypeList height - only reserve space when it's actually visible
  const typeListHeight = typeListVisible ? HEADER_HEIGHT : 0;
  
  // Resizer handle space (12px offset from PanelResizerHandle)
  const resizerHandleSpace = 12;

  useEffect(() => {
    const onResize = () => {
      const { width, height } = getAppViewportSize();
      setWindowSize({ w: width, h: height });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const bounds = useMemo(() => {
    const isExclusiveMode = windowSize.w <= EXCLUSIVE_PANEL_MODE_THRESHOLD;
    // In exclusive (mobile-style) mode, panels overlay the canvas rather than
    // displacing it, so the usable viewport spans the full window width.
    const effectiveLeftWidth = isExclusiveMode ? 0 : (leftExpanded ? leftWidth : 0);
    const effectiveRightWidth = isExclusiveMode ? 0 : (rightExpanded ? rightWidth : 0);

    // In flexbox layout, the canvas area starts immediately after the left panel
    // and extends to the right panel, with no additional margins
    const x = effectiveLeftWidth;
    const y = headerHeight; // The header is at 0,0, so canvas starts at headerHeight
    const width = windowSize.w - effectiveLeftWidth - effectiveRightWidth;
    const height = windowSize.h - headerHeight - typeListHeight;

    return {
      x,
      y,
      width,
      height,
      leftWidth: effectiveLeftWidth,
      rightWidth: effectiveRightWidth,
      windowWidth: windowSize.w,
      windowHeight: windowSize.h,
      bottomReserved: typeListHeight,
      leftHandleSpace: 0, // No handle space needed in flexbox layout
      rightHandleSpace: 0,
      isExclusiveMode
    };
  }, [leftWidth, rightWidth, windowSize, typeListHeight, headerHeight, leftExpanded, rightExpanded]);

  return bounds;
};

export default useViewportBounds;


