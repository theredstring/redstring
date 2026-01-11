import React, { useState } from 'react';
import CanvasModal from './CanvasModal';
import { isElectron } from '../utils/fileAccessAdapter.js';

/**
 * Storage Setup Modal
 * Allows users to choose between folder-based storage and browser storage
 * Shown after welcome screen when user clicks "Get Started"
 */
const StorageSetupModal = ({
  isVisible,
  onClose,
  onFolderSelected = null,
  onBrowserStorageSelected = null,
  ...canvasModalProps
}) => {
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));
  // Only use compact layout on truly small screens (mobile)
  const isCompactLayout = viewportSize.width <= 500;
  const modalWidth = isCompactLayout
    ? Math.min(Math.max(viewportSize.width - 24, 320), 540)
    : 600;
  const modalHeight = isCompactLayout
    ? Math.min(Math.max(viewportSize.height * 0.85, 400), 550)
    : 520;

  const showBrowserStorageOption = !isElectron();

  React.useEffect(() => {
    const handleResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleFolderChoice = () => {
    if (onFolderSelected) {
      onFolderSelected();
    }
  };

  const handleBrowserStorageChoice = () => {
    if (onBrowserStorageSelected) {
      onBrowserStorageSelected();
    }
  };

  const modalContent = (
    <>
      {/* Close button */}
      <button
        onClick={onClose}
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
          zIndex: 10
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = '#260000'}
        onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
      >
        ✕
      </button>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: isCompactLayout ? '16px' : '24px', flexShrink: 0 }}>
        <h2 style={{
          margin: '0 0 8px 0',
          color: '#260000',
          fontSize: isCompactLayout ? '1.1rem' : '1.4rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Where should we save your work?
        </h2>
      </div>

      {/* Main Content */}
      <div
        style={{
          lineHeight: '1.4',
          fontFamily: "'EmOne', sans-serif",
          overflowY: 'auto',
          flex: 1
        }}
      >
        {/* Option A: Choose a Folder */}
        <div
          style={{
            backgroundColor: '#f8f8f8',
            border: '2px solid #260000',
            borderRadius: '8px',
            padding: isCompactLayout ? '16px' : '20px',
            marginBottom: '16px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onClick={handleFolderChoice}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#fff';
            e.currentTarget.style.borderColor = '#8B0000';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#f8f8f8';
            e.currentTarget.style.borderColor = '#260000';
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            marginBottom: '12px'
          }}>
            <div style={{
              fontSize: '2rem',
              lineHeight: '1',
              flexShrink: 0
            }}>
              📁
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{
                margin: '0 0 4px 0',
                fontSize: isCompactLayout ? '1rem' : '1.1rem',
                fontWeight: 'bold',
                color: '#260000',
                fontFamily: "'EmOne', sans-serif"
              }}>
                Choose a Folder
                <span style={{
                  marginLeft: '8px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  color: '#8B0000',
                  fontFamily: "'EmOne', sans-serif"
                }}>
                  (Recommended)
                </span>
              </h3>
              <p style={{
                margin: '4px 0 0 0',
                fontSize: isCompactLayout ? '0.85rem' : '0.9rem',
                color: '#555',
                lineHeight: '1.4'
              }}>
                Save all universes in one place. Works across sessions.
              </p>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleFolderChoice();
            }}
            style={{
              width: '100%',
              padding: isCompactLayout ? '10px' : '12px',
              backgroundColor: '#8B0000',
              color: '#EFE8E5',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: isCompactLayout ? '0.9rem' : '1rem',
              fontWeight: 'bold',
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            Select Folder
          </button>
        </div>

        {/* Option B: Browser Storage (web only) */}
        {showBrowserStorageOption && (
          <div
            style={{
              backgroundColor: '#f8f8f8',
              border: '2px solid #ccc',
              borderRadius: '8px',
              padding: isCompactLayout ? '16px' : '20px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onClick={handleBrowserStorageChoice}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#fff';
              e.currentTarget.style.borderColor = '#999';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#f8f8f8';
              e.currentTarget.style.borderColor = '#ccc';
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              marginBottom: '12px'
            }}>
              <div style={{
                fontSize: '2rem',
                lineHeight: '1',
                flexShrink: 0
              }}>
                💾
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{
                  margin: '0 0 4px 0',
                  fontSize: isCompactLayout ? '1rem' : '1.1rem',
                  fontWeight: 'bold',
                  color: '#260000',
                  fontFamily: "'EmOne', sans-serif"
                }}>
                  Browser Storage
                </h3>
                <div style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  backgroundColor: '#fff3cd',
                  border: '1px solid #ffc107',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  color: '#856404',
                  marginBottom: '6px'
                }}>
                  Not recommended for important work
                </div>
                <p style={{
                  margin: '4px 0 0 0',
                  fontSize: isCompactLayout ? '0.85rem' : '0.9rem',
                  color: '#555',
                  lineHeight: '1.4'
                }}>
                  Quick start. Data stays in this browser only.
                </p>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleBrowserStorageChoice();
              }}
              style={{
                width: '100%',
                padding: isCompactLayout ? '10px' : '12px',
                backgroundColor: 'transparent',
                color: '#666',
                border: '2px solid #ddd',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: isCompactLayout ? '0.9rem' : '1rem',
                fontWeight: 'bold',
                fontFamily: "'EmOne', sans-serif"
              }}
            >
              Use Browser Storage
            </button>
          </div>
        )}
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
      onClose={onClose}
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

export default StorageSetupModal;
