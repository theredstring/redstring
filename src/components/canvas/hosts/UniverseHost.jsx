import React, { Profiler, memo, useCallback, useEffect, useMemo, useRef } from 'react';
import SaveStatusDisplay from '../../../SaveStatusDisplay';
import StorageSetupModal from '../../StorageSetupModal.jsx';
import GitReconnectModal from '../../modals/GitReconnectModal.jsx';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import * as fileStorage from '../../../store/fileStorage.js';
import workspaceService from '../../../services/WorkspaceService.js';
import { runPendingCallbacks, RECONNECT_RESUME_KEY } from '../../../services/githubAuthCallbacks.js';
import { persistentAuth } from '../../../services/persistentAuth.js';
import { getStorageKey } from '../../../utils/storageUtils.js';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';

// Ask the left panel to show a view (P2.05).
const openLeftPanelView = (view) => useCanvasUIStore.getState().openLeftPanelView(view);

/**
 * Universe lifecycle, outside NodeCanvas (P2.06c): workspace start-up and
 * auto-connect, onboarding (StorageSetupModal), GitHub reconnect
 * (GitReconnectModal), the Git redirect resume, the Universes-panel events,
 * and the save status pill. Moved verbatim from NodeCanvas; the reconnect
 * state is in canvasUIStore so the canvas error card (UniverseScreens) shares
 * it. The loading and "not loaded" screens themselves are UniverseScreens.
 */
function UniverseHost() {
  // A snapshot taken once per mount, as NodeCanvas's `storeActions` was: its
  // action functions never change.
  const storeActions = useMemo(() => useGraphStore.getState(), []);
  const isUniverseLoaded = useGraphStore(state => state.isUniverseLoaded);
  const isUniverseLoading = useGraphStore(state => state.isUniverseLoading);
  const universeLoadingError = useGraphStore(state => state.universeLoadingError);
  const hasUniverseFile = useGraphStore(state => state.hasUniverseFile);

  // Onboarding / Storage Setup state
  const showStorageSetupModal = useCanvasUIStore(s => s.showStorageSetupModal), setShowStorageSetupModal = useCanvasUIStore(s => s.setShowStorageSetupModal);

  // GitHub reconnect.
  //
  // `reconnectTarget` names the active universe (and its repo) when it is
  // Git-backed and its load failed — the canvas error card uses it. Null for
  // any other failure, which keeps the plain card.
  //
  // `reconnect` is the modal itself: { mode: 'load' | 'sync', name, repoLabel }.
  // It's latched rather than derived from the load error, because the error
  // clearing is not the end of the job — OAuth connecting makes the load
  // succeed while the App is still being detected, and closing then cut the
  // user off halfway. The modal closes itself once both are confirmed.
  // In canvasUIStore since P2.06c: the canvas error card (UniverseScreens)
  // reads the target and reopens the modal.
  const setReconnectTarget = useCanvasUIStore(s => s.setUniverseReconnectTarget);
  const reconnectDismissed = useCanvasUIStore(s => s.universeReconnectDismissed), setReconnectDismissed = useCanvasUIStore(s => s.setUniverseReconnectDismissed);
  const reconnect = useCanvasUIStore(s => s.universeReconnect), setReconnect = useCanvasUIStore(s => s.setUniverseReconnect);

  const resolveGitReconnectTarget = useCallback(async () => {
    const { default: universeBackend } = await import('../../../services/universeBackend.js');
    const universe = universeBackend.getActiveUniverse?.();
    const linked = universe?.gitRepo?.enabled ? universe.gitRepo.linkedRepo : null;
    if (!linked) return null;
    const owner = linked.user || linked.owner || null;
    const repo = linked.repo || linked.name || null;
    return {
      slug: universe.slug,
      name: universe.name || 'this universe',
      repoLabel: owner && repo ? `${owner}/${repo}` : null
    };
  }, []);

  useEffect(() => {
    if (!universeLoadingError || isUniverseLoading) {
      setReconnectTarget(null);
      // A later failure is a new problem and gets the modal again.
      if (!universeLoadingError) setReconnectDismissed(false);
      return undefined;
    }
    let cancelled = false;
    resolveGitReconnectTarget().then((target) => {
      if (cancelled) return;
      setReconnectTarget(target);
      if (target && !reconnectDismissed) {
        setReconnect((open) => open || { mode: 'load', ...target });
      }
    }).catch(() => { /* keep the plain error card */ });
    return () => { cancelled = true; };
  }, [universeLoadingError, isUniverseLoading, reconnectDismissed, resolveGitReconnectTarget]);

  // Loaded, but the GitHub App isn't linked. The App is how a Git universe is
  // meant to sync — OAuth carrying it (the "Allow OAuth as backup" setting)
  // is a fallback, not a substitute — so a Git universe without the App
  // always gets the modal. That covers nobody signed in at all, too.
  //
  // Closing it means "not now" for that universe, for the rest of the
  // session. Linking the App wipes those, so losing it again prompts again.
  const appPromptDismissedRef = useRef(new Set());
  const openReconnect = useCallback(async ({ force = false } = {}) => {
    const target = await resolveGitReconnectTarget().catch(() => null);
    if (!target) return;
    const failed = !!useGraphStore.getState().universeLoadingError;
    if (failed) {
      // The load-failure effect owns this case.
      if (force) setReconnectDismissed(false);
      setReconnect((current) => current || { mode: 'load', ...target });
      return;
    }
    if (!force && appPromptDismissedRef.current.has(target.slug)) return;
    setReconnect((current) => current || { mode: 'sync', ...target });
  }, [resolveGitReconnectTarget]);

  const isUniverseLoadedForPrompt = useGraphStore(state => state.isUniverseLoaded);
  useEffect(() => {
    let cancelled = false;
    let settleTimer = null;

    const evaluate = () => {
      clearTimeout(settleTimer);
      // Settle before judging: boot auto-connect may still be discovering the
      // App, and disconnect flows emit several events in a row. If the App
      // does turn up after this, the modal closes itself once it confirms.
      settleTimer = setTimeout(async () => {
        if (cancelled) return;
        await persistentAuth.readyPromise?.catch?.(() => {});
        const store = useGraphStore.getState();
        if (store.isUniverseLoading || !store.isUniverseLoaded || store.universeLoadingError) return;
        if (persistentAuth.getAuthStatus()?.hasGitHubApp) {
          appPromptDismissedRef.current.clear();
          return;
        }
        openReconnect();
      }, 1500);
    };

    evaluate();
    const AUTH_EVENTS = ['tokensCleared', 'authExpired', 'appInstallationCleared', 'tokenStored', 'appInstallationStored'];
    AUTH_EVENTS.forEach((ev) => persistentAuth.on(ev, evaluate));
    return () => {
      cancelled = true;
      clearTimeout(settleTimer);
      AUTH_EVENTS.forEach((ev) => persistentAuth.off(ev, evaluate));
    };
  }, [isUniverseLoading, isUniverseLoadedForPrompt, universeLoadingError, openReconnect]);

  // The save pill's Reconnect CTA — an explicit ask, so it ignores "not now".
  useEffect(() => {
    const onOpen = () => openReconnect({ force: true });
    window.addEventListener('redstring:open-git-reconnect', onOpen);
    return () => window.removeEventListener('redstring:open-git-reconnect', onOpen);
  }, [openReconnect]);

  const retryUniverseLoad = useCallback(async () => {
    const { default: universeBackend } = await import('../../../services/universeBackend.js');
    await universeBackend.retryActiveUniverseLoad();
  }, []);

  const openUniversesPanel = useCallback(() => {
    storeActions.setLeftPanelExpanded(true);
    openLeftPanelView('federation');
  }, [storeActions]);

  // Helper to get storage key with test mode support


  // Check for stored folder on app startup and attempt to restore
  // Check for stored workspace configuration on app startup
  useEffect(() => {
    let isMounted = true;

    const initializeWorkspace = async () => {
      try {
        const result = await workspaceService.initialize();
        if (!isMounted) return;

        console.log('[NodeCanvas] Workspace initialization result:', result);

        if (result.status === 'READY') {
          // 4a. If valid config exists, set state directly (loading happens via store action if needed)
          console.log('[NodeCanvas] Workspace ready. Active universe:', result.activeUniverse);
          storeActions.setStorageMode('folder');
          // Load UI settings from workspace config
          await storeActions.loadUISettingsFromWorkspace?.(workspaceService);
          // We can set universe loaded here if we want to skip loading screen immediately,
          // but usually we want to trigger a load. 
          // For now, let's assume the service/store handles the actual file read if implemented,
          // OR we trigger a load here.
          // Wait, initialize() only returned status. It didn't load the file content into store.
          // We need to trigger loadUniverseFromFile if we want to show it.
          // But WorkspaceService controls the config.

          if (result.activeUniverse) {
            // Trigger load of that specific file
            // We need the file handle first.
            const folderHandle = workspaceService.getFolderHandle();
            if (folderHandle) {
              // We need to implement a "loadUniverseByName" in NodeCanvas or call service?
              // Let's implement a quick loader helper or use existing list logic.
              // For now, let's just mark it as loaded and let user pick from grid if they want,
              // or better: auto-load the active universe.

              // For MVP of this fix: Let's just set storage mode and universe connected.
              // The system will eventually need to read the file.

              // Let's check if we have a way to load by name securely.
              // Actually, let's just Open the Universe Grid if we are ready but haven't loaded data.
              storeActions.setUniverseConnected(true);
              storeActions.setUniverseLoaded(true, false); // Mark loaded empty so we see UI

              // Important: If we want to auto-load the LAST file, we need to read it.
              // Let's defer that optimization and just go to Grid if unsure, 
              // BUT the user said "it doesn't actually make the universe... in the universes tab".

              // Let's start by confirming we DON'T show onboarding.
              // The state is ready.
            }
          }

        } else if (result.status === 'SELECT_UNIVERSE') {
          console.log('[NodeCanvas] Folder valid but no active universe. Opening Grid.');
          storeActions.setStorageMode('folder');
          storeActions.setUniverseConnected(true);
          storeActions.setUniverseLoaded(true, false);
          storeActions.setLeftPanelExpanded(true);
          setShowStorageSetupModal(false); // Close setup modal if it was accidentally opened

          if (typeof window !== 'undefined') {
            localStorage.setItem(getStorageKey('redstring-welcome-seen'), 'true');
          }
          openLeftPanelView('federation');
        }
        // If NEEDS_ONBOARDING, check if user has skipped setup before
        else if (result.status === 'NEEDS_ONBOARDING') {
          let welcomeSeen = typeof window !== 'undefined' && localStorage.getItem(getStorageKey('redstring-welcome-seen')) === 'true';

          // Self-heal: if localStorage flag is missing but the backend already
          // has a REAL universe (not just the auto-created empty placeholder),
          // treat as onboarded and rewrite the flag. Mirrors the hasRealUniverse
          // check below — existing.length > 0 alone isn't enough, since a
          // placeholder universe with no file handle/git link doesn't mean the
          // user ever went through onboarding.
          if (!welcomeSeen) {
            try {
              const mod = await import('../../../services/universeBackend.js');
              const existing = mod.default?.getAllUniverses?.() || [];
              const hasRealUniverse = existing.some(u =>
                u.localFile?.hadFileHandle ||
                u.localFile?.lastSaved ||
                u.metadata?.lastSaved ||
                u.gitRepo?.enabled
              );
              if (hasRealUniverse) {
                welcomeSeen = true;
                if (typeof window !== 'undefined') {
                  try { localStorage.setItem(getStorageKey('redstring-welcome-seen'), 'true'); } catch { }
                }
              }
            } catch { }
          }

          if (welcomeSeen) {
            console.log('[NodeCanvas] Onboarding seen but no workspace config. Falling back to browser/auto-connect...');
            // Try to auto-connect (handles IndexedDB/Browser Storage)
            const autoConnected = await fileStorage.autoConnectToUniverse();
            if (!autoConnected) {
              console.log('[NodeCanvas] Auto-connect failed. Opening Grid View.');
              // No previous session found -> Open Grid
              storeActions.setUniverseLoaded(true, false);
              storeActions.setLeftPanelExpanded(true);
              openLeftPanelView('federation');
            } else {
              console.log('[NodeCanvas] Auto-connected to browser storage session.');
              storeActions.setStorageMode('browser');
              storeActions.setUniverseConnected(true);
            }
          } else {
            // ONLY show onboarding if NOT seen
            console.log('[NodeCanvas] Fresh start. Showing onboarding (StorageSetupModal).');
            setShowStorageSetupModal(true);
          }
        }

      } catch (error) {
        console.error('[NodeCanvas] Workspace init failed:', error);
      }
    };

    initializeWorkspace();

    return () => {
      isMounted = false;
    };
  }, []); // Run once on mount

  // Show onboarding modal when there's no universe file and universe isn't loaded
  useEffect(() => {
    let cancelled = false;

    const evaluate = async () => {
      // Check if user has already completed onboarding
      let welcomeSeenVar = false;
      let hasCompletedOnboarding = false;
      try {
        if (typeof window !== 'undefined') {
          // Check scoped key first, then unscoped fallback. The unscoped key
          // survives session/test-mode changes and any future key rename —
          // critical for app updates where scoped lookups could miss.
          const scopedSeen = localStorage.getItem(getStorageKey('redstring-welcome-seen')) === 'true';
          const unscopedSeen = localStorage.getItem('redstring-welcome-seen') === 'true';
          welcomeSeenVar = scopedSeen || unscopedSeen;
          const fp = localStorage.getItem(getStorageKey('redstring_workspace_folder_path'));
          hasCompletedOnboarding = welcomeSeenVar || !!fp;
        }
      } catch { }

      // Additional onboarded signal: workspaceService already has an active
      // universe configured. Catches the case where localStorage welcome flag
      // was lost but WorkspaceService config survived.
      if (!hasCompletedOnboarding) {
        try {
          if (workspaceService?.config?.activeUniverse) {
            hasCompletedOnboarding = true;
          }
        } catch { }
      }

      // If still not marked onboarded, wait for universeBackend to finish
      // initializing, then check if universes exist. This self-heals cases
      // where localStorage was cleared (new machine, browser reset, a
      // version bump that moved a key) but universe state survived.
      //
      // CRITICAL: awaiting initialize() prevents a race where the effect
      // evaluates before universes are loaded, sees an empty list, and
      // falsely triggers onboarding — which could then overwrite the
      // user's existing universe if they click "Create Universe".
      if (!hasCompletedOnboarding) {
        try {
          const mod = await import('../../../services/universeBackend.js');
          const backend = mod.default;
          if (backend?.initialize && !backend.isInitialized) {
            await backend.initialize();
          }
          const existing = backend?.getAllUniverses?.() || [];
          // A placeholder universe created by createSafeDefaultUniverse() has
          // hadFileHandle=false, no lastSaved, and no git link. Only treat as
          // "user has data" when at least one universe has real evidence of setup.
          const hasRealUniverse = existing.some(u =>
            u.localFile?.hadFileHandle ||
            u.localFile?.lastSaved ||
            u.metadata?.lastSaved ||
            u.gitRepo?.enabled
          );
          if (hasRealUniverse) {
            hasCompletedOnboarding = true;
            // Self-heal: write both scoped + unscoped so future cold starts
            // short-circuit regardless of session/test-mode state.
            if (typeof window !== 'undefined' && !welcomeSeenVar) {
              try {
                localStorage.setItem(getStorageKey('redstring-welcome-seen'), 'true');
                localStorage.setItem('redstring-welcome-seen', 'true');
              } catch { }
            }
          }
        } catch { }
      }

      if (cancelled) return;

      // Suppress the welcome modal only for a PANEL-initiated Git flow (a
      // returning user connecting from the Universes panel). When the
      // onboarding resume flag is set, the redirect belongs to the GitHub
      // wizard and the modal must RE-OPEN at its git-connect step instead.
      let suppressForGitFlow = false;
      try {
        if (typeof window !== 'undefined') {
          const onboardingResume = sessionStorage.getItem('redstring_onboarding_resume') === 'true';
          const gitPending = (
            sessionStorage.getItem('github_oauth_pending') === 'true' ||
            sessionStorage.getItem('github_app_pending') === 'true'
          );
          suppressForGitFlow = gitPending && !onboardingResume;
        }
      } catch { }

      const shouldShowOnboarding =
        !hasCompletedOnboarding &&
        !suppressForGitFlow &&
        !isUniverseLoading && (
          !hasUniverseFile ||
          !isUniverseLoaded ||
          !!universeLoadingError
        );

      if (shouldShowOnboarding && !showStorageSetupModal) {
        setShowStorageSetupModal(true);
      }
    };

    evaluate();

    return () => { cancelled = true; };
  }, [isUniverseLoading, hasUniverseFile, isUniverseLoaded, universeLoadingError, showStorageSetupModal]);

  // Open Federation panel when global event is dispatched (from SaveStatusDisplay CTA
  // or onboarding/help).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handler = () => {
      try {
        storeActions.setLeftPanelExpanded(true);
        openLeftPanelView('federation');
      } catch { }
    };

    window.addEventListener('redstring:open-federation', handler);
    window.addEventListener('openGitFederation', handler);
    return () => {
      window.removeEventListener('redstring:open-federation', handler);
      window.removeEventListener('openGitFederation', handler);
    };
  }, []);

  // When the External Link load is triggered from anywhere (header menu,
  // in-panel button), open the left panel and navigate to the federation
  // (Universes) view so the modal — hosted inside UniverseManager — appears
  // in its proper context.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => {
      try {
        storeActions.setLeftPanelExpanded(true);
        openLeftPanelView('federation');
      } catch { }
    };
    window.addEventListener('redstring:open-external-link', handler);
    return () => window.removeEventListener('redstring:open-external-link', handler);
  }, []);

  // Resume Git flow after OAuth/App redirects.
  // - Onboarding wizard resume: re-open StorageSetupModal (it reads the
  //   resume flags and lands on its git-connect step). Do NOT open the panel.
  // - Reconnect resume (GitReconnectModal sent the user to GitHub): finish
  //   the callback here and stay on the canvas. Storing the token fires the
  //   auth event that reloads the universe from Git; if it still fails, the
  //   load error brings the reconnect modal back on its own.
  // - Panel-initiated connect (pending flags without the onboarding resume):
  //   open the Federation panel so its callback handler runs, as before.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const pendingOAuth = sessionStorage.getItem('github_oauth_pending') === 'true';
      const pendingApp = sessionStorage.getItem('github_app_pending') === 'true';
      const resumeOnboarding = sessionStorage.getItem('redstring_onboarding_resume') === 'true';
      const resumeReconnect = sessionStorage.getItem(RECONNECT_RESUME_KEY) === 'true';
      if (resumeOnboarding) {
        setShowStorageSetupModal(true);
      } else if (resumeReconnect) {
        sessionStorage.removeItem(RECONNECT_RESUME_KEY);
        runPendingCallbacks().catch((err) => {
          console.warn('[NodeCanvas] Reconnect callback processing failed:', err?.message || err);
        });
      } else if (pendingOAuth || pendingApp) {
        storeActions.setLeftPanelExpanded(true);
        openLeftPanelView('federation');
        setShowStorageSetupModal(false);
      }
    } catch (e) {
      // ignore sessionStorage errors
    }
  }, []);

  return (
    <Profiler id="UniverseHost" onRender={onRenderProbe}>
      {/* SaveStatusDisplay Component */}
      <SaveStatusDisplay hidden={showStorageSetupModal} />

      {/* GitHub reconnect — a Git-backed universe failed to load. Yields to
          onboarding, which owns the screen when it's up. */}
      <GitReconnectModal
        isVisible={!!reconnect && !showStorageSetupModal}
        mode={reconnect?.mode || 'load'}
        loaded={!universeLoadingError && !isUniverseLoading}
        onClose={() => {
          if (universeLoadingError) setReconnectDismissed(true);
          else if (reconnect?.slug) appPromptDismissedRef.current.add(reconnect.slug);
          setReconnect(null);
        }}
        onResolved={() => setReconnect(null)}
        universeName={reconnect?.name}
        repoLabel={reconnect?.repoLabel}
        errorMessage={universeLoadingError}
        onRetry={retryUniverseLoad}
        onOpenUniverses={() => {
          if (universeLoadingError) setReconnectDismissed(true);
          else if (reconnect?.slug) appPromptDismissedRef.current.add(reconnect.slug);
          setReconnect(null);
          openUniversesPanel();
        }}
      />

      {/* Storage Setup Modal */}
      <StorageSetupModal
        isVisible={showStorageSetupModal}
        onClose={() => {
          // Persist dismissal so the onboarding doesn't reappear. Write both
          // scoped + unscoped so the flag survives version/session changes.
          try {
            localStorage.setItem(getStorageKey('redstring-welcome-seen'), 'true');
            localStorage.setItem('redstring-welcome-seen', 'true');
            // Abandon any in-flight GitHub wizard so it restarts at the hub.
            sessionStorage.removeItem('redstring_onboarding_resume');
            sessionStorage.removeItem('redstring_onboarding_step');
            sessionStorage.removeItem('redstring_onboarding_slug');
            sessionStorage.removeItem('redstring_onboarding_universe_name');
          } catch { }
          setShowStorageSetupModal(false);
          // Dismissal leaves no universe (nothing is preloaded anymore), so
          // steer to the Universes tab where setup can be finished.
          import('../../../services/universeBackend.js').then(({ default: universeBackend }) => {
            const existing = universeBackend.getAllUniverses?.() || [];
            if (existing.length === 0) {
              storeActions.setUniverseLoaded(true, false);
              storeActions.setLeftPanelExpanded(true);
              openLeftPanelView('federation');
            }
          }).catch(() => { });
        }}
        onUniverseReady={async ({ slug, name, warnings }) => {
          // A storage slot was filled on the one onboarding universe (git repo
          // and/or local file — the modal owns all the actual repo/file work
          // now). Load that universe into the app shell so the canvas shows it,
          // but do NOT finalize onboarding: the modal returns to its slot hub so
          // the user can add another slot or click "Get Connected".
          // Finalization (welcome-seen + close) happens in onFinishOnboarding.
          try {
            const safeName = (name && name.trim()) ? name.trim() : 'Universe';

            // Pick a storage mode from the universe's source of truth. Mark the
            // universe loaded WITH a backing file (git repo or local file counts
            // as the persistent store) — otherwise the canvas stays on the
            // loading screen (gated by !hasUniverseFile) until a manual refresh.
            let mode = 'local';
            try {
              const { default: universeBackend } = await import('../../../services/universeBackend.js');
              const universe = slug ? universeBackend.getUniverse?.(slug) : null;
              const sot = universe?.sourceOfTruth;
              mode = sot === 'git' ? 'git' : sot === 'browser' ? 'browser' : 'local';
            } catch { /* fall back to 'local' */ }

            storeActions.setStorageMode(mode);
            storeActions.setUniverseConnected(true);
            storeActions.setUniverseLoaded(true, true);

            if (typeof window !== 'undefined' && slug) {
              window.dispatchEvent(new CustomEvent('redstring:universe-created', {
                detail: { slug, name: safeName }
              }));
            }

            if (Array.isArray(warnings) && warnings.length > 0) {
              console.warn('[NodeCanvas] Universe slot filled with warnings:', warnings);
            }
            console.log('[NodeCanvas] Universe slot configured. Active universe:', safeName, 'mode:', mode);
          } catch (error) {
            console.error('[NodeCanvas] onUniverseReady failed:', error);
            storeActions.setUniverseError(`Failed to load universe: ${error.message}`);
          }
        }}
        onFinishOnboarding={() => {
          // User clicked "Get Connected" (or dismissed) with at least one
          // universe set up. Finalize: mark onboarding seen, clear any wizard
          // resume flags, and close the modal — the universe is already loaded
          // into the shell, so the user lands on the canvas.
          try {
            if (typeof window !== 'undefined') {
              localStorage.setItem(getStorageKey('redstring-welcome-seen'), 'true');
              localStorage.setItem('redstring-welcome-seen', 'true');
              sessionStorage.removeItem('redstring_onboarding_resume');
              sessionStorage.removeItem('redstring_onboarding_step');
              sessionStorage.removeItem('redstring_onboarding_slug');
              sessionStorage.removeItem('redstring_onboarding_universe_name');
            }
          } catch { }
          setShowStorageSetupModal(false);
        }}
        onBrowserStorageSelected={async () => {
          try {
            console.log('[NodeCanvas] User selected browser storage option');

            // Mark onboarding as complete (scoped + unscoped for durability)
            if (typeof window !== 'undefined') {
              localStorage.setItem(getStorageKey('redstring-welcome-seen'), 'true');
              localStorage.setItem('redstring-welcome-seen', 'true');
            }

            // Close storage setup modal
            setShowStorageSetupModal(false);

            // No universe is preloaded anymore, so the skip path must create
            // the browser-backed universe itself — an explicit user choice,
            // not a preload.
            try {
              const { default: universeBackend } = await import('../../../services/universeBackend.js');
              const existing = universeBackend.getAllUniverses?.() || [];
              if (existing.length === 0) {
                await universeBackend.createUniverse('Universe', {
                  enableLocal: false,
                  enableGit: false,
                  sourceOfTruth: 'browser'
                });
              }
            } catch (createError) {
              console.warn('[NodeCanvas] Failed to create browser universe on skip:', createError);
            }

            // Load empty universe in browser storage mode
            storeActions.setStorageMode('browser');
            storeActions.setUniverseLoaded(true, false);

            // Open the Universes (grid) tab in left panel
            storeActions.setLeftPanelExpanded(true);
            openLeftPanelView('federation');

            console.log('[NodeCanvas] Browser storage mode activated');
          } catch (error) {
            console.error('[NodeCanvas] Browser storage setup failed:', error);
            storeActions.setUniverseError(`Failed to set up browser storage: ${error.message}`);
          }
        }}
      />
    </Profiler>
  );
}

export default memo(UniverseHost);
