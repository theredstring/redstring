import { useRef, useState, useCallback } from 'react';

/**
 * useCanvasTransform — DOM-bypass pan/zoom for NodeCanvas.
 *
 * Owns panOffset and zoomLevel as refs (not state).  Every mutation writes
 * directly to the content <g>'s SVG transform attribute, bypassing React
 * reconciliation.
 *
 * A debounced "settled" React state pair (`settledPan`, `settledZoom`) is
 * exposed for consumers that need React re-renders (culling, child-component
 * props, view-state persistence).  These update only after the user stops
 * interacting for `SETTLE_DELAY` ms.
 *
 * `isMovingRef` is the inverse signal: true from the first mutation of a gesture
 * until it settles.  It is a REF, not state, on purpose.  It was state once, so
 * that a memo could pick a cheaper rendering while the view moved — but the
 * canvas is expensive enough to render that the two flips per gesture cost more
 * than any in-motion shortcut saved (measured at 143ms per flip on a real
 * universe with connection labels on).  Anything reading this must do so from a
 * per-frame or event path, never from render scope.
 *
 * A compositor-zoom path once lived here: during a zoom gesture it froze this
 * attribute at a baseline and rode the remainder as a CSS transform on a
 * promoted wrapper around the <svg>, to avoid re-rasterising the SVG every
 * tick. It was built to stop "tile memory limits exceeded" flicker. That
 * flicker turned out to be caused by the orbit dim rect — a ~9-viewport
 * translucent scrim inside the content group — and once that was fixed the
 * compositor path was measurably WORSE than plain attribute writes: each of its
 * recommits was one full re-raster, and the ones landing mid-zoom (where the
 * most elements are on screen at full detail) showed up as visible hitches. It
 * was removed rather than tuned. Do not reintroduce it without a measurement
 * showing attribute writes are the bottleneck.
 */

const SETTLE_DELAY = 150; // ms of inactivity before settled state updates

/**
 * @param {object} overlayGroupRef optional second content <g>, in a separate
 *   <svg> layered above the canvas. Orbit mode renders its focus node and
 *   overlay there so a scrim can sit between them and the graph without being
 *   a translucent element inside the graph's own raster. It carries the SAME
 *   transform, so both layers stay in one coordinate space.
 */
export function useCanvasTransform(svgRef, contentGroupRef, canvasSize, overlayGroupRef) {
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
  const onTransformChangeRef = useRef(null);

  // What each content <g> currently carries, keyed by the element itself. Keying
  // on the element rather than on values is load-bearing: the <svg> and its
  // content <g> unmount and remount whenever NodeCanvas swings through its
  // loading / no-universe / no-graph branches, and a remounted <g> carries NO
  // transform attribute. A value-only check cannot see that — if the values
  // happened to match, the write would be skipped and the canvas would render
  // at raw canvas coords (~50k units off). A fresh element is simply absent
  // from this map, so it always gets written.
  const writtenRef = useRef(new WeakMap());

  // ---------------------------------------------------------------------------
  // LABEL SUPPRESSION DURING ZOOM
  //
  // Zoom is categorically more expensive than pan, and connection labels are
  // where it lands. A rotated <text> cannot use the browser's cached per-glyph
  // alpha mask — it rasterises from outlines — and a STROKED rotated text is
  // the worst case of that. Pan survives it because the glyph matrices are
  // unchanged frame to frame, so whatever was rasterised once is reused. Zoom
  // changes the SCALE every frame, so every matrix is new and every glyph is
  // re-rasterised from its outline, every frame, with nothing to reuse. This is
  // also why manhattan is fast and straight/lombardi are not: manhattan labels
  // sit at 0°/90°, which is the axis-aligned fast path, and everything else is
  // rotated.
  //
  // The connection-colored outer ring doubles that: SVG paints one stroke per
  // element, so the ring is a SECOND stroked <text> per label, carrying a
  // stroke 2.1x wider than the halo's. Two full outline rasterisations per
  // label per frame, and the wider one covers more pixels.
  //
  // So the labels leave for the duration of a zoom gesture and come back when
  // it settles — the ring at once, the text after a delay that doubles as the
  // detector for whether this is a real gesture or a single wheel notch. All
  // of the timing lives in CSS next to the rule; this only owns the class.
  // See CONNECTION LABELS DURING A ZOOM GESTURE in NodeCanvas.css, and note
  // that the out-delay there is tuned against SETTLE_DELAY below, so the two
  // move together.
  //
  // Two DOM writes per gesture, one class each way, and NO React render — that
  // distinction is the whole reason this lives here rather than in a memo. The
  // previous attempt at an in-motion shortcut made "is the view moving" React
  // state, and the two renders per gesture cost 143ms each on a real universe,
  // which is more than any shortcut could return. See the header note.
  const gestureBaseZoomRef = useRef(1);
  const ringsHiddenRef = useRef(false);
  const ringedElsRef = useRef([null, null]);

  // The guard tracks WHICH elements were last written, not just the desired
  // state, for the same reason `writtenRef` above keys on the element: these
  // <g>s unmount and remount when NodeCanvas swings through its loading /
  // no-universe / no-graph branches, and a remounted one carries no class. A
  // state-only guard would early-return against a stale `true` and leave the
  // fresh element permanently unsuppressed.
  const setRingsHidden = useCallback((hidden) => {
    const content = contentGroupRef.current;
    const overlay = overlayGroupRef?.current || null;
    const prev = ringedElsRef.current;
    if (ringsHiddenRef.current === hidden && prev[0] === content && prev[1] === overlay) return;
    ringsHiddenRef.current = hidden;
    ringedElsRef.current = [content, overlay];
    content?.classList?.toggle('canvas-zooming', hidden);
    overlay?.classList?.toggle('canvas-zooming', hidden);
  }, [contentGroupRef, overlayGroupRef]);

  // Write transform directly to the content <g> element via SVG's native
  // transform attribute (not the outer <svg>'s CSS style.transform). This
  // keeps the SVG itself off the GPU compositor's CSS-transform path — the
  // browser's SVG renderer applies the transform during paint, so scale
  // changes don't invalidate a tile cache the way a 100k CSS-transformed
  // layer would.
  const applyTransform = useCallback(() => {
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
    // Only a SCALE change invalidates the glyph rasters; a pan reuses them, so
    // a pan keeps its rings. See LABEL RING SUPPRESSION above.
    if (z !== gestureBaseZoomRef.current) setRingsHidden(true);

    // SVG transform attribute: spaces between args, no `px` units.
    const value = `translate(${tx} ${ty}) scale(${z})`;
    const written = writtenRef.current;
    const write = (g) => {
      if (!g) return;
      // Skip when this element already carries this exact state — setAttribute
      // with identical values still invalidates the raster.
      const w = written.get(g);
      if (w && w.x === p.x && w.y === p.y && w.zoom === z) return;
      g.setAttribute('transform', value);
      written.set(g, { x: p.x, y: p.y, zoom: z });
    };
    write(contentGroupRef.current);
    write(overlayGroupRef?.current);
  }, [contentGroupRef, overlayGroupRef, canvasSize, setRingsHidden]);

  // Schedule a deferred React state update when interaction settles.
  const scheduleSettle = useCallback(() => {
    movingRef.current = true;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      movingRef.current = false;
      gestureBaseZoomRef.current = zoomRef.current;
      setRingsHidden(false);
      setSettledPan({ ...panRef.current });
      setSettledZoom(zoomRef.current);
    }, SETTLE_DELAY);
  }, [setRingsHidden]);

  // Immediately flush settled state (for graph switches, navigations, etc.)
  const flushSettle = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    movingRef.current = false;
    gestureBaseZoomRef.current = zoomRef.current;
    setRingsHidden(false);
    setSettledPan({ ...panRef.current });
    setSettledZoom(zoomRef.current);
  }, [setRingsHidden]);

  const setPan = useCallback((newPan) => {
    // Support functional updater form:  setPan(prev => newVal)
    if (typeof newPan === 'function') {
      panRef.current = newPan(panRef.current);
    } else {
      panRef.current = newPan;
    }
    applyTransform();
    scheduleSettle();
    onTransformChangeRef.current?.();
  }, [applyTransform, scheduleSettle]);

  const setZoom = useCallback((newZoom) => {
    if (typeof newZoom === 'function') {
      zoomRef.current = newZoom(zoomRef.current);
    } else {
      zoomRef.current = newZoom;
    }
    applyTransform();
    scheduleSettle();
    onTransformChangeRef.current?.();
  }, [applyTransform, scheduleSettle]);

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
    applyTransform();
    scheduleSettle();
    onTransformChangeRef.current?.();
  }, [applyTransform, scheduleSettle]);

  // Same as setPanAndZoom but also immediately flushes settled state
  // (use for discrete jumps like graph-switch restore)
  const jumpTo = useCallback((newPan, newZoom) => {
    panRef.current = typeof newPan === 'function' ? newPan(panRef.current) : newPan;
    zoomRef.current = typeof newZoom === 'function' ? newZoom(zoomRef.current) : newZoom;
    // A jump is discrete, not a gesture — rebase first so applyTransform below
    // doesn't strip the rings for the one frame before flushSettle restores them.
    gestureBaseZoomRef.current = zoomRef.current;
    applyTransform();
    flushSettle();
    onTransformChangeRef.current?.();
  }, [applyTransform, flushSettle]);

  return {
    // Refs — read in event handlers / animation loops
    panRef,
    zoomRef,

    // Settled React state — use for child props, dependency arrays, JSX
    settledPan,
    settledZoom,

    // True while a pan/zoom gesture is in flight (see the header note)
    isMovingRef: movingRef,

    // Mutators
    setPan,
    setZoom,
    setPanAndZoom,
    jumpTo,

    // Direct DOM application (call after externally mutating refs)
    applyTransform,
    flushSettle,

    // Consumer-writable: assign a function to receive synchronous notification
    // on every pan/zoom mutation (used by culling to read live ref values).
    onTransformChangeRef,
  };
}
