import React, { useState, useEffect } from 'react';
import { HEADER_HEIGHT } from './constants';
import { gitFederationService } from './services/gitFederationService';
import saveCoordinator from './services/SaveCoordinator';

const SaveStatusDisplay = () => {
  const [statusText, setStatusText] = useState('Loading...');
  const [isCTA, setIsCTA] = useState(false);

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
          setIsCTA(false);
          return;
        }

        // Determine connectivity (any linked storage?)
        const raw = activeUniverse.raw || {};
        const hasGit = !!(raw.gitRepo?.enabled && raw.gitRepo?.linkedRepo);
        const hasLocal = !!(raw.localFile?.enabled && (raw.localFile?.hadFileHandle || raw.localFile?.path));
        const hasStorage = hasGit || hasLocal;

        if (!hasStorage) {
          setStatusText('Connect');
          setIsCTA(true);
          return;
        }

        // Simple status: distinguish between actively saving vs waiting
        const syncStatus = state.syncStatuses?.[activeUniverse.slug];
        const engine = syncStatus || activeUniverse.sync?.engine || {};
        const pendingCommits = Number(engine?.pendingCommits || 0);
        const isCommitting = engine?.isRunning || false;
        const hasUnsavedChanges = engine?.hasChanges || false;
        
        // Check SaveCoordinator for immediate dirty flag (includes drag operations)
        const coordinatorHasUnsaved = saveCoordinator.hasUnsavedChanges();

        // Priority order: Error > Paused > Actively Saving > Not Saved > Saved
        if (engine?.isInErrorBackoff || engine?.isHealthy === false) {
          setStatusText('Error');
          setIsCTA(false);
        } else if (engine?.isPaused) {
          setStatusText('Paused');
          setIsCTA(false);
        } else if (isCommitting) {
          // Actively committing to Git
          setStatusText('Saving...');
          setIsCTA(false);
        } else if (coordinatorHasUnsaved || pendingCommits > 0 || hasUnsavedChanges) {
          // Has pending changes (including during drag operations)
          setStatusText('Not Saved');
          setIsCTA(false);
        } else {
          setStatusText('Saved');
          setIsCTA(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[SaveStatusDisplay] Failed to get sync status:', error);
          setStatusText('Unknown');
          setIsCTA(false);
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

  return (
    <div
      className="save-status-display"
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
        cursor: isCTA ? 'pointer' : 'default',
        textDecoration: 'none'
      }}
      onClick={() => {
        if (isCTA) {
          try {
            window.dispatchEvent(new CustomEvent('redstring:open-federation'));
          } catch {}
        }
      }}
      onMouseEnter={(e) => {
        if (!isCTA) return;
        try {
          e.currentTarget.style.transform = 'scale(1.06)';
          e.currentTarget.style.transition = 'transform 120ms ease';
        } catch {}
      }}
      onMouseLeave={(e) => {
        if (!isCTA) return;
        try {
          e.currentTarget.style.transform = 'scale(1)';
        } catch {}
      }}
    >
      {statusText}
    </div>
  );
};

export default SaveStatusDisplay;

