import { describe, it, expect, afterEach, vi } from 'vitest';
import { getAppViewportSize, getFixedOverlayOrigin } from '../../src/utils/appViewport.js';

/**
 * Under viewport-fit=cover, window.innerHeight becomes the FULL screen —
 * including the Dynamic Island and home-indicator bands that <body> reserves as
 * padding. The canvas coordinate system places the canvas at HEADER_HEIGHT from
 * the top of the app box and sizes it by the remaining height, so feeding it the
 * window would offset everything by the inset. This must report the padded box.
 */

function mockRoot({ width, height }) {
  const el = { clientWidth: width, clientHeight: height };
  vi.spyOn(document, 'getElementById').mockImplementation((id) =>
    (id === 'root' ? el : null));
  return el;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('getAppViewportSize', () => {
  it('reports the padded #root box rather than the raw window', () => {
    mockRoot({ width: 393, height: 759 }); // 852 screen − 59 top − 34 bottom
    expect(getAppViewportSize()).toEqual({ width: 393, height: 759 });
  });

  it('falls back to the window when #root is absent', () => {
    vi.spyOn(document, 'getElementById').mockReturnValue(null);
    expect(getAppViewportSize()).toEqual({
      width: window.innerWidth,
      height: window.innerHeight
    });
  });

  it('falls back when #root has not been laid out yet', () => {
    // A hidden or pre-layout root measures 0; returning that would collapse the
    // canvas to nothing on first paint.
    mockRoot({ width: 0, height: 0 });
    expect(getAppViewportSize()).toEqual({
      width: window.innerWidth,
      height: window.innerHeight
    });
  });

  it('falls back when measuring throws', () => {
    vi.spyOn(document, 'getElementById').mockImplementation(() => {
      throw new Error('detached document');
    });
    expect(getAppViewportSize()).toEqual({
      width: window.innerWidth,
      height: window.innerHeight
    });
  });

  it('equals the window on a display with no insets', () => {
    // env(safe-area-inset-*) resolves to 0 there, so body padding is 0 and the
    // two measurements agree — the non-mobile path is unchanged.
    mockRoot({ width: window.innerWidth, height: window.innerHeight });
    expect(getAppViewportSize()).toEqual({
      width: window.innerWidth,
      height: window.innerHeight
    });
  });
});

/**
 * #root carries a transform (App.css) so the fixed panels measure from the app
 * box, which makes it the containing block for every fixed descendant. An
 * overlay anchored off a MEASUREMENT — a client rect, a touch's clientY — has
 * to be rebased out of client space before it can be written to a fixed
 * left/top, or it lands one safe-area inset off. That was the abstraction
 * carousel sitting below its node in the Capacitor build.
 */
function mockRootRect({ left, top }) {
  const el = { getBoundingClientRect: () => ({ left, top }) };
  vi.spyOn(document, 'getElementById').mockImplementation((id) =>
    (id === 'root' ? el : null));
  return el;
}

describe('getFixedOverlayOrigin', () => {
  it('reports the inset origin the app box starts at', () => {
    mockRootRect({ left: 0, top: 59 }); // portrait: notch band on top only
    expect(getFixedOverlayOrigin()).toEqual({ x: 0, y: 59 });
  });

  it('is zero on a display with no insets', () => {
    mockRootRect({ left: 0, top: 0 });
    expect(getFixedOverlayOrigin()).toEqual({ x: 0, y: 0 });
  });

  it('falls back to the viewport origin when #root is absent', () => {
    vi.spyOn(document, 'getElementById').mockReturnValue(null);
    expect(getFixedOverlayOrigin()).toEqual({ x: 0, y: 0 });
  });

  it('falls back when measuring throws', () => {
    vi.spyOn(document, 'getElementById').mockImplementation(() => {
      throw new Error('detached document');
    });
    expect(getFixedOverlayOrigin()).toEqual({ x: 0, y: 0 });
  });
});
