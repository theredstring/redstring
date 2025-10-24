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
    const viewportX = viewportBounds.x;
    const viewportY = viewportBounds.y;
    const viewportWidth = viewportBounds.width;
    const viewportHeight = viewportBounds.height;

    let left, top;

    switch (position) {
      case 'top-left':
        left = viewportX + 20;
        top = viewportY + 20;
        break;
      case 'top-right':
        left = viewportX + viewportWidth - width - 20;
        top = viewportY + 20;
        break;
      case 'bottom-left':
        const modalHeightBottomLeft = typeof height === 'number' ? height : 400;
        left = viewportX + 20;
        top = viewportY + viewportHeight - modalHeightBottomLeft - 20;
        break;
      case 'bottom-right':
        const modalHeightBottomRight = typeof height === 'number' ? height : 400;
        left = viewportX + viewportWidth - width - 20;
        top = viewportY + viewportHeight - modalHeightBottomRight - 20;
        break;
      case 'center':
      default:
        const modalHeight = typeof height === 'number' ? height : 400;
        left = viewportX + (viewportWidth - width) / 2;
        top = viewportY + (viewportHeight - modalHeight) / 2;
        break;
    }

    // Ensure modal stays within viewport bounds, accounting for header and TypeList
    // Use consistent 20px margins from all edges
    const modalHeight = typeof height === 'number' ? height : 400;
    const minTop = viewportY + 20;
    const maxTop = viewportY + viewportHeight - modalHeight - 20;

    left = Math.max(viewportX + 20, Math.min(left, viewportX + viewportWidth - width - 20));
    top = Math.max(minTop, Math.min(top, maxTop));

    return { left, top };
  };

  if (!isVisible || !viewportBounds) return null;

  const { left, top } = getModalPosition();

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
          backgroundColor: fullScreenOverlay ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.5)',
          zIndex: fullScreenOverlay ? 10000 : 9998, // Higher z-index for full screen
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
          width: `${width}px`,
          height: height === 'auto' ? 'auto' : `${height}px`,
          maxWidth: `${viewportBounds.width - margin * 2}px`,
          maxHeight: `${viewportBounds.height - margin * 2}px`,
          backgroundColor: '#bdb5b5', // Canvas color
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          zIndex: fullScreenOverlay ? 10001 : 9999, // Higher z-index for full screen
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
