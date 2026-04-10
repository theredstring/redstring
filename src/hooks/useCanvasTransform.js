import { useRef, useState, useCallback } from 'react';

/**
 * useCanvasTransform — DOM-bypass pan/zoom for NodeCanvas.
 *
 * Owns panOffset and zoomLevel as refs (not state).  Every mutation writes
 * directly to the SVG element's style.transform, bypassing React reconciliation.
 *
 * A debounced "settled" React state pair (`settledPan`, `settledZoom`) is
 * exposed for consumers that need React re-renders (culling, child-component
 * props, view-state persistence).  These update only after the user stops
 * interacting for `SETTLE_DELAY` ms.
 */

const SETTLE_DELAY = 150; // ms of inactivity before settled state updates

export function useCanvasTransform(svgRef, canvasSize) {
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);

  const [settledPan, setSettledPan] = useState({ x: 0, y: 0 });
  const [settledZoom, setSettledZoom] = useState(1);

  const settleTimerRef = useRef(null);

  // Consumer-supplied callback fired synchronously on every pan/zoom mutation.
  // Used by the culling system to recompute visibility without waiting for the
  // settled-state debounce. Consumers assign via `transform.onTransformChangeRef.current = fn`.
  const onTransformChangeRef = useRef(null);

  // Write transform directly to SVG DOM element — no React involved.
  const applyTransform = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const p = panRef.current;
    const z = zoomRef.current;
    const cs = canvasSize;
    svg.style.transform =
      `translate(${p.x - cs.offsetX * z}px, ${p.y - cs.offsetY * z}px) scale(${z})`;
  }, [svgRef, canvasSize]);

  // Schedule a deferred React state update when interaction settles.
  const scheduleSettle = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      setSettledPan({ ...panRef.current });
      setSettledZoom(zoomRef.current);
    }, SETTLE_DELAY);
  }, []);

  // Immediately flush settled state (for graph switches, navigations, etc.)
  const flushSettle = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
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
