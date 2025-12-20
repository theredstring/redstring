/**
 * Shared color utility functions for Redstring
 */

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

/**
 * Returns an appropriate text color (dark or light) based on the background color's brightness.
 * @param {string} backgroundColor - Hex color string
 * @returns {string} - Hex color string for text
 */
export const getTextColor = (backgroundColor) => {
  if (!backgroundColor) return '#bdb5b5';
  
  const { h, s, l } = hexToHsl(backgroundColor);
  
  // If background is bright (lightness > 35), use dark text with same hue
  // Threshold 35% provides good contrast for this UI's specific style
  if (l > 35) {
    // Create a dark color with the same hue but very low lightness for better contrast
    return hslToHex(h, Math.min(s, 50), 12); // Darker text (12% lightness) with slightly higher saturation
  } else {
    // Use light text for dark backgrounds
    return '#bdb5b5';
  }
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

