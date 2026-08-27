import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAnchoredStyle } from '../../utils/anchoredPosition.js';
import useMobileDetection from '../../hooks/useMobileDetection.js';

/**
 * The floating box half of an anchored popover — the PieMenu bubble translated
 * into DOM: off-white fill, maroon stroke, maroon text.
 *
 * Deliberately theme-INDEPENDENT. The pie-menu language is the same in light
 * and dark (see the note in PanelIconButton about #DEDADA being hardcoded in
 * both), and ContextMenu and the hover-aid label chip already render it this
 * way. A themed version would break the family resemblance.
 *
 * Portals to document.body so panel `overflow` can't clip it.
 */

// Above panels (10000-10002), TypeList (19999-20000) and CanvasModal
// (20100/20200). Deliberately BELOW ContextMenu (999999) — an explanation
// should never outrank a right-click menu.
export const POPOVER_Z_INDEX = 20300;

const AnchoredPopoverBox = ({
  position,
  direction = 'down-left',
  width = 280,
  estimatedHeight = 180,
  onDismiss,
  triggerRef,
  role = 'dialog',
  ariaLabel,
  children
}) => {
  const boxRef = useRef(null);
  const mobileState = useMobileDetection();
  const [openedAt] = useState(() => performance.now());

  // Dismiss on outside click. Two guards, both load-bearing:
  //
  //  - Registration is deferred to the next frame. Without it the very click
  //    that opened the popover reaches this listener and closes it again.
  //  - Clicks inside the trigger are ignored, so the trigger stays a toggle.
  //
  // 'click' rather than 'mousedown' is deliberate, matching ColorPicker: on
  // mousedown this fires before the trigger's own onClick and they fight.
  useEffect(() => {
    let frame = null;
    const handle = (event) => {
      // A tap produces a compatibility click ~300ms later that would otherwise
      // close the popover the same gesture just opened.
      if (performance.now() - openedAt < 250) return;
      if (boxRef.current?.contains(event.target)) return;
      if (triggerRef?.current?.contains(event.target)) return;
      onDismiss?.();
    };
    frame = requestAnimationFrame(() => {
      document.addEventListener('click', handle);
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('click', handle);
    };
  }, [onDismiss, triggerRef, openedAt]);

  // Escape closes and returns focus to the trigger, as Dropdown does.
  useEffect(() => {
    const handle = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onDismiss?.();
      triggerRef?.current?.focus?.();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onDismiss, triggerRef]);

  const boxWidth = mobileState.isMobile
    ? Math.min(width, window.innerWidth - 24)
    : width;

  const style = getAnchoredStyle({
    position,
    direction,
    width: boxWidth,
    height: estimatedHeight,
    zIndex: POPOVER_Z_INDEX,
    isMobile: mobileState.isMobile
  });

  return createPortal(
    <div
      ref={boxRef}
      role={role}
      aria-label={ariaLabel}
      style={{
        ...style,
        width: boxWidth,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: '60vh',
        overflowY: 'auto',
        background: '#DEDADA',
        border: '2px solid maroon',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        padding: '10px 12px',
        color: 'maroon',
        fontFamily: "'EmOne', sans-serif",
        fontSize: '0.8rem',
        lineHeight: 1.45,
        boxSizing: 'border-box'
      }}
    >
      {children}
    </div>,
    document.body
  );
};

export default AnchoredPopoverBox;
