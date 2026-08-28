import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAnchoredStyle } from '../../utils/anchoredPosition.js';
import useMobileDetection from '../../hooks/useMobileDetection.js';
import './AnchoredPopoverBox.css';

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

/**
 * At most one of these on screen at a time, across the whole app.
 *
 * Each popover's open/closed state belongs to whatever opened it — an
 * InfoPopover keeps its own, About's rows share one between the search and
 * match menus — so none of them can see the others. Opening a second box left
 * the first sitting there, and two of these overlapping is genuinely confusing:
 * they look identical, so nothing on screen says which trigger either belongs
 * to.
 *
 * Coordinating here rather than at the call sites means every popover is
 * covered by construction, including ones written later.
 */
let openPopover = null;

const claimPopover = (close) => {
  if (openPopover && openPopover !== close) openPopover();
  openPopover = close;
  // Guarded: by the time a displaced popover unmounts, `openPopover` is already
  // the one that displaced it, and clearing unconditionally would forget it.
  return () => { if (openPopover === close) openPopover = null; };
};

const AnchoredPopoverBox = ({
  position,
  direction = 'down-left',
  width = 280,
  estimatedHeight = 180,
  onDismiss,
  triggerRef,
  role = 'dialog',
  ariaLabel,
  // Off when the content manages its own scrolling region — a popover with a
  // search field wants the field pinned and only the results scrolling, not the
  // whole box sliding away under the cursor.
  scrollable = true,
  children
}) => {
  const boxRef = useRef(null);
  const mobileState = useMobileDetection();
  const [openedAt] = useState(() => performance.now());

  // Take the single open slot, closing whoever held it. Read through a ref so
  // this runs once on mount: callers often pass an inline arrow for onDismiss,
  // and depending on its identity would re-claim on every render.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => claimPopover(() => dismissRef.current?.()), []);

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

  // Clamped on every viewport, not just mobile. The positioner needs the real
  // rendered width to place the box, and a desktop window narrower than the
  // requested width would otherwise be positioned as if it had room it doesn't.
  const boxWidth = Math.min(width, window.innerWidth - 24);

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
      // Only the box itself scrolls when `scrollable`; otherwise the content
      // owns a scrolling region and carries this class there instead.
      className={scrollable ? 'anchored-popover-scroll' : undefined}
      style={{
        // `style` carries a maxHeight computed from the room actually available
        // beside the anchor, so it is spread AFTER nothing that would override
        // it. A flat cap here (this used to be 60vh) let a long list run past
        // the bottom of the screen.
        ...style,
        width: boxWidth,
        maxWidth: 'calc(100vw - 24px)',
        ...(scrollable
          ? { overflowY: 'auto' }
          : { display: 'flex', flexDirection: 'column', overflow: 'hidden' }),
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
