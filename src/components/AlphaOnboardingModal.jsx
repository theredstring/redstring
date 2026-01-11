import React, { useState, useEffect } from 'react';
import CanvasModal from './CanvasModal';

/**
 * Alpha Onboarding Modal
 * A specialized CanvasModal that welcomes users to Redstring's open alpha
 * Inherits all CanvasModal functionality while providing alpha-specific content
 */
const AlphaOnboardingModal = ({
  isVisible,
  onClose,
  onGetStarted = null,
  onUseWithoutSaving = null,
  ...canvasModalProps
}) => {
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));
  const isCompactLayout = viewportSize.width <= 768;
  const modalWidth = isCompactLayout
    ? Math.min(Math.max(viewportSize.width - 24, 320), 540)
    : 600;
  const modalHeight = isCompactLayout
    ? Math.min(Math.max(viewportSize.height * 0.85, 400), 550)
    : 600; // Reduced height for simpler modal

  useEffect(() => {
    const handleResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleClose = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('redstring-alpha-welcome-seen', 'true');
    }
    onClose();
  };

  const handleGetStarted = () => {
    if (onGetStarted) {
      onGetStarted();
    }
  };

  const handleUseWithoutSaving = () => {
    handleClose();
    if (onUseWithoutSaving) {
      onUseWithoutSaving();
    }
  };

  const modalContent = (
    <>
      {/* Close button in top right */}
      <button
        onClick={handleClose}
        onTouchEnd={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleClose();
        }}
        style={{
          position: 'absolute',
          top: isCompactLayout ? '12px' : '16px',
          right: isCompactLayout ? '12px' : '16px',
          background: 'none',
          border: 'none',
          color: '#666',
          cursor: 'pointer',
          padding: '6px',
          borderRadius: '4px',
          fontSize: '16px',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif",
          zIndex: 10,
          touchAction: 'manipulation'
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = '#260000'}
        onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
      >
        ✕
      </button>

      {/* Welcome Header */}
      <div style={{ textAlign: 'center', marginBottom: isCompactLayout ? '12px' : '16px', flexShrink: 0 }}>
        <h2 style={{
          margin: '0 0 8px 0',
          color: '#260000',
          fontSize: isCompactLayout ? '1.1rem' : '1.4rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Welcome to Redstring
        </h2>
        <div style={{
          margin: '0 0 6px 0',
          fontSize: isCompactLayout ? '0.85rem' : '0.9rem',
          color: '#716C6C',
          fontFamily: "'EmOne', sans-serif",
          fontWeight: '600'
        }}>
          Alpha v0.1.0
        </div>
      </div>

      {/* Mobile Warning for compact layouts */}
      {isCompactLayout && (
        <div style={{
          backgroundColor: '#fff3cd',
          border: '2px solid #ffc107',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '12px',
          fontSize: '0.8rem',
          color: '#856404',
          textAlign: 'center'
        }}>
          Redstring is unfinished on mobile in this version and will not work correctly. For the best experience, please use a desktop browser.
        </div>
      )}

      {/* Main Content */}
      <div
        style={{
          lineHeight: '1.4',
          fontFamily: "'EmOne', sans-serif",
          overflowY: 'auto',
          flex: 1
        }}
      >
        <p style={{
          margin: '0 0 24px 0',
          fontSize: isCompactLayout ? '0.85rem' : '0.95rem',
          color: '#333',
          fontFamily: "'EmOne', sans-serif",
          textAlign: 'center'
        }}>
          A visual thinking tool for building interconnected knowledge through <strong>Things</strong> and <strong>Connections</strong>.
        </p>

        <div style={{
          backgroundColor: '#260000',
          borderRadius: '8px',
          padding: isCompactLayout ? '10px' : '12px',
          marginBottom: '24px',
          fontSize: isCompactLayout ? '0.8rem' : '0.85rem',
          color: '#EFE8E5',
          border: '1px solid #260000'
        }}>
          <strong style={{ fontSize: isCompactLayout ? '0.9rem' : '1rem' }}>Basic Controls:</strong><br />
          • Click and hold to move a Thing<br />
          • Click and drag between Things to connect them<br />
          • Click a connection to give it meaning<br />
          • Double-click a Thing to open it in the right panel<br />
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <button
            onClick={handleGetStarted}
            style={{
              padding: isCompactLayout ? '12px' : '14px 20px',
              backgroundColor: '#8B0000',
              color: '#EFE8E5',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: isCompactLayout ? '0.95rem' : '1rem',
              fontWeight: 'bold',
              fontFamily: "'EmOne', sans-serif",
              textAlign: 'center'
            }}
          >
            Get Started
          </button>

          <button
            onClick={handleUseWithoutSaving}
            style={{
              padding: isCompactLayout ? '10px 12px' : '12px 16px',
              backgroundColor: 'transparent',
              color: '#666',
              border: '2px solid #ddd',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: isCompactLayout ? '0.85rem' : '0.9rem',
              fontWeight: 'bold',
              fontFamily: "'EmOne', sans-serif",
              textAlign: 'center'
            }}
          >
            Use Without Saving
          </button>
        </div>
      </div>
    </>
  );

  const wrapper = (
    <div style={{
      padding: isCompactLayout ? '16px' : '24px',
      boxSizing: 'border-box',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'
    }}>
      {modalContent}
    </div>
  );

  return (
    <CanvasModal
      isVisible={isVisible}
      onClose={handleClose}
      title=""
      width={modalWidth}
      height={modalHeight}
      position="center"
      margin={isCompactLayout ? 12 : 20}
      {...canvasModalProps}
    >
      {wrapper}
    </CanvasModal>
  );
};

export default AlphaOnboardingModal;
