export const NODE_WIDTH = 120;
export const NODE_HEIGHT = 100;
export const LONG_PRESS_DURATION = 250;
export const LERP_SPEED = 0.8;
export const HEADER_HEIGHT = 50;
// At or below this viewport width, opening one panel closes the other and the
// header consolidates its inline action buttons into a single hamburger menu.
export const EXCLUSIVE_PANEL_MODE_THRESHOLD = 1100;
// Allow effectively unbounded zoom; keep a very high cap to avoid numeric overflow
export const MAX_ZOOM = 1000;
export const MOVEMENT_THRESHOLD = 3;
export const SCROLL_SENSITIVITY = 0.5;
export const PLUS_SIGN_SIZE = 160;
export const PLUS_LINE_SIZE = PLUS_SIGN_SIZE / 2;
export const PLUS_SIGN_ANIMATION_DURATION = 150;

// Node Layout Constants (Moved from Node.jsx)
export const NODE_PADDING = 30; // Unified padding for horizontal, bottom, and gap
export const NODE_CORNER_RADIUS = 40;
export const NAME_AREA_FACTOR = 0.7; // Determines effective height for name positioning
export const EXPANDED_NODE_WIDTH = 420; // Width when image is present
export const AVERAGE_CHAR_WIDTH = 14; // Approx width per char for 20px bold font
export const WRAPPED_NODE_HEIGHT = 110; // Height for text-only nodes when text wraps
export const LINE_HEIGHT_ESTIMATE = 28; // Approx height of one line of text (px) - reduced from 32 for tighter spacing

// --- Per-instance node size steps ---
// Discrete multipliers applied ON TOP of the user's global textSettings.nodeScale.
// Index 2 (1.0) is the default "Medium". Stored in instance.scale (a continuous float),
// so these are simply five chosen points on that continuum — a future free-drag resize
// can write arbitrary values and still cycle sanely (nextNodeSizeStep snaps first).
export const NODE_SIZE_STEPS = [0.5, 0.75, 1.0, 1.5, 2.0]; // XS, S, M, L, XL
export const NODE_SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL'];
export const NODE_SIZE_DEFAULT_INDEX = 2; // Medium

// Snap an arbitrary scale to the nearest defined step index.
export const nearestNodeSizeIndex = (scale) => {
  const s = (typeof scale === 'number' && scale > 0) ? scale : NODE_SIZE_STEPS[NODE_SIZE_DEFAULT_INDEX];
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < NODE_SIZE_STEPS.length; i++) {
    const d = Math.abs(NODE_SIZE_STEPS[i] - s);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
};

// Cycle order per product spec: M → L → XL → XS → S → M …
// Ascending array with (idx + 1) % len yields exactly that when starting at Medium.
export const nextNodeSizeStep = (scale) => {
  const idx = nearestNodeSizeIndex(scale);
  return NODE_SIZE_STEPS[(idx + 1) % NODE_SIZE_STEPS.length];
};

export const nodeSizeLabel = (scale) => NODE_SIZE_LABELS[nearestNodeSizeIndex(scale)];

export const EDGE_MARGIN = 75; // Pixels from viewport edge for decomposed view placement

export const TRACKPAD_ZOOM_SENSITIVITY = 6.5;     // Slightly increased sensitivity for trackpad pinch-zooming (macOS)
export const PAN_DRAG_SENSITIVITY = 1.2;
export const MOUSE_WHEEL_ZOOM_SENSITIVITY = 1.5; // Renaming this slightly for clarity, adjust value if needed
export const SMOOTH_MOUSE_WHEEL_ZOOM_SENSITIVITY = 0.3; // Slightly faster to address slow mouse wheel zoom
export const MIDDLE_MOUSE_ZOOM_SENSITIVITY = 1.0;       // Per-pixel zoom delta for middle-mouse-drag
export const KEYBOARD_PAN_SPEED = 0.065;                // for keyboard panning
export const KEYBOARD_ZOOM_SPEED = 0.15;               // for keyboard zooming

// Image Processing
export const THUMBNAIL_MAX_DIMENSION = 500; // Max width/height for canvas node thumbnails

// UI Icon Sizes
export const PANEL_CLOSE_ICON_SIZE = 16; // Standard size for X/close icons in panels
export const MODAL_CLOSE_ICON_SIZE = 20; // Standard size for X/close icons in modal dialogs

// Define default node color - maroon to match base Thing prototype
export const NODE_DEFAULT_COLOR = '#8B0000';

// Define default connection color - red for new connections in UnifiedSelector
export const CONNECTION_DEFAULT_COLOR = '#8B0000';

// Dark mode background colors
export const DARK_MODE_BG_COLOR = '#3F3A3A';
export const LIGHT_MODE_BG_COLOR = '#bdb5b5';
