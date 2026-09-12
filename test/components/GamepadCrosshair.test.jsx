/**
 * The controller's reticle is the cursor, and it must not move.
 *
 * It is pinned to the ABSOLUTE centre of the app box, so opening, closing or
 * resizing a panel leaves it exactly where it was. Two separate mistakes have
 * put panel dependence back into it, and neither is visible by reading the
 * component alone — both come from what `viewportBounds.x` means:
 *
 *  1. Drawing at `viewportBounds.width / 2`, i.e. the centre of the region left
 *     over after the panels. That moves whenever a panel does.
 *  2. Correcting that by subtracting `viewportBounds.x`. It reads like a
 *     container conversion, but `.canvas-area` is full-width — the panels are
 *     position:fixed overlays and take no flow space — so `viewportBounds.x` is
 *     just the left panel's width, and subtracting it drags the reticle left by
 *     exactly that much.
 *
 * So these tests assert the property directly: same window, different panels,
 * same pixel. And that the pixel is the middle of the app box, which is what
 * the aim resolution and the zoom anchor independently compute.
 */

import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import GamepadCrosshair from '../../src/components/GamepadCrosshair.jsx';
import { crosshairCenter } from '../../src/utils/gamepadAim.js';

// The component reads only darkMode off the store, to pick its colour.
vi.mock('../../src/hooks/useTheme.js', () => ({
  useDarkMode: () => false,
  useTheme: () => ({ darkMode: false }),
}));

const HEADER = 50;
const WINDOW = { w: 1600, h: 900 };

/**
 * A viewportBounds as useViewportBounds builds one: `x` is the left panel's
 * width, `y` the header's height, width/height the region left over.
 */
const boundsWith = ({ left = 0, right = 0, typeList = 0 } = {}) => ({
  x: left,
  y: HEADER,
  width: WINDOW.w - left - right,
  height: WINDOW.h - HEADER - typeList,
  leftWidth: left,
  rightWidth: right,
  windowWidth: WINDOW.w,
  windowHeight: WINDOW.h,
  bottomReserved: typeList,
  isExclusiveMode: false,
});

/**
 * Centre of the drawn reticle, in CLIENT coords.
 *
 * The two bars are positioned inside `.canvas-area`, whose origin is
 * (0, HEADER) — so the horizontal bar's midpoint plus that origin is where the
 * user actually sees the reticle.
 */
const drawnCenter = (container) => {
  const [horizontal, vertical] = Array.from(
    container.querySelector('.gamepad-crosshair').children
  );
  const px = (v) => parseFloat(v);
  return {
    x: px(horizontal.style.left) + px(horizontal.style.width) / 2,
    y: px(vertical.style.top) + px(vertical.style.height) / 2 + HEADER,
  };
};

const renderAt = (bounds) => {
  const { container } = render(
    <GamepadCrosshair visible viewportBounds={bounds} headerHeight={HEADER} scale={1} />
  );
  return drawnCenter(container);
};

afterEach(cleanup);

describe('GamepadCrosshair position', () => {
  it('sits at the centre of the app box with no panels open', () => {
    expect(renderAt(boundsWith())).toEqual({ x: WINDOW.w / 2, y: WINDOW.h / 2 });
  });

  it('does not move when the left panel opens', () => {
    const closed = renderAt(boundsWith());
    cleanup();
    const open = renderAt(boundsWith({ left: 280 }));
    expect(open).toEqual(closed);
  });

  it('does not move when the left panel is resized', () => {
    const narrow = renderAt(boundsWith({ left: 280 }));
    cleanup();
    const wide = renderAt(boundsWith({ left: 520 }));
    expect(wide).toEqual(narrow);
  });

  it('does not move for the right panel or the TypeList either', () => {
    const bare = renderAt(boundsWith());
    cleanup();
    const dressed = renderAt(boundsWith({ left: 280, right: 340, typeList: 50 }));
    expect(dressed).toEqual(bare);
  });

  it('lands on the same point the aim resolution and the zoom anchor use', () => {
    // The three must agree pixel for pixel or the reticle lies about what it is
    // pointing at. crosshairCenter is the single source they all read.
    const bounds = boundsWith({ left: 280, right: 340, typeList: 50 });
    expect(renderAt(bounds)).toEqual(crosshairCenter(bounds));
  });
});
