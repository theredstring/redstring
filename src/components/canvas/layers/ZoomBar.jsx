/**
 * The zoom bar: a small slider, shown or hidden and placed from Settings ›
 * Display. On the left or right (right is the default) it is vertical, zoom-in
 * on top, centred under that side's panel toggle while the panel is closed and
 * just under the header beside it while open. At the bottom it is horizontal,
 * centred along the usable canvas and riding above the TypeList when it is
 * open.
 *
 * The track is logarithmic, so every stretch of it is the same zoom ratio. The
 * thumb follows the live camera (wheel, pinch, keyboard, framing), drags to
 * zoom, and the icons at either end step to the next eighth of the track. The
 * world scales about the middle of the usable viewport, as the keyboard zoom
 * does.
 *
 * Presence: the bar rests dimmed and wakes to full opacity while it is wanted,
 * which is one rule, `awake = near || engaged || lingering`:
 * - near: a mouse or pen within NEAR_PX of it;
 * - engaged: an icon held, or the thumb or track being dragged;
 * - lingering: the LINGER_MS after an interaction ends, so a tap on a touch
 *   screen (which has no hover) doesn't vanish under the finger.
 * Keyboard focus wakes it too (CSS, :focus-visible).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import useGraphStore from '../../../store/graphStore.js';
import { useViewportBounds } from '../../../hooks/useViewportBounds';
import { haptic } from '../../../services/haptics.js';
import { useTheme } from '../../../hooks/useTheme.js';
import { DARK_THEME } from '../../../utils/themeColors.js';
import { MAX_ZOOM, NODE_DEFAULT_COLOR, DEFAULT_ZOOM_BAR_POSITION } from '../../../constants';
import './ZoomBar.css';

// Clearance above the TypeList (or the bottom edge when it is closed). Matches
// the 20px the bottom control panels and the download pill leave.
const BOTTOM_GAP = 20;
// Height of the bar (its width, standing on a side), exported so the download
// pill can sit above it.
export const ZOOM_BAR_HEIGHT = 32;
// The panel toggles (ToggleButton): 50px squares on the window's edges, just
// under the header. A side bar is centred under its toggle, and keeps that
// inset from a panel's edge when the panel is open.
const PANEL_TOGGLE_SIZE = 50;
const SIDE_INSET = (PANEL_TOGGLE_SIZE - ZOOM_BAR_HEIGHT) / 2;
// Clearance below the toggle, or below the header with the panel open.
const SIDE_GAP = 12;
// A standing bar's length: two 28px icons, the 140px track, two 4px gaps
// (ZoomBar.css).
const BAR_LENGTH = 28 + 4 + 140 + 4 + 28;
// The panel resize handle's touch area (PanelResizers): HITBOX_WIDTH px into
// the canvas from an open panel's edge, centred on the window's height at
// 33% + 24px, between 84 and 374px tall. When a window is short enough that it
// reaches the bar, the bar steps out past it by this much more slop.
const RESIZER_HITBOX = 28;
const RESIZER_SLOP = 16;
// The icons move the thumb to the next of this many notches.
const STEPS = 8;
// How far a burst of clicks may queue ahead of the camera.
const MAX_LEAD = 3;
// A click this soon after the last one stacks onto it. Outlasts the hold delay,
// so a hold's first repeat carries on from the press.
const STACK_WINDOW_MS = 500;
const STEP_MS = 320;
// Short enough to feel attached to the finger, long enough to smooth it.
const DRAG_MS = 90;
// Holding an icon: the first notch on press, then after HOLD_DELAY_MS a notch
// every REPEAT_MS, quickening gently to REPEAT_MIN_MS. Each repeat retargets
// the move under way, so the camera glides rather than stutters.
const HOLD_DELAY_MS = 420;
const REPEAT_MS = 260;
const REPEAT_MIN_MS = 170;
const REPEAT_QUICKEN = 0.9;
// How close the mouse comes before the bar wakes, measured from its edge.
const NEAR_PX = 64;
// How long the bar stays awake after an interaction ends.
const LINGER_MS = 1200;

export default function ZoomBar({ ctx, ready, bottomStripTaken }) {
  const {
    zoomLevel, zoomLevelRef, panOffsetRef, animateCanvasView, MIN_ZOOM, viewportSize, canvasSize,
  } = ctx;
  const leftPanelExpanded = useGraphStore(state => state.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(state => state.rightPanelExpanded);
  const typeListMode = useGraphStore(state => state.typeListMode);
  // Live: the bar rides a panel's edge through a resize drag, not after it.
  const viewportBounds = useViewportBounds(
    leftPanelExpanded, rightPanelExpanded, typeListMode !== 'closed', { live: true });
  const showZoomBar = useGraphStore(state => state.showZoomBar !== false);
  const position = useGraphStore(state => state.zoomBarPosition ?? DEFAULT_ZOOM_BAR_POSITION);
  const vertical = position !== 'bottom';
  // Only the bottom position shares its strip with the bottom control panels.
  const suppressed = !!bottomStripTaken && !vertical;
  // `ready` is CanvasChrome's gate: a web on screen with its view restored, so
  // the bar first appears where it belongs rather than moving there.
  const shown = !!ready && showZoomBar;
  // Default-node maroon on light; on dark, the theme's light red for brand
  // marks on the dark canvas, where the maroon all but disappears; on
  // blueprint, light or dark, where any red fights the blue, the app's
  // off-white (dark-mode text, the pie menu's bubbles).
  const theme = useTheme();
  const canvasColor = useGraphStore(state => state.canvasColor);
  const color = canvasColor === 'blueprint'
    ? DARK_THEME.canvas.textPrimary
    : theme.darkMode ? theme.canvas.brandText : NODE_DEFAULT_COLOR;

  const barRef = useRef(null);
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [near, setNear] = useState(false);
  const [lingering, setLingering] = useState(false);
  const engaged = dragging || pressing;
  const awake = near || engaged || lingering;

  // Lingering: on while engaged, and for LINGER_MS after.
  useEffect(() => {
    if (engaged) {
      setLingering(true);
      return undefined;
    }
    const timer = setTimeout(() => setLingering(false), LINGER_MS);
    return () => clearTimeout(timer);
  }, [engaged]);

  // Near: the pointer's distance from the bar's edge, read at most once a
  // frame. Window capture phase, so canvas handlers that stop propagation
  // can't hide a move from it. Touch has no hover and is left to `engaged`.
  const listening = shown && !suppressed;
  useEffect(() => {
    if (!listening) {
      setNear(false);
      return undefined;
    }
    let raf = 0;
    let last = null;
    const measure = () => {
      raf = 0;
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect || !last) return;
      const dx = Math.max(rect.left - last.x, 0, last.x - rect.right);
      const dy = Math.max(rect.top - last.y, 0, last.y - rect.bottom);
      setNear(dx * dx + dy * dy <= NEAR_PX * NEAR_PX);
    };
    const onMove = (e) => {
      if (e.pointerType === 'touch') return;
      last = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const away = () => setNear(false);
    const onLeave = (e) => { if (!e.relatedTarget) away(); };
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    document.addEventListener('mouseout', onLeave);
    window.addEventListener('blur', away);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove, { capture: true });
      document.removeEventListener('mouseout', onLeave);
      window.removeEventListener('blur', away);
    };
  }, [listening]);

  const minZoom = MIN_ZOOM;
  const lnMin = Math.log(minZoom);
  // The track spans the canvas's whole zoom range, so its ends are the real ends.
  const lnSpan = Math.log(MAX_ZOOM) - lnMin;
  const toT = useCallback(
    (z) => Math.max(0, Math.min(1, (Math.log(z) - lnMin) / lnSpan)),
    [lnMin, lnSpan]
  );
  const fromT = useCallback((t) => Math.exp(lnMin + t * lnSpan), [lnMin, lnSpan]);

  // The CSS reads --zoom-t as `left` or `bottom` by orientation.
  const placeThumb = useCallback((t) => {
    barRef.current?.style.setProperty('--zoom-t', String(t));
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
  }, [zoomLevel, zoomLevelRef, toT, placeThumb, shown]);

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

  // Where the last click was headed, while its move is still under way, so
  // rapid clicks add up instead of each recomputing from a camera still in
  // flight (which would land on the same notch and swallow the click).
  const pendingStepRef = useRef(null);

  // Returns 'moved', 'capped' (a burst is as far ahead of the camera as it may
  // get) or 'end' (the track has run out that way), so a hold knows to wait or
  // to stop.
  const step = useCallback((dir, { quiet = false } = {}) => {
    const now = performance.now();
    const pending = pendingStepRef.current;
    const live = toT(zoomLevelRef.current) * STEPS;
    const stacking = !!pending && now < pending.until && Math.sign(dir) === pending.dir;
    let notch;
    if (stacking) {
      notch = pending.notch + dir;
    } else {
      // Snap to the next notch in that direction, so steps land on eighths
      // however the zoom got where it is.
      notch = dir > 0 ? Math.floor(live + 1e-6) + 1 : Math.ceil(live - 1e-6) - 1;
    }
    // A burst runs at most MAX_LEAD notches ahead of the camera, and never
    // past the ends of the track.
    notch = Math.max(Math.floor(live - MAX_LEAD), Math.min(Math.ceil(live + MAX_LEAD), notch));
    notch = Math.max(0, Math.min(STEPS, notch));
    if (stacking ? notch === pending.notch : Math.abs(notch - live) < 1e-6) {
      return notch === (dir > 0 ? STEPS : 0) ? 'end' : 'capped';
    }
    if (!quiet) haptic('menuSelect');
    pendingStepRef.current = { notch, dir: Math.sign(dir), until: now + STACK_WINDOW_MS };
    // The thumb follows the camera there rather than jumping ahead of it.
    zoomTo(fromT(notch / STEPS), STEP_MS);
    return 'moved';
  }, [toT, fromT, zoomLevelRef, zoomTo]);

  // Click and hold. The press steps at once; a timer then repeats it until the
  // pointer lets go, the bar steps aside, or the track runs out; while capped
  // it waits a beat for the camera to catch up. Repeats are quiet: one haptic
  // for the press, not one per notch.
  const holdTimerRef = useRef(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  const endHold = useCallback(() => {
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    setPressing(false);
  }, []);

  const onIconPointerDown = (dir) => (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    endHold();
    setPressing(true);
    if (stepRef.current(dir) === 'end') return;
    let interval = REPEAT_MS;
    const repeat = () => {
      // At the end the repeats stop, but the press holds the bar awake until release.
      if (stepRef.current(dir, { quiet: true }) === 'end') return;
      interval = Math.max(REPEAT_MIN_MS, interval * REPEAT_QUICKEN);
      holdTimerRef.current = setTimeout(repeat, interval);
    };
    holdTimerRef.current = setTimeout(repeat, HOLD_DELAY_MS);
  };

  // Mouse and touch go through the press above; this is the keyboard's Enter
  // and Space, which arrive as a click with no press count.
  const onIconClick = (dir) => (e) => {
    if (e.detail === 0) step(dir);
  };

  useEffect(() => {
    if (suppressed || !shown) endHold();
  }, [suppressed, shown, endHold]);
  useEffect(() => endHold, [endHold]);

  // Along the track: left to right lying down, bottom to top standing up.
  const tFromPointer = (e) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const t = vertical
      ? (rect.height ? (rect.bottom - e.clientY) / rect.height : null)
      : (rect.width ? (e.clientX - rect.left) / rect.width : null);
    return t == null ? null : Math.max(0, Math.min(1, t));
  };

  const onTrackPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    pendingStepRef.current = null;
    setDragging(true);
    const t = tFromPointer(e);
    if (t == null) return;
    placeThumb(t);
    // A press away from the thumb travels there at step speed; the drag that
    // follows takes over from wherever the camera has got to.
    zoomTo(fromT(t), STEP_MS);
  };

  const onTrackPointerMove = (e) => {
    if (!draggingRef.current) return;
    const t = tFromPointer(e);
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

  if (!shown) return null;

  // Placement. viewportBounds.y is the header's bottom (0 in the fullscreen
  // landscape shell, where the toggles go flush to the top as well).
  let place;
  if (position === 'bottom') {
    place = {
      left: viewportBounds.x + viewportBounds.width / 2,
      bottom: viewportBounds.bottomReserved + BOTTOM_GAP,
      height: ZOOM_BAR_HEIGHT,
    };
  } else {
    const left = position === 'left';
    const panelOpen = left ? leftPanelExpanded : rightPanelExpanded;
    // With the panel open its toggle sits over the panel, so the bar takes the
    // canvas's edge just under the header; closed, it goes under the toggle.
    // (In the narrow exclusive layout an open panel covers the canvas, and the
    // bar with it.)
    const edge = left ? viewportBounds.leftWidth : viewportBounds.rightWidth;
    const top = viewportBounds.y + (panelOpen ? 0 : PANEL_TOGGLE_SIZE) + SIDE_GAP;
    // Beside an open panel, clear its resize handle's touch area when the
    // two would overlap (short windows), so neither steals the other's taps.
    const winH = viewportBounds.windowHeight;
    const handleH = Math.min(374, Math.max(84, winH * 0.33 + 24));
    const handleTop = winH / 2 - handleH / 2;
    const besideHandle = panelOpen && edge > 0 && top + BAR_LENGTH + RESIZER_SLOP > handleTop;
    place = {
      [left ? 'left' : 'right']: edge + (besideHandle ? RESIZER_HITBOX + SIDE_INSET : SIDE_INSET),
      top,
      width: ZOOM_BAR_HEIGHT,
    };
  }

  return (
    <div
      ref={barRef}
      className={`zoom-bar ${vertical ? 'is-vertical' : 'is-bottom'}${awake ? ' is-awake' : ''}${suppressed ? ' is-suppressed' : ''}${dragging ? ' is-dragging' : ''}${viewportBounds.resizing ? ' is-panel-resizing' : ''}`}
      style={{ ...place, '--zoom-bar-color': color }}
      {...shield}
    >
      <button
        type="button"
        className="zoom-bar-icon"
        onPointerDown={onIconPointerDown(-1)}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onLostPointerCapture={endHold}
        onClick={onIconClick(-1)}
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
        <div className="zoom-bar-thumb" />
      </div>
      <button
        type="button"
        className="zoom-bar-icon"
        onPointerDown={onIconPointerDown(1)}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onLostPointerCapture={endHold}
        onClick={onIconClick(1)}
        aria-label="Zoom in"
        title="Zoom in"
        tabIndex={suppressed ? -1 : 0}
      >
        <ZoomIn size={18} strokeWidth={2.25} />
      </button>
    </div>
  );
}
