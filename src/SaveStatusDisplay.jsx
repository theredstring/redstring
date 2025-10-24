import React, { useState, useEffect } from 'react';
import { HEADER_HEIGHT } from './constants';
import { gitFederationService } from './services/gitFederationService';
import saveCoordinator from './services/SaveCoordinator';

const SaveStatusDisplay = ({ onOpenFederation }) => {
  const [statusText, setStatusText] = useState('Loading...');
  const [isBrowserOnly, setIsBrowserOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Poll sync status every second (same as GitNativeFederation)
    const pollInterval = setInterval(async () => {
      if (cancelled) return;

      try {
        const state = await gitFederationService.getState();
        if (cancelled) return;

        const activeUniverse = state.universes.find(u => u.slug === state.activeUniverseSlug);
        if (!activeUniverse) {
          setStatusText('No universe');
          setIsBrowserOnly(false);
          return;
        }

        // Check if user is on browser storage only (no file handle, no git repo)
        const raw = activeUniverse.raw || {};
        const hasLocalFile = raw.localFile?.enabled && raw.localFile?.hadFileHandle;
        const hasGitRepo = raw.gitRepo?.enabled && raw.gitRepo?.linkedRepo;
        const onBrowserOnly = raw.sourceOfTruth === 'browser' || (!hasLocalFile && !hasGitRepo);
        setIsBrowserOnly(onBrowserOnly);

        // Simple status: distinguish between actively saving vs waiting
        const syncStatus = state.syncStatuses?.[activeUniverse.slug];
        const engine = syncStatus || activeUniverse.sync?.engine || {};
        const pendingCommits = Number(engine?.pendingCommits || 0);
        const isCommitting = engine?.isRunning || false;
        const hasUnsavedChanges = engine?.hasChanges || false;
        
        // Check SaveCoordinator for immediate dirty flag (includes drag operations)
        const coordinatorHasUnsaved = saveCoordinator.hasUnsavedChanges();

        // Priority order: Error > Paused > Actively Saving > Connect (browser only) > Not Saved > Saved
        if (engine?.isInErrorBackoff || engine?.isHealthy === false) {
          setStatusText('Error');
        } else if (engine?.isPaused) {
          setStatusText('Paused');
        } else if (isCommitting) {
          // Actively committing to Git
          setStatusText('Saving...');
        } else if (onBrowserOnly) {
          // On browser storage only - show "Connect" instead of "Not Saved"
          setStatusText('Connect');
        } else if (coordinatorHasUnsaved || pendingCommits > 0 || hasUnsavedChanges) {
          // Has pending changes (including during drag operations)
          setStatusText('Not Saved');
        } else {
          setStatusText('Saved');
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[SaveStatusDisplay] Failed to get sync status:', error);
          setStatusText('Unknown');
          setIsBrowserOnly(false);
        }
      }
    }, 1000);

    // Initial load
    pollInterval;

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
    };
  }, []);

  const handleClick = () => {
    // Only make clickable when showing "Connect" (browser-only mode)
    if (isBrowserOnly && statusText === 'Connect' && onOpenFederation) {
      onOpenFederation();
    }
  };

  return (
    <div
      className="save-status-display"
      onClick={handleClick}
      style={{
        position: 'fixed',
        bottom: 0,
        right: 0,
        margin: '0 10px 10px 0',
        height: `${HEADER_HEIGHT}px`,
        width: `${HEADER_HEIGHT * 3}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#260000',
        border: '2px solid #260000',
        borderRadius: '8px',
        padding: 0,
        color: '#bdb5b5',
        zIndex: 20000,
        boxShadow: '0 0 0 3px #BDB5B5, 0 2px 5px rgba(0, 0, 0, 0.2)',
        fontSize: '16px',
        fontFamily: "'EmOne', sans-serif",
        fontWeight: 'normal',
        userSelect: 'none',
        cursor: isBrowserOnly && statusText === 'Connect' ? 'pointer' : 'default',
        transition: 'transform 0.1s ease',
        ...(isBrowserOnly && statusText === 'Connect' ? {
          ':hover': {
            transform: 'scale(1.05)'
          }
        } : {})
      }}
      onMouseEnter={(e) => {
        if (isBrowserOnly && statusText === 'Connect') {
          e.currentTarget.style.transform = 'scale(1.05)';
        }
      }}
      onMouseLeave={(e) => {
        if (isBrowserOnly && statusText === 'Connect') {
          e.currentTarget.style.transform = 'scale(1)';
        }
      }}
    >
      {statusText}
    </div>
  );
};

export default SaveStatusDisplay;

