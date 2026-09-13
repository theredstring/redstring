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

      {/* Context menu - positioned with top-left corner at cursor */}
      <div
        style={{
          position: 'fixed',
          left: x,
          top: y,
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
