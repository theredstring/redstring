import React, { memo, useEffect, useRef, useState } from 'react';
import useGraphStore from '../../store/graphStore.js';
import useCanvasUIStore from '../../store/canvasUIStore.js';
import { EXCLUSIVE_PANEL_MODE_THRESHOLD } from '../../constants';
import {
  PANEL_TOGGLE_BUTTON_WIDTH,
  PANEL_OVERLAY_MIN_WIDTH,
  clampOverlayPanelWidth,
  resizerOffset,
} from '../../utils/canvas/panelWidth.js';

/**
 * The overlay resizer bars beside the side panels (P2.12), moved from NodeCanvas
 * with their drag, hover and fade state, their window listeners and the
 * gamepad's resize handle. The committed widths live in canvasUIStore. During a
 * drag the width goes to a ref and the bar is moved directly; the panel follows
 * `panelWidthChanging`, and the end of the drag commits and persists the width
 * once (`panelWidthChanged`).
 *
 * `controlRef` is filled with { begin, by, end, isDragging } for the gamepad and
 * for NodeCanvas, which must not start a canvas pan while a resize is on.
 */
function PanelResizers({ controlRef }) {
  const darkMode = useGraphStore(s => s.darkMode);
  const leftPanelExpanded = useGraphStore(s => s.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(s => s.rightPanelExpanded);
  const leftPanelWidth = useCanvasUIStore(s => s.leftPanelWidth), setLeftPanelWidth = useCanvasUIStore(s => s.setLeftPanelWidth);
  const rightPanelWidth = useCanvasUIStore(s => s.rightPanelWidth), setRightPanelWidth = useCanvasUIStore(s => s.setRightPanelWidth);
  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);
  const dragStartXRef = useRef(0);
  const startWidthRef = useRef(0);
  const resizeRafRef = useRef(null);
  const latestResizeClientXRef = useRef(0);
  const leftResizerElRef = useRef(null); // the bars, moved directly while dragging
  const rightResizerElRef = useRef(null);
  const [isHoveringLeftResizer, setIsHoveringLeftResizer] = useState(false);
  const [isHoveringRightResizer, setIsHoveringRightResizer] = useState(false);
  const [resizersVisible, setResizersVisible] = useState(false);
  // Track latest widths in refs to avoid stale closures in global listeners
  const leftWidthRef = useRef(leftPanelWidth);
  const rightWidthRef = useRef(rightPanelWidth);
  useEffect(() => { leftWidthRef.current = leftPanelWidth; }, [leftPanelWidth]);
  useEffect(() => { rightWidthRef.current = rightPanelWidth; }, [rightPanelWidth]);

  useEffect(() => {
    const onPanelChanged = (e) => {
      const { side, width } = e.detail || {};
      if (side === 'left' && typeof width === 'number') setLeftPanelWidth(width);
      if (side === 'right' && typeof width === 'number') setRightPanelWidth(width);
    };
    window.addEventListener('panelWidthChanged', onPanelChanged);
    return () => window.removeEventListener('panelWidthChanged', onPanelChanged);
  }, []);

  // Re-clamp overlay-resizer widths when the viewport changes (mobile
  // emulation, window resize, rotation) so the canvas-side resizers never sit
  // outside the visible area.
  useEffect(() => {
    const onResize = () => {
      setLeftPanelWidth(prev => clampOverlayPanelWidth(prev));
      setRightPanelWidth(prev => clampOverlayPanelWidth(prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const timerApi = typeof window !== 'undefined' ? window : globalThis;
    const timeoutId = timerApi.setTimeout(() => setResizersVisible(true), 180);
    return () => {
      if (typeof timerApi.clearTimeout === 'function') {
        timerApi.clearTimeout(timeoutId);
      }
    };
  }, []);

  const MIN_WIDTH = PANEL_OVERLAY_MIN_WIDTH;

  const beginDrag = (side, clientX) => {
    if (side === 'left') {
      isDraggingLeft.current = true;
      dragStartXRef.current = clientX;
      startWidthRef.current = leftWidthRef.current;
    } else {
      isDraggingRight.current = true;
      dragStartXRef.current = clientX;
      startWidthRef.current = rightWidthRef.current;
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    // Prevent page overscroll while resizing
    try { document.body.style.overscrollBehavior = 'none'; } catch { }
  };

  const applyResizeUpdate = () => {
    resizeRafRef.current = null;
    const clientX = latestResizeClientXRef.current;
    // In exclusive panel mode (narrow window), allow expansion up to the
    // opposite-side toggle button. Otherwise cap at half the viewport.
    const isExclusive = window.innerWidth <= EXCLUSIVE_PANEL_MODE_THRESHOLD;
    const maxWidth = isExclusive
      ? Math.max(MIN_WIDTH, window.innerWidth - PANEL_TOGGLE_BUTTON_WIDTH)
      : Math.max(240, Math.round(window.innerWidth / 2) - 30);
    // The width goes to the ref and the bar is moved directly: setting state here
    // re-rendered all of NodeCanvas on every frame of the drag (F-04, P1.05).
    // The panel follows panelWidthChanging; endDrag commits the width once.
    const side = isDraggingLeft.current ? 'left' : isDraggingRight.current ? 'right' : null;
    if (!side) return;
    const dx = clientX - dragStartXRef.current;
    const w = Math.max(MIN_WIDTH, Math.min(startWidthRef.current + (side === 'left' ? dx : -dx), maxWidth));
    (side === 'left' ? leftWidthRef : rightWidthRef).current = w;
    const bar = (side === 'left' ? leftResizerElRef : rightResizerElRef).current;
    if (bar) bar.style[side] = `${resizerOffset(w)}px`;
    try { window.dispatchEvent(new CustomEvent('panelWidthChanging', { detail: { side, width: w } })); } catch { }
  };

  const onDragMove = (e) => {
    latestResizeClientXRef.current = e.touches?.[0]?.clientX ?? e.clientX;
    if (!resizeRafRef.current) {
      resizeRafRef.current = requestAnimationFrame(applyResizeUpdate);
    }
  };

  const endDrag = () => {
    // Apply a pending rAF update synchronously, so the width committed below is the final one
    if (resizeRafRef.current) {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
      applyResizeUpdate();
    }
    // Commit the width the drag left in its ref (one render), persist and broadcast it
    for (const [side, dragging, widthRef, setWidth] of [
      ['left', isDraggingLeft, leftWidthRef, setLeftPanelWidth],
      ['right', isDraggingRight, rightWidthRef, setRightPanelWidth],
    ]) {
      if (!dragging.current) continue;
      dragging.current = false;
      setWidth(widthRef.current);
      try {
        localStorage.setItem(`panelWidth_${side}`, JSON.stringify(widthRef.current));
        window.dispatchEvent(new CustomEvent('panelWidthChanged', { detail: { side, width: widthRef.current } }));
      } catch { }
    }
    // Clear any hover state at the end of a drag (helps on touch devices)
    setIsHoveringLeftResizer(false);
    setIsHoveringRightResizer(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    try { document.body.style.overscrollBehavior = ''; } catch { }
  };

  /**
   * Panel resizing from a game controller, driven through the resizer the mouse
   * drives rather than alongside it.
   *
   * The bars the user actually grabs are these overlay resizers, not the strip
   * inside the panel — they are positioned from `leftPanelWidth`/`rightPanelWidth`
   * here, and the panel FOLLOWS them via `panelWidthChanging`. A controller
   * path that talked to the panel directly moved the panel and left the bar
   * behind, because the bar's position was never part of that conversation.
   *
   * So this fakes a pointer drag instead of inventing a second mechanism: the
   * same refs `beginDrag` sets, the same `applyResizeUpdate` for clamping and
   * broadcasting, the same `endDrag` for persistence. The stick's motion is
   * accumulated into a virtual cursor x, which means even the per-side sign
   * (dragging right widens the left panel and narrows the right one) stays
   * where it already lives instead of being restated.
   *
   * `isHovering*Resizer` is set for the duration so the bar shows itself held
   * — the controller has no pointer to hover with, so the look has to be
   * asserted rather than arrived at.
   */
  // The gamepad's handle (and NodeCanvas's "is a resize in progress" check).
  controlRef.current = {
    isDragging: () => isDraggingLeft.current || isDraggingRight.current,
    begin: (side) => {
      dragStartXRef.current = 0;
      latestResizeClientXRef.current = 0;
      if (side === 'left') {
        startWidthRef.current = leftWidthRef.current;
        isDraggingLeft.current = true;
        setIsHoveringLeftResizer(true);
      } else {
        startWidthRef.current = rightWidthRef.current;
        isDraggingRight.current = true;
        setIsHoveringRightResizer(true);
      }
    },
    /** @param {number} pointerDx px the virtual cursor moved this frame */
    by: (side, pointerDx) => {
      const live = side === 'left' ? isDraggingLeft.current : isDraggingRight.current;
      if (!live) return;
      latestResizeClientXRef.current += pointerDx;
      // Called directly rather than through the rAF coalescing the pointer path
      // uses: this is ALREADY once per frame, and deferring it by a frame is
      // the thing that made the panel lag the stick.
      applyResizeUpdate();
    },
    end: () => endDrag(),
  };

  // Render overlay resizer bars that sit just outside panels
  const renderPanelResizers = () => {
    const barHeightPct = 0.33;
    const barHeight = `${Math.round(barHeightPct * 100)}%`;
    const HITBOX_WIDTH = 28; // wider invisible hitbox
    const VISIBLE_WIDTH = 6; // thin visible bar
    const extraHitboxPx = 24; // slightly taller than the visual bar
    const wrapperHeight = `calc(${barHeight} + ${extraHitboxPx}px)`;
    const wrapperMinHeight = 60 + extraHitboxPx;
    const wrapperMaxHeight = 350 + extraHitboxPx;
    const wrapperCommon = {
      position: 'fixed',
      top: '50%',
      transform: 'translateY(-50%)',
      height: wrapperHeight,
      minHeight: wrapperMinHeight,
      maxHeight: wrapperMaxHeight,
      width: HITBOX_WIDTH,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'col-resize',
      zIndex: 10002,
      touchAction: 'none',
      pointerEvents: 'auto',
      backgroundColor: 'transparent',
      transition: 'opacity 200ms ease'
    };
    const handleVisualCommon = {
      width: VISIBLE_WIDTH,
      height: barHeight,
      minHeight: 60,
      maxHeight: 350,
      borderRadius: 999,
      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      transition: 'background-color 120ms ease, opacity 160ms ease'
    };
    const leftActive = isDraggingLeft.current || isHoveringLeftResizer;
    const rightActive = isDraggingRight.current || isHoveringRightResizer;
    const baseColor = (active) => darkMode ? `rgba(151,144,144,${active ? 1 : 0.18})` : `rgba(38,0,0,${active ? 1 : 0.18})`;
    const fadeOpacity = resizersVisible ? 1 : 0;
    const leftWrapperLeft = resizerOffset(leftPanelWidth);
    const rightWrapperRight = resizerOffset(rightPanelWidth);
    // Use optional chaining with defaults so we don't depend on early state initialization
    const leftCollapsed = !(typeof leftPanelExpanded === 'boolean' ? leftPanelExpanded : true);
    const rightCollapsed = !(typeof rightPanelExpanded === 'boolean' ? rightPanelExpanded : true);
    return (
      <>
        {/* Left resizer wrapper (full-height hitbox) */}
        <div
          ref={leftResizerElRef}
          style={{
            ...wrapperCommon,
            left: leftWrapperLeft,
            pointerEvents: (!resizersVisible || leftCollapsed) ? 'none' : 'auto',
            opacity: fadeOpacity
          }}
          onMouseDown={(e) => {
            // prevent canvas panning on resizer mouse down
            e.stopPropagation();
            beginDrag('left', e.clientX);
          }}
          onTouchStart={(e) => {
            if (e && e.cancelable) { e.preventDefault(); }
            e.stopPropagation();
            if (e.touches?.[0]) beginDrag('left', e.touches[0].clientX);
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse') {
              e.preventDefault();
              e.stopPropagation();
              beginDrag('left', e.clientX);
            }
          }}
          onWheel={(e) => {
            // Only block scroll when actively dragging to avoid interfering with canvas scrolling
            if ((isDraggingLeft.current || isDraggingRight.current) && e && e.cancelable) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onTouchMove={(e) => {
            if ((isDraggingLeft.current || isDraggingRight.current) && e && e.cancelable) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onMouseEnter={() => setIsHoveringLeftResizer(true)}
          onMouseLeave={() => setIsHoveringLeftResizer(false)}
        >
          <div style={{ ...handleVisualCommon, backgroundColor: baseColor(leftActive), opacity: leftCollapsed ? 0 : fadeOpacity }} />
        </div>
        {/* Right resizer wrapper (full-height hitbox) */}
        <div
          ref={rightResizerElRef}
          style={{
            ...wrapperCommon,
            right: rightWrapperRight,
            pointerEvents: (!resizersVisible || rightCollapsed) ? 'none' : 'auto',
            opacity: fadeOpacity
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            beginDrag('right', e.clientX);
          }}
          onTouchStart={(e) => {
            if (e && e.cancelable) { e.preventDefault(); }
            e.stopPropagation();
            if (e.touches?.[0]) beginDrag('right', e.touches[0].clientX);
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse') {
              e.preventDefault();
              e.stopPropagation();
              beginDrag('right', e.clientX);
            }
          }}
          onWheel={(e) => {
            if ((isDraggingLeft.current || isDraggingRight.current) && e && e.cancelable) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onTouchMove={(e) => {
            if ((isDraggingLeft.current || isDraggingRight.current) && e && e.cancelable) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onMouseEnter={() => setIsHoveringRightResizer(true)}
          onMouseLeave={() => setIsHoveringRightResizer(false)}
        >
          <div style={{ ...handleVisualCommon, backgroundColor: baseColor(rightActive), opacity: rightCollapsed ? 0 : fadeOpacity }} />
        </div>
      </>
    );
  };

  // Global listeners for resizer drag to keep latency low
  useEffect(() => {
    const move = (e) => {
      if (!isDraggingLeft.current && !isDraggingRight.current) return;
      // Prevent page scroll/pinch on touchmove while dragging
      if (e && e.cancelable) {
        try { e.preventDefault(); } catch { }
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
      }
      onDragMove(e);
    };
    const up = () => {
      if (!isDraggingLeft.current && !isDraggingRight.current) return;
      endDrag();
    };
    const blockWheelWhileDragging = (e) => {
      // Only block global wheel when dragging to avoid interfering with normal scroll
      if (!isDraggingLeft.current && !isDraggingRight.current) return;
      if (e && e.cancelable) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    window.addEventListener('pointerup', up);
    // A touch sequence does NOT have to end in touchend. Android fires
    // touchcancel instead whenever the system takes the gesture over — an edge
    // swipe (which the fullscreen build makes routine, since that is how the
    // system bars are summoned), the notification shade, a focus loss, some
    // multi-touch. Without these the drag never ends: the isDragging refs stay
    // latched, so `up` and `move` keep firing on the NEXT unrelated touch and
    // go on resizing the panel, and endDrag never runs, so panelWidthChanged
    // never broadcasts and useViewportBounds keeps the stale width while the
    // panel renders at the new one — every fixed element measured off those
    // bounds then sits at the wrong offset with the panel peeking out from
    // under it.
    window.addEventListener('touchcancel', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('wheel', blockWheelWhileDragging, { passive: false });
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('touchcancel', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('wheel', blockWheelWhileDragging);
    };
  }, []);

  return renderPanelResizers();
}

export default memo(PanelResizers);
