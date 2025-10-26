import React, { useEffect, useRef } from 'react';
import { useViewportBounds } from '../hooks/useViewportBounds';
import useGraphStore from '../store/graphStore.jsx';

/**
 * Canvas Modal Component
 * Positions content within the canvas viewport with canvas-colored styling
 * and drop shadow. Includes margins and proper backdrop handling.
 */
const CanvasModal = ({
  isVisible,
  onClose,
  children,
  title = '',
  width = 400,
  height = 'auto',
  position = 'center', // 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'
  margin = 20,
  className = '',
  disableBackdrop = false, // Disable backdrop click to close
  fullScreenOverlay = false // Cover entire viewport including panels
}) => {
  const modalRef = useRef(null);
  const { leftPanelExpanded, rightPanelExpanded, typeListMode } = useGraphStore();

  // Get viewport bounds for positioning
  const viewportBounds = useViewportBounds(
    leftPanelExpanded,
    rightPanelExpanded,
    typeListMode !== 'closed'
  );

  // Handle escape key
  useEffect(() => {
    if (!isVisible) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isVisible, onClose]);

  // Handle backdrop click
  const handleBackdropClick = (e) => {
    if (!disableBackdrop && e.target === e.currentTarget) {
      onClose();
    }
  };

  // Calculate position within viewport, accounting for header and TypeList
  const getModalPosition = () => {
    const baseWindowWidth = viewportBounds.windowWidth || window.innerWidth || viewportBounds.width;
    const baseWindowHeight = viewportBounds.windowHeight || window.innerHeight || viewportBounds.height;
    const viewportX = fullScreenOverlay ? 0 : viewportBounds.x;
    const viewportY = fullScreenOverlay ? 0 : viewportBounds.y;
    const viewportWidth = fullScreenOverlay ? baseWindowWidth : viewportBounds.width;
    const viewportHeight = fullScreenOverlay ? baseWindowHeight : viewportBounds.height;

    const maxWidth = Math.max(240, viewportWidth - margin * 2);
    const maxHeight = Math.max(200, viewportHeight - margin * 2);
    const numericWidth = typeof width === 'number' ? width : null;
    const numericHeight = typeof height === 'number' ? height : null;
    const modalWidth = Math.min(numericWidth ?? maxWidth, maxWidth);
    const modalHeightForLayout = Math.min(
      numericHeight ?? Math.min(maxHeight, 720),
      maxHeight
    );

    let left, top;

    switch (position) {
      case 'top-left':
        left = viewportX + margin;
        top = viewportY + margin;
        break;
      case 'top-right':
        left = viewportX + viewportWidth - modalWidth - margin;
        top = viewportY + margin;
        break;
      case 'bottom-left':
        left = viewportX + margin;
        top = viewportY + viewportHeight - modalHeightForLayout - margin;
        break;
      case 'bottom-right':
        left = viewportX + viewportWidth - modalWidth - margin;
        top = viewportY + viewportHeight - modalHeightForLayout - margin;
        break;
      case 'center':
      default:
        left = viewportX + (viewportWidth - modalWidth) / 2;
        top = viewportY + (viewportHeight - modalHeightForLayout) / 2;
        break;
    }

    // Ensure modal stays within viewport bounds, accounting for header and TypeList
    const minTop = viewportY + margin;
    const maxTop = viewportY + viewportHeight - modalHeightForLayout - margin;

    left = Math.max(viewportX + margin, Math.min(left, viewportX + viewportWidth - modalWidth - margin));
    top = Math.max(minTop, Math.min(top, maxTop));

    return { left, top, modalWidth, modalHeightForLayout, maxWidth, maxHeight };
  };

  if (!isVisible || !viewportBounds) return null;

  const { left, top, modalWidth, modalHeightForLayout, maxWidth, maxHeight } = getModalPosition();
  const numericHeight = typeof height === 'number' ? height : null;
  const numericWidth = typeof width === 'number' ? width : null;
  const appliedWidth = numericWidth !== null ? Math.min(numericWidth, maxWidth) : modalWidth;
  const appliedHeight = numericHeight !== null ? Math.min(numericHeight, maxHeight) : null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: fullScreenOverlay ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.5)',
          zIndex: fullScreenOverlay ? 20000 : 9998, // Higher z-index for full screen
          backdropFilter: fullScreenOverlay ? 'blur(4px)' : 'blur(2px)',
          ...(fullScreenOverlay && {
            // Ensure it covers absolutely everything
            width: '100vw',
            height: '100vh'
          })
        }}
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={`canvas-modal ${className}`}
        style={{
          position: 'fixed',
          left: `${left}px`,
          top: `${top}px`,
          width: appliedWidth ? `${appliedWidth}px` : 'auto',
          height: appliedHeight === null ? 'auto' : `${appliedHeight}px`,
          maxWidth: `${maxWidth}px`,
          maxHeight: `${maxHeight}px`,
          backgroundColor: '#bdb5b5', // Canvas color
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          zIndex: fullScreenOverlay ? 20001 : 9999, // Higher z-index for full screen
          fontFamily: "'EmOne', sans-serif",
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        {title && (
          <div
            style={{
              backgroundColor: '#260000',
              color: '#bdb5b5',
              padding: '12px 16px',
              borderBottom: '2px solid #8B0000',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0
            }}
          >
            <h3 style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 'bold'
            }}>
              {title}
            </h3>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#bdb5b5',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(189, 181, 181, 0.2)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              ✕
            </button>
          </div>
        )}

        {/* Content */}
        <div
          style={{
            padding: '16px',
            overflowY: 'auto',
            flex: 1
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
};

export default CanvasModal;
