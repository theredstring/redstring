import { useRef, useState, useCallback } from 'react';

/**
 * useCanvasTransform — DOM-bypass pan/zoom for NodeCanvas.
 *
 * Owns panOffset and zoomLevel as refs (not state).  Every mutation writes
 * directly to the DOM, bypassing React reconciliation.
 *
 * Two write paths, chosen per mutation:
 *
 * 1. ATTRIBUTE path (pans, and every commit): the transform is written to the
 *    content <g>'s SVG transform attribute. This invalidates and re-rasters
 *    the SVG — cheap at an unchanged scale (glyph/image caches stay warm),
 *    which is why panning never flickered.
 *
 * 2. GESTURE path (zoom changes): re-rastering per tick at a CHANGING scale
 *    is the expensive case — every glyph and image resamples at the new scale
 *    on every tick, and the cost grows the further in you zoom. Left
 *    unchecked it exhausts the compositor's tile budget (Chrome logs
 *    "tile memory limits exceeded" and drops tiles, which reads as flicker).
 *    So while a zoom gesture is in flight the attribute keeps its last
 *    committed "baseline" value and only the DELTA (scale ratio +
 *    translation) is written as a CSS transform on a viewport-sized,
 *    overflow-hidden wrapper around the <svg> (`gestureLayerRef`). The
 *    wrapper carries `will-change: transform` for the duration, and
 *    Chromium/WebKit do NOT re-raster a will-change:transform layer when its
 *    transform changes — the existing raster is scaled on the compositor
 *    (slightly soft while zooming, sharp again on commit). The real attribute
 *    is committed once when the gesture settles (or at the recommit
 *    thresholds below), collapsing dozens of full-SVG re-rasters per second
 *    into one or two.
 *
 * The delta is EXACT, not an approximation: delta ∘ baseline = target, so
 * every consumer that derives geometry from panRef/zoomRef stays correct
 * mid-gesture. Only raster sharpness degrades, never position.
 *
 * The outer <svg> itself is still never CSS-transformed (it is intrinsically
 * 100k×100k; promoting IT would create a 100k compositor layer). The wrapper
 * is viewport-sized and clips, so its layer is viewport-sized.
 *
 * A debounced "settled" React state pair (`settledPan`, `settledZoom`) is
 * exposed for consumers that need React re-renders (culling, child-component
 * props, view-state persistence).  These update only after the user stops
 * interacting for `SETTLE_DELAY` ms — the same moment the gesture delta is
 * committed to the attribute.
 *
 * `isMovingRef` is the inverse signal: true from the first mutation of a gesture
 * until it settles.  It is a REF, not state, on purpose.  It was state once, so
 * that a memo could pick a cheaper rendering while the view moved — but the
 * canvas is expensive enough to render that the two flips per gesture cost more
 * than any in-motion shortcut saved (measured at 143ms per flip on a real
 * universe with connection labels on).  Anything reading this must do so from a
 * per-frame or event path, never from render scope.
 *
 * Runtime dials (console, no rebuild):
 *   window.__compositorZoom = false   — disable the gesture path entirely and
 *                                       write the attribute every tick, i.e.
 *                                       the pre-compositor behaviour. Use it
 *                                       to A/B the tile-memory warnings.
 *   window.__zoomRecommit = { up, down, exposurePx }  — override the
 *                                       thresholds below to calibrate the
 *                                       softness/exposure tradeoff live.
 */

const SETTLE_DELAY = 150; // ms of inactivity before settled state updates + gesture commit

// Recommit thresholds for the gesture path. Each recommit is one full SVG
// re-raster — the cost that used to be paid on EVERY tick — so these bound how
// far the compositor delta may drift from the baseline raster before paying it.
//
// Upscale past RECOMMIT_SCALE_UP just looks soft, so zoom-IN can ride a long
// way: the baseline raster already contains everything a magnified subset of
// the viewport needs.
//
// Zoom-OUT is the opposite and does not composite at all (RECOMMIT_SCALE_DOWN
// = 1, i.e. any r < 1 commits immediately). Shrinking the baseline exposes a
// ring of canvas the raster never painted — blank background where nodes, the
// grid and especially long connections running off-screen should be — and it
// cannot be fixed by loosening or tightening the bound: a looser one shows a
// bigger blank ring, a tighter one stalls on more full re-rasters. Since the
// tile-budget blowout this whole path exists to fix grows with zoom DEPTH,
// giving zoom-out back its per-tick attribute writes costs little and restores
// correct rendering. Set `window.__zoomRecommit = { down: 0.85 }` to
// re-enable compositing on the way out and see the ring for yourself.
//
// RECOMMIT_EXPOSURE_PX still guards the same never-painted-margin problem for
// large pans folded into a live zoom-in delta.
const RECOMMIT_SCALE_UP = 1.5;
const RECOMMIT_SCALE_DOWN = 1;
const RECOMMIT_EXPOSURE_PX = 100;

// The gesture path is a fix for a Chromium tile-budget failure, and it puts a
// scaling, clipping, composited ancestor above content this codebase has four
// separate notes about WebKit mishandling: promoted <g>s relocate foreignObject
// to the SVG origin (Node.css), group opacity does the same (Node.jsx), a
// clipPath ancestor blanks it (Node.jsx), and "HTML inside SVG inside SVG fails
// on iOS WebKit when the parent SVG canvas has a scale transform" (Node.jsx).
// Chromium-only by default; `window.__compositorZoom = true` forces it on for
// testing, `= false` forces it off anywhere.
const IS_WEBKIT = typeof navigator !== 'undefined'
  && /AppleWebKit/.test(navigator.userAgent || '')
  && !/Chrome|Chromium|Edg\//.test(navigator.userAgent || '');

export function useCanvasTransform(svgRef, contentGroupRef, canvasSize, gestureLayerRef) {
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);

  const [settledPan, setSettledPan] = useState({ x: 0, y: 0 });
  const [settledZoom, setSettledZoom] = useState(1);
  // Gesture-in-flight flag. A ref, never state — see the header note.
  const movingRef = useRef(false);

  const settleTimerRef = useRef(null);

  // Consumer-supplied callback fired synchronously on every pan/zoom mutation.
  // Used by the culling system to recompute visibility without waiting for the
  // settled-state debounce. Consumers assign via `transform.onTransformChangeRef.current = fn`.
  // It is fired AGAIN on every commit (with gestureActiveRef already cleared),
  // so consumers that defer work during a gesture catch up at the commit.
  const onTransformChangeRef = useRef(null);

  // The pan/zoom last committed to the content <g>'s transform ATTRIBUTE —
  // i.e. the state the SVG raster actually reflects. `zoom: NaN` forces the
  // first commit to write. During a zoom gesture panRef/zoomRef run ahead of
  // this baseline and the difference rides the gesture layer's CSS transform.
  const rasterRef = useRef({ x: 0, y: 0, zoom: NaN });
  // True while a CSS delta is riding on the gesture layer. Consumers that
  // mutate the SVG DOM per transform tick (culling, the orbit dim rect) must
  // skip their work while this is set — the raster is deliberately frozen, and
  // any write to the content group invalidates it — and catch up on the commit
  // re-fire of onTransformChange.
  const gestureActiveRef = useRef(false);

  // The exact elements the baseline and the delta were last written to. The
  // <svg> and its content <g> unmount and remount whenever NodeCanvas swings
  // through its loading / no-universe / no-graph branches, and a remounted <g>
  // carries NO transform attribute. Comparing pan/zoom VALUES cannot see that —
  // if they happen to equal the baseline, a value-only guard would skip the
  // write and leave the canvas parked at raw canvas coords (~50k units off).
  // So identity is what gates the write, not equality.
  const writtenGroupRef = useRef(null);
  const writtenLayerRef = useRef(null);

  // Drop any delta state that belongs to an element we are no longer writing to.
  // Called at the top of both write paths.
  const reconcileElements = useCallback(() => {
    const layer = gestureLayerRef?.current;
    if (layer !== writtenLayerRef.current) {
      // A fresh layer has no inline transform, so any "active" delta is fiction.
      gestureActiveRef.current = false;
      writtenLayerRef.current = layer || null;
    }
    if (contentGroupRef.current !== writtenGroupRef.current && gestureActiveRef.current) {
      // A fresh group has no attribute, so the next commit will write the FULL
      // transform — but the delta above it is still describing a raster that no
      // longer exists. Strip it here, or the two compose and the canvas lands
      // at delta × target. (The commit's own cleanup can't do this: it is gated
      // on the very flag being cleared.)
      gestureActiveRef.current = false;
      if (layer) {
        layer.style.transform = '';
        layer.style.willChange = '';
      }
    }
    if (contentGroupRef.current !== writtenGroupRef.current) {
      // The baseline describes a raster that no longer exists. Force a write.
      rasterRef.current = { x: 0, y: 0, zoom: NaN };
    }
  }, [contentGroupRef, gestureLayerRef]);

  // Commit the authoritative pan/zoom to the SVG attribute and clear any CSS
  // delta. This is the only place the attribute (and the raster baseline) is
  // written.
  const commitTransform = useCallback(() => {
    const g = contentGroupRef.current;
    if (!g) return;
    reconcileElements();
    const p = panRef.current;
    const z = zoomRef.current;
    const cs = canvasSize;
    const tx = p.x - cs.offsetX * z;
    const ty = p.y - cs.offsetY * z;
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(z)) {
      console.warn('[transform] invalid values', {
        px: p.x, py: p.y, z,
        csOffX: cs?.offsetX, csOffY: cs?.offsetY,
        tx, ty,
      });
      return;
    }
    const base = rasterRef.current;
    // Skip the DOM write when this exact element already carries this exact
    // state and no CSS delta rides above it — setAttribute with identical
    // values still invalidates the raster. Element identity is part of the
    // test: see writtenGroupRef.
    if (
      g === writtenGroupRef.current &&
      !gestureActiveRef.current &&
      base.x === p.x && base.y === p.y && base.zoom === z
    ) return;
    // SVG transform attribute: spaces between args, no `px` units.
    g.setAttribute('transform', `translate(${tx} ${ty}) scale(${z})`);
    writtenGroupRef.current = g;
    rasterRef.current = { x: p.x, y: p.y, zoom: z };
    if (gestureActiveRef.current) {
      gestureActiveRef.current = false;
      const layer = gestureLayerRef?.current;
      if (layer) {
        layer.style.transform = '';
        // Drop the promotion at rest. Leaving will-change on would pin a
        // permanently-composited texture for the whole canvas — the same
        // mistake documented in Node.css, PieMenu.css and OrbitOverlay.
        layer.style.willChange = '';
      }
    }
  }, [contentGroupRef, gestureLayerRef, canvasSize, reconcileElements]);

  // Apply the current refs as a compositor-only delta above the baseline
  // raster, recommitting when the delta drifts past the quality/coverage
  // thresholds. Falls back to a direct commit when there is no gesture layer.
  const applyGestureTransform = useCallback(() => {
    reconcileElements();
    const layer = gestureLayerRef?.current;
    const base = rasterRef.current;
    const override = typeof window !== 'undefined' ? window.__compositorZoom : undefined;
    const enabled = override === true ? true : (override === false ? false : !IS_WEBKIT);
    if (!enabled || !layer || !Number.isFinite(base.zoom)) { commitTransform(); return; }
    const p = panRef.current;
    const z = zoomRef.current;
    const r = z / base.zoom;
    if (!gestureActiveRef.current && r === 1) {
      // Pure pan outside a zoom gesture: attribute path (see header).
      commitTransform();
      return;
    }
    const cs = canvasSize;
    const tx = p.x - cs.offsetX * z;
    const ty = p.y - cs.offsetY * z;
    const btx = base.x - cs.offsetX * base.zoom;
    const bty = base.y - cs.offsetY * base.zoom;
    // Solve delta ∘ baseline = target (about the wrapper's 0,0 origin, which
    // coincides with the SVG's attribute-coordinate origin).
    const dx = tx - r * btx;
    const dy = ty - r * bty;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(r)) { commitTransform(); return; }
    const dial = (typeof window !== 'undefined' && window.__zoomRecommit) || null;
    const upLimit = dial?.up ?? RECOMMIT_SCALE_UP;
    const downLimit = dial?.down ?? RECOMMIT_SCALE_DOWN;
    const exposureLimit = dial?.exposurePx ?? RECOMMIT_EXPOSURE_PX;
    // Screen-space strips showing content the baseline raster never painted
    // (the wrapper clips the raster to the viewport at commit time).
    const vw = layer.clientWidth || 0;
    const vh = layer.clientHeight || 0;
    const exposure = Math.max(
      dx,               // left strip
      dy,               // top strip
      vw - (dx + r * vw), // right strip
      vh - (dy + r * vh)  // bottom strip
    );
    if (r > upLimit || r < downLimit || exposure > exposureLimit) {
      commitTransform();
      return;
    }
    if (!gestureActiveRef.current) {
      gestureActiveRef.current = true;
      // Promote for the duration of the gesture only — see commitTransform.
      layer.style.willChange = 'transform';
      writtenLayerRef.current = layer;
    }
    // One matrix() rather than translate()+scale() — same result, but no chance
    // of the two forms disagreeing about whether this is a 2D or 3D transform.
    layer.style.transform = `matrix(${r}, 0, 0, ${r}, ${dx}, ${dy})`;
  }, [gestureLayerRef, canvasSize, commitTransform, reconcileElements]);

  // Schedule a deferred React state update when interaction settles. The
  // settle also commits any in-flight gesture delta (one full re-raster) and
  // re-fires onTransformChange so deferred consumers catch up.
  const scheduleSettle = useCallback(() => {
    movingRef.current = true;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      movingRef.current = false;
      commitTransform();
      setSettledPan({ ...panRef.current });
      setSettledZoom(zoomRef.current);
      onTransformChangeRef.current?.();
    }, SETTLE_DELAY);
  }, [commitTransform]);

  // Immediately flush settled state (for graph switches, navigations, etc.)
  const flushSettle = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    movingRef.current = false;
    commitTransform();
    setSettledPan({ ...panRef.current });
    setSettledZoom(zoomRef.current);
  }, [commitTransform]);

  const setPan = useCallback((newPan) => {
    // Support functional updater form:  setPan(prev => newVal)
    if (typeof newPan === 'function') {
      panRef.current = newPan(panRef.current);
    } else {
      panRef.current = newPan;
    }
    // A pan that arrives mid-zoom-gesture folds into the CSS delta; otherwise
    // it takes the attribute path directly.
    if (gestureActiveRef.current) applyGestureTransform(); else commitTransform();
    scheduleSettle();
    onTransformChangeRef.current?.();
  }, [applyGestureTransform, commitTransform, scheduleSettle]);

  const setZoom = useCallback((newZoom) => {
    if (typeof newZoom === 'function') {
      zoomRef.current = newZoom(zoomRef.current);
    } else {
      zoomRef.current = newZoom;
    }
    applyGestureTransform();
    scheduleSettle();
    onTransformChangeRef.current?.();
  }, [applyGestureTransform, scheduleSettle]);

  // Convenience: set both in one call (one DOM write, one settle timer reset)
  const setPanAndZoom = useCallback((newPan, newZoom) => {
    if (typeof newPan === 'function') {
      panRef.current = newPan(panRef.current);
    } else {
      panRef.current = newPan;
    }
    if (typeof newZoom === 'function') {
      zoomRef.current = newZoom(zoomRef.current);
    } else {
      zoomRef.current = newZoom;
    }
    applyGestureTransform();
    scheduleSettle();
    onTransformChangeRef.current?.();
  }, [applyGestureTransform, scheduleSettle]);

  // Same as setPanAndZoom but also immediately flushes settled state
  // (use for discrete jumps like graph-switch restore)
  const jumpTo = useCallback((newPan, newZoom) => {
    panRef.current = typeof newPan === 'function' ? newPan(panRef.current) : newPan;
    zoomRef.current = typeof newZoom === 'function' ? newZoom(zoomRef.current) : newZoom;
    flushSettle();
    onTransformChangeRef.current?.();
  }, [flushSettle]);

  return {
    // Refs — read in event handlers / animation loops
    panRef,
    zoomRef,

    // Settled React state — use for child props, dependency arrays, JSX
    settledPan,
    settledZoom,

    // True while a pan/zoom gesture is in flight (see the header note)
    isMovingRef: movingRef,

    // True while a compositor delta is riding on the gesture layer (raster
    // frozen). Per-tick consumers that mutate the SVG DOM must check this.
    gestureActiveRef,

    // Mutators
    setPan,
    setZoom,
    setPanAndZoom,
    jumpTo,

    // Direct DOM application with commit semantics (call after externally
    // mutating refs — writes the attribute and clears any gesture delta)
    applyTransform: commitTransform,
    // Direct DOM application via the gesture path (call after externally
    // mutating refs in a per-frame loop — e.g. the keyboard zoom loop, which
    // bypasses the mutators). Must be paired with a flushSettle() when the
    // movement ends, or the delta never commits.
    applyGestureTransform,
    flushSettle,

    // Consumer-writable: assign a function to receive synchronous notification
    // on every pan/zoom mutation (used by culling to read live ref values).
    onTransformChangeRef,
  };
}
