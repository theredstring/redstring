import { describe, it, expect } from 'vitest';
import { LIGHT_THEME, DARK_THEME, getTheme } from '../../src/utils/themeColors.js';

/**
 * Theme Color Tests
 *
 * `canvas.brand` is the same maroon in both themes, which is correct for fills
 * but unreadable as TEXT on the dark panel background. `canvas.brandText` is
 * the readable-on-background variant. These tests keep the two from drifting
 * back together.
 */

/** WCAG relative luminance for a #rrggbb string. */
const luminance = (hex) => {
  const channels = [1, 3, 5].map((i) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('theme brand colors', () => {
  it('exposes brandText in both themes', () => {
    expect(LIGHT_THEME.canvas.brandText).toBeDefined();
    expect(DARK_THEME.canvas.brandText).toBeDefined();
    expect(getTheme(true).canvas.brandText).toBe(DARK_THEME.canvas.brandText);
    expect(getTheme(false).canvas.brandText).toBe(LIGHT_THEME.canvas.brandText);
  });

  it('keeps the light-mode brand text as the brand maroon itself', () => {
    expect(LIGHT_THEME.canvas.brandText).toBe(LIGHT_THEME.canvas.brand);
  });

  it('lifts the dark-mode brand text away from the unreadable maroon', () => {
    // The bug: #7A0000 on #2E2A2A. If these ever match again, brand-colored
    // labels have gone invisible in dark mode.
    expect(DARK_THEME.canvas.brandText).not.toBe(DARK_THEME.canvas.brand);
  });

  it('meets WCAG AA for small text on the dark panel and card backgrounds', () => {
    expect(contrast(DARK_THEME.canvas.brandText, DARK_THEME.canvas.bg)).toBeGreaterThanOrEqual(4.5);
    // Discovered-universe cards sit on `inactive`, not the panel bg.
    expect(contrast(DARK_THEME.canvas.brandText, DARK_THEME.canvas.inactive)).toBeGreaterThanOrEqual(4.5);
  });

  it('proves the shared brand maroon would have failed in dark mode', () => {
    // Documents why brandText exists at all.
    expect(contrast(DARK_THEME.canvas.brand, DARK_THEME.canvas.bg)).toBeLessThan(2);
    expect(contrast(DARK_THEME.canvas.brand, DARK_THEME.canvas.inactive)).toBeLessThan(2);
  });

  it('leaves light mode exactly as it was', () => {
    // Light mode is untouched by the dark-mode fix. Recorded so a future change
    // to the light palette is a deliberate decision rather than a side effect.
    // (For reference, brand-on-`inactive` is ~3.7:1 here — below AA for small
    // text, but that predates brandText and is the existing light design.)
    expect(LIGHT_THEME.canvas.brandText).toBe('#7A0000');
    expect(contrast(LIGHT_THEME.canvas.brandText, LIGHT_THEME.canvas.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
