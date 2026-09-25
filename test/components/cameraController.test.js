import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createCameraController } from '../../src/components/canvas/camera/cameraController.js';
import { VIEW_MOTION_MIN_SAMPLES, VIEW_MOTION_STALE_MS } from '../../src/utils/canvas/input/inputTuning.js';

// The camera controller (P4.02): momentum, view motion, trackpad zoom and the
// wheel, moved out of NodeCanvas. NodeCanvas creates it once and hands it its
// live values through ctxRef.

const ref = (current) => ({ current });

function makeCtx(over = {}) {
  const canvasSize = { width: 100000, height: 100000, offsetX: -50000, offsetY: -50000 };
  const viewportSize = { width: 1200, height: 800 };
  const ctx = {
    MIN_ZOOM: 0.05, MAX_ZOOM: 4,
    canvasSize, canvasSizeRef: ref(canvasSize), viewportSize, viewportSizeRef: ref(viewportSize),
    containerRef: ref({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }) }),
    panOffsetRef: ref({ x: -50000, y: -50000 }), zoomLevelRef: ref(1),
    isPanningOrZooming: ref(false), panVelocityHistoryRef: ref([1, 2]), isAnimatingZoomRef: ref(false),
    visibleNodeIdsRef: ref(new Set()), visibleEdgesRef: ref([]),
    setPanAndZoom: vi.fn((pan, zoom) => { ctx.panOffsetRef.current = pan; ctx.zoomLevelRef.current = zoom; }),
    setPanOffset: vi.fn(),
    ...over,
  };
  return ctx;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('createCameraController', () => {
  it('provides every name NodeCanvas takes from it', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/NodeCanvas.jsx'), 'utf8');
    const names = new Set();
    for (const m of src.matchAll(/const \{([^}]*)\} = camera;/g)) m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => names.add(n));
    for (const m of src.matchAll(/\bcamera\.(\w+)/g)) names.add(m[1]);
    expect(names.size).toBeGreaterThan(5);
    const camera = createCameraController(ref(makeCtx()));
    for (const n of names) expect(camera[n], n).toBeDefined();
  });

  it('reads the view as moving only after enough moving samples, and not once they go stale', () => {
    const ctx = makeCtx();
    const camera = createCameraController(ref(ctx));
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    expect(camera.isViewMoving()).toBe(false);
    for (let i = 0; i <= VIEW_MOTION_MIN_SAMPLES; i++) {
      now += 16;
      ctx.panOffsetRef.current = { x: ctx.panOffsetRef.current.x + 40, y: ctx.panOffsetRef.current.y };
      camera.sampleViewMotion();
    }
    expect(camera.isViewMoving()).toBe(true);
    now += VIEW_MOTION_STALE_MS + 1;
    expect(camera.isViewMoving()).toBe(false);
  });

  it('stopPanMomentum clears the glide and the panning flag', () => {
    const ctx = makeCtx();
    ctx.isPanningOrZooming.current = true;
    const camera = createCameraController(ref(ctx));
    Object.assign(camera.panMomentumRef.current, { vx: 3, vy: 4, active: true, source: 'touch' });
    camera.stopPanMomentum();
    expect(camera.panMomentumRef.current).toMatchObject({ vx: 0, vy: 0, active: false, source: null, animationId: null });
    expect(ctx.isPanningOrZooming.current).toBe(false);
    expect(ctx.panVelocityHistoryRef.current).toEqual([]);
  });

  it('trackpad zoom eases to the target and keeps the world point under the cursor fixed', () => {
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const ctx = makeCtx();
    const camera = createCameraController(ref(ctx));
    const cursor = { x: 300, y: 200 };
    const worldAt = () => {
      const p = ctx.panOffsetRef.current, z = ctx.zoomLevelRef.current;
      return { x: (cursor.x - p.x) / z + ctx.canvasSize.offsetX, y: (cursor.y - p.y) / z + ctx.canvasSize.offsetY };
    };
    const before = worldAt();
    camera.setTrackpadZoomTarget(2, cursor.x, cursor.y, 0.05, 4);
    let t = 0;
    for (let i = 0; i < 200 && frames.length; i++) { const cb = frames.shift(); t += 16; cb(t); }
    expect(ctx.zoomLevelRef.current).toBeCloseTo(2, 3);
    const after = worldAt();
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    expect(ctx.isPanningOrZooming.current).toBe(false);
  });
});
