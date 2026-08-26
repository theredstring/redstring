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
  }, [contentGroupRef, overlayGroupRef, canvasSize]);

  // Schedule a deferred React state update when interaction settles.
  const scheduleSettle = useCallback(() => {
    movingRef.current = true;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      movingRef.current = false;
      setSettledPan({ ...panRef.current });
      setSettledZoom(zoomRef.current);
    }, SETTLE_DELAY);
  }, []);

  // Immediately flush settled state (for graph switches, navigations, etc.)
  const flushSettle = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    movingRef.current = false;
    setSettledPan({ ...panRef.current });
    setSettledZoom(zoomRef.current);
  }, []);

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
