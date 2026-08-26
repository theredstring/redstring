import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCanvasTransform } from '../../src/hooks/useCanvasTransform.js';

/**
 * Pan/zoom is written straight to the content <g>'s transform attribute,
 * bypassing React. These cover the two things that can go wrong with a
 * write-through-to-the-DOM design: writing the wrong value, and skipping a
 * write that was needed.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const CANVAS_SIZE = { width: 100000, height: 100000, offsetX: -50000, offsetY: -50000 };

function makeGroup() {
  return document.createElementNS(SVG_NS, 'g');
}

function setup({ canvasSize = CANVAS_SIZE, withOverlay = false } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const group = makeGroup();
  svg.appendChild(group);
  document.body.appendChild(svg);

  const svgRef = { current: svg };
  const contentGroupRef = { current: group };
  const overlayGroupRef = { current: withOverlay ? makeGroup() : null };

  const { result } = renderHook(() =>
    useCanvasTransform(svgRef, contentGroupRef, canvasSize, overlayGroupRef)
  );

  return { result, contentGroupRef, overlayGroupRef, canvasSize };
}

/** Parse `translate(tx ty) scale(z)` off the content group. */
function readTransform(contentGroupRef) {
  const raw = contentGroupRef.current.getAttribute('transform');
  if (!raw) return null;
  const m = /translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)/.exec(raw);
  if (!m) throw new Error(`unparseable transform: ${raw}`);
  return { tx: Number(m[1]), ty: Number(m[2]), z: Number(m[3]) };
}

/** Where canvas-space (x, y) should land, from the live refs. */
function expected(result, canvasSize, x, y) {
  const p = result.current.panRef.current;
  const z = result.current.zoomRef.current;
  return {
    x: p.x - canvasSize.offsetX * z + z * x,
    y: p.y - canvasSize.offsetY * z + z * y,
  };
}

describe('useCanvasTransform', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('writes a transform that maps canvas points exactly where the refs say', () => {
    const { result, contentGroupRef, canvasSize } = setup();

    for (const [pan, zoom] of [
      [{ x: 0, y: 0 }, 1],
      [{ x: -300, y: -200 }, 1.25],
      [{ x: 940, y: -60 }, 0.4],
      [{ x: -12000, y: 7000 }, 3.75],
    ]) {
      act(() => { result.current.setPanAndZoom(pan, zoom); });
      const t = readTransform(contentGroupRef);
      for (const [x, y] of [[0, 0], [250, -125], [-4000, 900]]) {
        const want = expected(result, canvasSize, x, y);
        expect(t.tx + t.z * x).toBeCloseTo(want.x, 6);
        expect(t.ty + t.z * y).toBeCloseTo(want.y, 6);
      }
    }
  });

  it('keeps panRef and zoomRef live for every mutator', () => {
    const { result } = setup();

    act(() => { result.current.setPan({ x: -40, y: 30 }); });
    expect(result.current.panRef.current).toEqual({ x: -40, y: 30 });

    act(() => { result.current.setZoom(2); });
    expect(result.current.zoomRef.current).toBe(2);

    act(() => { result.current.setPan((p) => ({ x: p.x - 10, y: p.y })); });
    expect(result.current.panRef.current).toEqual({ x: -50, y: 30 });

    act(() => { result.current.setZoom((z) => z / 4); });
    expect(result.current.zoomRef.current).toBe(0.5);
  });

  it('fires onTransformChange synchronously on every mutation', () => {
    const { result } = setup();
    let calls = 0;
    result.current.onTransformChangeRef.current = () => { calls++; };

    act(() => { result.current.setPan({ x: 1, y: 1 }); });
    act(() => { result.current.setZoom(1.5); });
    act(() => { result.current.setPanAndZoom({ x: 2, y: 2 }, 2); });
    act(() => { result.current.jumpTo({ x: 3, y: 3 }, 3); });

    expect(calls).toBe(4);
  });

  it('skips the DOM write when nothing actually changed', () => {
    const { result, contentGroupRef } = setup();
    act(() => { result.current.setPanAndZoom({ x: -10, y: 20 }, 1.5); });

    let writes = 0;
    const el = contentGroupRef.current;
    const real = el.setAttribute.bind(el);
    el.setAttribute = (...args) => { writes++; return real(...args); };

    act(() => { result.current.setPanAndZoom({ x: -10, y: 20 }, 1.5); });
    expect(writes).toBe(0); // identical state — an identical write still costs a raster

    act(() => { result.current.setPanAndZoom({ x: -10, y: 21 }, 1.5); });
    expect(writes).toBe(1);
  });

  it('writes the attribute again after the content group remounts', () => {
    // NodeCanvas swaps the whole <svg> out through its loading / no-graph
    // branches. A remounted <g> carries no transform attribute, so a guard that
    // compared only pan/zoom VALUES would skip the write and strand the canvas
    // at raw canvas coords (~50k units off).
    const { result, contentGroupRef } = setup();

    act(() => { result.current.jumpTo({ x: -120, y: 60 }, 1.5); });
    expect(readTransform(contentGroupRef)).not.toBeNull();

    const remounted = makeGroup();
    contentGroupRef.current = remounted;
    expect(remounted.getAttribute('transform')).toBeNull();

    // Same pan/zoom values as before — only element identity differs.
    act(() => { result.current.applyTransform(); });

    expect(readTransform(contentGroupRef)).toEqual({
      tx: -120 + 50000 * 1.5,
      ty: 60 + 50000 * 1.5,
      z: 1.5,
    });
  });

  it('keeps the orbit layer in the same coordinate space as the canvas', () => {
    // Orbit renders its focus node and overlay into a second <svg> above the
    // scrim. The two layers only line up if they carry the identical transform;
    // any drift would put the orbit somewhere other than on its node.
    const { result, contentGroupRef, overlayGroupRef } = setup({ withOverlay: true });

    for (const [pan, zoom] of [
      [{ x: 0, y: 0 }, 1],
      [{ x: -640, y: 275 }, 2.5],
      [{ x: 1200, y: -80 }, 0.6],
    ]) {
      act(() => { result.current.setPanAndZoom(pan, zoom); });
      expect(overlayGroupRef.current.getAttribute('transform'))
        .toBe(contentGroupRef.current.getAttribute('transform'));
    }

    // And a layer that mounts mid-session (orbit opening) picks up the current
    // transform on the next write rather than staying at identity.
    const lateGroup = makeGroup();
    overlayGroupRef.current = lateGroup;
    expect(lateGroup.getAttribute('transform')).toBeNull();
    act(() => { result.current.applyTransform(); });
    expect(lateGroup.getAttribute('transform'))
      .toBe(contentGroupRef.current.getAttribute('transform'));
  });

  it('tolerates having no orbit layer', () => {
    const { result, contentGroupRef } = setup(); // overlay ref holds null
    act(() => { result.current.setPanAndZoom({ x: -5, y: 5 }, 1.5); });
    expect(readTransform(contentGroupRef).z).toBe(1.5);
  });

  it('defers settled state until the interaction stops, and flushes on demand', async () => {
    const { result } = setup();

    act(() => { result.current.setPanAndZoom({ x: -500, y: 250 }, 2); });
    // Still the initial values — settled state is deliberately behind the refs.
    expect(result.current.settledPan).toEqual({ x: 0, y: 0 });
    expect(result.current.settledZoom).toBe(1);
    expect(result.current.isMovingRef.current).toBe(true);

    act(() => { result.current.flushSettle(); });
    expect(result.current.settledPan).toEqual({ x: -500, y: 250 });
    expect(result.current.settledZoom).toBe(2);
    expect(result.current.isMovingRef.current).toBe(false);
  });

  it('jumpTo applies and settles in one step', () => {
    const { result, contentGroupRef } = setup();

    act(() => { result.current.jumpTo({ x: 77, y: -33 }, 4); });

    expect(readTransform(contentGroupRef).z).toBe(4);
    expect(result.current.settledPan).toEqual({ x: 77, y: -33 });
    expect(result.current.settledZoom).toBe(4);
    expect(result.current.isMovingRef.current).toBe(false);
  });
});
