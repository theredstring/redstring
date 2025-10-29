import React, { useState, useEffect } from 'react';
import CanvasModal from './CanvasModal';
import { persistentAuth } from '../services/persistentAuth.js';

/**
 * Alpha Onboarding Modal
 * A specialized CanvasModal that welcomes users to Redstring's open alpha
 * Inherits all CanvasModal functionality while providing alpha-specific content
 */
const AlphaOnboardingModal = ({
  isVisible,
  onClose,
  onDontShowAgain = null,
  onCreateLocal = null,
  onOpenLocal = null,
  onConnectGitHub = null,
  ...canvasModalProps
}) => {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [selectedOption, setSelectedOption] = useState('github'); // Default to GitHub as recommended
  const [currentStep, setCurrentStep] = useState('selection'); // 'selection', 'github-onboarding', 'github-connecting'
  const [connectionStatus, setConnectionStatus] = useState({
    oauth: false,
    app: false,
    checking: true
  });
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
    : 700;
  const contentPadding = isCompactLayout ? 16 : 24;
  const sectionGap = isCompactLayout ? 12 : 20;
  const cardPadding = isCompactLayout ? 14 : 20;
  const headingFontSize = isCompactLayout ? '1.2rem' : '1.5rem';
  const subheadingFontSize = isCompactLayout ? '0.85rem' : '0.9rem';
  const buttonFontSize = isCompactLayout ? '0.95rem' : '1rem';
  const fullWidthButtonStyle = isCompactLayout ? { width: '100%' } : {};

  // Check if user has already seen this modal
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hasSeen = localStorage.getItem('redstring-alpha-welcome-seen') === 'true';
      if (hasSeen && !isVisible) {
        // User has seen it before and it's not being forcibly shown
        return;
      }
    }
  }, [isVisible]);

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
  
  // Check connection status when modal becomes visible
  useEffect(() => {
    if (isVisible) {
      const checkConnections = async () => {
        console.log('[AlphaOnboardingModal] Checking GitHub connection status...');

        try {
          // Import gitFederationService to ensure we're synced with GitNativeFederation
          const { default: gitFederationService } = await import('../services/gitFederationService.js');

          // Refresh auth state to get latest
          await gitFederationService.refreshAuth();

          // Get state from gitFederationService (same source as GitNativeFederation)
          const serviceState = await gitFederationService.getState();

          // Use same logic as GitNativeFederation for consistency
          const hasOAuth = !!serviceState.authStatus?.hasOAuthTokens;
          const hasApp = !!(serviceState.authStatus?.hasGitHubApp || serviceState.githubAppInstallation?.installationId);

          console.log('[AlphaOnboardingModal] Connection status:', {
            oauth: hasOAuth,
            app: hasApp,
            oauthUser: serviceState.authStatus?.userData?.login || 'none',
            appUser: serviceState.githubAppInstallation?.username || 'none'
          });

          setConnectionStatus({
            oauth: hasOAuth,
            app: hasApp,
            checking: false
          });

          // If already fully connected, show suggestion to use existing connection
          if (hasOAuth && hasApp) {
            console.log('[AlphaOnboardingModal] ✅ Fully connected to GitHub - both OAuth and App available');
          } else if (hasOAuth || hasApp) {
            console.log('[AlphaOnboardingModal] ⚠️ Partially connected - only', hasOAuth ? 'OAuth' : 'GitHub App', 'available');
          } else {
            console.log('[AlphaOnboardingModal] ❌ Not connected to GitHub');
          }
        } catch (error) {
          console.error('[AlphaOnboardingModal] Failed to check connection status:', error);
          // Fallback to persistentAuth if gitFederationService fails
          const oauthStatus = persistentAuth.getAuthStatus();
          const appInstallation = persistentAuth.getAppInstallation();
          setConnectionStatus({
            oauth: oauthStatus.isAuthenticated,
            app: !!appInstallation,
            checking: false
          });
        }
      };

      checkConnections();
    }
  }, [isVisible]);

  const handleClose = () => {
    // Always mark onboarding as complete when modal is closed
    if (typeof window !== 'undefined') {
      localStorage.setItem('redstring-alpha-welcome-seen', 'true');
    }
    if (dontShowAgain) {
      onDontShowAgain && onDontShowAgain();
    }
    onClose();
  };

  // Render different content based on current step
  const renderStepContent = () => {
    if (currentStep === 'github-onboarding') {
      return renderGitHubOnboarding();
    } else if (currentStep === 'github-connecting') {
      return renderGitHubConnecting();
    }
    return renderSelection();
  };

  const renderSelectionIndicator = (optionKey) => {
    const isActive = selectedOption === optionKey;
    if (isCompactLayout) {
      return (
        <div
          style={{
            padding: '4px 12px',
            borderRadius: '999px',
            border: `2px solid ${isActive ? '#8B0000' : '#c7c2c2'}`,
            backgroundColor: isActive ? '#8B0000' : 'transparent',
            color: isActive ? '#EFE8E5' : '#555',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            minWidth: '88px',
            textAlign: 'center'
          }}
        >
          {isActive ? 'Selected' : 'Tap'}
        </div>
      );
    }
    return (
      <div style={{
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        border: `2px solid ${isActive ? '#8B0000' : '#ddd'}`,
        backgroundColor: isActive ? '#8B0000' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {isActive && (
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'white' }} />
        )}
      </div>
    );
  };

  const renderSelection = () => (
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
          flex: 1,
          lineHeight: '1.4',
          marginBottom: isCompactLayout ? '8px' : '12px',
          fontFamily: "'EmOne', sans-serif",
          overflowY: 'auto'
        }}
      >
        <p style={{
          margin: '0 0 24px 0',
          fontSize: isCompactLayout ? '0.85rem' : '0.95rem',
          color: '#333',
          fontFamily: "'EmOne', sans-serif",
          textAlign: 'center'
        }}>
          <strong>Redstring</strong> helps you build interconnected knowledge through <strong>Things</strong> (concepts) and <strong>Webs</strong> (networks).
        </p>

        <div style={{ 
          backgroundColor: '#260000', 
          borderRadius: '8px', 
          padding: isCompactLayout ? '10px' : '12px',
          marginBottom: '12px',
          fontSize: isCompactLayout ? '0.8rem' : '0.85rem',
          color: '#EFE8E5',
          border: '1px solid #260000'
        }}>
          <strong style={{ fontSize: isCompactLayout ? '0.9rem' : '1rem' }}>Basic Controls:</strong><br />
          • Click and hold to move a Thing<br />
          • Click and drag between Things to connect them<br />
          • Click a connection to give it meaning with a Thing<br />
          • Double-click a Thing to open it in the right panel<br />
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          marginBottom: isCompactLayout ? '12px' : '16px'
        }}>
          <button
            onClick={() => {
              handleClose();
              // Dispatch event to open Git Federation panel
              window.dispatchEvent(new CustomEvent('openGitFederation'));
            }}
            style={{
              padding: isCompactLayout ? '10px 12px' : '12px 16px',
              backgroundColor: '#8B0000',
              color: '#EFE8E5',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: isCompactLayout ? '0.85rem' : '0.9rem',
              fontWeight: 'bold',
              fontFamily: "'EmOne', sans-serif",
              textAlign: 'center'
            }}
          >
            Connect Your First Universe
          </button>

          <button
            onClick={() => {
              handleClose();
              // Dispatch event to open help modal
              window.dispatchEvent(new Event('openHelpModal'));
            }}
            style={{
              padding: isCompactLayout ? '10px 12px' : '12px 16px',
              backgroundColor: '#666',
              color: '#EFE8E5',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: isCompactLayout ? '0.85rem' : '0.9rem',
              fontWeight: 'bold',
              fontFamily: "'EmOne', sans-serif",
              textAlign: 'center'
            }}
          >
            Learn More
          </button>
        </div>

        <p style={{
          margin: '0',
          padding: isCompactLayout ? '24px 16px' : '32px 24px',
          fontSize: isCompactLayout ? '0.75rem' : '0.8rem',
          color: '#666',
          textAlign: 'center',
          fontStyle: 'italic'
        }}>
          Your work is stored in <strong>Universes</strong>.<br />
          Connect GitHub for cloud sync or use local files.
        </p>
      </div>
    </>
  );

  const renderGitHubOnboarding = () => (
    <>
      {/* Back button in top left */}
      <button
        onClick={() => setCurrentStep('selection')}
        style={{
          position: 'absolute',
          top: isCompactLayout ? '12px' : '16px',
          left: isCompactLayout ? '12px' : '16px',
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
        ← Back
      </button>

      {/* GitHub Onboarding Header */}
      <div style={{ textAlign: 'center', marginBottom: `${sectionGap}px`, flexShrink: 0, marginTop: isCompactLayout ? '32px' : '40px' }}>
        <h2 style={{
          margin: '0 0 8px 0',
          color: '#260000',
          fontSize: headingFontSize,
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Connect to GitHub
        </h2>
        <div style={{
          margin: '0 0 16px 0',
          fontSize: subheadingFontSize,
          color: '#666',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Set up automatic cloud sync for your universes
        </div>
      </div>

      {/* GitHub Setup Steps */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: `${sectionGap}px` }}>
        
        {/* Step 1: OAuth */}
        <div style={{
          border: '1px solid #979090',
          borderRadius: '8px',
          padding: `${cardPadding}px`,
          backgroundColor: '#f3f0f0'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              backgroundColor: '#8B0000',
              color: '#bdb5b5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '12px',
              fontSize: '0.8rem',
              fontWeight: 'bold'
            }}>
              1
            </div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#260000' }}>Repository Access (OAuth)</h3>
            {connectionStatus.oauth && (
              <span style={{
                marginLeft: '8px',
                fontSize: '0.75rem',
                color: '#7A0000',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '10px',
                border: '1px solid rgba(122,0,0,0.3)'
              }}>Connected</span>
            )}
          </div>
          <p style={{ margin: '0 0 16px 0', fontSize: '0.9rem', color: '#666' }}>
            Connect your GitHub account to browse and create repositories
          </p>
          {connectionStatus.oauth ? (
            <div style={{ fontSize: '0.85rem', color: '#260000' }}>
              OAuth connection is active
            </div>
          ) : (
            <button
              onClick={() => {
                setCurrentStep('github-connecting');
                if (onConnectGitHub) onConnectGitHub('oauth');
              }}
              style={{
                padding: isCompactLayout ? '10px 16px' : '10px 20px',
                backgroundColor: '#24292f',
                color: '#EFE8E5',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: buttonFontSize,
                fontWeight: 'bold',
                fontFamily: "'EmOne', sans-serif",
                ...fullWidthButtonStyle
              }}
            >
              Connect OAuth
            </button>
          )}
        </div>

        {/* Step 2: GitHub App */}
        <div style={{
          border: '1px solid #979090',
          borderRadius: '8px',
          padding: `${cardPadding}px`,
          backgroundColor: '#f3f0f0'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              backgroundColor: '#8B0000',
              color: '#bdb5b5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '12px',
              fontSize: '0.8rem',
              fontWeight: 'bold'
            }}>
              2
            </div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#260000' }}>Auto-Sync (GitHub App)</h3>
            {connectionStatus.app && (
              <span style={{
                marginLeft: '8px',
                fontSize: '0.75rem',
                color: '#7A0000',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '10px',
                border: '1px solid rgba(122,0,0,0.3)'
              }}>Installed</span>
            )}
          </div>
          <p style={{ margin: '0 0 16px 0', fontSize: '0.9rem', color: '#666' }}>
            Install the Redstring app for automatic universe synchronization
          </p>
          {connectionStatus.app ? (
            <div style={{ fontSize: '0.85rem', color: '#260000' }}>
              GitHub App is installed and active
            </div>
          ) : (
            <button
              onClick={() => {
                setCurrentStep('github-connecting');
                if (onConnectGitHub) onConnectGitHub('app');
              }}
              style={{
                padding: isCompactLayout ? '10px 16px' : '10px 20px',
                backgroundColor: '#8B0000',
                color: '#EFE8E5',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: buttonFontSize,
                fontWeight: 'bold',
                fontFamily: "'EmOne', sans-serif",
                ...fullWidthButtonStyle
              }}
            >
              Install App
            </button>
          )}
        </div>

        {/* Complete Setup */}
        <div style={{
          textAlign: 'center',
          padding: `${cardPadding}px`,
          backgroundColor: 'rgba(122,0,0,0.05)',
          borderRadius: '8px',
          border: '1px solid rgba(122,0,0,0.2)'
        }}>
          {(connectionStatus.oauth && connectionStatus.app) ? (
            <>
              <p style={{ margin: '0 0 16px 0', fontSize: '0.95rem', color: '#260000', fontWeight: 'bold' }}>
                GitHub Integration Complete
              </p>
              <button
                onClick={() => {
                  // Set up Git storage mode and close modal properly
                  if (onConnectGitHub) {
                    console.log('[AlphaOnboardingModal] Starting with existing GitHub connections');
                    onConnectGitHub('use-existing');
                  }
              handleClose();
            }}
            style={{
              padding: isCompactLayout ? '12px 16px' : '12px 24px',
              backgroundColor: '#8B0000',
              color: '#EFE8E5',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: buttonFontSize,
              fontWeight: 'bold',
              fontFamily: "'EmOne', sans-serif",
              ...fullWidthButtonStyle
            }}
          >
            Start with GitHub Sync
          </button>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 16px 0', fontSize: '0.9rem', color: '#666' }}>
                Complete both steps for full GitHub integration
                {connectionStatus.oauth || connectionStatus.app ? (
                  <span style={{ display: 'block', marginTop: '4px', color: '#f57c00', fontSize: '0.8rem' }}>
                    ({connectionStatus.oauth ? '1' : '0'} of 2 steps completed)
                  </span>
                ) : null}
              </p>
              <button
                onClick={() => {
                  setCurrentStep('github-connecting');
                  if (onConnectGitHub) onConnectGitHub('complete');
                }}
                style={{
                  padding: isCompactLayout ? '12px 16px' : '12px 24px',
                  backgroundColor: '#8B0000',
                  color: '#EFE8E5',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: buttonFontSize,
                  fontWeight: 'bold',
                  fontFamily: "'EmOne', sans-serif",
                  ...fullWidthButtonStyle
                }}
              >
                Complete GitHub Setup
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );

  const renderGitHubConnecting = () => (
    <>
      {/* Connecting Header */}
      <div style={{ textAlign: 'center', marginBottom: isCompactLayout ? '24px' : '40px', flexShrink: 0, marginTop: isCompactLayout ? '40px' : '60px' }}>
        <h2 style={{
          margin: '0 0 16px 0',
          color: '#260000',
          fontSize: headingFontSize,
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          Connecting to GitHub...
        </h2>
        
        {/* Loading Spinner */}
        <div style={{
          width: '40px',
          height: '40px',
          margin: '0 auto 20px auto',
          border: '4px solid #ddd',
          borderTop: '4px solid #8B0000',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        
        <p style={{
          margin: '0',
          fontSize: subheadingFontSize,
          color: '#666',
          fontFamily: "'EmOne', sans-serif"
        }}>
          You'll be redirected to GitHub to complete the setup. When you return, this setup will auto-resume.
        </p>
      </div>
      
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </>
  );

  const modalContent = (
    <div style={{
      padding: `${contentPadding}px`,
      boxSizing: 'border-box',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'
    }}>
      {renderStepContent()}
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
      disableBackdrop={currentStep !== 'selection'} // Disable backdrop close during onboarding
      fullScreenOverlay={isCompactLayout || currentStep !== 'selection'} // Use full screen overlay for GitHub onboarding or compact screens
      {...canvasModalProps}
    >
      {modalContent}
    </CanvasModal>
  );
};

export default AlphaOnboardingModal;
