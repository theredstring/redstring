/**
 * Theme Color Definitions
 *
 * Centralized color palettes for light and dark themes.
 * This is the single source of truth for all canvas/panel/modal background colors.
 */

// Light mode theme
export const LIGHT_THEME = {
  canvas: {
    bg: '#bdb5b5',      // Main canvas/panel background
    textPrimary: '#260000',   // Primary text color on canvas bg
    textSecondary: '#3F3A3A', // Secondary/muted text (lighter for better readability)
    border: '#979090',   // Borders and dividers
    hover: '#cfc6c6',    // Hover states
    active: '#bdb5b5',   // Active tab/button states
    inactive: '#979090', // Inactive tab/button states
    brand: '#7A0000',    // Brand/accent color
  },
  // Accent colors remain theme-independent
  accent: {
    primary: '#8B0000',  // Maroon (nodes, connections)
    secondary: '#7A0000',
  },
  alert: {
    error: {
      bg: '#ffebee',
      text: '#c62828',
      border: '#ffcdd2'
    },
    warning: {
      bg: '#fff8e1',
      text: '#f57c00',
      border: '#ffca28'
    },
    info: {
      bg: 'rgba(21,101,192,0.08)',
      text: '#1565c0',
      border: 'rgba(21,101,192,0.4)'
    },
    success: {
      bg: 'rgba(46,125,50,0.08)',
      text: '#2e7d32',
      border: 'rgba(46,125,50,0.4)'
    }
  }
};

// Dark mode theme
export const DARK_THEME = {
  canvas: {
    bg: '#3F3A3A',      // Main canvas/panel background
    textPrimary: '#DEDADA',   // Primary text color (light on dark)
    textSecondary: '#BDB5B5', // Secondary light text
    border: '#6a6464',   // Borders and dividers (lightened for contrast)
    hover: '#4a4545',    // Hover states
    active: '#3F3A3A',   // Active tab/button states
    inactive: '#2e2a2a', // Inactive tab/button states
    brand: '#7A0000',    // Brand/accent color
  },
  accent: {
    primary: '#8B0000',
    secondary: '#7A0000',
  },
  alert: {
    error: {
      bg: 'rgba(211,47,47,0.15)',
      text: '#ff8a80',
      border: 'rgba(211,47,47,0.4)'
    },
    warning: {
      bg: 'rgba(255,160,0,0.15)',
      text: '#ffd180',
      border: 'rgba(255,160,0,0.4)'
    },
    info: {
      bg: 'rgba(3,169,244,0.15)',
      text: '#81d4fa',
      border: 'rgba(3,169,244,0.4)'
    },
    success: {
      bg: 'rgba(76,175,80,0.15)',
      text: '#a5d6a7',
      border: 'rgba(76,175,80,0.4)'
    }
  }
};

/**
 * Get theme based on darkMode boolean
 * @param {boolean} isDark - Whether dark mode is active
 * @returns {Object} Theme object with color values
 */
export function getTheme(isDark) {
  return isDark ? DARK_THEME : LIGHT_THEME;
}

// Backwards compatibility - keep existing exports
export const DARK_MODE_BG_COLOR = DARK_THEME.canvas.bg;
export const LIGHT_MODE_BG_COLOR = LIGHT_THEME.canvas.bg;
