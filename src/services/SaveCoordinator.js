/**
 * Save Coordinator - Simplified save management system
 * 
 * Coordinates between:
 * - Local file saves (FileStorage)
 * - Git repository commits (GitSyncEngine)
 * 
 * Features:
 * - Single debounced save timer (500ms) for all changes
 * - GitSyncEngine handles its own batching and rate limiting
 * - Consistent state synchronization
 */

import { exportToRedstring } from '../formats/redstringFormat.js';
import { gitAutosavePolicy } from './GitAutosavePolicy.js';

// SIMPLIFIED: No priorities - all changes batched together with a single debounce
const DEBOUNCE_MS = 3000; // Wait 3000ms after last change before saving (merges node drop + view restore)

class SaveCoordinator {
  constructor() {
    this.isEnabled = false;
    this.fileStorage = null;
    this.gitSyncEngine = null;

    // SIMPLIFIED: Single state tracking
    this.lastSaveHash = null;
    this.pendingHash = null;  // Hash of changes waiting to be saved
    this.pendingString = null; // Pre-serialized JSON string from worker
    this.pendingRedstringData = null; // Pre-computed Redstring object from worker
    this.lastState = null;
    this.lastChangeContext = {};
    this.saveTimer = null; // Single timer for all changes

    // CRITICAL data-loss guard: do NOT save anything until we have observed at
    // least one explicit `load` change context. Otherwise, when the universe
    // load times out (e.g. slow disk / Git fetch), the store still contains
    // default empty state, and any incidental change would otherwise overwrite
    // the user's file with that empty state.
    this.hasLoadedFromFile = false;

    // High-water mark for catastrophic-shrinkage detection. Set on successful
    // load and after each accepted save. If a save would reduce data well below
    // this baseline (e.g. due to HMR re-creating an empty store, or a buggy
    // reset path), we refuse it instead of overwriting the file. The user can
    // always intentionally clear data via `forceSave` which bypasses this.
    this.dataBaseline = { nodes: 0, graphs: 0 };

    // Drag performance optimization
    this._lastDragLogTime = 0; // Throttle console logs during drag
    this._lastInteractionEndTime = 0; // Track when interaction ended for cooldown

    // Status tracking
    this.statusHandlers = new Set();
    this.isSaving = false;
    this.lastError = null;
    this.isGlobalDragging = false; // Track drag state globally to prevent interleaved updates from triggering saves
    
    // Worker for offloading heavy serialization
    this.saveWorker = null;
    this.workerProcessing = false;
    this.workerDirty = false;
    this.nextStateToProcess = null;
    // Worker watchdog. iOS Safari workers can stall when the tab is backgrounded
    // or under memory pressure; without recovery, scheduleSave is never called
    // (it's only triggered from handleWorkerMessage), so isDirty stays true and
    // the bottom-right indicator gets stuck on "Saving..." forever even though
    // manual save works fine. The watchdog assumes the worker is dead after
    // WORKER_STALL_MS and dispatches a main-thread save with the state we have.
    this.workerWatchdogTimer = null;

    // SoT swap pause. While true, onStateChange queues but doesn't dispatch,
    // and processStateChange early-returns. Set by universeBackend around the
    // setSourceOfTruth migration window so an autosave can't fire mid-swap and
    // dual-write empty state to both local and Git.
    this.swapInProgress = false;

    // Slug of the universe whose baseline is currently loaded. Used to key
    // persisted guard state in localStorage so the shrinkage guard has a
    // meaningful floor immediately after a page refresh (before the load
    // context fires).
    this.activeUniverseSlugForGuard = null;

    // console.log('[SaveCoordinator] Initialized with simple batched saves');
  }

  _getGuardStorageKey(slug) {
    return `redstring-savecoord-guard:${slug}`;
  }

  _persistGuardState(slug) {
    if (!slug || typeof window === 'undefined' || !window.localStorage) return;
    try {
      const payload = {
        dataBaseline: this.dataBaseline,
        lastSaveHash: this.lastSaveHash,
        hasLoadedFromFile: this.hasLoadedFromFile,
        ts: Date.now()
      };
      window.localStorage.setItem(this._getGuardStorageKey(slug), JSON.stringify(payload));
    } catch (e) {
      // Quota / privacy mode failures are non-fatal — the guard still functions
      // in-memory, just without cross-refresh protection.
    }
  }

  _restoreGuardState(slug) {
    if (!slug || typeof window === 'undefined' || !window.localStorage) return false;
    try {
      const raw = window.localStorage.getItem(this._getGuardStorageKey(slug));
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      if (parsed.dataBaseline && typeof parsed.dataBaseline === 'object') {
        this.dataBaseline = {
          nodes: Math.max(this.dataBaseline?.nodes || 0, parsed.dataBaseline.nodes || 0),
          graphs: Math.max(this.dataBaseline?.graphs || 0, parsed.dataBaseline.graphs || 0)
        };
      }
      if (parsed.lastSaveHash) this.lastSaveHash = parsed.lastSaveHash;
      if (parsed.hasLoadedFromFile === true) this.hasLoadedFromFile = true;
      this.activeUniverseSlugForGuard = slug;
      console.log('[SaveCoordinator] Restored persisted guard state for', slug, this.dataBaseline);
      return true;
    } catch (e) {
      return false;
    }
  }

  clearPersistedGuardState(slug) {
    if (!slug || typeof window === 'undefined' || !window.localStorage) return;
    try { window.localStorage.removeItem(this._getGuardStorageKey(slug)); } catch (_) { /* noop */ }
  }

  /**
   * Pause autosave dispatch during a source-of-truth swap.
   * Callers must invoke endSwap() in a finally block to avoid stranding saves.
   */
  beginSwap(label = 'sot-swap') {
    this.swapInProgress = true;
    console.log(`[SaveCoordinator] Swap pause active: ${label}`);
  }

  /**
   * Resume autosave dispatch. If state was queued during the swap, flush it
   * through the normal path so any post-swap edits don't get stranded.
   */
  endSwap(label = 'sot-swap') {
    if (!this.swapInProgress) return;
    this.swapInProgress = false;
    console.log(`[SaveCoordinator] Swap pause released: ${label}`);
    if (this.nextStateToProcess || this.isDirty) {
      this.scheduleSave();
    }
  }

  // Status notification system
  onStatusChange(handler) {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  notifyStatus(type, message, details = {}) {
    const status = { type, message, timestamp: Date.now(), ...details };
    this.statusHandlers.forEach(handler => {
      try {
        handler(status);
      } catch (error) {
        console.warn('[SaveCoordinator] Status handler error:', error);
      }
    });
  }

  // Initialize with required dependencies
  initialize(fileStorage, gitSyncEngine) {
    this.fileStorage = fileStorage;
    this.setGitSyncEngine(gitSyncEngine);
    this.isEnabled = true;

    // Restore persisted guard state for the currently-active universe so the
    // shrinkage guard has a non-zero floor before the first `type:'load'`
    // context fires. Without this, an empty-state autosave racing the load on
    // a fresh refresh slips past the guard (baseline starts at 0) and can
    // wipe both local and Git.
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const activeSlug = window.localStorage.getItem('active_universe_slug');
        if (activeSlug) {
          this._restoreGuardState(activeSlug);
        }
      }
    } catch (e) {
      console.warn('[SaveCoordinator] Failed to restore guard state on initialize:', e);
    }

    // Initialize Save Worker
    try {
      this.saveWorker = new Worker(new URL('./save.worker.js', import.meta.url), { type: 'module' });
      this.saveWorker.onmessage = this.handleWorkerMessage.bind(this);
      this.saveWorker.onerror = (event) => {
        // Worker crashed (script error, OOM, etc.). Recover so the save loop
        // doesn't strand the user's edits — schedule a main-thread save with
        // whatever state we have, then drop the worker (we'll keep using the
        // main thread until the next page load).
        console.warn('[SaveCoordinator] Save worker error event:', event?.message || event);
        this._handleWorkerStall('error event');
        try { this.saveWorker?.terminate?.(); } catch { /* noop */ }
        this.saveWorker = null;
      };
      // console.log('[SaveCoordinator] Save worker initialized');
    } catch (e) {
      console.warn('[SaveCoordinator] Failed to initialize save worker:', e);
      this.saveWorker = null;
    }

    // Initialize Git autosave policy
    gitAutosavePolicy.initialize(gitSyncEngine, this);

    // console.log('[SaveCoordinator] Initialized with dependencies and autosave policy');
    this.notifyStatus('info', 'Save coordinator ready with Git autosave policy');
  }

  handleWorkerMessage(e) {
    const { type, hash, jsonString, redstringData, success, error } = e.data;

    // Worker responded — cancel the stall watchdog.
    if (this.workerWatchdogTimer) {
      clearTimeout(this.workerWatchdogTimer);
      this.workerWatchdogTimer = null;
    }

    this.workerProcessing = false;

    if (type === 'save_processed' && success) {
      // Worker finished processing

      // Check if hash changed
      if (hash !== this.lastSaveHash && hash !== this.pendingHash) {
        this.pendingHash = hash;
        this.pendingString = jsonString; // Store the pre-serialized string
        this.pendingRedstringData = redstringData; // Store the pre-computed object

        // console.log('[SaveCoordinator] Change detected by worker, hash:', hash.substring(0, 8));
        this.isDirty = true;
        this.notifyStatus('info', 'Changes detected');

        // Notify Git autosave policy
        gitAutosavePolicy.onEditActivity();

        // Schedule the actual write
        this.scheduleSave();
      }
    } else if (type === 'error') {
      console.error('[SaveCoordinator] Worker error:', error);
      this.notifyStatus('error', `Worker save failed: ${error}`);
    }

    // Process any queued updates
    if (this.workerDirty) {
      this.workerDirty = false;
      this.sendToWorker();
    }
  }

  sendToWorker() {
    if (!this.nextStateToProcess) return;

    // No worker available (init failed, was terminated after onerror, or the
    // browser doesn't support module workers — iOS Safari < 15). Do the same
    // hash-and-schedule work on the main thread so autosave still functions.
    // Without this fallback, sendToWorker silently no-ops on every edit and
    // the autosave loop never dispatches — the symptom the user hits on
    // mobile where manual save works but autosave doesn't.
    if (!this.saveWorker) {
      this._processSaveOnMainThread(this.nextStateToProcess);
      return;
    }

    this.workerProcessing = true;

    // Extract only data properties for the worker to avoid DataCloneError
    // The store state often contains functions (actions) mixed in
    const {
      graphs,
      nodePrototypes,
      edges,
      openGraphIds,
      activeGraphId,
      activeDefinitionNodeId,
      expandedGraphIds,
      rightPanelTabs,
      savedNodeIds,
      savedGraphIds,
      showConnectionNames
    } = this.nextStateToProcess;

    // Strip imageSrc/thumbnailSrc from auto-enriched nodePrototypes before postMessage —
    // structured clone copies all data to the worker heap, and base64 data URLs
    // (100KB-5MB each) cause OOM in both the main thread and worker.
    // User-uploaded images (no autoEnriched flag) are preserved for save.
    let cleanPrototypes = nodePrototypes;
    if (nodePrototypes && typeof nodePrototypes.entries === 'function') {
      cleanPrototypes = new Map();
      for (const [id, proto] of nodePrototypes) {
        if (proto.semanticMetadata?.autoEnriched) {
          const { imageSrc, thumbnailSrc, ...rest } = proto;
          cleanPrototypes.set(id, rest);
        } else {
          cleanPrototypes.set(id, proto);
        }
      }
    }

    const cleanState = {
      graphs,
      nodePrototypes: cleanPrototypes,
      edges,
      openGraphIds,
      activeGraphId,
      activeDefinitionNodeId,
      expandedGraphIds,
      rightPanelTabs,
      savedNodeIds,
      savedGraphIds,
      showConnectionNames
    };

    // Capture state and start the watchdog BEFORE postMessage. If postMessage
    // throws (DataCloneError from unserializable state, worker channel closed,
    // OOM), we want lastState to be set and the watchdog armed so recovery
    // still happens. Previously the throw skipped both, latching
    // workerProcessing=true forever with no watchdog to clear it — exactly
    // the state the user hit on iOS (workerProcessing:true, hasLastState:false,
    // workerWatchdogPending:false).
    const stateToSend = this.nextStateToProcess;
    this.lastState = stateToSend;
    this.nextStateToProcess = null;

    if (this.workerWatchdogTimer) clearTimeout(this.workerWatchdogTimer);
    const WORKER_STALL_MS = 3000;
    this.workerWatchdogTimer = setTimeout(() => {
      this.workerWatchdogTimer = null;
      this._handleWorkerStall('timeout');
    }, WORKER_STALL_MS);

    try {
      this.saveWorker.postMessage({
        type: 'process_save',
        state: cleanState,
        userDomain: null
      });
    } catch (postErr) {
      // structured clone failed (DataCloneError) or worker channel is dead.
      // Drop the worker so future sends use the main-thread path directly,
      // and immediately dispatch a main-thread save with the captured state
      // — don't wait for the 3s watchdog when we already know it failed.
      console.warn('[SaveCoordinator] postMessage to save worker threw — switching to main-thread save:', postErr);
      try { this.saveWorker?.terminate?.(); } catch { /* noop */ }
      this.saveWorker = null;
      if (this.workerWatchdogTimer) {
        clearTimeout(this.workerWatchdogTimer);
        this.workerWatchdogTimer = null;
      }
      this.workerProcessing = false;
      // Re-queue the state so _processSaveOnMainThread picks it up. lastState
      // is already set above; restore nextStateToProcess so the main-thread
      // helper has something to process.
      this._processSaveOnMainThread(stateToSend);
    }
  }

  // Recover from a stalled or crashed worker. Reuses the main-thread save
  // path so a dead/slow worker never blocks autosave on mobile.
  _handleWorkerStall(reason) {
    if (this.workerWatchdogTimer) {
      clearTimeout(this.workerWatchdogTimer);
      this.workerWatchdogTimer = null;
    }
    const wasProcessing = this.workerProcessing;
    this.workerProcessing = false;
    this.workerDirty = false;
    if (!wasProcessing) return;
    console.warn(`[SaveCoordinator] Worker stall recovery (${reason}) — dispatching main-thread save.`);
    // Prefer the latest nextStateToProcess (queued during the stall) over
    // the stale lastState that was sent to the dead worker.
    const state = this.nextStateToProcess || this.lastState;
    if (state) {
      this._processSaveOnMainThread(state);
    }
  }

  // Main-thread analogue of save.worker.js. Hashes the content state with the
  // same FNV-1a logic the worker uses, and — if it differs from lastSaveHash —
  // marks dirty and schedules a save. This is the fallback that runs whenever
  // the worker is unavailable (mobile Safari module-worker init failure,
  // worker termination after onerror, watchdog stall recovery). Without it,
  // autosave silently no-ops on every edit when the worker is gone.
  _processSaveOnMainThread(state) {
    if (!state) return;
    this.lastState = state;
    this.nextStateToProcess = null;
    try {
      const hash = this.generateStateHash(state);
      if (hash !== this.lastSaveHash && hash !== this.pendingHash) {
        this.pendingHash = hash;
        // No pre-serialized string from the main-thread path — fileStorage
        // serializes when it writes, and gitSyncEngine.updateState handles
        // its own serialization downstream. Both tolerate a null pendingString.
        this.pendingString = null;
        this.pendingRedstringData = null;
        this.isDirty = true;
        try { gitAutosavePolicy.onEditActivity(); } catch { /* noop */ }
        this.scheduleSave();
      }
    } catch (err) {
      console.warn('[SaveCoordinator] Main-thread save processing failed, scheduling anyway:', err);
      // Hash failed but state exists — schedule a save anyway so edits aren't
      // stranded. The save dispatch tolerates a missing hash.
      this.isDirty = true;
      this.scheduleSave();
    }
  }

  // Main entry point for state changes
  onStateChange(newState, changeContext = {}) {
    if (!this.isEnabled || !newState) {
      if (!this.isEnabled) {
        // console.log('[SaveCoordinator] State change ignored - not enabled');
      }
      return;
    }

    // SoT swap in progress — capture the latest state but don't schedule a
    // dispatch. endSwap() will flush whatever's queued through scheduleSave.
    if (this.swapInProgress) {
      this.nextStateToProcess = newState;
      this.lastChangeContext = changeContext;
      return;
    }

    try {
      // Skip processing for viewport-only changes (pan/zoom) - these don't affect the save hash
      // This prevents unnecessary worker processing during keyboard/wheel panning and zooming
      if (changeContext.type === 'viewport' && !changeContext.forceProcess) {
        // Just update the latest state reference for when content changes happen
        this.nextStateToProcess = newState;
        return;
      }

      // Skip save processing for load operations - loading a file should not trigger a save.
      // We still update the state reference and clear any pending save so the loaded state
      // becomes the new baseline (the next real edit will compute a fresh hash against it).
      if (changeContext.type === 'load') {
        this.nextStateToProcess = newState;
        this.lastSaveHash = null;
        this.pendingHash = null;
        this.pendingString = null;
        this.pendingRedstringData = null;
        this.isDirty = false;
        if (this.saveTimer) {
          clearTimeout(this.saveTimer);
          this.saveTimer = null;
        }
        if (this.workerTimer) {
          clearTimeout(this.workerTimer);
          this.workerTimer = null;
        }
        // Now we have a real loaded baseline — saves are safe from this point.
        this.hasLoadedFromFile = true;
        // Capture the data baseline we just loaded so we can detect a
        // catastrophic shrinkage on subsequent saves.
        try {
          const counts = this._countDataItems(newState);
          this.dataBaseline = counts;
        } catch (_) { /* non-fatal */ }
        return;
      }

      // Data-loss guard. The narrow case this exists to catch is:
      // a universe has a real file on disk with data, the load failed/timed
      // out silently, the store still holds default-empty state, and an
      // incidental change triggers a save that would overwrite the file
      // with empty.
      //
      // The previous version of this guard was a binary check on
      // `hasLoadedFromFile`, which over-fires: many code paths set
      // `hasUniverseFile=true` without announcing a `type:'load'` context
      // (workspace setup creating a new universe, load-timeout fast path
      // releasing the UI spinner, file-handle restore paths, etc.). In
      // those cases the guard would block every subsequent save *forever*
      // and the user's work would silently never persist.
      //
      // Smarter rule: only block if the upcoming save would actually be
      // empty. If the state has real user-added content, the user clearly
      // did work that needs to persist — refusing to save is the bigger
      // data-loss risk than potentially overwriting an unloaded file (which
      // is also recoverable via reload, while in-flight edits are not).
      // The shrinkage guard at save time (processStateChange) still
      // independently catches the "had real data, surprise-collapsed to
      // empty" case (HMR resets, accidental store wipes) using
      // `dataBaseline`, so this guard doesn't need to cover that.
      if (!this.hasLoadedFromFile && newState?.hasUniverseFile === true) {
        let stateHasRealData = false;
        try {
          const counts = this._countDataItems(newState);
          // > 0 user prototypes, OR more than the implicit default graph
          stateHasRealData = counts.nodes > 0 || counts.graphs > 1;
        } catch { /* if counting fails, fall through to the conservative block */ }

        if (!stateHasRealData) {
          this.nextStateToProcess = newState;
          this.lastChangeContext = changeContext;
          if (!this._loggedLoadGuard) {
            console.warn('[SaveCoordinator] Save blocked: state is empty and no load has been observed for a universe claiming hasUniverseFile=true.');
            this._loggedLoadGuard = true;
          }
          return;
        }

        // Real data present — allow the save. Treat this as the load
        // baseline going forward so the shrinkage guard has a meaningful
        // floor and we stop logging "no load observed" on every keystroke.
        this.hasLoadedFromFile = true;
        try {
          const counts = this._countDataItems(newState);
          this.dataBaseline = counts;
        } catch { /* non-fatal */ }
        if (this._loggedLoadGuard) this._loggedLoadGuard = false;
        console.log('[SaveCoordinator] Adopting current non-empty state as load baseline (no explicit load context fired).');
      }

      // Update global interaction state based on context
      // Track drag, pan, pinch, and animation states
      const isInteracting = changeContext.isDragging === true ||
                           changeContext.isPanning === true ||
                           changeContext.isPinching === true ||
                           changeContext.isAnimating === true;

      // Self-heal stuck isGlobalDragging. iOS Safari/Chrome can drop touchend
      // events when the OS hijacks a gesture (system swipe, scroll-into-pull,
      // notification banner, app-switch) — the start phase reached us but the
      // end phase never did, latching this flag true. Once latched, the early
      // return at line 440 below blocks ALL autosave forever, exactly the
      // symptom the user hits where manual save works but autosave doesn't.
      // If the last interactive update was more than INTERACTION_MAX_AGE_MS
      // ago, the gesture is dead — clear the flag.
      const now = Date.now();
      const INTERACTION_MAX_AGE_MS = 2500;
      if (this.isGlobalDragging && !isInteracting && this._lastInteractionTouchTime
          && (now - this._lastInteractionTouchTime) > INTERACTION_MAX_AGE_MS) {
        console.warn(`[SaveCoordinator] Force-clearing stale isGlobalDragging (no interactive update in ${now - this._lastInteractionTouchTime}ms — probably a dropped touchend)`);
        this.isGlobalDragging = false;
        this._lastInteractionEndTime = now;
      }

      if (isInteracting) {
        this._lastInteractionTouchTime = now;
        this.isGlobalDragging = true;
      } else if (changeContext.phase === 'end' || changeContext.phase === 'complete') {
        if (this.isGlobalDragging) {
          this._lastInteractionEndTime = now;
        }
        this.isGlobalDragging = false;
      }

      // Skip updates during any interaction (drag, pan, pinch, zoom animation)
      if (this.isGlobalDragging && changeContext.phase !== 'end' && changeContext.phase !== 'complete') {
        this.isDirty = true;
        this.nextStateToProcess = newState; // Keep updating the latest state
        this.lastChangeContext = changeContext;
        
        const now = Date.now();
        if (!this._lastDragLogTime || (now - this._lastDragLogTime) > 1000) {
          const interactionType = changeContext.isDragging ? 'drag' : 
                                 changeContext.isPanning ? 'pan' :
                                 changeContext.isPinching ? 'pinch' : 'interaction';
          // console.log(`[SaveCoordinator] ${interactionType.charAt(0).toUpperCase() + interactionType.slice(1)} in progress - deferring processing`);
          this._lastInteractionEndTime = Date.now(); // Update end time to prevent immediate save after stutter
        }
        return;
      }

      // Update latest state
      this.nextStateToProcess = newState;
      this.lastChangeContext = changeContext;

      // If interaction just ended, force immediate processing logic  
      if ((changeContext.phase === 'end' || changeContext.phase === 'complete') && !isInteracting) {
        // console.log('[SaveCoordinator] Interaction ended, triggering processing');
        // Clear worker timer to force fresh processing after interaction
        if (this.workerTimer) {
          clearTimeout(this.workerTimer);
          this.workerTimer = null;
        }
      }

      // Debounce sending to worker to avoid flooding it
      // But ONLY if we're not in an interaction - worker serialization is expensive
      if (this.workerProcessing) {
        this.workerDirty = true;
      } else {
        // Clear existing debounce timer
        if (this.workerTimer) clearTimeout(this.workerTimer);
        
        this.workerTimer = setTimeout(() => {
          this.sendToWorker();
        }, 300); // 300ms debounce for worker calls
      }

    } catch (error) {
      console.error('[SaveCoordinator] Error processing state change:', error);
      this.notifyStatus('error', `Save coordination failed: ${error.message}`);
    }
  }

  // Schedule a debounced save (cancels previous timer)
  scheduleSave() {
    // Clear existing timer
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    
    // console.log(`[SaveCoordinator] Scheduling write in ${DEBOUNCE_MS}ms`);
    
    // Schedule new save
    this.saveTimer = setTimeout(() => {
      this.executeSave();
    }, DEBOUNCE_MS);
  }

  // Execute save (both local and git) - NON-BLOCKING
  executeSave() {
    // Defense-in-depth: if a SoT swap is in flight, don't dispatch. The fire-
    // and-forget dual write would otherwise commit potentially-empty state to
    // both local and Git mid-handoff.
    if (this.swapInProgress) {
      console.log('[SaveCoordinator] executeSave deferred: swap in progress');
      return;
    }
    if (this.isSaving) {
      // A previous save is still in flight. Reschedule rather than silently
      // drop this attempt — otherwise if the prior save is stuck (mobile
      // rIC stall, slow git push, watchdog window), the change marked
      // dirty by the worker never gets dispatched, and the "Saving..."
      // indicator stays stuck even after the engine reports clean
      // (because isDirty / pendingHash were set but never cleared by an
      // executed save).
      this.scheduleSave();
      return;
    }

    // CRITICAL: Don't execute save during ANY user interaction (drag, pan, pinch, zoom animation)
    // This prevents choppy performance and ensures we only save when the user is done interacting
    if (this.isGlobalDragging) {
      // console.log('[SaveCoordinator] executeSave blocked - user interaction still in progress, rescheduling');
      this.scheduleSave(); // Reschedule for after interaction ends
      return;
    }
    
    // CRITICAL: Add cooldown after interaction ends to let UI settle
    // This prevents choppy lift/release by deferring heavy file I/O
    const timeSinceInteractionEnd = Date.now() - this._lastInteractionEndTime;
    const COOLDOWN_MS = 300; // Wait 300ms after interaction ends before saving
    if (this._lastInteractionEndTime > 0 && timeSinceInteractionEnd < COOLDOWN_MS) {
      const remainingCooldown = COOLDOWN_MS - timeSinceInteractionEnd;
      // console.log(`[SaveCoordinator] executeSave deferred ${remainingCooldown}ms for post-interaction cooldown`);
      setTimeout(() => this.executeSave(), remainingCooldown);
      return;
    }
    
    // We need either a pending string (from worker) or a lastState (fallback)
    if (!this.pendingString && !this.lastState) return;

    // Capture values before async operations
    const state = this.lastState;
    const pendingString = this.pendingString;
    const pendingRedstringData = this.pendingRedstringData;
    const pendingHash = this.pendingHash;

    // Catastrophic-shrinkage guard. Refuse to save if the new state has
    // collapsed to near-empty while the baseline had real data. This catches
    // HMR re-instantiating an empty store, accidental reset paths, and other
    // surprise-empty states. forceSave() (user-triggered) bypasses this.
    try {
      const current = this._countDataItems(state);
      const baseline = this.dataBaseline || { nodes: 0, graphs: 0 };
      const baselineNodes = baseline.nodes || 0;
      const baselineGraphs = baseline.graphs || 0;
      const collapsed = (
        (baselineNodes >= 5 && current.nodes <= Math.max(2, Math.floor(baselineNodes * 0.1))) ||
        (baselineGraphs >= 1 && current.graphs === 0)
      );
      if (collapsed) {
        console.warn('[SaveCoordinator] Refusing to save: data appears catastrophically reduced', {
          baseline,
          current,
          message: 'If this was intentional, use forceSave() (e.g. via "Save Now" in the UI).'
        });
        this.notifyStatus('warning', 'Save blocked: data shrank unexpectedly. Reload to recover, or use Save Now to confirm.');
        // Don't clear pending — leave state as-is so a future legitimate save can fire.
        this.isSaving = false;
        return;
      }
    } catch (e) {
      console.warn('[SaveCoordinator] Shrinkage check failed (continuing with save):', e);
    }

    // Mark as saving immediately
    this.isSaving = true;

    // Watchdog: force-reset isSaving if the dispatch never completes within
    // the budget. On mobile (iOS Safari especially) requestIdleCallback +
    // microtask chains can stall indefinitely if the tab is backgrounded or
    // memory-pressured, which leaves the SaveStatus stuck on "Saving..."
    // even though manual save works fine. The save operations themselves
    // are fire-and-forget (fileStorage.saveToFile is .catch()-handled,
    // gitSyncEngine.updateState just queues), so a stuck dispatch only
    // hurts the UI, not the actual persistence. 5s is generous; the
    // synchronous dispatch below normally completes in <10ms.
    const watchdogId = setTimeout(() => {
      if (this.isSaving) {
        console.warn('[SaveCoordinator] Watchdog clearing stuck isSaving flag — dispatch did not complete in 5s');
        this.isSaving = false;
        // If the dispatch never ran, the dirty flag is still set and pending
        // data is still queued. Reschedule so we don't strand the change.
        if (this.isDirty || this.pendingHash !== null) {
          this.scheduleSave();
        }
      }
    }, 5000);

    // Drop requestIdleCallback entirely. It was used as a "be nice to the
    // main thread" optimization, but its reliability on mobile is poor
    // (iOS Safari often defers it indefinitely even with timeout), and the
    // work we do here is already non-blocking — fileStorage.saveToFile
    // is .catch()-handled (not awaited), gitSyncEngine.updateState just
    // pushes to a queue. Plain setTimeout(0) gives us identical UI
    // responsiveness with predictable cross-browser firing.
    setTimeout(() => {
      try {
        // Save to local file if available - fire and forget with error handling
        if (this.fileStorage && typeof this.fileStorage.saveToFile === 'function') {
          this.fileStorage.saveToFile(state, false, {
            preSerialized: !!pendingString,
            serializedData: pendingString,
            redstringData: pendingRedstringData
          }).catch(error => {
            console.error('[SaveCoordinator] Local file save failed:', error);
          });
        }

        // Save to Git if available - already non-blocking (just queues)
        if (this.gitSyncEngine && this.gitSyncEngine.isHealthy()) {
          this.gitSyncEngine.updateState(state);
        }

        // Update save hash after initiating save. If pendingHash is missing
        // (worker stalled and we fell back to main-thread dispatch), compute
        // it now via the same FNV-1a logic the worker uses — otherwise the
        // next worker callback would see hash !== lastSaveHash and re-mark
        // dirty, restarting the autosave loop and stranding the indicator
        // on "Saving..." even after the data has been persisted.
        if (pendingHash) {
          this.lastSaveHash = pendingHash;
          this.pendingHash = null;
        } else if (state) {
          try {
            this.lastSaveHash = this.generateStateHash(state);
          } catch (hashErr) {
            console.warn('[SaveCoordinator] Main-thread hash after fallback save failed:', hashErr);
          }
        }

        // Update the data baseline now that this state has been written to
        // disk — used by the shrinkage guard on future saves.
        try {
          const counts = this._countDataItems(state);
          // Only ratchet up the baseline; never reduce it via successful
          // saves of smaller datasets, because we'd otherwise lose the
          // protection threshold over time.
          this.dataBaseline = {
            nodes: Math.max(this.dataBaseline?.nodes || 0, counts.nodes),
            graphs: Math.max(this.dataBaseline?.graphs || 0, counts.graphs)
          };

          // Persist the baseline so the shrinkage guard survives page refresh.
          // Use the slug embedded in state (graphStore stamps `_universeSlug`)
          // and fall back to whatever was active when we initialized.
          const slugForGuard = state?._universeSlug || this.activeUniverseSlugForGuard;
          if (slugForGuard) {
            this.activeUniverseSlugForGuard = slugForGuard;
            this._persistGuardState(slugForGuard);
          }
        } catch (_) { /* non-fatal */ }

        // Clear dirty flag and pending data
        this.isDirty = false;
        this.pendingString = null;
        this.pendingRedstringData = null;
        this.notifyStatus('success', 'Save completed');
      } catch (error) {
        console.error('[SaveCoordinator] Save failed:', error);
        this.notifyStatus('error', `Save failed: ${error.message}`);
      } finally {
        // The dispatch completed. The actual saves continue in the
        // background — that's fine, the engine tracks its own state.
        this.isSaving = false;
        clearTimeout(watchdogId);
      }
    }, 0);
  }

  // Force immediate save (for manual save button) - still awaitable for user feedback
  async forceSave(state) {
    if (!this.isEnabled) {
      throw new Error('Save coordinator not initialized');
    }

    try {
      // console.log('[SaveCoordinator] Force save requested');
      this.notifyStatus('info', 'Force saving...');
      
      if (this.saveTimer) clearTimeout(this.saveTimer);
      if (this.workerTimer) clearTimeout(this.workerTimer);
      
      this.lastState = state;
      this.isSaving = true;
      
      // For force save, we do await to give user feedback that it completed
      // But we still use non-blocking patterns where possible
      if (this.fileStorage && typeof this.fileStorage.saveToFile === 'function') {
        try {
          await this.fileStorage.saveToFile(state, false, { 
            preSerialized: false // Force re-serialize for explicit save
          });
        } catch (error) {
          console.error('[SaveCoordinator] Force save local file failed:', error);
        }
      }

      // Queue Git save (non-blocking)
      if (this.gitSyncEngine && this.gitSyncEngine.isHealthy()) {
        this.gitSyncEngine.updateState(state);
      }
      
      this.isDirty = false;
      this.pendingString = null;
      this.pendingRedstringData = null;
      this.pendingHash = null;
      this.isSaving = false;

      // Update lastSaveHash so a worker callback that arrives after this
      // force-save (worker was mid-process when the user clicked Save Now)
      // doesn't see hash !== lastSaveHash and instantly re-mark dirty —
      // which is what was stranding the indicator on "Saving..." right
      // after the user did a successful manual save on mobile.
      try {
        this.lastSaveHash = this.generateStateHash(state);
      } catch (hashErr) {
        console.warn('[SaveCoordinator] Hash after forceSave failed:', hashErr);
      }

      // Force save is user-triggered intent — accept the new shape as the
      // baseline (whether it grew, shrank, or cleared). Otherwise the next
      // automatic save would be blocked by the shrinkage guard against the
      // old high-water mark.
      try {
        this.dataBaseline = this._countDataItems(state);
        this.hasLoadedFromFile = true;
      } catch (_) { /* non-fatal */ }

      this.notifyStatus('success', 'Force save completed');
      return true;

    } catch (error) {
      console.error('[SaveCoordinator] Force save failed:', error);
      this.isSaving = false;
      this.notifyStatus('error', `Force save failed: ${error.message}`);
      throw error;
    }
  }

  // Generate hash - now mostly for fallback or worker internal use
  // Kept here for compatibility if needed, but primary logic moved to worker
  generateStateHash(state) {
      // ... (implementation matches worker) ...
      // Legacy implementation kept for robustness if worker fails
    try {
      const contentState = {
        graphs: state.graphs ? Array.from(state.graphs.entries()).map(([id, graph]) => {
          const { panOffset, zoomLevel, instances, ...rest } = graph || {};
          const instancesArray = instances ? Array.from(instances.entries()) : [];
          return [id, { ...rest, instances: instancesArray }];
        }) : [],
        // Strip imageSrc/thumbnailSrc from hash — base64 data URLs are huge and
        // cause V8 OOM when JSON.stringify'd. Images are either in the separate
        // imageCache store (auto-enriched) or reconstructible from URLs in semanticMetadata.
        nodePrototypes: state.nodePrototypes ? Array.from(state.nodePrototypes.entries()).map(
          ([id, proto]) => {
            const { imageSrc, thumbnailSrc, ...rest } = proto;
            return [id, rest];
          }
        ) : [],
        edges: state.edges ? Array.from(state.edges.entries()) : []
      };

      const stateString = JSON.stringify(contentState);
      let hash = 2166136261;
      for (let i = 0; i < stateString.length; i++) {
        hash ^= stateString.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return (hash >>> 0).toString();
    } catch (error) {
      console.warn('[SaveCoordinator] Hash generation failed:', error);
      return Date.now().toString();
    }
  }

  // Get current state for autosave policy
  getState() {
    // Return the last state
    if (this.lastState) {
      return this.lastState;
    }

    // Fallback to Git sync engine's local state
    if (this.gitSyncEngine && this.gitSyncEngine.localState) {
      return this.gitSyncEngine.localState.get('current');
    }

    return null;
  }

  // Get pre-serialized string for Git autosave policy (avoids redundant JSON.stringify)
  getPendingString() {
    return this.pendingString;
  }

  // Get current status
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      isSaving: this.isSaving,
      hasPendingSave: this.saveTimer !== null || this.pendingHash !== null,
      lastError: this.lastError,
      gitAutosavePolicy: gitAutosavePolicy.getStatus()
    };
  }

  // Diagnostic snapshot for the debug overlay. Surfaces exactly the state
  // that gates autosave — used on mobile where we can't open devtools and
  // need to see which flag is latched true.
  getDiagnostics() {
    const now = Date.now();
    return {
      isEnabled: this.isEnabled,
      isSaving: this.isSaving,
      isDirty: this.isDirty,
      hasUnsavedChanges: this.hasUnsavedChanges(),
      pendingHashSet: this.pendingHash !== null,
      pendingStringSet: this.pendingString !== null,
      lastSaveHashSet: this.lastSaveHash !== null,
      hasLastState: !!this.lastState,
      hasNextStateToProcess: !!this.nextStateToProcess,
      // Worker
      hasSaveWorker: !!this.saveWorker,
      workerProcessing: this.workerProcessing,
      workerDirty: this.workerDirty,
      workerWatchdogPending: this.workerWatchdogTimer !== null,
      // Timers
      saveTimerPending: this.saveTimer !== null,
      workerTimerPending: this.workerTimer !== null,
      // Interaction gating (the most likely autosave killer on mobile)
      isGlobalDragging: this.isGlobalDragging,
      msSinceInteractionStart: this._lastInteractionTouchTime
        ? now - this._lastInteractionTouchTime
        : null,
      msSinceInteractionEnd: this._lastInteractionEndTime
        ? now - this._lastInteractionEndTime
        : null,
      // Data-loss guard
      hasLoadedFromFile: this.hasLoadedFromFile,
      // Storage targets actually connected
      hasFileStorage: !!this.fileStorage,
      hasGitSyncEngine: !!this.gitSyncEngine,
      gitEngineHealthy: this.gitSyncEngine
        ? (typeof this.gitSyncEngine.isHealthy === 'function' ? this.gitSyncEngine.isHealthy() : null)
        : null,
    };
  }

  // Enable/disable the coordinator
  setEnabled(enabled) {
    if (enabled && !this.isEnabled) {
      this.isEnabled = true;
      console.log('[SaveCoordinator] Enabled');
      this.notifyStatus('info', 'Save coordination enabled');
    } else if (!enabled && this.isEnabled) {
      this.isEnabled = false;
      
      // Clear pending timer
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      
      console.log('[SaveCoordinator] Disabled');
      this.notifyStatus('info', 'Save coordination disabled');
    }
  }

  // Count "real" data items (excluding the always-present base prototypes
  // like base-thing-prototype / base-connection-prototype) so the shrinkage
  // guard doesn't mis-trigger on a brand-new universe.
  _countDataItems(state) {
    if (!state) return { nodes: 0, graphs: 0 };
    let nodes = 0;
    if (state.nodePrototypes instanceof Map) {
      for (const id of state.nodePrototypes.keys()) {
        if (id !== 'base-thing-prototype' && id !== 'base-connection-prototype') nodes++;
      }
    } else if (state.nodePrototypes && typeof state.nodePrototypes === 'object') {
      for (const id of Object.keys(state.nodePrototypes)) {
        if (id !== 'base-thing-prototype' && id !== 'base-connection-prototype') nodes++;
      }
    }
    let graphs = 0;
    if (state.graphs instanceof Map) {
      graphs = state.graphs.size;
    } else if (state.graphs && typeof state.graphs === 'object') {
      graphs = Object.keys(state.graphs).length;
    }
    return { nodes, graphs };
  }

  // Cancel all pending saves and clear stale state.
  // Used during universe switching/deletion to prevent cross-contamination.
  cancelPendingSaves() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.workerTimer) { clearTimeout(this.workerTimer); this.workerTimer = null; }
    if (this.workerWatchdogTimer) { clearTimeout(this.workerWatchdogTimer); this.workerWatchdogTimer = null; }
    this.workerProcessing = false;
    this.workerDirty = false;
    this.pendingHash = null;
    this.pendingString = null;
    this.pendingRedstringData = null;
    this.lastState = null;
    this.isDirty = false;
    // Reset the data-loss guard. The new universe's load needs to happen
    // before saves are allowed again.
    this.hasLoadedFromFile = false;
    this._loggedLoadGuard = false;
    this.dataBaseline = { nodes: 0, graphs: 0 };
  }

  // Check if there are unsaved changes (for immediate UI feedback)
  hasUnsavedChanges() {
    return this.isDirty || (this.pendingHash !== null);
  }

  setGitSyncEngine(gitSyncEngine) {
    this.gitSyncEngine = gitSyncEngine;
    if (gitAutosavePolicy) {
      gitAutosavePolicy.gitSyncEngine = gitSyncEngine;
    }
  }

  // Cleanup
  destroy() {
    this.setEnabled(false);
    this.statusHandlers.clear();
    console.log('[SaveCoordinator] Destroyed');
  }
}

// Export singleton instance
export const saveCoordinator = new SaveCoordinator();
export default saveCoordinator;

// ===========================================================================
// HMR state preservation
// ---------------------------------------------------------------------------
// On hot reload this module re-instantiates a fresh SaveCoordinator with
// `hasLoadedFromFile: false` and zeroed `dataBaseline`. Without preservation,
// the data-loss guard would correctly block saves but the baseline would be
// lost, and any save status state (isEnabled, etc.) would also reset. We
// transfer the critical guard fields across HMR boundaries.
// ===========================================================================
if (typeof import.meta !== 'undefined' && import.meta.hot) {
  try {
    const cached = import.meta.hot.data?.saveCoordinatorGuard;
    if (cached) {
      saveCoordinator.hasLoadedFromFile = !!cached.hasLoadedFromFile;
      saveCoordinator.dataBaseline = cached.dataBaseline || { nodes: 0, graphs: 0 };
      saveCoordinator.lastSaveHash = cached.lastSaveHash || null;
      console.log('[SaveCoordinator HMR] Restored guard state across hot reload', {
        hasLoadedFromFile: saveCoordinator.hasLoadedFromFile,
        dataBaseline: saveCoordinator.dataBaseline
      });
    }
    import.meta.hot.dispose((data) => {
      try {
        data.saveCoordinatorGuard = {
          hasLoadedFromFile: saveCoordinator.hasLoadedFromFile,
          dataBaseline: saveCoordinator.dataBaseline,
          lastSaveHash: saveCoordinator.lastSaveHash
        };
      } catch (e) {
        console.warn('[SaveCoordinator HMR] Failed to capture guard state:', e);
      }
    });
  } catch (e) {
    console.warn('[SaveCoordinator HMR] HMR setup failed:', e);
  }
}
