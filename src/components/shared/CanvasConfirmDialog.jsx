import React from 'react';
import { AlertCircle, Info, HelpCircle } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * A confirm dialog positioned absolutely in the canvas at specific coordinates
 * Used for contextual confirmations like adding nodes to groups
 */
const CanvasConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  onCancel = null,
  onSecondaryConfirm = null,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  secondaryConfirmLabel = null,
  variant = 'default', // 'default', 'danger', 'warning', 'info'
  showIcon = true,
  position = { x: 0, y: 0 }, // Canvas coordinates
  containerRect = null, // Bounding rect for positioning
  panOffset = { x: 0, y: 0 },
  zoomLevel = 1,
  showDontAskAgain = false,
  dontAskAgainChecked = false,
  onDontAskAgainChange = null,
  dontAskAgainLabel = "Don't ask me again"
}) => {
  const theme = useTheme();
  if (!isOpen || !containerRect) return null;

  const icons = {
    danger: <AlertCircle size={20} />,
    warning: <AlertCircle size={20} />,
    info: <Info size={20} />,
    default: <HelpCircle size={20} />
  };

  const iconColors = {
    danger: theme.accent.secondary,
    warning: '#ef6c00',
    info: '#1565c0',
    default: theme.canvas.textPrimary
  };

  const buttonStyle = (isPrimary) => ({
    padding: '4px 14px',
    lineHeight: 1.2,
    borderRadius: 6,
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'EmOne', sans-serif",
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    border: isPrimary && variant === 'danger'
      ? `2px solid ${theme.accent.secondary}`
      : `2px solid ${theme.canvas.textPrimary}`,
    backgroundColor: isPrimary
      ? (variant === 'danger' ? theme.accent.secondary : theme.canvas.textPrimary)
      : 'transparent',
    color: isPrimary
      ? (variant === 'danger'
        ? (theme.darkMode ? theme.canvas.textPrimary : '#EFE8E5')
        : theme.canvas.bg)
      : theme.canvas.textPrimary
  });

  // Dialog dimensions (estimate)
  const dialogWidth = 360;
  const dialogHeight = 160;

  // Keep dialog within viewport bounds
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Center the dialog on the viewport
  let left = (viewportWidth - dialogWidth) / 2;
  let top = (viewportHeight - dialogHeight) / 2;

  // Ensure minimum margins
  if (left < 20) {
    left = 20;
  }
  if (top < 20) {
    top = 20;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        zIndex: 10000,
        pointerEvents: 'auto'
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute',
          left: `${left}px`,
          top: `${top}px`,
          width: `${dialogWidth}px`,
          backgroundColor: theme.canvas.bg,
          border: `3px solid ${theme.canvas.textPrimary}`,
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
          fontFamily: "'EmOne', sans-serif",
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderBottom: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border,
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px'
          }}
        >
          {showIcon && (
            <div style={{ color: iconColors[variant], flexShrink: 0 }}>
              {icons[variant]}
            </div>
          )}
          <h2
            style={{
              margin: 0,
              fontSize: '1rem',
              fontWeight: 700,
              color: theme.canvas.textPrimary
            }}
          >
            {title}
          </h2>
        </div>

        {/* Content */}
        <div style={{ padding: '16px 18px' }}>
          <p
            style={{
              margin: 0,
              fontSize: '0.9rem',
              lineHeight: 1.5,
              color: theme.canvas.textPrimary,
              whiteSpace: 'pre-wrap'
            }}
          >
            {message}
          </p>
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: '8px 18px',
            borderTop: `2px solid ${theme.canvas.textPrimary}`,
            backgroundColor: theme.canvas.border,
            borderBottomLeftRadius: '12px',
            borderBottomRightRadius: '12px'
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              justifyContent: showDontAskAgain ? 'center' : 'flex-end',
              flexWrap: 'wrap',
              width: showDontAskAgain ? '100%' : 'auto',
              alignSelf: showDontAskAgain ? 'stretch' : 'flex-end'
            }}
          >
            <button
              onClick={() => {
                if (onCancel) {
                  onCancel();
                }
                onClose();
              }}
              style={buttonStyle(false)}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(38, 0, 0, 0.2)' : 'rgba(38, 0, 0, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {cancelLabel}
            </button>
            {secondaryConfirmLabel && onSecondaryConfirm && (
              <button
                onClick={() => {
                  onSecondaryConfirm();
                  onClose();
                }}
                style={buttonStyle(false)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(38, 0, 0, 0.2)' : 'rgba(38, 0, 0, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {secondaryConfirmLabel}
              </button>
            )}
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              style={buttonStyle(true)}
              onMouseEnter={(e) => {
                if (variant === 'danger') {
                  e.currentTarget.style.backgroundColor = '#5A0000';
                } else {
                  e.currentTarget.style.backgroundColor = '#1a0000';
                  if (theme.darkMode) {
                    e.currentTarget.style.color = theme.canvas.textPrimary;
                  }
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = variant === 'danger' ? theme.accent.secondary : theme.canvas.textPrimary;
                if (variant !== 'danger' && theme.darkMode) {
                  e.currentTarget.style.color = theme.canvas.bg;
                }
              }}
            >
              {confirmLabel}
            </button>
          </div>
          {showDontAskAgain && (
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.78rem',
                color: theme.canvas.textPrimary,
                cursor: 'pointer',
                userSelect: 'none',
                fontFamily: "'EmOne', sans-serif"
              }}
            >
              <span
                style={{
                  position: 'relative',
                  width: 16,
                  height: 16,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 3,
                  border: `1.5px solid ${theme.canvas.textPrimary}`,
                  backgroundColor: dontAskAgainChecked ? '#7A0000' : 'transparent',
                  transition: 'background-color 0.15s'
                }}
              >
                <input
                  type="checkbox"
                  checked={!!dontAskAgainChecked}
                  onChange={(e) => onDontAskAgainChange?.(e.target.checked)}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: 0,
                    margin: 0,
                    cursor: 'pointer'
                  }}
                />
                {dontAskAgainChecked && (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="#DEDADA"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ pointerEvents: 'none' }}
                  >
                    <polyline points="2.5,6.5 5,9 9.5,3.5" />
                  </svg>
                )}
              </span>
              {dontAskAgainLabel}
            </label>
          )}
        </div>
      </div>
    </div>
  );
};

export default CanvasConfirmDialog;

