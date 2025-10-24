import React, { useEffect, useRef } from 'react';
import { useViewportBounds } from '../hooks/useViewportBounds';
import useGraphStore from '../store/graphStore.jsx';

/**
 * Panel Modal Component
 * Positions content within a panel area with canvas-colored styling
 * and drop shadow. Includes margins and proper backdrop handling.
 */
const PanelModal = ({
  isVisible,
  onClose,
  children,
  title = '',
  width = 320,
  height = 'auto',
  panel = 'right', // 'left' or 'right'
  position = 'center', // 'top', 'center', 'bottom'
  margin = 16,
  className = ''
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
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Calculate position within panel
  const getModalPosition = () => {
    const isLeftPanel = panel === 'left';
    const isRightPanel = panel === 'right';

    // Get panel dimensions
    const panelWidth = isLeftPanel ? viewportBounds.leftWidth : viewportBounds.rightWidth;
    const panelExpanded = isLeftPanel ? leftPanelExpanded : rightPanelExpanded;

    if (!panelExpanded || panelWidth === 0) {
      // Fallback to center of screen if panel is collapsed
      return {
        left: (viewportBounds.windowWidth - width) / 2,
        top: (viewportBounds.windowHeight - (height === 'auto' ? 300 : height)) / 2
      };
    }

    // Calculate panel bounds
    let panelX, panelY, panelW, panelH;

    if (isLeftPanel) {
      panelX = 0;
      panelY = viewportBounds.y;
      panelW = panelWidth;
      panelH = viewportBounds.height;
    } else {
      panelX = viewportBounds.windowWidth - panelWidth;
      panelY = viewportBounds.y;
      panelW = panelWidth;
      panelH = viewportBounds.height;
    }

    let left, top;

    switch (position) {
      case 'top':
        left = panelX + (panelW - width) / 2;
        top = panelY + margin;
        break;
      case 'bottom':
        left = panelX + (panelW - width) / 2;
        top = panelY + panelH - (height === 'auto' ? 300 : height) - margin;
        break;
      case 'center':
      default:
        left = panelX + (panelW - width) / 2;
        top = panelY + (panelH - (height === 'auto' ? 300 : height)) / 2;
        break;
    }

    // Ensure modal stays within panel bounds
    left = Math.max(panelX + margin, Math.min(left, panelX + panelW - width - margin));
    top = Math.max(panelY + margin, Math.min(top, panelY + panelH - (height === 'auto' ? 300 : height) - margin));

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
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 9998,
          backdropFilter: 'blur(2px)'
        }}
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={`panel-modal ${className}`}
        style={{
          position: 'fixed',
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: height === 'auto' ? 'auto' : `${height}px`,
          backgroundColor: '#bdb5b5', // Canvas color
          border: '2px solid #260000', // Maroon border
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          zIndex: 9999,
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

export default PanelModal;
