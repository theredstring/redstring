/**
 * Theme Hooks
 *
 * Custom React hooks for accessing the current theme.
 */

import { useMemo } from 'react';
import useGraphStore from '../store/graphStore.js';
import { getTheme, getCanvasSurface } from '../utils/themeColors.js';

/**
 * Hook that provides the current theme's color palette.
 * Automatically updates when darkMode or canvasColor changes.
 *
 * @returns {Object} Theme object with color values
 * @example
 * const theme = useTheme();
 * <div style={{ backgroundColor: theme.canvas.bg, color: theme.canvas.text }}>
 */
export function useTheme() {
  const darkMode = useGraphStore(state => state.darkMode);
  const canvasColor = useGraphStore(state => state.canvasColor);

  return useMemo(() => ({
    ...getTheme(darkMode),
    darkMode,
    // What the web is drawn on; differs from canvas.bg when Canvas Color isn't Auto.
    surface: getCanvasSurface(canvasColor, darkMode),
  }), [darkMode, canvasColor]);
}

/**
 * Hook that just returns whether dark mode is active.
 * More efficient if you only need the boolean.
 *
 * @returns {boolean} Whether dark mode is active
 */
export function useDarkMode() {
  return useGraphStore(state => state.darkMode);
}
