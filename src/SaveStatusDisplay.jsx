import React, { useState, useEffect, useRef } from 'react';
import { HEADER_HEIGHT } from './constants';
import { universeManagerService } from './services/universeManagerService';
import saveCoordinator from './services/SaveCoordinator';
import { resolveSaveStatus } from './utils/saveStatus.js';
import { useViewportBounds } from './hooks/useViewportBounds';
import useGraphStore from './store/graphStore.js';
import { persistentAuth } from './services/persistentAuth.js';

// How long changes may sit un-written before the indicator says so even with
// no reason reported. The normal pipeline writes ~1.5s after an edit (500ms
// worker debounce + 1s save debounce); a refused or failed write reports its
// reason at once (`saveCoordinator.lastBlockReason`), so this only catches a
// stall nobody explained. The dirty clock is held at zero during interaction
// (see below), so a long drag never trips it.
const STALLED_DIRTY_MS = 6000;

const SaveStatusDisplay = ({ hidden = false }) => {
  // `null` means "nothing worth saying" (mid-drag, before anything is written).
  const [statusText, setStatusText] = useState('Loading...');
  // Why a save didn't happen, shown on hover over "Not saved".
  const [statusDetail, setStatusDetail] = useState(null);
  const [isCTA, setIsCTA] = useState(false);
  // What the CTA does: 'reconnect' opens GitReconnectModal (a Git universe
  // with nobody signed in); anything else opens the Universes panel.
  const [ctaAction, setCtaAction] = useState(null);
  const [isVisible, setIsVisible] = useState(true);

  // Timestamp the coordinator first went dirty with no write in flight.
  const dirtySinceRef = useRef(0);

  const openFederation = () => {
    if (!isCTA) return;
    try {
      window.dispatchEvent(new CustomEvent(
        ctaAction === 'reconnect' ? 'redstring:open-git-reconnect' : 'redstring:open-federation'
      ));
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
        //
        // A universe load in flight counts too, and it is the case the
        // `standby` check alone missed: the engine can be past standby while
        // `loadUniverseData` is still fetching, and during that window the
        // coordinator DEFERS every save rather than running one. Nothing is
        // saving, nothing is dirty, nothing is pending — so the status fell
        // through to "Saved" and asserted a write that had not happened, over
        // a canvas that was still empty. It should read as syncing until the
        // universe is actually in.
        const isLoadingFromRepo = (hasGit && activeUniverse.sync?.state === 'standby')
          || saveCoordinator.loadInFlight > 0;

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

        // The decision itself lives in resolveSaveStatus, so what each state
        // is allowed to CLAIM can be asserted in a test. See saveStatus.js.
        const gitAuth = persistentAuth.getAuthStatus();
        const status = resolveSaveStatus({
          hasUniverse: true,
          hasStorage: true,
          // Git-linked without the GitHub App. With nobody signed in the sync
          // engine never starts, so "Syncing..." would never end; with only
          // OAuth it syncs on the fallback. Either way the App is missing,
          // and this is the way back to the modal after "not now".
          needsGitAuth: hasGit && !gitAuth?.hasGitHubApp,
          gitAuthLabel: gitAuth?.isAuthenticated ? 'Link App' : 'Reconnect',
          isInErrorBackoff: !!engine?.isInErrorBackoff,
          isUnhealthy: engine?.isHealthy === false,
          isPaused: !!engine?.isPaused,
          isLoadingFromRepo,
          isSaving: coordinatorIsSaving,
          blockedReason: coordinatorHasUnsaved ? saveCoordinator.lastBlockReason : null,
          dirtyStalled,
          hasUnsavedChanges: coordinatorHasUnsaved,
          isInteracting: !!saveCoordinator.isGlobalDragging,
          gitBehind: isCommitting || pendingCommits > 0 || hasUnsavedChanges,
          /*
           * The store is the authority on whether a universe is actually in.
           * SaveCoordinator's own flag only flips once a change flows through
           * it, so it stays false through an idle post-load session.
           *
           * Read fresh rather than subscribed: this poll's effect has an empty
           * dependency array, so anything closed over here is frozen at mount
           * — when the value in question is "has the universe arrived yet",
           * the frozen answer is always no, and the indicator would stick on
           * Syncing forever.
           */
          universeReady: !!useGraphStore.getState().isUniverseLoaded
            || saveCoordinator.hasLoadedFromFile
        });
        setStatusText(status.text);
        setStatusDetail(status.detail || null);
        setIsCTA(status.isCTA);
        setCtaAction(status.action || null);
      } catch (error) {
        if (!cancelled) {
          console.warn('[SaveStatusDisplay] Failed to get sync status:', error);
          setStatusText('Unknown');
          setIsCTA(false);
        }
      } finally {
        // Reschedule in `finally`: the early returns above ("No universe",
        // "Connect") used to skip this and stop polling for good. Always clear
        // first: poll() is also called from events, and without the clear each
        // of those calls started a second, permanent polling chain.
        if (!cancelled) {
          currentInterval = getPollInterval();
          if (pollInterval) clearTimeout(pollInterval);
          pollInterval = setTimeout(poll, currentInterval);
        }
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

    // Re-read at once when the coordinator reports (changes detected, a save
    // landed or was refused), so "Saving..." and "Saved" track the write
    // itself rather than the next tick of the poll.
    const unsubscribeCoordinator = saveCoordinator.onStatusChange?.(() => {
      if (!cancelled) poll();
    });

    return () => {
      cancelled = true;
      try { unsubscribeCoordinator?.(); } catch { }
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
      title={statusDetail || undefined}
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

