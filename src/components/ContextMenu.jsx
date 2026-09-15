import React from 'react';
import { Check } from 'lucide-react';

const ContextMenu = ({ x, y, options = [], onClose, onSelect }) => {
  // If no options provided, show default message
  const displayOptions = options.length > 0 ? options : [{ label: 'No Tools Here...', disabled: true }];

  // A menu opened from a button on touch has a click still in flight: the
  // browser emits one after touchend, and it lands on this backdrop — mounted
  // in the meantime, right under the finger — closing the menu before it is
  // ever seen. So the backdrop ignores clicks that arrive too soon to be a
  // second, deliberate tap.
  const openedAtRef = React.useRef(0);
  // Keyed on the menu's identity, not just mount: opening a second menu while
  // one is up reuses this instance rather than remounting it.
  React.useEffect(() => { openedAtRef.current = Date.now(); }, [x, y, options]);
  const handleBackdropClick = (e) => {
    if (Date.now() - openedAtRef.current < 300) return;
    onClose?.(e);
  };

  // Keep the card on screen.
  //
  // Callers hand us a point, not a rectangle — showContextMenu is a raw cursor
  // position with no math behind it at all, and the anchored/centred helpers can
  // only work from an ESTIMATE of a card that sizes itself to its content. So
  // the only place that knows how big this menu actually is, is this menu. Fix
  // it once here and every caller is covered.
  //
  // Near an edge, FLIP before clamping: a card pinned flush to the bottom sits
  // under the cursor that opened it, and the row you land on is not the row you
  // pointed at. Flipping keeps the corner at the cursor and grows the other way,
  // which is what a native menu does. Clamping is the fallback for when the flip
  // would not fit either.
  const menuRef = React.useRef(null);
  const [pos, setPos] = React.useState({ left: x, top: y });
  React.useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || typeof window === 'undefined') return;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Measure at the top-left corner first. The card is shrink-to-fit, so a
    // fixed element with only `left` set has the viewport's right edge as its
    // available width — measuring it where it currently sits would read a card
    // already squeezed by the very edge we are trying to move it away from.
    el.style.left = '0px';
    el.style.top = '0px';
    const { width, height } = el.getBoundingClientRect();

    let left = x;
    if (left + width > vw - margin) left = x - width;
    left = Math.max(margin, Math.min(left, Math.max(margin, vw - width - margin)));

    let top = y;
    if (top + height > vh - margin) {
      const above = y - height;
      top = above >= margin ? above : Math.max(margin, vh - height - margin);
    }

    // Write it straight back before this layout pass ends — the state update is
    // what keeps it there across the next render.
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    setPos({ left, top });
    // Measured from the rendered card, so re-run whenever its content or the
    // requested point changes.
  }, [x, y, options]);

  return (
    <>
      {/* Invisible backdrop to catch clicks. Classed because it is also the
          controller's close control — the pad dismisses this menu by clicking
          exactly what a mouse clicks. See gamepadMenuNav's `context` config. */}
      <div
        className="context-menu-backdrop"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 999998
        }}
        onClick={handleBackdropClick}
      />

      {/* Context menu — top-left corner at the cursor, flipped/clamped above to
          stay on screen. A menu taller than the viewport scrolls rather than
          running off the bottom of it. */}
      <div
        ref={menuRef}
        style={{
          position: 'fixed',
          left: pos.left,
          top: pos.top,
          maxHeight: 'calc(100vh - 16px)',
          maxWidth: 'calc(100vw - 16px)',
          overflowY: 'auto',
          background: '#DEDADA', // PlusSign off-white background
          border: '2px solid maroon', // PlusSign maroon stroke
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          zIndex: 999999,
          minWidth: '150px',
          fontFamily: 'EmOne, sans-serif',
          fontSize: '0.85rem'
        }}
      >
        {displayOptions.map((option, index) => (
          <div
            key={index}
            style={{
              padding: '8px 12px',
              color: option.disabled ? 'rgba(128, 0, 0, 0.5)' : 'maroon', // PlusSign maroon text
              // `active` is for chooser-style menus — the ones that replaced an
              // anchored dropdown, where a row is the current setting rather
              // than a command. Tinted here and check-marked below.
              backgroundColor: option.active ? 'rgba(128, 0, 0, 0.12)' : 'transparent',
              cursor: option.disabled ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              borderBottom: index < displayOptions.length - 1 ? '1px solid rgba(128, 0, 0, 0.2)' : 'none',
              transition: 'background-color 0.1s ease',
              fontWeight: 'bold'
            }}
            className="context-menu-item"
            data-disabled={option.disabled}
            title={option.title}
            onClick={() => {
              if (!option.disabled && onSelect) {
                onSelect(option);
              }
              onClose();
            }}
          >
            {option.icon && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                flexShrink: 0
              }}>
                {option.icon}
              </div>
            )}
            <span>{option.label}</span>
            {option.active && !option.shortcut && (
              <Check size={14} style={{ marginLeft: 'auto', flexShrink: 0 }} />
            )}
            {option.shortcut && (
              <span style={{
                marginLeft: 'auto',
                fontSize: '0.7rem',
                opacity: 0.7
              }}>
                {option.shortcut}
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
};

export default ContextMenu;
