import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runMarqueeEdgePan, runConnectionEdgePan } from '../../src/components/canvas/input/edgePan.js';
import useGraphStore from '../../src/store/graphStore.js';

// A hand-cranked rAF: each tick() runs the frames queued since the last one.
let queue = [];
const tick = () => { const run = queue; queue = []; run.forEach((fn) => fn()); };

const ref = (current) => ({ current });

// An 800x600 viewport over a 10000x10000 canvas, panned well inside it.
const marqueeCtx = (pointer) => {
  const updates = [];
  const ctx = {
    selectionStart: { x: 0, y: 0 },
    selectionStartRef: ref({ x: 0, y: 0 }),
    isMouseDown: ref(true),
    mouseMoved: ref(true),
    containerRef: ref({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }),
    updateMarquee: (x, y) => updates.push({ x, y }),
    isAnimatingZoomRef: ref(false),
    mousePositionRef: ref(pointer),
    viewportBoundsRef: ref({ x: 0, y: 0, width: 800, height: 600 }),
    panOffsetRef: ref({ x: -5000, y: -5000 }),
    zoomLevelRef: ref(1),
    canvasSizeRef: ref({ width: 10000, height: 10000, offsetX: -5000, offsetY: -5000 }),
    viewportSizeRef: ref({ width: 800, height: 600 }),
    setPanOffset: vi.fn(),
  };
  return { ctx, updates };
};

beforeEach(() => {
  queue = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => { queue.push(fn); return queue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { queue = []; });
  useGraphStore.setState({ mouseSettings: { ...useGraphStore.getState().mouseSettings, marqueeEdgePanEnabled: true } });
});
afterEach(() => vi.unstubAllGlobals());

describe('marquee edge-pan', () => {
  it('pans toward the edge the pointer is held at and keeps the box corner under it', () => {
    const { ctx, updates } = marqueeCtx({ x: 799, y: 300 });
    const stop = runMarqueeEdgePan(ctx);
    tick();
    const pan = ctx.panOffsetRef.current;
    expect(pan.x).toBeLessThan(-5000); // view moves right: pan goes more negative
    expect(pan.y).toBe(-5000);
    expect(ctx.setPanOffset).toHaveBeenCalledWith(pan);
    expect(updates).toHaveLength(1);
    // The corner tracks the pointer's canvas point under the new pan.
    tick();
    expect(updates[1].x).toBeGreaterThan(updates[0].x);
    stop();
  });

  it('stays still away from the edge, before the pointer has moved, and when switched off', () => {
    const away = marqueeCtx({ x: 400, y: 300 });
    const stop1 = runMarqueeEdgePan(away.ctx); tick(); stop1();
    expect(away.ctx.setPanOffset).not.toHaveBeenCalled();

    const unmoved = marqueeCtx({ x: 799, y: 300 });
    unmoved.ctx.mouseMoved.current = false;
    const stop2 = runMarqueeEdgePan(unmoved.ctx); tick(); stop2();
    expect(unmoved.ctx.setPanOffset).not.toHaveBeenCalled();

    useGraphStore.setState({ mouseSettings: { ...useGraphStore.getState().mouseSettings, marqueeEdgePanEnabled: false } });
    const off = marqueeCtx({ x: 799, y: 300 });
    const stop3 = runMarqueeEdgePan(off.ctx); tick(); stop3();
    expect(off.ctx.setPanOffset).not.toHaveBeenCalled();
  });

  it('does nothing without a marquee', () => {
    const { ctx } = marqueeCtx({ x: 799, y: 300 });
    expect(runMarqueeEdgePan({ ...ctx, selectionStart: null })).toBeUndefined();
    expect(queue).toHaveLength(0);
  });
});

describe('connection edge-pan (shared loop)', () => {
  it('still pans a connection draw and re-projects its endpoint', () => {
    const { ctx } = marqueeCtx({ x: 1, y: 599 });
    const reproject = vi.fn();
    const stop = runConnectionEdgePan({
      ...ctx, drawingConnectionFrom: { sourceInstanceId: 'a' }, drawingConnectionFromRef: ref({ sourceInstanceId: 'a' }),
      reprojectDrawingConnectionEnd: reproject,
    });
    tick();
    expect(ctx.panOffsetRef.current.x).toBeGreaterThan(-5000);
    expect(ctx.panOffsetRef.current.y).toBeLessThan(-5000);
    expect(reproject).toHaveBeenCalledWith(1, 599, ctx.panOffsetRef.current, 1);
    stop();
  });
});
