/**
 * Theme Hooks
 *
 * Custom React hooks for accessing the current theme.
 */

import { useMemo } from 'react';
import useGraphStore from '../store/graphStore.jsx';
import { getTheme } from '../utils/themeColors.js';

/**
 * Hook that provides the current theme's color palette.
 * Automatically updates when darkMode changes.
 *
 * @returns {Object} Theme object with color values
 * @example
 * const theme = useTheme();
 * <div style={{ backgroundColor: theme.canvas.bg, color: theme.canvas.text }}>
 */
export function useTheme() {
  const darkMode = useGraphStore(state => state.darkMode);

  return useMemo(() => ({
    ...getTheme(darkMode),
    darkMode
  }), [darkMode]);
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
