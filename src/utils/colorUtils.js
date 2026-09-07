const LIGHTNESS_THRESHOLD = 50;
const DARK_TEXT_LIGHTNESS = 12;

// Helper function to convert CSS color names to hex
export const cssColorToHex = (color) => {
  // If it's already a hex color, return as-is
  if (typeof color === 'string' && color.startsWith('#')) {
    return color;
  }

  // Create a temporary element to get the computed color
  if (typeof document !== 'undefined') {
    const tempElement = document.createElement('div');
    tempElement.style.color = color;
    document.body.appendChild(tempElement);

    const computedColor = getComputedStyle(tempElement).color;
    document.body.removeChild(tempElement);

    // Parse rgb(r, g, b) format
    const rgbMatch = computedColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
      const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
      const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }

  // Fallback for common CSS colors
  const colorMap = {
    'maroon': '#800000',
    'red': '#ff0000',
    'orange': '#ffa500',
    'yellow': '#ffff00',
    'olive': '#808000',
    'lime': '#00ff00',
    'green': '#008000',
    'aqua': '#00ffff',
    'teal': '#008080',
    'blue': '#0000ff',
    'navy': '#000080',
    'fuchsia': '#ff00ff',
    'purple': '#800080',
    'black': '#000000',
    'gray': '#808080',
    'silver': '#c0c0c0',
    'white': '#EFE8E5'
  };

  return colorMap[color.toLowerCase()] || '#800000'; // Default to maroon if unknown
};

export const hexToHsl = (hex) => {
  // Convert CSS color names to hex first
  hex = cssColorToHex(hex);

  // Remove # if present
  hex = hex.replace('#', '');

  // Handle 3-digit hex
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16) / 255;
  const g = parseInt(hex.substr(2, 2), 16) / 255;
  const b = parseInt(hex.substr(4, 2), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l;

  l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
};

export const hslToHex = (h, s, l) => {
  h = h % 360;
  s = s / 100;
  l = l / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }

  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const hexToRgb = (hex) => {
  hex = cssColorToHex(hex).replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return {
    r: parseInt(hex.substr(0, 2), 16),
    g: parseInt(hex.substr(2, 2), 16),
    b: parseInt(hex.substr(4, 2), 16),
  };
};

/**
 * Mixes a tint into a base color in RGB space. Used where a surface needs to
 * carry a trace of another color without going translucent — an opaque result
 * keeps stacking predictable when tinted surfaces overlap.
 * @param {string} baseColor - Hex color string (the surface)
 * @param {string} tintColor - Hex color string (what to mix in)
 * @param {number} amount - 0 = untouched base, 1 = pure tint
 * @returns {string} - Hex color string
 */
export const blendColors = (baseColor, tintColor, amount) => {
  const t = Math.max(0, Math.min(1, amount));
  const base = hexToRgb(baseColor);
  const tint = hexToRgb(tintColor);
  const mix = (a, b) => Math.round(a + (b - a) * t).toString(16).padStart(2, '0');
  return `#${mix(base.r, tint.r)}${mix(base.g, tint.g)}${mix(base.b, tint.b)}`;
};

const LIGHT_TEXT_LIGHTNESS = 95;

/**
 * Perceptual brightness test used to decide whether a color wants dark or light
 * text on top of it. Raw HSL lightness isn't enough — the same lightness reads
 * much brighter in yellow than in blue — so the threshold is nudged per hue.
 * @param {string} color - Hex color string
 * @returns {boolean} - true when the color is bright enough to need dark text
 */
export const isBrightColor = (color) => {
  const { h, s, l } = hexToHsl(color);

  // Colors from yellow through cyan are perceptually brighter to human eyes,
  // so we lower the threshold to switch to dark text earlier.
  // Blue is perceptually dark so it gets less adjustment.
  // Low saturation makes colors appear even brighter, so we boost the adjustment further.
  let hueAdjustment = 0;
  if (h > 45 && h < 70) {
    hueAdjustment = 20;       // Yellow
  } else if (h >= 70 && h < 150) {
    hueAdjustment = 15;       // Yellow-green / Green (reduced from 20 for earlier light text on dark greens)
  } else if (h >= 150 && h < 200) {
    hueAdjustment = 15;       // Cyan / Light blue
  } else if (h >= 200 && h < 250) {
    hueAdjustment = 5;        // Blue (perceptually dark, needs less adjustment)
  } else if (h >= 250 && h < 320) {
    hueAdjustment = -5;       // Purple/violet (darker purples get light text sooner)
  }

  // Low saturation = more washed out = appears brighter, needs dark text sooner
  if (hueAdjustment > 0 && s < 50) {
    hueAdjustment += Math.round((50 - s) / 5); // up to +10 extra at s=0
  }

  return l > (LIGHTNESS_THRESHOLD - hueAdjustment);
};

/**
 * Returns an appropriate text color (dark or light) based on the background color's brightness.
 * @param {string} backgroundColor - Hex color string
 * @param {boolean} isDarkMode - Whether the application is in dark mode
 * @returns {string} - Hex color string for text
 */
export const getTextColor = (backgroundColor, isDarkMode = false) => {
  if (!backgroundColor) return '#bdb5b5';

  const { h, s } = hexToHsl(backgroundColor);

  // Nodes are self-contained visual elements that should look the same regardless
  // of the app's theme. Text color is determined purely by the node's background color.
  // If background is bright, use dark text with same hue
  if (isBrightColor(backgroundColor)) {
    // Create a dark color with the same hue (preserving saturation) but very low lightness
    // This creates a "near black" that matches the theme of the group/node
    return hslToHex(h, s, DARK_TEXT_LIGHTNESS);
  } else {
    // Create a light color with the same hue but very high lightness
    // This creates a "near white" that matches the theme
    return hslToHex(h, s, LIGHT_TEXT_LIGHTNESS);
  }
};

/**
 * Returns the opposite lightness text color from getTextColor.
 * If getTextColor would return dark text, this returns light text, and vice versa.
 * Used for connection labels where text sits on top of the edge color.
 */
export const getInvertedTextColor = (backgroundColor, isDarkMode = false) => {
  if (!backgroundColor) return '#bdb5b5';

  const { h, s } = hexToHsl(backgroundColor);

  // Inverted: bright backgrounds get light text, dark backgrounds get dark text
  if (isBrightColor(backgroundColor)) {
    return hslToHex(h, s, LIGHT_TEXT_LIGHTNESS);
  } else {
    return hslToHex(h, s, DARK_TEXT_LIGHTNESS);
  }
};

/**
 * Returns a light color preserving the hue/saturation of the input color.
 * Always returns high lightness regardless of input brightness.
 * Used for connection label fill text.
 */
export const getLightHueText = (backgroundColor) => {
  if (!backgroundColor) return '#bdb5b5';
  const { h, s } = hexToHsl(backgroundColor);
  return hslToHex(h, s, LIGHT_TEXT_LIGHTNESS);
};

/**
 * Returns a dark color preserving the hue/saturation of the input color.
 * Always returns low lightness regardless of input brightness.
 * Used for connection label stroke outline.
 */
export const getDarkHueText = (backgroundColor) => {
  if (!backgroundColor) return '#bdb5b5';
  const { h, s } = hexToHsl(backgroundColor);
  return hslToHex(h, s, DARK_TEXT_LIGHTNESS);
};

export const CONNECTION_LABEL_COLOR_MODES = ['light', 'connection', 'theme'];
export const DEFAULT_CONNECTION_LABEL_COLOR_MODE = 'light';
export const DEFAULT_CONNECTION_LABEL_OUTER_RING = true;

/**
 * Returns the { fill, stroke } pair for a connection label. Both are drawn from
 * the connection's own hue — one near-white, one near-black — so the halo is
 * always the opposite lightness of the glyph fill.
 *
 * Which of the two lands on the fill depends on the mode:
 *  - 'light' (default): the fill is always the near-white, the halo always the
 *    near-black, whatever the connection color or app theme.
 *  - 'connection': the connection's color decides, the same way node text does —
 *    a dark connection gets a light fill, a light one gets a dark fill.
 *  - 'theme': the app's light/dark mode decides (the original behavior).
 *
 * `outerStroke` is a third, outermost ring in the connection's own color, so the
 * halo never meets the canvas directly and the label reads as sitting IN the line
 * rather than on top of it. It is independent of the mode — any of the three can
 * wear it — and is null when `showOuterRing` is false.
 *
 * @param {string} connectionColor - Hex color string of the connection
 * @param {boolean} isDarkMode - Whether the application is in dark mode
 * @param {string} mode - 'light', 'connection', or 'theme'
 * @param {boolean} showOuterRing - Whether to include the connection-colored ring
 * @returns {{ fill: string, stroke: string, outerStroke: string|null }}
 */
export const getConnectionLabelColors = (
  connectionColor,
  isDarkMode = false,
  mode = DEFAULT_CONNECTION_LABEL_COLOR_MODE,
  showOuterRing = DEFAULT_CONNECTION_LABEL_OUTER_RING
) => {
  const base = connectionColor || '#800000';
  const light = getLightHueText(base);
  const dark = getDarkHueText(base);

  let fillIsDark = false;
  if (mode === 'theme') fillIsDark = !!isDarkMode;
  else if (mode === 'connection') fillIsDark = isBrightColor(base);

  const outerStroke = showOuterRing ? base : null;

  return fillIsDark
    ? { fill: dark, stroke: light, outerStroke }
    : { fill: light, stroke: dark, outerStroke };
};

/**
 * How much wider the connection-colored outer ring is than the label's own halo.
 * SVG paints one stroke per element, so the ring is a second <text> underneath
 * the real one carrying this width — see the connection label render sites.
 */
export const CONNECTION_LABEL_OUTER_STROKE_SCALE = 2.1;

// Generate consistent color based on node name
export const generateConceptColor = (name) => {
  // Hue values that create pleasant, readable colors with maroon's saturation/brightness
  const hues = [0, 25, 90, 140, 200, 260, 300]; // Red, Orange-Red, Green, Cyan-Green, Blue, Purple, Magenta

  // Convert HSV to hex (same logic as ColorPicker)
  const hsvToHex = (h, s, v) => {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r, g, b;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
    else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
    else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
    else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Use maroon's saturation (1.0) and brightness (~0.545) for consistency
  const targetSaturation = 1.0;
  const targetBrightness = 0.545;

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) & 0xffffffff;
  }

  const selectedHue = hues[Math.abs(hash) % hues.length];
  return hsvToHex(selectedHue, targetSaturation, targetBrightness);
};

/**
 * Generates a progressive color for abstraction levels
 */
export const generateProgressiveColor = (baseColor, level) => {
  if (level === 0) return baseColor;

  const { h, s, l } = hexToHsl(baseColor);
  const reducedSaturation = Math.max(0, s - 25);

  let newLightness = l;

  if (level < 0) {
    if (level === -1) {
      newLightness = Math.min(90, l + 40);
    } else {
      const stepsFromFirst = Math.abs(level) - 1;
      const linearBase = 40;
      const linearIncrement = 8;
      const lighteningFactor = linearBase + (stepsFromFirst * linearIncrement);
      newLightness = Math.min(90, l + lighteningFactor);
    }
  } else if (level > 0) {
    const linearDarkeningFactor = level * 6;
    newLightness = Math.max(10, l - linearDarkeningFactor);
  }

  return hslToHex(h, reducedSaturation, newLightness);
};

/**
 * Get the current theme colors (for use outside React components)
 * @returns {Object} Current theme object
 */
export function getCurrentTheme() {
  // Import dynamically to avoid circular dependencies
  const { getTheme } = require('./themeColors.js');
  const useGraphStore = require('../store/graphStore.js').default;

  try {
    const darkMode = useGraphStore.getState().darkMode;
    return getTheme(darkMode);
  } catch (error) {
    // Fallback to light theme if store not available
    const { LIGHT_THEME } = require('./themeColors.js');
    return LIGHT_THEME;
  }
}

/**
 * Get appropriate text color for a given background, considering current theme.
 * Falls back to contrast-based calculation for custom backgrounds.
 * @param {string} backgroundColor - Hex color string
 * @returns {string} - Hex color string for text
 */
export function getThemeAwareTextColor(backgroundColor) {
  const theme = getCurrentTheme();

  // If it's one of our theme background colors, use the corresponding text color
  if (backgroundColor === theme.canvas.bg) {
    return theme.canvas.text;
  }

  // Otherwise use existing contrast-based logic
  return getTextColor(backgroundColor);
}







