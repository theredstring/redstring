import React, { useEffect, useRef } from 'react';
import { useTheme } from '../../hooks/useTheme.js';
import { X } from 'lucide-react';

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

  const handleCloseTouchEnd = (e) => {
    e.stopPropagation();
    touchHandledRef.current = true;
    onClose();
    setTimeout(() => { touchHandledRef.current = false; }, 400);
  };

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
          border: `1px solid ${theme.canvas.textPrimary}`,
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
            borderBottom: `1px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border,
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
            <button
              onClick={handleCloseClick}
              onTouchEnd={handleCloseTouchEnd}
              style={{
                background: 'none',
                border: 'none',
                color: theme.canvas.textPrimary,
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s',
                minWidth: '36px',
                minHeight: '36px',
                touchAction: 'manipulation'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.canvas.hover}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              aria-label="Close modal"
            >
              <X size={20} />
            </button>
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
