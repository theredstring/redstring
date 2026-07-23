import React, { useState, useEffect, useRef } from 'react';
import { HEADER_HEIGHT } from './constants';
import { universeManagerService } from './services/universeManagerService';
import saveCoordinator from './services/SaveCoordinator';
import { useViewportBounds } from './hooks/useViewportBounds';
import useGraphStore from './store/graphStore.js';

const SaveStatusDisplay = ({ hidden = false }) => {
  const [statusText, setStatusText] = useState('Loading...');
  const [isCTA, setIsCTA] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  const openFederation = () => {
    if (!isCTA) return;
    try {
      window.dispatchEvent(new CustomEvent('redstring:open-federation'));
    } catch { }
  };

  // Guards against the synthetic click that follows touchend from firing
  // openFederation a second time. React registers onTouchEnd as passive, so
  // preventDefault() isn't available there — use a flag instead.
  const touchHandledRef = useRef(false);
  const handleClick = () => {
    if (touchHandledRef.current) return;
    openFederation();
  };
  const handleTouchEnd = () => {
    if (!isCTA) return;
    touchHandledRef.current = true;
    openFederation();
    setTimeout(() => { touchHandledRef.current = false; }, 400);
  };

  const leftPanelExpanded = useGraphStore(state => state.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(state => state.rightPanelExpanded);
  const typeListMode = useGraphStore(state => state.typeListMode);
  const darkMode = useGraphStore(state => state.darkMode);
  
  const viewportBounds = useViewportBounds(
    leftPanelExpanded,
    rightPanelExpanded,
    typeListMode !== 'closed'
  );

  useEffect(() => {
    if (statusText === 'Saved') {
      // After a brief moment, fade out completely. Saving.../Error/Loading.../
      // etc. still flash through; only the steady-state "Saved" is hidden.
      const timer = setTimeout(() => setIsVisible(false), 1500);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(true);
    }
  }, [statusText]);

  useEffect(() => {
    let cancelled = false;

    // Poll sync status - use longer interval during interactions to reduce load
    const getPollInterval = () => {
      // Check if user is actively interacting (dragging, panning, etc.)
      const isInteracting = saveCoordinator.isGlobalDragging;
      return isInteracting ? 5000 : 1000; // 5s during interaction, 1s otherwise
    };

    let currentInterval = getPollInterval();
    let pollInterval;

    const poll = async () => {
      if (cancelled) return;

      try {
        const state = await universeManagerService.getState();
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
        const coordinatorIsSaving = saveCoordinator.isSaving;

        // "Standby" means the universe is git-linked but the sync engine hasn't
        // started/finished its initial pull yet. The canvas is visibly empty
        // and interactive during this window — without a clear indicator the
        // user thinks the universe is loaded and starts editing, and their
        // edits get wiped when the engine finally pulls. Showing "Loading..."
        // here tells them to wait. Source: universeManagerService.getSyncSummary
        // sets state='standby' / label='Awaiting sync engine' when authed +
        // git-linked but no engine yet (universeManagerService.js:247).
        const isLoadingFromRepo = hasGit && activeUniverse.sync?.state === 'standby';

        // Priority order: Error > Paused > Loading > Actively Saving > Not Saved > Saved
        if (engine?.isInErrorBackoff || engine?.isHealthy === false) {
          setStatusText('Error');
          setIsCTA(false);
        } else if (engine?.isPaused) {
          setStatusText('Paused');
          setIsCTA(false);
        } else if (isLoadingFromRepo) {
          setStatusText('Syncing...');
          setIsCTA(false);
        } else if (coordinatorIsSaving || isCommitting) {
          // Actively saving (either SaveCoordinator or Git engine)
          setStatusText('Saving...');
          setIsCTA(false);
        } else if (coordinatorHasUnsaved || pendingCommits > 0 || hasUnsavedChanges) {
          // Has pending changes (including during drag operations)
          setStatusText('Saving...');
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

      // Reschedule with potentially updated interval
      const nextInterval = getPollInterval();
      if (nextInterval !== currentInterval) {
        currentInterval = nextInterval;
        if (pollInterval) clearTimeout(pollInterval);
        pollInterval = setTimeout(poll, currentInterval);
      } else {
        pollInterval = setTimeout(poll, currentInterval);
      }
    };

    // Initial poll
    poll();

    // Listen for universe creation events to refresh immediately
    // Listen for universe creation/update events to refresh immediately
    const handleUniverseChange = () => {
      console.log('[SaveStatusDisplay] Universe changed, updating status...');
      poll();
    };
    window.addEventListener('redstring:universe-created', handleUniverseChange);
    window.addEventListener('redstring:universe-updated', handleUniverseChange);

    return () => {
      cancelled = true;
      if (pollInterval) clearTimeout(pollInterval);
      window.removeEventListener('redstring:universe-created', handleUniverseChange);
      window.removeEventListener('redstring:universe-updated', handleUniverseChange);
    };
  }, []);

  return (
    <div
      className="save-status-display"
      style={{
        position: 'fixed',
        right: viewportBounds ? viewportBounds.rightWidth + 25 : 25,
        bottom: viewportBounds ? viewportBounds.bottomReserved + 5 : 5, // Reduced padding
        transform: 'scale(1)',
        height: `${HEADER_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        padding: 0,
        color: darkMode ? '#e0e0e0' : '#260000',
        zIndex: 20000,
        fontSize: '16px',
        fontFamily: "'EmOne', sans-serif",
        fontWeight: 'bold',
        textShadow: (() => {
          const strokeColor = darkMode ? '#3F3A3A' : '#BDB5B5';
          return `
          -2px -2px 0 ${strokeColor},
           0   -2px 0 ${strokeColor},
           2px -2px 0 ${strokeColor},
           2px  0   0 ${strokeColor},
           2px  2px 0 ${strokeColor},
           0    2px 0 ${strokeColor},
          -2px  2px 0 ${strokeColor},
          -2px  0   0 ${strokeColor}
        `;
        })(),
        userSelect: 'none',

        cursor: isCTA ? 'pointer' : 'default',
        textDecoration: 'none',
        opacity: (isVisible && !hidden) ? 1 : 0,
        transition: 'opacity 1s ease',
        pointerEvents: (isVisible && !hidden) ? 'auto' : 'none'
      }}
      onClick={handleClick}
      onMouseEnter={(e) => {
        if (!isCTA) return;
        try {
          e.currentTarget.style.transform = 'scale(1.06)';
          e.currentTarget.style.transition = 'opacity 1s ease, transform 120ms ease';
        } catch { }
      }}
      onMouseLeave={(e) => {
        if (!isCTA) return;
        try {
          e.currentTarget.style.transform = 'scale(1)';
        } catch { }
      }}
      onTouchStart={(e) => {
        if (!isCTA) return;
        try {
          e.currentTarget.style.transform = 'scale(1.06)';
          e.currentTarget.style.transition = 'opacity 1s ease, transform 120ms ease';
        } catch { }
      }}
      onTouchEnd={(e) => {
        if (!isCTA) return;
        try {
          e.currentTarget.style.transform = 'scale(1)';
        } catch { }
        handleTouchEnd(e);
      }}
      onTouchCancel={(e) => {
        if (!isCTA) return;
        try {
          e.currentTarget.style.transform = 'scale(1)';
        } catch { }
      }}
    >
      {statusText}
    </div>
  );
};

export default SaveStatusDisplay;

