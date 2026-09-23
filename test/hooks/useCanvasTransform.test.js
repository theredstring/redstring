import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
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

  const renders = { n: 0 };
  const { result } = renderHook(() => {
    renders.n++;
    return useCanvasTransform(svgRef, contentGroupRef, canvasSize, overlayGroupRef);
  });

  return { result, contentGroupRef, overlayGroupRef, canvasSize, renders };
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

/**
 * P1.09 / F-11 — a settle is a full NodeCanvas render, so a settle with nothing
 * new to publish must not commit. "Nothing new" is strict: the values equal what
 * was last committed AND the view has not been anywhere else since. A gesture
 * that wanders off and returns still commits a fresh object, because the
 * culling settle-prune keys on the settledPan identity.
 */
describe('useCanvasTransform settle skips no-op commits (P1.09)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const settle = () => act(() => { vi.advanceTimersByTime(1000); });

  function settledAt(pan, zoom) {
    const ctx = setup();
    act(() => { ctx.result.current.jumpTo(pan, zoom); });
    return ctx;
  }

  it('a settle after a mutation that moved nothing renders nothing', () => {
    const { result, renders } = settledAt({ x: -10, y: 20 }, 1.5);
    const pan = result.current.settledPan;
    const before = renders.n;

    // e.g. a wheel notch at the zoom clamp, a pan held against the canvas edge
    act(() => { result.current.setPanAndZoom({ x: -10, y: 20 }, 1.5); });
    act(() => { result.current.setPan((p) => ({ x: p.x, y: p.y })); });
    act(() => { result.current.setZoom(1.5); });
    expect(result.current.isMovingRef.current).toBe(true);
    settle();

    expect(renders.n).toBe(before);
    expect(result.current.settledPan).toBe(pan);
    expect(result.current.settledZoom).toBe(1.5);
    // The rest of the settle still happens.
    expect(result.current.isMovingRef.current).toBe(false);
  });

  it('flushSettle and jumpTo to the current view render nothing', () => {
    const { result, renders } = settledAt({ x: 5, y: -5 }, 2);
    const pan = result.current.settledPan;
    const before = renders.n;

    act(() => { result.current.flushSettle(); });
    act(() => { result.current.jumpTo({ x: 5, y: -5 }, 2); });

    expect(renders.n).toBe(before);
    expect(result.current.settledPan).toBe(pan);
  });

  it('commits when x, y or zoom changes, each on its own', () => {
    const { result } = settledAt({ x: 0, y: 0 }, 1);

    for (const [pan, zoom] of [
      [{ x: 1, y: 0 }, 1],
      [{ x: 1, y: 1 }, 1],
      [{ x: 1, y: 1 }, 1.25],
    ]) {
      const prev = result.current.settledPan;
      act(() => { result.current.setPanAndZoom(pan, zoom); });
      settle();
      expect(result.current.settledPan).not.toBe(prev);
      expect(result.current.settledPan).toEqual(pan);
      expect(result.current.settledZoom).toBe(zoom);
    }
  });

  it('a gesture that wanders off and returns still commits a fresh object', () => {
    const { result, renders } = settledAt({ x: -40, y: 60 }, 1);
    const pan = result.current.settledPan;
    const before = renders.n;

    act(() => { result.current.setPan({ x: -400, y: 60 }); });
    act(() => { result.current.setPan({ x: -40, y: 60 }); });
    settle();

    // Same values, new identity: the settle-prune effect must still run.
    expect(result.current.settledPan).not.toBe(pan);
    expect(result.current.settledPan).toEqual({ x: -40, y: 60 });
    expect(renders.n).toBe(before + 1);
  });

  it('a zoom that wanders off and returns still commits', () => {
    const { result } = settledAt({ x: 0, y: 0 }, 1);
    const pan = result.current.settledPan;

    act(() => { result.current.setZoom(2); });
    act(() => { result.current.setZoom(1); });
    settle();

    expect(result.current.settledPan).not.toBe(pan);
    expect(result.current.settledZoom).toBe(1);
  });

  it('commits a keyboard-style move: refs written directly, applyTransform, then flushSettle', () => {
    const { result } = settledAt({ x: 0, y: 0 }, 1);

    act(() => {
      result.current.panRef.current = { x: -30, y: -30 };
      result.current.applyTransform();
      result.current.flushSettle();
    });

    expect(result.current.settledPan).toEqual({ x: -30, y: -30 });
  });

  it('commits a ref write that never went through applyTransform', () => {
    const { result } = settledAt({ x: 0, y: 0 }, 1);

    act(() => {
      result.current.zoomRef.current = 0.5;
      result.current.flushSettle();
    });

    expect(result.current.settledZoom).toBe(0.5);
  });

  it('a later no-op settle is skipped again once a real one has committed', () => {
    const { result, renders } = settledAt({ x: 0, y: 0 }, 1);

    act(() => { result.current.setPan({ x: 9, y: 9 }); });
    settle();
    const pan = result.current.settledPan;
    expect(pan).toEqual({ x: 9, y: 9 });
    const before = renders.n;

    act(() => { result.current.setPan({ x: 9, y: 9 }); });
    settle();

    expect(result.current.settledPan).toBe(pan);
    expect(renders.n).toBe(before);
  });
});
