/**
 * The zoom bar: a small horizontal slider centred along the bottom of the
 * usable canvas, riding above the TypeList when it is open.
 *
 * The track is logarithmic, so every stretch of it is the same zoom ratio. The
 * thumb follows the live camera (wheel, pinch, keyboard, framing), drags to
 * zoom, and the icons at either end step to the next eighth of the track. The
 * world scales about the middle of the usable viewport, as the keyboard zoom
 * does.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import useGraphStore from '../../../store/graphStore.js';
import { useViewportBounds } from '../../../hooks/useViewportBounds';
import { haptic } from '../../../services/haptics.js';
import './ZoomBar.css';

// Clearance above the TypeList (or the bottom edge when it is closed). Matches
// the 20px the bottom control panels and the download pill leave.
const BOTTOM_GAP = 20;
// Height of the bar, exported so the download pill can sit above it.
export const ZOOM_BAR_HEIGHT = 32;
// The top of the track. The wheel can zoom far past this (MAX_ZOOM is 1000);
// out there the thumb rests at the end of the track.
const BAR_MAX_ZOOM = 8;
// The icons move the thumb to the next of this many notches.
const STEPS = 8;
const STEP_MS = 320;
// Short enough to feel attached to the finger, long enough to smooth it.
const DRAG_MS = 90;

export default function ZoomBar({ ctx, suppressed }) {
  const {
    zoomLevel, zoomLevelRef, panOffsetRef, animateCanvasView, MIN_ZOOM, viewportSize, canvasSize,
  } = ctx;
  const leftPanelExpanded = useGraphStore(state => state.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(state => state.rightPanelExpanded);
  const typeListMode = useGraphStore(state => state.typeListMode);
  // Only over a web: not on the universe screens or the empty-web prompt.
  const showingWeb = useGraphStore(state =>
    !!state.activeGraphId && state.isUniverseLoaded && !state.isUniverseLoading && state.hasUniverseFile);
  const viewportBounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListMode !== 'closed');

  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const minZoom = MIN_ZOOM;
  const lnMin = Math.log(minZoom);
  const lnSpan = Math.log(BAR_MAX_ZOOM) - lnMin;
  const toT = useCallback(
    (z) => Math.max(0, Math.min(1, (Math.log(z) - lnMin) / lnSpan)),
    [lnMin, lnSpan]
  );
  const fromT = useCallback((t) => Math.exp(lnMin + t * lnSpan), [lnMin, lnSpan]);

  const placeThumb = useCallback((t) => {
    if (thumbRef.current) thumbRef.current.style.left = `${t * 100}%`;
  }, []);

  // Follow the live camera. Pan and zoom write the DOM directly and only settle
  // into React state once a move stops, so the thumb listens to the per-frame
  // event and writes its own position rather than re-rendering.
  useEffect(() => {
    placeThumb(toT(zoomLevelRef.current ?? zoomLevel));
    const onTransform = (e) => {
      if (draggingRef.current) return;
      const z = e?.detail?.zoom ?? zoomLevelRef.current;
      if (z) placeThumb(toT(z));
    };
    window.addEventListener('canvas-transform-change', onTransform);
    return () => window.removeEventListener('canvas-transform-change', onTransform);
  }, [zoomLevel, zoomLevelRef, toT, placeThumb, showingWeb]);

  // Zoom about the middle of the usable viewport, in container-local coords
  // (the space panOffset lives in; see the keyboard zoom in useCanvasKeyboard).
  // Pan and zoom are eased together linearly, which holds that point still the
  // whole way, not just at the ends.
  const zoomTo = useCallback((targetZoom, durationMs) => {
    const prevZoom = zoomLevelRef.current;
    const newZoom = Math.max(minZoom, targetZoom);
    if (!prevZoom || Math.abs(newZoom - prevZoom) < 1e-6) return;
    const ratio = newZoom / prevZoom;
    const cx = viewportBounds.x + viewportBounds.width / 2;
    const cy = viewportBounds.height / 2;
    const prev = panOffsetRef.current;
    const minPanX = viewportSize.width - canvasSize.width * newZoom;
    const minPanY = viewportSize.height - canvasSize.height * newZoom;
    const pan = {
      x: Math.max(minPanX, Math.min(0, cx - (cx - prev.x) * ratio)),
      y: Math.max(minPanY, Math.min(0, cy - (cy - prev.y) * ratio)),
    };
    animateCanvasView(pan, newZoom, durationMs);
  }, [minZoom, viewportBounds, viewportSize, canvasSize, panOffsetRef, zoomLevelRef, animateCanvasView]);

  const step = useCallback((dir) => {
    haptic('menuSelect');
    const t = toT(zoomLevelRef.current);
    // Snap to the next notch in that direction, so steps land on eighths
    // however the zoom got where it is.
    const notch = dir > 0
      ? Math.floor(t * STEPS + 1e-6) + 1
      : Math.ceil(t * STEPS - 1e-6) - 1;
    const next = Math.max(0, Math.min(STEPS, notch)) / STEPS;
    placeThumb(next);
    zoomTo(fromT(next), STEP_MS);
  }, [toT, fromT, zoomLevelRef, placeThumb, zoomTo]);

  const tFromPointer = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const onTrackPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    const t = tFromPointer(e.clientX);
    if (t == null) return;
    placeThumb(t);
    // A press away from the thumb travels there at step speed; the drag that
    // follows takes over from wherever the camera has got to.
    zoomTo(fromT(t), STEP_MS);
  };

  const onTrackPointerMove = (e) => {
    if (!draggingRef.current) return;
    const t = tFromPointer(e.clientX);
    if (t == null) return;
    placeThumb(t);
    zoomTo(fromT(t), DRAG_MS);
  };

  const endDrag = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // The bar sits inside .canvas-area, whose React handlers start marquees,
  // pans and taps. Keep presses here from reaching them. (Wheel is left to
  // bubble: scrolling over the bar still zooms the canvas.)
  const stop = (e) => e.stopPropagation();
  const shield = {
    onMouseDown: stop, onMouseUp: stop, onMouseMove: stop, onClick: stop, onDoubleClick: stop,
    onTouchStart: stop, onTouchMove: stop, onTouchEnd: stop, onTouchCancel: stop,
    onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); },
  };

  if (!showingWeb) return null;

  const centerX = viewportBounds.x + viewportBounds.width / 2;
  const bottom = viewportBounds.bottomReserved + BOTTOM_GAP;

  return (
    <div
      className={`zoom-bar${suppressed ? ' is-suppressed' : ''}${dragging ? ' is-dragging' : ''}`}
      style={{ left: centerX, bottom, height: ZOOM_BAR_HEIGHT }}
      {...shield}
    >
      <button
        type="button"
        className="zoom-bar-icon"
        onClick={() => step(-1)}
        aria-label="Zoom out"
        title="Zoom out"
        tabIndex={suppressed ? -1 : 0}
      >
        <ZoomOut size={18} strokeWidth={2.25} />
      </button>
      <div
        ref={trackRef}
        className="zoom-bar-track"
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="zoom-bar-line" />
        <div ref={thumbRef} className="zoom-bar-thumb" />
      </div>
      <button
        type="button"
        className="zoom-bar-icon"
        onClick={() => step(1)}
        aria-label="Zoom in"
        title="Zoom in"
        tabIndex={suppressed ? -1 : 0}
      >
        <ZoomIn size={18} strokeWidth={2.25} />
      </button>
    </div>
  );
}
