import React, { useState, useEffect, useRef } from 'react';
import { HEADER_HEIGHT } from './constants';
import { universeManagerService } from './services/universeManagerService';
import saveCoordinator from './services/SaveCoordinator';
import { useViewportBounds } from './hooks/useViewportBounds';
import useGraphStore from './store/graphStore.js';

// How long changes may sit un-written before the indicator says so. The normal
// pipeline dispatches ~3.5s after an edit (500ms worker debounce + 3s save
// debounce), so anything past this is a genuine stall — a failed write in
// retry backoff, or a data-loss guard refusing the save — and the user needs
// to know. The dirty clock is held at zero during interaction (see below), so
// a long drag never trips it.
const STALLED_DIRTY_MS = 10000;

const SaveStatusDisplay = ({ hidden = false }) => {
  // `null` means "nothing worth saying" — the quiet debounce window between an
  // edit and its write. Previously this window rendered "Saving..." even
  // though no write was in flight, which is what made a single edit look like
  // it was saving for many seconds.
  const [statusText, setStatusText] = useState('Loading...');
  const [isCTA, setIsCTA] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Timestamp the coordinator first went dirty with no write in flight.
  const dirtySinceRef = useRef(0);

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
    if (statusText === null) {
      // Quiet window — nothing to report, fade out immediately.
      setIsVisible(false);
      return;
    }
    if (statusText === 'Saved') {
      // After a brief moment, fade out completely. Saving.../Error/Loading.../
      // etc. still flash through; only the steady-state "Saved" is hidden.
      const timer = setTimeout(() => setIsVisible(false), 1500);
      return () => clearTimeout(timer);
    }
    setIsVisible(true);
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

        // Track how long changes have been dirty with no write in flight. The
        // clock is held at zero while the user is interacting, because the
        // coordinator deliberately defers serialization until the drag/pan
        // ends — that deferral is correct, not a stall.
        if (!coordinatorHasUnsaved || coordinatorIsSaving || saveCoordinator.isGlobalDragging) {
          dirtySinceRef.current = 0;
        } else if (dirtySinceRef.current === 0) {
          dirtySinceRef.current = Date.now();
        }
        const dirtyStalled = dirtySinceRef.current > 0
          && (Date.now() - dirtySinceRef.current) > STALLED_DIRTY_MS;

        // Priority order: Error > Paused > Loading > Writing > Stalled > Git behind > Saved
        //
        // "Saving..." now means a write is genuinely in flight. The debounce
        // window between an edit and its write reports nothing at all — it is
        // a normal, uninteresting few seconds, and labelling it "Saving..."
        // was what made one edit look like a ten-second save.
        if (engine?.isInErrorBackoff || engine?.isHealthy === false) {
          setStatusText('Error');
          setIsCTA(false);
        } else if (engine?.isPaused) {
          setStatusText('Paused');
          setIsCTA(false);
        } else if (isLoadingFromRepo) {
          setStatusText('Syncing...');
          setIsCTA(false);
        } else if (coordinatorIsSaving) {
          // A local write is actually running.
          setStatusText('Saving...');
          setIsCTA(false);
        } else if (dirtyStalled) {
          // Past the debounce by a wide margin — the write failed and is in
          // retry backoff, or a guard refused it. Say so rather than sitting
          // silently on stale-looking "Saved".
          setStatusText('Unsaved');
          setIsCTA(false);
        } else if (coordinatorHasUnsaved) {
          // Normal debounce window. Nothing useful to report yet.
          setStatusText(null);
          setIsCTA(false);
        } else if (isCommitting || pendingCommits > 0 || hasUnsavedChanges) {
          // Local bytes are durable; Git is still catching up. That is a
          // different (and much less urgent) state than "not yet saved".
          setStatusText('Syncing...');
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

