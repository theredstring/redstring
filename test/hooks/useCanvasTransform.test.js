import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCanvasTransform } from '../../src/hooks/useCanvasTransform.js';

/**
 * The compositor-zoom path splits one logical transform across two DOM writes:
 * the content <g>'s `transform` ATTRIBUTE (the baseline the SVG raster was
 * painted at) and a CSS `transform` on a wrapper div (the delta riding above
 * it). Everything downstream — hit-testing, overlay anchoring, edge glows —
 * assumes those two compose back to exactly the pan/zoom the refs report.
 *
 * That composition is the load-bearing claim, so it gets asserted directly.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const CANVAS_SIZE = { width: 100000, height: 100000, offsetX: -50000, offsetY: -50000 };
const VIEWPORT = { width: 1400, height: 800 };

function makeGroup() {
  return document.createElementNS(SVG_NS, 'g');
}

function setup({ canvasSize = CANVAS_SIZE } = {}) {
  const layer = document.createElement('div');
  // jsdom reports 0 for every layout box; the exposure test needs a real one.
  Object.defineProperty(layer, 'clientWidth', { value: VIEWPORT.width, configurable: true });
  Object.defineProperty(layer, 'clientHeight', { value: VIEWPORT.height, configurable: true });

  const svg = document.createElementNS(SVG_NS, 'svg');
  const group = makeGroup();
  svg.appendChild(group);
  layer.appendChild(svg);
  document.body.appendChild(layer);

  const svgRef = { current: svg };
  const contentGroupRef = { current: group };
  const layerRef = { current: layer };

  const { result } = renderHook(() =>
    useCanvasTransform(svgRef, contentGroupRef, canvasSize, layerRef)
  );

  return { result, layer, contentGroupRef, layerRef, canvasSize };
}

/** The committed baseline: `translate(tx ty) scale(z)`. */
function readBaseline(contentGroupRef) {
  const raw = contentGroupRef.current.getAttribute('transform');
  if (!raw) return null;
  const m = /translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)/.exec(raw);
  if (!m) throw new Error(`unparseable baseline: ${raw}`);
  return { tx: Number(m[1]), ty: Number(m[2]), z: Number(m[3]) };
}

/** The riding delta: `matrix(r, 0, 0, r, dx, dy)`, or null when none. */
function readDelta(layer) {
  const raw = layer.style.transform;
  if (!raw) return null;
  const m = /matrix\(([^)]+)\)/.exec(raw);
  if (!m) throw new Error(`unparseable delta: ${raw}`);
  const [a, , , , e, f] = m[1].split(',').map((s) => Number(s.trim()));
  return { r: a, dx: e, dy: f };
}

/** Where canvas-space `x` actually lands, composing delta over baseline. */
function project(contentGroupRef, layer, x, y) {
  const base = readBaseline(contentGroupRef);
  const delta = readDelta(layer);
  let px = base.tx + base.z * x;
  let py = base.ty + base.z * y;
  if (delta) {
    px = delta.r * px + delta.dx;
    py = delta.r * py + delta.dy;
  }
  return { x: px, y: py };
}

/** Where it should land, from the live refs alone. */
function expected(result, canvasSize, x, y) {
  const p = result.current.panRef.current;
  const z = result.current.zoomRef.current;
  return {
    x: p.x - canvasSize.offsetX * z + z * x,
    y: p.y - canvasSize.offsetY * z + z * y,
  };
}

describe('useCanvasTransform — compositor zoom', () => {
  beforeEach(() => {
    // Force the gesture path on: the default is Chromium-only and jsdom's UA
    // reports as WebKit-ish.
    window.__compositorZoom = true;
  });

  afterEach(() => {
    delete window.__compositorZoom;
    delete window.__zoomRecommit;
    document.body.innerHTML = '';
  });

  it('composes delta over baseline to exactly the live pan/zoom', () => {
    const { result, layer, contentGroupRef, canvasSize } = setup();

    act(() => { result.current.jumpTo({ x: -300, y: -200 }, 1); });
    act(() => { result.current.setZoom(1.25); });

    // A delta must actually be riding, or this asserts nothing.
    expect(readDelta(layer)).not.toBeNull();
    expect(result.current.gestureActiveRef.current).toBe(true);

    for (const [x, y] of [[0, 0], [250, -125], [-4000, 900], [50000, -50000]]) {
      const got = project(contentGroupRef, layer, x, y);
      const want = expected(result, canvasSize, x, y);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
  });

  it('keeps pure pans on the attribute path with no delta', () => {
    const { result, layer, contentGroupRef } = setup();

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });
    act(() => { result.current.setPan({ x: -450, y: 275 }); });

    expect(layer.style.transform).toBe('');
    expect(result.current.gestureActiveRef.current).toBe(false);
    expect(readBaseline(contentGroupRef)).toEqual({ tx: -450 + 50000, ty: 275 + 50000, z: 1 });
  });

  it('folds a mid-gesture pan into the delta instead of writing the attribute', () => {
    const { result, layer, contentGroupRef, canvasSize } = setup();

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });
    act(() => { result.current.setZoom(1.2); });
    const baselineDuringGesture = contentGroupRef.current.getAttribute('transform');

    act(() => { result.current.setPan({ x: -40, y: 30 }); });

    // Attribute untouched; the pan rode the delta.
    expect(contentGroupRef.current.getAttribute('transform')).toBe(baselineDuringGesture);
    expect(result.current.gestureActiveRef.current).toBe(true);
    const got = project(contentGroupRef, layer, 1234, -567);
    const want = expected(result, canvasSize, 1234, -567);
    expect(got.x).toBeCloseTo(want.x, 6);
    expect(got.y).toBeCloseTo(want.y, 6);
  });

  it('recommits when the delta drifts past the scale-up threshold', () => {
    const { result, layer } = setup();

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });
    act(() => { result.current.setZoom(1.2); });
    expect(readDelta(layer)).not.toBeNull();

    act(() => { result.current.setZoom(1.9); }); // r = 1.9 > 1.5

    expect(layer.style.transform).toBe('');
    expect(result.current.gestureActiveRef.current).toBe(false);
    expect(readBaseline({ current: layer.querySelector('g') }).z).toBe(1.9);
  });

  it('never composites a zoom-out, however small', () => {
    // Shrinking the baseline raster exposes a ring of canvas it never painted —
    // blank where nodes, grid and off-screen-bound connections belong. Zoom-out
    // therefore always takes the attribute path.
    const { result, layer, contentGroupRef } = setup();

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });

    for (const z of [0.995, 0.9, 0.7, 0.2]) {
      act(() => { result.current.setZoom(z); });
      expect(layer.style.transform).toBe('');
      expect(result.current.gestureActiveRef.current).toBe(false);
      expect(readBaseline(contentGroupRef).z).toBe(z);
    }
  });

  it('commits a zoom-out that arrives mid-zoom-in gesture', () => {
    const { result, layer, contentGroupRef, canvasSize } = setup();

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });
    act(() => { result.current.setZoom(1.3); }); // delta riding
    expect(readDelta(layer)).not.toBeNull();

    act(() => { result.current.setZoom(1.1); }); // still > baseline, but reversing

    // r = 1.1 relative to the 1.0 baseline is still an upscale, so this one may
    // ride; what must never happen is the two transforms disagreeing.
    const got = project(contentGroupRef, layer, 800, -400);
    const want = expected(result, canvasSize, 800, -400);
    expect(got.x).toBeCloseTo(want.x, 6);
    expect(got.y).toBeCloseTo(want.y, 6);

    act(() => { result.current.setZoom(0.9); }); // now below the baseline
    expect(layer.style.transform).toBe('');
    expect(readBaseline(contentGroupRef).z).toBe(0.9);
  });

  it('recommits when exposure would reveal unrastered edges', () => {
    const { result, layer, contentGroupRef } = setup();

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });
    // A scale well inside the ratio thresholds, but panned far enough that the
    // baseline raster no longer covers the viewport.
    window.__zoomRecommit = { up: 100, down: 0.001, exposurePx: 40 };
    act(() => { result.current.setPanAndZoom({ x: -5000, y: 0 }, 1.05); });

    expect(layer.style.transform).toBe('');
    expect(readBaseline(contentGroupRef).z).toBe(1.05);
  });

  it('clears the delta on flushSettle and on jumpTo', () => {
    const { result, layer } = setup();

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });
    act(() => { result.current.setZoom(1.2); });
    expect(readDelta(layer)).not.toBeNull();

    act(() => { result.current.flushSettle(); });
    expect(layer.style.transform).toBe('');
    expect(result.current.gestureActiveRef.current).toBe(false);

    act(() => { result.current.setZoom(1.35); });
    expect(readDelta(layer)).not.toBeNull();
    act(() => { result.current.jumpTo({ x: 10, y: 10 }, 2); });
    expect(layer.style.transform).toBe('');
  });

  it('drops the will-change promotion when no delta is riding', () => {
    const { result, layer } = setup();

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });
    expect(layer.style.willChange).toBe('');

    act(() => { result.current.setZoom(1.2); });
    expect(layer.style.willChange).toBe('transform');

    act(() => { result.current.flushSettle(); });
    expect(layer.style.willChange).toBe('');
  });

  it('never touches the wrapper when the compositor path is disabled', () => {
    const { result, layer, contentGroupRef } = setup();
    window.__compositorZoom = false;

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });
    act(() => { result.current.setZoom(1.2); });
    act(() => { result.current.setPanAndZoom({ x: -80, y: 40 }, 1.4); });

    expect(layer.style.transform).toBe('');
    expect(result.current.gestureActiveRef.current).toBe(false);
    // Every tick went straight to the attribute.
    expect(readBaseline(contentGroupRef).z).toBe(1.4);
  });

  it('writes the attribute again after the content group remounts', () => {
    // NodeCanvas swaps the whole <svg> out through its loading / no-graph
    // branches. A remounted <g> carries no transform attribute, so a guard that
    // compared only pan/zoom VALUES would skip the write and strand the canvas
    // at raw canvas coords.
    const { result, contentGroupRef } = setup();

    act(() => { result.current.jumpTo({ x: -120, y: 60 }, 1.5); });
    expect(readBaseline(contentGroupRef)).not.toBeNull();

    const remounted = makeGroup();
    contentGroupRef.current = remounted;
    expect(remounted.getAttribute('transform')).toBeNull();

    // Same pan/zoom values as the baseline — only element identity differs.
    act(() => { result.current.applyTransform(); });

    expect(readBaseline(contentGroupRef)).toEqual({
      tx: -120 + 50000 * 1.5,
      ty: 60 + 50000 * 1.5,
      z: 1.5,
    });
  });

  it('abandons a riding delta when the content group remounts mid-gesture', () => {
    const { result, layer, contentGroupRef, canvasSize } = setup();

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });
    act(() => { result.current.setZoom(1.2); });
    expect(result.current.gestureActiveRef.current).toBe(true);

    contentGroupRef.current = makeGroup();
    act(() => { result.current.setZoom(1.25); });

    // The new group must carry the full transform, with nothing left riding.
    expect(layer.style.transform).toBe('');
    expect(result.current.gestureActiveRef.current).toBe(false);
    const got = project(contentGroupRef, layer, 900, -450);
    const want = expected(result, canvasSize, 900, -450);
    expect(got.x).toBeCloseTo(want.x, 6);
    expect(got.y).toBeCloseTo(want.y, 6);
  });

  it('exposes gestureActiveRef only while a delta rides', () => {
    const { result } = setup();

    act(() => { result.current.jumpTo({ x: 0, y: 0 }, 1); });
    expect(result.current.gestureActiveRef.current).toBe(false);

    act(() => { result.current.setPan({ x: -10, y: -10 }); });
    expect(result.current.gestureActiveRef.current).toBe(false);

    act(() => { result.current.setZoom(1.1); });
    expect(result.current.gestureActiveRef.current).toBe(true);

    act(() => { result.current.applyTransform(); });
    expect(result.current.gestureActiveRef.current).toBe(false);
  });
});
