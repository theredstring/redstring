import React from 'react';
import { X } from 'lucide-react';

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'medium',
  showCloseButton = true
}) => {
  if (!isOpen) return null;

  const sizeStyles = {
    small: { width: 'min(95vw, 320px)', height: 'auto', maxHeight: '85vh' },
    medium: { width: 'min(95vw, 380px)', height: 'min(85vh, 600px)' },
    large: { width: 'min(95vw, 480px)', height: 'min(90vh, 700px)' },
    slim: { width: 'min(95vw, 400px)', height: 'min(90vh, 750px)' }
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
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          ...sizeStyles[size],
          backgroundColor: '#bdb5b5',
          border: '2px solid #260000',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
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
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #260000',
            backgroundColor: '#979090',
            flexShrink: 0
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: '#260000'
            }}
          >
            {title}
          </h2>
          {showCloseButton && (
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#260000',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(38, 0, 0, 0.1)'}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
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
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            padding: 16
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;