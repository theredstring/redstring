import { EXCLUSIVE_PANEL_MODE_THRESHOLD } from '../../constants.js';

/** Side-panel width helpers (moved from NodeCanvas in P2.12). */

export const PANEL_TOGGLE_BUTTON_WIDTH = 50; // Must match ToggleButton width
export const PANEL_OVERLAY_MIN_WIDTH = 150;
/** Width a panel opens at before the user has resized it (Panel's INITIAL_PANEL_WIDTH). */
export const DEFAULT_PANEL_WIDTH = 250;

// Clamp an overlay-resizer panel width to what the current viewport supports.
// Mirrors the formula used during active resize drags (PanelResizers).
export const clampOverlayPanelWidth = (width) => {
  if (typeof window === 'undefined') return width;
  const isExclusive = window.innerWidth <= EXCLUSIVE_PANEL_MODE_THRESHOLD;
  const max = isExclusive
    ? Math.max(PANEL_OVERLAY_MIN_WIDTH, window.innerWidth - PANEL_TOGGLE_BUTTON_WIDTH)
    : Math.max(240, Math.round(window.innerWidth / 2) - 30);
  return Math.max(PANEL_OVERLAY_MIN_WIDTH, Math.min(width, max));
};

/** The persisted width for `side` ('left' | 'right'), clamped to the viewport. */
export const readPersistedPanelWidth = (side) => {
  try {
    return clampOverlayPanelWidth(JSON.parse(localStorage.getItem(`panelWidth_${side}`) || String(DEFAULT_PANEL_WIDTH)));
  } catch {
    return clampOverlayPanelWidth(DEFAULT_PANEL_WIDTH);
  }
};

// Where a panel's overlay resizer bar sits, from the panel width: 14 px inset
// from the panel edge, centred on its 28 px hitbox (PanelResizers).
export const resizerOffset = (panelWidth) => Math.max(0, panelWidth + 14 - 28 / 2);
