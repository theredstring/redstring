import { describe, it, expect } from 'vitest';
import {
  getConnectionLabelColors,
  getTextColor,
  getLightHueText,
  getDarkHueText,
  DEFAULT_CONNECTION_LABEL_COLOR_MODE,
} from '../../src/utils/colorUtils.js';

// A dark connection and a light one, so "which half lands on the fill" is
// actually exercised rather than being the same answer twice.
const DARK = '#800000';   // maroon
const LIGHT = '#ffe066';  // pale yellow

describe('getConnectionLabelColors', () => {
  it('defaults to the always-light mode', () => {
    expect(DEFAULT_CONNECTION_LABEL_COLOR_MODE).toBe('light');
    for (const color of [DARK, LIGHT]) {
      const { fill, stroke } = getConnectionLabelColors(color);
      expect(fill).toBe(getLightHueText(color));
      expect(stroke).toBe(getDarkHueText(color));
    }
  });

  it("takes the fill from the connection's own color in connection mode", () => {
    // Same call node text makes: dark background -> light text, and vice versa.
    for (const color of [DARK, LIGHT]) {
      const { fill } = getConnectionLabelColors(color, false, 'connection');
      expect(fill).toBe(getTextColor(color));
    }
    expect(getConnectionLabelColors(DARK, false, 'connection').fill)
      .not.toBe(getConnectionLabelColors(LIGHT, false, 'connection').fill);
  });

  it('ignores the app theme except in theme mode', () => {
    for (const mode of ['light', 'connection']) {
      expect(getConnectionLabelColors(DARK, true, mode))
        .toEqual(getConnectionLabelColors(DARK, false, mode));
    }
    const dark = getConnectionLabelColors(DARK, true, 'theme');
    const light = getConnectionLabelColors(DARK, false, 'theme');
    expect(dark.fill).toBe(light.stroke);
    expect(dark.stroke).toBe(light.fill);
  });

  it('always makes the stroke the opposite lightness of the fill', () => {
    for (const mode of ['light', 'connection', 'theme']) {
      for (const isDark of [false, true]) {
        for (const color of [DARK, LIGHT]) {
          const { fill, stroke } = getConnectionLabelColors(color, isDark, mode);
          const pair = [getLightHueText(color), getDarkHueText(color)];
          expect(pair).toContain(fill);
          expect(pair).toContain(stroke);
          expect(fill).not.toBe(stroke);
        }
      }
    }
  });

  it('carries the outer ring independently of the mode', () => {
    for (const mode of ['light', 'connection', 'theme']) {
      expect(getConnectionLabelColors(DARK, false, mode, true).outerStroke).toBe(DARK);
      expect(getConnectionLabelColors(DARK, false, mode, false).outerStroke).toBeNull();
    }
  });

  it('rings by default and falls back to maroon for a missing color', () => {
    expect(getConnectionLabelColors(DARK).outerStroke).toBe(DARK);
    expect(getConnectionLabelColors(null).outerStroke).toBe('#800000');
  });
});
