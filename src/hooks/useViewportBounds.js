import { useEffect, useMemo, useState } from 'react';
import { HEADER_HEIGHT } from '../constants';

/**
 * Computes the central usable viewport bounds by subtracting left/right panel widths
 * and the bottom TypeList bar from window dimensions.
 * Accounts for collapsed panels by using 0 width when panels are not expanded.
 * Includes space for resizer handles when panels are expanded.
 *
 * Listens to window resize and custom panel events:
 *  - panelWidthChanging, panelWidthChanged
 * Also reads persisted widths from localStorage on mount for initial render.
 */
export const useViewportBounds = (leftExpanded = true, rightExpanded = true, typeListVisible = false) => {
  const readPersistedWidth = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
  };

  const [leftWidth, setLeftWidth] = useState(() => readPersistedWidth('panelWidth_left', 280));
  const [rightWidth, setRightWidth] = useState(() => readPersistedWidth('panelWidth_right', 280));
  const [windowSize, setWindowSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  
  // TypeList height - only reserve space when it's actually visible
  const typeListHeight = typeListVisible ? HEADER_HEIGHT : 0;
  
  // Resizer handle space (12px offset from PanelResizerHandle)
  const resizerHandleSpace = 12;

  useEffect(() => {
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Only sync React state on drag end (panelWidthChanged) to avoid
  // re-rendering NodeCanvas and other consumers on every drag frame.
  // The panel DOM width is updated directly via ref during drag.
  useEffect(() => {
    const onChanged = (e) => {
      const { side, width } = e.detail || {};
      if (side === 'left' && typeof width === 'number') setLeftWidth(width);
      if (side === 'right' && typeof width === 'number') setRightWidth(width);
    };
    window.addEventListener('panelWidthChanged', onChanged);
    return () => {
      window.removeEventListener('panelWidthChanged', onChanged);
    };
  }, []);

  const bounds = useMemo(() => {
    const effectiveLeftWidth = leftExpanded ? leftWidth : 0;
    const effectiveRightWidth = rightExpanded ? rightWidth : 0;
    
    // In flexbox layout, the canvas area starts immediately after the left panel
    // and extends to the right panel, with no additional margins
    const x = effectiveLeftWidth;
    const y = HEADER_HEIGHT; // The header is at 0,0, so canvas starts at HEADER_HEIGHT
    const width = windowSize.w - effectiveLeftWidth - effectiveRightWidth;
    const height = windowSize.h - HEADER_HEIGHT - (typeListVisible ? HEADER_HEIGHT : 0);
    
    return { 
      x, 
      y, 
      width, 
      height, 
      leftWidth: effectiveLeftWidth, 
      rightWidth: effectiveRightWidth, 
      windowWidth: windowSize.w, 
      windowHeight: windowSize.h, 
      bottomReserved: typeListVisible ? HEADER_HEIGHT : 0,
      leftHandleSpace: 0, // No handle space needed in flexbox layout
      rightHandleSpace: 0
    };
  }, [leftWidth, rightWidth, windowSize, typeListHeight, leftExpanded, rightExpanded, typeListVisible]);

  return bounds;
};

export default useViewportBounds;


