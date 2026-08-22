import { describe, it, expect, afterEach, vi } from 'vitest';
import { getAppViewportSize } from '../../src/utils/appViewport.js';

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
