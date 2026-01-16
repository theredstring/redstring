import React, { useState } from 'react';
import CanvasModal from './CanvasModal';
import { isElectron } from '../utils/fileAccessAdapter.js';
import { FolderOpen, ArrowRightCircle, ArrowRight } from 'lucide-react';

/**
 * Storage Setup Modal
 * Allows users to choose between folder-based storage and browser storage
 * Shown after welcome screen when user clicks "Get Started"
 * 
 * Flow:
 * 1. "Where should we save your work?" (Folder vs Skip)
 * 2. If Folder -> "Name your Universe"
 */
const StorageSetupModal = ({
  isVisible,
  onClose,
  onFolderSelected = null, // (folderPath, universeName) => void
  onBrowserStorageSelected = null,
  ...canvasModalProps
}) => {
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));

  // Step state: 'selection' | 'naming'
  const [step, setStep] = useState('selection');
  const [universeName, setUniverseName] = useState('MyUniverse');
  // Temporary storage for the selected folder path/handle while we ask for the name
  const [tempFolderHandle, setTempFolderHandle] = useState(null);

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

  const handleFolderChoice = async () => {
    // 1. Trigger the native picker
    // This is passed in a way that we assume it returns a promise resolving to the handle/path
    // But wait, the prop `onFolderSelected` was the handler. 
    // We need to change how this works. We need the "picker" logic to be *inside* here or passed as a "picker" prop.
    // However, usually `onFolderSelected` in NodeCanvas *does* the picking.
    // We need a slight interface change: we need a way to PICK first, then store, then Confirm.
    // actually, NodeCanvas passes `onFolderSelected`. That handler *calls* `pickFolder`.
    // We can't easily split that unless we pass `pickFolder` down, OR we make this component responsible for calling `pickFolder`.
    // Let's assume we can change this component to import `pickFolder` or have it passed.
    // For now, let's try to import `pickFolder` directly if we can, or just expect it to be passed?
    // Reviewing NodeCanvas code: `onFolderSelected` *is* the logic that picks.
    // We should probably allow the user to pick, then if successful, move to step 2.

    try {
      // We'll use the imported 'pickFolder' from fileAccessAdapter directly 
      // effectively moving that logic here (or duplicating the import).
      // Check imports above -> `isElectron` is imported. Let's rely on `pickFolder` being available or adapt.
      // Actually, let's just use the `pickFolder` from the adapter directly here.
      const { pickFolder } = await import('../utils/fileAccessAdapter.js');
      const handle = await pickFolder();

      if (handle) {
        setTempFolderHandle(handle);
        setStep('naming');
      }
    } catch (e) {
      console.error("Failed to pick folder", e);
    }
  };

  const handleConfirmUniverseCreation = () => {
    if (onFolderSelected && tempFolderHandle) {
      // Pass both the handle and the name
      onFolderSelected(tempFolderHandle, universeName || "MyUniverse");
    }
  };

  const handleBrowserStorageChoice = () => {
    if (onBrowserStorageSelected) {
      onBrowserStorageSelected();
    }
  };

  const renderSelectionStep = () => (
    <>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: isCompactLayout ? '16px' : '24px', flexShrink: 0 }}>
        <h1 style={{
          margin: '0 0 4px 0',
          color: '#8B0000',
          fontSize: isCompactLayout ? '0.9rem' : '1rem',
          fontWeight: '600',
          fontFamily: "'EmOne', sans-serif",
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          Welcome To Redstring
        </h1>
        <h2 style={{
          margin: '0 0 8px 0',
          color: '#260000',
          fontSize: isCompactLayout ? '1.2rem' : '1.5rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Where should we save your work?
        </h2>
      </div>

      {/* Start Button Options */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
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
              flexShrink: 0,
              color: '#260000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <FolderOpen size={32} />
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

        {/* Option B: Browser Storage */}
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
                flexShrink: 0,
                color: '#666',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <ArrowRightCircle size={32} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{
                  margin: '0 0 4px 0',
                  fontSize: isCompactLayout ? '1rem' : '1.1rem',
                  fontWeight: 'bold',
                  color: '#260000',
                  fontFamily: "'EmOne', sans-serif"
                }}>
                  Skip Folder Setup
                </h3>
                <div style={{
                  marginBottom: '6px',
                  fontStyle: 'italic',
                  color: '#666',
                  fontSize: '0.85rem'
                }}>
                  Finish Set Up on the Universes Tab in the Left Panel
                </div>
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
              Skip For Now
            </button>
          </div>
        )}
      </div>
    </>
  );

  const renderNamingStep = () => (
    <>
      <div style={{ textAlign: 'center', marginBottom: '32px', flexShrink: 0 }}>
        <h2 style={{
          margin: '0 0 8px 0',
          color: '#260000',
          fontSize: isCompactLayout ? '1.3rem' : '1.6rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Name Your Universe
        </h2>
        <p style={{ color: '#666', margin: 0, fontSize: '0.95rem' }}>
          This will be the name of your first .redstring file.
        </p>
      </div>

      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 20px'
      }}>
        <label style={{
          display: 'block',
          marginBottom: '8px',
          fontWeight: 'bold',
          color: '#260000',
          fontSize: '0.9rem'
        }}>
          Universe Name
        </label>
        <input
          type="text"
          value={universeName}
          onChange={(e) => setUniverseName(e.target.value)}
          placeholder="MyUniverse"
          autoFocus
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: '1.1rem',
            borderRadius: '8px',
            border: '2px solid #260000',
            backgroundColor: '#fff',
            color: '#260000',
            fontFamily: "'EmOne', sans-serif",
            marginBottom: '24px',
            outline: 'none'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && universeName.trim()) {
              handleConfirmUniverseCreation();
            }
          }}
        />

        <button
          onClick={handleConfirmUniverseCreation}
          disabled={!universeName.trim()}
          style={{
            width: '100%',
            padding: '14px',
            backgroundColor: universeName.trim() ? '#8B0000' : '#ccc',
            color: '#EFE8E5',
            border: 'none',
            borderRadius: '8px',
            cursor: universeName.trim() ? 'pointer' : 'not-allowed',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            fontFamily: "'EmOne', sans-serif",
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            transition: 'all 0.2s'
          }}
        >
          Create Universe
          <ArrowRight size={20} />
        </button>

        <button
          onClick={() => {
            setStep('selection');
            setTempFolderHandle(null);
          }}
          style={{
            marginTop: '16px',
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: '0.9rem',
            textDecoration: 'underline'
          }}
        >
          Back to Folder Selection
        </button>
      </div>
    </>
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
      <div style={{
        padding: isCompactLayout ? '16px' : '24px',
        boxSizing: 'border-box',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}>
        {/* Close button - always available */}
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

        {step === 'selection' ? renderSelectionStep() : renderNamingStep()}
      </div>
    </CanvasModal>
  );
};

export default StorageSetupModal;
