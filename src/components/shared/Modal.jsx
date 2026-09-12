import React, { useEffect, useRef } from 'react';
import { useTheme } from '../../hooks/useTheme.js';
import { X } from 'lucide-react';
import PanelIconButton from './PanelIconButton.jsx';

/**
 * The general-purpose modal shell.
 *
 * Its frame is deliberately the same one Dialog.jsx draws — a 3px canvas.textPrimary
 * edge, 12px corners, and a header on the same band with a 2px rule under it —
 * so a modal and a dialog read as the same surface at different sizes.
 * The close is a PanelIconButton, which is where the panel's pie-menu hover and
 * the touch double-fire guard live.
 */

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'medium',
  showCloseButton = true,
  style = {}
}) => {
  const theme = useTheme();
  const modalRef = useRef(null);
  // Track touch-handled to prevent double-fire (touch + synthetic click).
  // Cannot use preventDefault() in onTouchEnd since React registers it as passive.
  const touchHandledRef = useRef(false);

  if (!isOpen) return null;

  const sizeStyles = {
    small: { width: 'min(95vw, 320px)', height: 'auto', maxHeight: '85vh' },
    medium: { width: 'min(95vw, 380px)', height: 'min(85vh, 600px)' },
    large: { width: 'min(95vw, 480px)', height: 'min(90vh, 700px)' },
    slim: { width: 'min(95vw, 400px)', height: 'min(90vh, 750px)' }
  };

  const handleBackdropTouchEnd = (e) => {
    touchHandledRef.current = true;
    onClose();
    setTimeout(() => { touchHandledRef.current = false; }, 400);
  };

  const handleBackdropClick = (e) => {
    if (touchHandledRef.current) return;
    onClose();
  };

  // The close button no longer needs a touch handler of its own: PanelIconButton
  // carries the same guard internally and stops the touch from reaching the
  // backdrop. This ref is now only about a touch that lands on the backdrop.
  const handleCloseClick = (e) => {
    if (touchHandledRef.current) return;
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
        touchAction: 'manipulation'
      }}
      onClick={handleBackdropClick}
      onTouchEnd={handleBackdropTouchEnd}
    >
      <div
        style={{
          ...sizeStyles[size],
          ...style,
          backgroundColor: theme.canvas.bg,
          border: `3px solid ${theme.canvas.textPrimary}`,
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
          fontFamily: "'EmOne', sans-serif",
          overflow: 'hidden',
          touchAction: 'manipulation'
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: `2px solid ${theme.canvas.textPrimary}`,
            // The band is the surface with a shadow in it, not canvas.border —
            // which is darker than the canvas in light mode but much LIGHTER
            // than it in dark, and read as a pale grey bar. Same value as
            // Dialog.jsx's BAND and ModalChrome's --rs-modal-band.
            backgroundColor: 'rgba(0, 0, 0, 0.22)',
            flexShrink: 0
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: theme.canvas.textPrimary
            }}
          >
            {title}
          </h2>
          {showCloseButton && (
            <PanelIconButton
              icon={X}
              size={20}
              title="Close modal"
              onClick={handleCloseClick}
              style={{ minWidth: 36, minHeight: 36, touchAction: 'manipulation' }}
            />
          )}
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            padding: size === 'slim' ? 0 : 16,
            minHeight: 0
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;
