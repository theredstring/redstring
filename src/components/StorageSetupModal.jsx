import React, { useState } from 'react';
import CanvasModal from './CanvasModal';
import { isElectron } from '../utils/fileAccessAdapter.js';
import { FolderOpen, ArrowRightCircle, ArrowRight, Github } from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';

/**
 * Storage Setup Modal
 * Lets a first-time user choose where their universes live: a local folder,
 * a GitHub repository, or browser storage (skip).
 *
 * Flow:
 * 1. "Where should we save your universes?" (Folder / GitHub / Skip)
 *    - Mobile (no File System Access API): GitHub is the primary option and
 *      the folder option is hidden — folder picking doesn't work there.
 *    - Desktop: folder is primary, GitHub is optional.
 * 2. Folder or GitHub -> "Name your Universe"
 */
const StorageSetupModal = ({
  isVisible,
  onClose,
  onFolderSelected = null, // (folderPath, universeName) => void
  onGitSetupSelected = null, // (universeName) => void
  onBrowserStorageSelected = null,
  ...canvasModalProps
}) => {
  const theme = useTheme();
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));

  // Step state: 'selection' | 'naming'
  const [step, setStep] = useState('selection');
  const [universeName, setUniverseName] = useState('Universe');
  // Which path led to the naming step: 'folder' | 'git'
  const [setupMode, setSetupMode] = useState('folder');
  // Temporary storage for the selected folder path/handle while we ask for the name
  const [tempFolderHandle, setTempFolderHandle] = useState(null);

  // Only use compact layout on truly small screens (mobile)
  const isCompactLayout = viewportSize.width <= 500;
  const modalWidth = isCompactLayout
    ? Math.min(Math.max(viewportSize.width - 24, 320), 540)
    : 600;

  const showBrowserStorageOption = !isElectron();

  // No File System Access API (mobile browsers, iOS/Android): folder-based
  // storage can't work, so git sync becomes the primary onboarding path.
  const gitFirst = !isElectron() &&
    typeof window !== 'undefined' && !('showSaveFilePicker' in window);
  const showFolderOption = !gitFirst;
  const showGitOption = !!onGitSetupSelected;

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
        setSetupMode('folder');
        setStep('naming');
      }
    } catch (e) {
      console.error("Failed to pick folder", e);
    }
  };

  const handleGitChoice = () => {
    setSetupMode('git');
    setStep('naming');
  };

  const handleConfirmUniverseCreation = () => {
    const name = universeName || "MyUniverse";
    if (setupMode === 'git') {
      if (onGitSetupSelected) onGitSetupSelected(name);
      return;
    }
    if (onFolderSelected && tempFolderHandle) {
      // Pass both the handle and the name
      onFolderSelected(tempFolderHandle, name);
    }
  };

  const handleBrowserStorageChoice = () => {
    if (onBrowserStorageSelected) {
      onBrowserStorageSelected();
    }
  };

  const renderGitCard = () => (
    <div
      style={{
        backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
        border: `2px solid ${theme.canvas.border}`,
        borderRadius: '8px',
        padding: isCompactLayout ? '16px' : '20px',
        marginBottom: '16px',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
      onClick={handleGitChoice}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.1)' : '#fff';
        e.currentTarget.style.borderColor = theme.canvas.border;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA';
        e.currentTarget.style.borderColor = theme.canvas.border;
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
          color: theme.canvas.textPrimary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Github size={32} />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{
            margin: '0 0 4px 0',
            fontSize: isCompactLayout ? '1rem' : '1.1rem',
            fontWeight: 'bold',
            color: theme.canvas.textPrimary,
            fontFamily: "'EmOne', sans-serif"
          }}>
            {gitFirst ? 'Sync with GitHub' : 'Sync with GitHub (Optional)'}
          </h3>
          <p style={{
            margin: '4px 0 0 0',
            fontSize: isCompactLayout ? '0.85rem' : '0.9rem',
            color: theme.canvas.textPrimary,
            lineHeight: '1.4'
          }}>
            Save your universes to a GitHub repository. Works on any device.
          </p>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleGitChoice();
        }}
        style={{
          width: '100%',
          padding: isCompactLayout ? '10px' : '12px',
          backgroundColor: gitFirst
            ? (theme.darkMode ? '#EFE8E5' : '#260000')
            : 'transparent',
          color: gitFirst
            ? (theme.darkMode ? '#260000' : '#EFE8E5')
            : theme.canvas.textPrimary,
          border: gitFirst ? 'none' : `2px solid ${theme.canvas.border}`,
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: isCompactLayout ? '0.9rem' : '1rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}
      >
        Connect GitHub
      </button>
    </div>
  );

  const renderSelectionStep = () => (
    <>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: isCompactLayout ? '16px' : '24px', flexShrink: 0 }}>
        <h1 style={{
          margin: '0 0 4px 0',
          color: theme.accent.primary,
          fontSize: isCompactLayout ? '1.5rem' : '1.8rem',
          fontWeight: '600',
          fontFamily: "'EmOne', sans-serif",
          letterSpacing: '0.05em'
        }}>
          Welcome to Redstring
        </h1>
        <h2 style={{
          margin: '0 0 8px 0',
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '1.2rem' : '1.5rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Where should we save your universes?
        </h2>
      </div>

      {/* Start Button Options */}
      <div style={{ flexShrink: 0 }}>
        {/* Git first on mobile (folder storage unavailable there) */}
        {showGitOption && gitFirst && renderGitCard()}

        {/* Option A: Choose a Folder */}
        {showFolderOption && (
        <div
          style={{
            backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
            border: `2px solid ${theme.canvas.border}`,
            borderRadius: '8px',
            padding: isCompactLayout ? '16px' : '20px',
            marginBottom: '16px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onClick={handleFolderChoice}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.1)' : '#fff';
            e.currentTarget.style.borderColor = theme.canvas.border;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA';
            e.currentTarget.style.borderColor = theme.canvas.border;
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
              color: theme.canvas.textPrimary,
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
                color: theme.canvas.textPrimary,
                fontFamily: "'EmOne', sans-serif"
              }}>
                Choose a Folder
              </h3>
              <p style={{
                margin: '4px 0 0 0',
                fontSize: isCompactLayout ? '0.85rem' : '0.9rem',
                color: theme.canvas.textPrimary,
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
              backgroundColor: theme.darkMode ? '#EFE8E5' : '#260000',
              color: theme.darkMode ? '#260000' : '#EFE8E5',
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
        )}

        {/* Git as an optional extra on desktop */}
        {showGitOption && !gitFirst && renderGitCard()}

        {/* Option B: Browser Storage */}
        {showBrowserStorageOption && (
          <div
            style={{
              backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
              border: `2px solid ${theme.canvas.border}`,
              borderRadius: '8px',
              padding: isCompactLayout ? '16px' : '20px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onClick={handleBrowserStorageChoice}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.1)' : '#fff';
              e.currentTarget.style.borderColor = theme.canvas.border;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA';
              e.currentTarget.style.borderColor = theme.canvas.border;
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
                color: theme.canvas.textPrimary,
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
                  color: theme.canvas.textPrimary,
                  fontFamily: "'EmOne', sans-serif"
                }}>
                  Skip Folder Setup
                </h3>
                <div style={{
                  marginBottom: '6px',
                  fontStyle: 'italic',
                  color: theme.canvas.textPrimary,
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
                color: theme.canvas.textPrimary,
                border: `2px solid ${theme.canvas.border}`,
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
      <div style={{ textAlign: 'center', marginBottom: '32px', flexShrink: 0, marginTop: '16px' }}>
        <h2 style={{
          margin: '0 0 8px 0',
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '1.3rem' : '1.6rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Name Your Universe
        </h2>
        <p style={{ color: theme.canvas.textPrimary, opacity: 0.8, margin: 0, fontSize: '0.95rem' }}>
          {setupMode === 'git'
            ? "You'll connect GitHub next and pick a repository to sync it."
            : 'This will be the name of your first .redstring file.'}
        </p>
      </div>

      <div style={{
        flexShrink: 0,
        padding: '0 20px'
      }}>
        <label style={{
          display: 'block',
          marginBottom: '8px',
          fontWeight: 'bold',
          color: theme.canvas.textPrimary,
          fontSize: '0.9rem'
        }}>
          Universe Name
        </label>
        <input
          type="text"
          value={universeName}
          onChange={(e) => setUniverseName(e.target.value)}
          placeholder="Universe"
          autoFocus
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: '1.1rem',
            borderRadius: '8px',
            border: `2px solid ${theme.canvas.border}`,
            backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA',
            color: theme.canvas.textPrimary,
            boxSizing: 'border-box',
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
            backgroundColor: universeName.trim() ? (theme.darkMode ? '#EFE8E5' : '#260000') : (theme.darkMode ? 'rgba(255,255,255,0.1)' : '#ccc'),
            color: universeName.trim() && theme.darkMode ? '#260000' : '#EFE8E5',
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
          {setupMode === 'git' ? 'Continue to GitHub' : 'Create Universe'}
          <ArrowRight size={20} />
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
      height="auto"
      position="center"
      margin={isCompactLayout ? 12 : 20}
      {...canvasModalProps}
    >
      <div style={{
        padding: isCompactLayout ? '16px' : '24px',
        boxSizing: 'border-box',
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
            color: theme.canvas.textPrimary,
            opacity: 0.6,
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '4px',
            fontSize: '16px',
            fontWeight: 'bold',
            fontFamily: "'EmOne', sans-serif",
            zIndex: 10,
            transition: 'opacity 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
        >
          ✕
        </button>

        {step === 'selection' ? renderSelectionStep() : renderNamingStep()}
      </div>
    </CanvasModal>
  );
};

export default StorageSetupModal;
