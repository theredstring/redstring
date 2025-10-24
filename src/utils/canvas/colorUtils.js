/**
 * Color utility functions for canvas operations
 */

/**
 * Interpolates between two hex colors
 * @param {string} color1 - Start color in hex format (#RRGGBB)
 * @param {string} color2 - End color in hex format (#RRGGBB)
 * @param {number} factor - Interpolation factor (0 to 1)
 * @returns {string} Interpolated color in hex format
 */
export function interpolateColor(color1, color2, factor) {
  // Simple color interpolation - convert hex to RGB, interpolate, convert back
  const hex1 = color1.replace('#', '');
  const hex2 = color2.replace('#', '');

  const r1 = parseInt(hex1.substr(0, 2), 16);
  const g1 = parseInt(hex1.substr(2, 2), 16);
  const b1 = parseInt(hex1.substr(4, 2), 16);

  const r2 = parseInt(hex2.substr(0, 2), 16);
  const g2 = parseInt(hex2.substr(2, 2), 16);
  const b2 = parseInt(hex2.substr(4, 2), 16);

  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
