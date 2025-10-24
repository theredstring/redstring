import React from 'react';
import { AlertCircle, Info, HelpCircle } from 'lucide-react';

/**
 * A confirm dialog positioned absolutely in the canvas at specific coordinates
 * Used for contextual confirmations like adding nodes to groups
 */
const CanvasConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  onCancel = null,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default', // 'default', 'danger', 'warning', 'info'
  showIcon = true,
  position = { x: 0, y: 0 }, // Canvas coordinates
  containerRect = null, // Bounding rect for positioning
  panOffset = { x: 0, y: 0 },
  zoomLevel = 1
}) => {
  if (!isOpen || !containerRect) return null;

  const icons = {
    danger: <AlertCircle size={20} />,
    warning: <AlertCircle size={20} />,
    info: <Info size={20} />,
    default: <HelpCircle size={20} />
  };

  const iconColors = {
    danger: '#7A0000',
    warning: '#ef6c00',
    info: '#1565c0',
    default: '#260000'
  };

  const buttonStyle = (isPrimary) => ({
    padding: '8px 16px',
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
      ? '2px solid #7A0000' 
      : '2px solid #260000',
    backgroundColor: isPrimary 
      ? (variant === 'danger' ? '#7A0000' : '#260000')
      : 'transparent',
    color: isPrimary 
      ? '#bdb5b5'
      : '#260000'
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
          backgroundColor: '#bdb5b5',
          border: '3px solid #260000',
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
            borderBottom: '2px solid #260000',
            backgroundColor: '#979090',
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
              color: '#260000'
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
              color: '#260000',
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
            gap: 10,
            padding: '12px 18px',
            borderTop: '2px solid #260000',
            backgroundColor: '#979090',
            justifyContent: 'flex-end',
            borderBottomLeftRadius: '12px',
            borderBottomRightRadius: '12px'
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
              e.currentTarget.style.backgroundColor = 'rgba(38, 0, 0, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            {cancelLabel}
          </button>
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
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = variant === 'danger' ? '#7A0000' : '#260000';
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CanvasConfirmDialog;

