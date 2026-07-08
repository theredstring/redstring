/**
 * @module SaveCoordinator
 * @description Centralized save management for Redstring. Coordinates local file writes
 * and Git commits from a single debounced pipeline.
 *
 * State changes flow through a Web Worker (save.worker.js) that hashes the content
 * state off the main thread. When the hash differs from `lastSaveHash`, a debounced
 * write is scheduled. A main-thread fallback activates when the worker is unavailable
 * (mobile Safari, OOM, stall).
 *
 * Key invariants:
 * - Saves are blocked until a `type:'load'` change context fires (`hasLoadedFromFile`).
 * - Catastrophic shrinkage (>90% drop from baseline) is refused; use `forceSave` to override.
 * - All interaction gates (drag, pan, pinch) defer serialization until `signalInteractionEnd`.
 */

import { exportToRedstring, PERSISTED_STORE_KEYS } from '../formats/redstringFormat.js';
import { gitAutosavePolicy } from './GitAutosavePolicy.js';
import { generateStateHash as computeStateHash } from './saveHash.js';

// SIMPLIFIED: No priorities - all changes batched together with a single debounce
const DEBOUNCE_MS = 3000; // Wait 3000ms after last change before saving (merges node drop + view restore)

/**
 * Coordinates save operations for a Redstring universe.
 *
 * Instantiated as a singleton (`saveCoordinator`) and wired to the Zustand store
 * via `graphStore.jsx`. Consumers call `initialize()` once with storage backends,
 * then `onStateChange()` on every store update.
 *
 * @class
 */
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

    // Write-failure retry tracking. A save only counts as complete when the
    // storage backend confirms it — failed/blocked writes keep the dirty
    // state and retry with exponential backoff instead of silently marking
    // the session clean (which would strand the user's work forever, since
    // an identical re-hash would be skipped).
    this.retryAttempt = 0;
    this._lastGitUnhealthyWarnTime = 0;
    
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

  /**
   * Returns the localStorage key for the persisted guard state of a universe.
   *
   * @private
   * @param {string} slug - Universe slug identifier.
   * @returns {string} localStorage key.
   */
  _getGuardStorageKey(slug) {
    return `redstring-savecoord-guard:${slug}`;
  }

  /**
   * Persists the data-loss guard state to localStorage so the shrinkage floor
   * survives page refresh before the next `type:'load'` context fires.
   *
   * Failures (quota exceeded, private-mode restrictions) are silently ignored;
   * the guard still operates in-memory.
   *
   * @private
   * @param {string} slug - Universe slug used as the storage key suffix.
   */
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

  /**
   * Restores guard state from localStorage for the given universe slug.
   *
   * Only ratchets `dataBaseline` upward — never reduces it — so a stale
   * persisted value can't lower the protection threshold.
   *
   * @private
   * @param {string} slug - Universe slug to look up.
   * @returns {boolean} True if state was successfully restored.
   */
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

  /**
   * Removes the persisted guard state for a universe from localStorage.
   *
   * Called when a universe is deleted or reset so the old baseline doesn't
   * constrain the new universe's first save.
   *
   * @param {string} slug - Universe slug whose guard entry should be removed.
   */
  clearPersistedGuardState(slug) {
    if (!slug || typeof window === 'undefined' || !window.localStorage) return;
    try { window.localStorage.removeItem(this._getGuardStorageKey(slug)); } catch (_) { /* noop */ }
  }

  /**
   * Pauses autosave dispatch during a source-of-truth swap.
   *
   * While paused, `onStateChange` queues state but does not schedule a dispatch.
   * Callers MUST call `endSwap()` in a `finally` block — failing to do so strands
   * all subsequent saves forever.
   *
   * @param {string} [label='sot-swap'] - Diagnostic label logged with the pause event.
   */
  beginSwap(label = 'sot-swap') {
    this.swapInProgress = true;
    console.log(`[SaveCoordinator] Swap pause active: ${label}`);
  }

  /**
   * Resumes autosave dispatch after a source-of-truth swap.
   *
   * If state was queued while paused, immediately schedules a save so the
   * queued changes are not stranded.
   *
   * @param {string} [label='sot-swap'] - Diagnostic label logged with the resume event.
   */
  endSwap(label = 'sot-swap') {
    if (!this.swapInProgress) return;
    this.swapInProgress = false;
    console.log(`[SaveCoordinator] Swap pause released: ${label}`);
    if (this.nextStateToProcess || this.isDirty) {
      this.scheduleSave();
    }
  }

  // ─── STATUS NOTIFICATIONS ────────────────────────────────────────────────────

  /**
   * Registers a status change handler and returns an unsubscribe function.
   *
   * @param {function(Object): void} handler - Called with `{ type, message, timestamp, ...details }` on each status event.
   * @returns {function(): void} Call to unregister the handler.
   */
  onStatusChange(handler) {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /**
   * Broadcasts a status event to all registered handlers.
   *
   * @param {string} type - Severity level: `'info'`, `'success'`, `'warning'`, or `'error'`.
   * @param {string} message - Human-readable status message.
   * @param {Object} [details={}] - Additional fields merged into the status object.
   */
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

  /**
   * Releases the interaction gate and schedules a deferred worker dispatch.
   *
   * Called by `useNodeDrag` after the zoom-restore animation finishes, so the
   * expensive structured-clone postMessage doesn't run on the animation tail.
   * Safe to call when already idle (idempotent).
   *
   * @param {Object} [context={}] - Optional context for logging.
   */
  signalInteractionEnd(context = {}) {
    if (!this.isEnabled) return;
    const wasInteracting = this.isGlobalDragging;
    if (wasInteracting) {
      this._lastInteractionEndTime = Date.now();
    }
    this.isGlobalDragging = false;

    // The gate-held window swallowed every worker-debounce attempt during the
    // drag (processStateChange early-returned before scheduling one). Schedule
    // one now so the latest queued state actually gets serialized + saved.
    if (this.nextStateToProcess) {
      if (this.workerProcessing) {
        this.workerDirty = true;
      } else {
        if (this.workerTimer) clearTimeout(this.workerTimer);
        this.workerTimer = setTimeout(() => {
          this.sendToWorker();
        }, 300);
      }
    }
  }

  /**
   * Wires the coordinator to storage backends and starts the save worker.
   *
   * Must be called once before `onStateChange`. Restores persisted guard state
   * from localStorage so the shrinkage floor is non-zero before the first load.
   *
   * @param {Object} fileStorage - FileStorage instance with a `saveToFile` method.
   * @param {Object} gitSyncEngine - GitSyncEngine instance; may be `null` when Git is disabled.
   */
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

  /**
   * Processes a message from the save worker.
   *
   * On `save_processed` success: if the hash changed, marks dirty and schedules a
   * debounced write. Cancels the stall watchdog. If `workerDirty` is set (new state
   * arrived while the worker was busy), immediately re-dispatches.
   *
   * @param {MessageEvent} e - Worker message event with `{ type, hash, jsonString, redstringData, success, error }`.
   */
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
        // Record which state snapshot this serialization came from, so
        // executeSave never writes an older serialization on behalf of a
        // newer state (local file and Git would silently diverge).
        this.pendingStringState = this.lastState;

        // console.log('[SaveCoordinator] Change detected by worker, hash:', hash.substring(0, 8));
        this.isDirty = true;
        this.notifyStatus('info', 'Changes detected');

        // Notify Git autosave policy
        gitAutosavePolicy.onEditActivity();

        // Schedule the actual write
        this.scheduleSave();
      }
    } else if (type === 'error') {
      // The worker threw while serializing/hashing (e.g. a deterministic
      // exportToRedstring failure on some state shape). Without recovery the
      // change is stranded — no dirty flag, no retry. Fall back to the
      // main-thread path, which fails open (hash error → save fires anyway),
      // so the write is attempted and the real error surfaces at write time.
      console.error('[SaveCoordinator] Worker error — falling back to main-thread save:', error);
      this.notifyStatus('warning', 'Background save failed, retrying on main thread…');
      const state = this.lastState || this.nextStateToProcess;
      if (state) {
        this._processSaveOnMainThread(state);
      }
    }

    // Process any queued updates
    if (this.workerDirty) {
      this.workerDirty = false;
      this.sendToWorker();
    }
  }

  /**
   * Serializes and posts the current pending state to the save worker.
   *
   * Strips `imageSrc`/`thumbnailSrc` from auto-enriched prototypes before
   * `postMessage` to avoid OOM from large base64 data URLs. Falls back to
   * `_processSaveOnMainThread` when no worker is available (mobile Safari,
   * post-crash recovery). Arms a stall watchdog that fires after 3 seconds
   * if the worker never responds.
   */
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

    // Extract ONLY the persisted data properties for the worker. Two reasons:
    // (1) the store contains functions (actions) that would throw
    // DataCloneError on postMessage; (2) the set of forwarded keys must EXACTLY
    // match what the serializer persists — deriving it from PERSISTED_STORE_KEYS
    // guarantees a new persisted field can't be silently dropped here (the bug
    // that erased wizardPlansByConversation on every autosave). Carry
    // _universeSlug through so downstream identity guards work.
    const cleanState = { _universeSlug: this.nextStateToProcess._universeSlug };
    for (const key of PERSISTED_STORE_KEYS) {
      cleanState[key] = this.nextStateToProcess[key];
    }

    // Strip imageSrc/thumbnailSrc from auto-enriched nodePrototypes before postMessage —
    // structured clone copies all data to the worker heap, and base64 data URLs
    // (100KB-5MB each) cause OOM in both the main thread and worker.
    // User-uploaded images (no autoEnriched flag) are preserved for save.
    const nodePrototypes = cleanState.nodePrototypes;
    if (nodePrototypes && typeof nodePrototypes.entries === 'function') {
      const cleanPrototypes = new Map();
      for (const [id, proto] of nodePrototypes) {
        // Strip only genuinely re-fetchable Wikipedia images (auto-enriched
        // AND we have the thumbnail URL). A user-uploaded photo — even on a
        // node that was once auto-enriched — has no wikipediaThumbnail and
        // must be kept, or the save writes null over it.
        if (proto.semanticMetadata?.autoEnriched && proto.semanticMetadata?.wikipediaThumbnail) {
          const { imageSrc, thumbnailSrc, ...rest } = proto;
          cleanPrototypes.set(id, rest);
        } else {
          cleanPrototypes.set(id, proto);
        }
      }
      cleanState.nodePrototypes = cleanPrototypes;
    }

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

  /**
   * Recovers from a stalled or crashed save worker.
   *
   * Clears the watchdog, resets `workerProcessing`, and immediately dispatches
   * a main-thread save so autosave is never blocked by a dead worker. Prefers
   * the latest queued `nextStateToProcess` over the stale `lastState`.
   *
   * @private
   * @param {string} reason - Description of the stall cause for log output.
   */
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

  /**
   * Main-thread fallback for the save worker's hash-and-schedule pipeline.
   *
   * Uses the same FNV-1a hashing logic as `save.worker.js`. If the hash
   * differs from `lastSaveHash`, marks dirty and calls `scheduleSave`. Runs
   * whenever the worker is unavailable (mobile Safari module-worker failure,
   * post-crash recovery, watchdog stall).
   *
   * @private
   * @param {Object} state - Zustand store snapshot to process.
   */
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

  /**
   * Primary entry point for Zustand store state updates.
   *
   * Called on every store mutation. Applies several early-return guards in order:
   * 1. Not enabled → skip
   * 2. Swap in progress → queue only
   * 3. `type:'viewport'` → update state ref, skip serialization
   * 4. `type:'load'` → reset hashes, set `hasLoadedFromFile`, skip save
   * 5. Universe loading/error → block
   * 6. Empty state before first load → block (unless real data is present)
   *
   * For passing changes, debounces `sendToWorker` by 500ms; respects the global
   * interaction gate (`isGlobalDragging`).
   *
   * @param {Object} newState - Current Zustand store snapshot.
   * @param {Object} [changeContext={}] - Metadata about the change: `type`, `isDragging`, `isPanning`, `isPinching`, `isAnimating`, `phase`.
   */
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
        this.pendingStringState = null;
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
        if (this._loggedLoadErrorGuard) this._loggedLoadErrorGuard = false;
        // Capture the data baseline we just loaded so we can detect a
        // catastrophic shrinkage on subsequent saves.
        try {
          const counts = this._countDataItems(newState);
          this.dataBaseline = counts;
        } catch (_) { /* non-fatal */ }
        return;
      }

      // Block saves while the universe is still loading, or if it failed to load
      // (e.g. no permissions, Git auth failed). This prevents "Saving..." loops 
      // and accidental overwrites of existing files with empty/unauthorized state.
      if (newState?.isUniverseLoading === true || !!newState?.universeLoadingError) {
        this.nextStateToProcess = newState;
        this.lastChangeContext = changeContext;
        if (newState?.universeLoadingError && !this._loggedLoadErrorGuard) {
          console.warn('[SaveCoordinator] Save blocked: Universe failed to load (' + newState.universeLoadingError + ')');
          this._loggedLoadErrorGuard = true;
        }
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
        // Arm a timer-based failsafe: if no further interactive update and no
        // end/complete phase arrives within the window, clear the gate and
        // flush. The previous self-heal only ran inside a *future*
        // onStateChange — so if the drag's last mutation was also the
        // session's last mutation, the gate stayed latched and autosave never
        // fired again. A timer doesn't depend on future activity.
        if (this._dragGateFailsafe) clearTimeout(this._dragGateFailsafe);
        this._dragGateFailsafe = setTimeout(() => {
          this._dragGateFailsafe = null;
          if (this.isGlobalDragging) {
            console.warn('[SaveCoordinator] Drag gate failsafe: clearing isGlobalDragging and flushing (no end signal received)');
            this.isGlobalDragging = false;
            this._lastInteractionEndTime = Date.now();
            if (this.nextStateToProcess || this.isDirty) {
              this.signalInteractionEnd({ reason: 'drag-gate-failsafe' });
            }
          }
        }, 2500);
      } else if (changeContext.phase === 'end' || changeContext.phase === 'complete') {
        if (this.isGlobalDragging) {
          this._lastInteractionEndTime = now;
        }
        this.isGlobalDragging = false;
        if (this._dragGateFailsafe) { clearTimeout(this._dragGateFailsafe); this._dragGateFailsafe = null; }
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
        }, 500); // 500ms debounce — keeps structured-clone postMessage off the
                  // tail of the 250ms drag zoom-restore animation, and batches
                  // typing/keystroke flurries a little more aggressively.
      }

    } catch (error) {
      console.error('[SaveCoordinator] Error processing state change:', error);
      this.notifyStatus('error', `Save coordination failed: ${error.message}`);
    }
  }

  /**
   * Schedules a debounced write, resetting the timer on each call.
   *
   * Fires `executeSave` after `DEBOUNCE_MS` (3000ms) with no further calls.
   * Always cancels any previously pending timer before setting a new one.
   */
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

  /**
   * Dispatches a non-blocking fire-and-forget write to all active storage backends.
   *
   * Guards applied before dispatching: swap in progress, `isSaving` already set,
   * interaction gate active, post-interaction cooldown (300ms), catastrophic
   * shrinkage detected. Reschedules rather than dropping if a prior save is
   * still in flight. Updates `lastSaveHash` and ratchets `dataBaseline` after
   * dispatching.
   */
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
    let pendingString = this.pendingString;
    let pendingRedstringData = this.pendingRedstringData;
    const pendingHash = this.pendingHash;

    // Never write a serialization produced from an OLDER state on behalf of
    // a newer one — drop the stale pre-serialized payload and let the
    // storage layer re-serialize from `state` directly.
    if (pendingString && this.pendingStringState && this.pendingStringState !== state) {
      pendingString = null;
      pendingRedstringData = null;
    }

    // Catastrophic-shrinkage guard. Refuse to save if the new state has
    // collapsed to near-empty while the baseline had real data. This catches
    // HMR re-instantiating an empty store, accidental reset paths, and other
    // surprise-empty states. forceSave() (user-triggered) bypasses this.
    if (this._isCatastrophicShrinkage(state)) {
      this.notifyStatus('warning', 'Save blocked: data shrank unexpectedly. Reload to recover, or use Save Now to confirm.');
      // Don't clear pending — leave state as-is so a future legitimate save can fire.
      this.isSaving = false;
      return;
    }

    // Mark as saving immediately
    this.isSaving = true;

    // Watchdog: force-reset isSaving if the write never settles within the
    // budget. isSaving is now held for the duration of the actual write (so
    // dispatches are serialized and results are honest), which means slow
    // disks / large universes can legitimately take seconds. 30s covers the
    // worst realistic write; anything longer is a hung promise (iOS Safari
    // backgrounded-tab stalls, dead FSA handle) and must not block autosave
    // forever.
    const watchdogId = setTimeout(() => {
      if (this.isSaving) {
        console.warn('[SaveCoordinator] Watchdog clearing stuck isSaving flag — write did not settle in 30s');
        this.isSaving = false;
        // The write outcome is unknown, so the state must remain dirty and
        // pending data must stay queued for a retry.
        this.isDirty = true;
        if (this.isDirty || this.pendingHash !== null) {
          this.scheduleSave();
        }
      }
    }, 30000);

    // setTimeout(0) keeps the dispatch off the current frame for UI
    // responsiveness; the callback itself AWAITS the local write so the
    // dirty flag and save hash only advance when bytes actually landed.
    setTimeout(async () => {
      try {
        // ── Local write (awaited — its result decides clean vs dirty) ──
        let localOutcome = { status: 'skipped', reason: 'no-file-storage' };
        if (this.fileStorage && typeof this.fileStorage.saveToFile === 'function') {
          try {
            const result = await this.fileStorage.saveToFile(state, false, {
              preSerialized: !!pendingString,
              serializedData: pendingString,
              redstringData: pendingRedstringData
            });
            localOutcome = this._normalizeSaveOutcome(result);
          } catch (error) {
            console.error('[SaveCoordinator] Local file save failed:', error);
            localOutcome = { status: 'failed', reason: error?.message || 'write error' };
          }
        }

        // ── Git queue (non-blocking; the engine has its own retry/floor
        //    machinery). An unhealthy engine on a git-enabled universe is a
        //    degraded-durability state the user must be able to see. ──
        if (this.gitSyncEngine) {
          if (this.gitSyncEngine.isHealthy()) {
            this.gitSyncEngine.updateState(state);
          } else {
            this._notifyGitUnhealthy();
          }
        }

        if (localOutcome.status === 'saved' || localOutcome.status === 'skipped') {
          // Durable (or local persistence not applicable for this universe).
          this._onSaveConfirmed(state, pendingHash);
        } else {
          // 'failed' (write error, disconnected handle) or 'blocked' (a
          // data-loss guard refused the write). Either way the data is NOT
          // on disk: keep the pending state and dirty flag, surface the
          // failure, and retry with backoff. Do NOT advance lastSaveHash —
          // that is what previously made failed saves unretryable (the
          // identical re-hash was skipped forever).
          this.isDirty = true;
          if (localOutcome.status === 'failed') {
            this.lastError = localOutcome.reason;
            this.notifyStatus('error', `Save failed: ${localOutcome.reason}. Changes are kept and will retry.`, { persistent: true });
          }
          // 'blocked' outcomes already emitted their own warning at the guard.
          this._scheduleRetry();
        }
      } catch (error) {
        console.error('[SaveCoordinator] Save dispatch failed:', error);
        this.isDirty = true;
        this.notifyStatus('error', `Save failed: ${error.message}`);
        this._scheduleRetry();
      } finally {
        this.isSaving = false;
        clearTimeout(watchdogId);
      }
    }, 0);
  }

  /**
   * Marks a dispatched state as durably saved: advances the save hash,
   * ratchets the shrinkage baseline, and clears pending data — but only if no
   * newer change arrived while the write was in flight.
   *
   * @private
   * @param {Object} state - The state that was written.
   * @param {string|null} confirmedHash - The pending hash captured at dispatch time.
   */
  _onSaveConfirmed(state, confirmedHash) {
    this.retryAttempt = 0;
    this.lastError = null;

    // If confirmedHash is missing (worker stalled, main-thread fallback),
    // compute it now so the next worker callback for the same content
    // doesn't re-mark dirty and strand the indicator on "Saving...".
    let savedHash = confirmedHash;
    if (!savedHash && state) {
      try {
        savedHash = this.generateStateHash(state);
      } catch (hashErr) {
        console.warn('[SaveCoordinator] Hash after confirmed save failed:', hashErr);
      }
    }
    if (savedHash) {
      this.lastSaveHash = savedHash;
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

    // Only clear pending data if no NEWER change arrived while the write was
    // in flight. If the worker produced a fresh hash mid-write, that change
    // is still pending and its own scheduled save will pick it up.
    if (this.pendingHash === confirmedHash || this.pendingHash === null) {
      this.pendingHash = null;
      this.pendingString = null;
      this.pendingRedstringData = null;
      this.pendingStringState = null;
      this.isDirty = false;
    }
    this.notifyStatus('success', 'Save completed');
  }

  /**
   * Normalizes the many historical return shapes of storage backends into
   * `{ status: 'saved' | 'skipped' | 'blocked' | 'failed', reason? }`.
   *
   * - `true` / `undefined` (no throw) → saved
   * - `false` → skipped (legacy "no save method available" no-op)
   * - `{ success: true }` → saved
   * - `{ skipped | blocked: true }` → blocked (a guard refused; data NOT persisted)
   * - `{ failed: true }` → failed
   *
   * @private
   * @param {*} result - Raw return value from a `saveToFile` implementation.
   * @returns {{ status: string, reason?: string }} Normalized outcome.
   */
  _normalizeSaveOutcome(result) {
    if (result === true || result === undefined || result === null) {
      return { status: 'saved' };
    }
    if (result === false) {
      return { status: 'skipped', reason: 'no-save-target' };
    }
    if (typeof result === 'object') {
      if (result.success) return { status: 'saved' };
      if (result.failed) return { status: 'failed', reason: result.reason || 'save failed' };
      if (result.skipped || result.blocked) {
        return { status: 'blocked', reason: result.reason || 'save blocked by guard' };
      }
    }
    return { status: 'saved' };
  }

  /**
   * Schedules a retry after a failed/blocked write with exponential backoff.
   *
   * Backoff: DEBOUNCE_MS * 2^attempt, capped at 60s. Reset to zero on any
   * confirmed save. New user edits also reschedule through the normal
   * pipeline, so the backoff only governs the no-new-edits case.
   *
   * @private
   */
  _scheduleRetry() {
    const delay = Math.min(60000, DEBOUNCE_MS * Math.pow(2, this.retryAttempt));
    this.retryAttempt++;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.executeSave();
    }, delay);
  }

  /**
   * Returns `true` if the state has collapsed to near-empty against the
   * recorded baseline — the signature of an HMR store reset or a buggy wipe
   * rather than intentional deletion.
   *
   * @private
   * @param {Object} state - Store snapshot to check.
   * @returns {boolean} `true` when the save should be refused.
   */
  _isCatastrophicShrinkage(state) {
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
      }
      return collapsed;
    } catch (e) {
      console.warn('[SaveCoordinator] Shrinkage check failed (continuing with save):', e);
      return false;
    }
  }

  /**
   * Immediately writes any unsaved changes, bypassing debounce and interaction
   * gates. Used on quit/close/tab-hide, where waiting out the 3s debounce
   * means losing the user's last edits.
   *
   * Unlike `forceSave`, this respects the catastrophic-shrinkage guard —
   * a quit-flush must never be the thing that persists a surprise-empty state.
   *
   * @param {string} [reason='flush'] - Diagnostic label for logging.
   * @param {Object} [options={}] - Flush options.
   * @param {boolean} [options.terminal=false] - `true` when the app is
   *   actually exiting: Git changes are force-committed now (no later commit
   *   loop will run). When `false` (tab hidden, still alive) Git changes are
   *   queued through the normal engine loop instead.
   * @returns {Promise<boolean>} `true` if a write was performed and confirmed.
   */
  async flush(reason = 'flush', { terminal = false } = {}) {
    if (!this.isEnabled || this.swapInProgress) return false;

    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.workerTimer) { clearTimeout(this.workerTimer); this.workerTimer = null; }

    // The app is closing/hiding — any interaction is over by definition.
    this.isGlobalDragging = false;
    this._lastInteractionEndTime = 0;

    const state = this.nextStateToProcess || this.lastState;
    if (!state) return false;

    // Anything to write? Either the pipeline already knows it's dirty, or an
    // unprocessed state is queued whose hash differs from the last save.
    let needsWrite = this.hasUnsavedChanges();
    if (!needsWrite) {
      try {
        needsWrite = this.generateStateHash(state) !== this.lastSaveHash;
      } catch {
        needsWrite = true;
      }
    }
    if (!needsWrite) return false;

    if (!this.hasLoadedFromFile || state?.universeLoadingError || state?.isUniverseLoading) {
      console.warn(`[SaveCoordinator] flush(${reason}) skipped: universe not in a saveable state`);
      return false;
    }
    if (this._isCatastrophicShrinkage(state)) {
      console.warn(`[SaveCoordinator] flush(${reason}) refused by shrinkage guard`);
      return false;
    }

    // Let any in-flight dispatch settle first (bounded wait).
    const waitStart = Date.now();
    while (this.isSaving && Date.now() - waitStart < 4000) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`[SaveCoordinator] Flushing unsaved changes (${reason})`);
    this.isSaving = true;
    try {
      this.lastState = state;

      let localOutcome = { status: 'skipped', reason: 'no-file-storage' };
      if (this.fileStorage && typeof this.fileStorage.saveToFile === 'function') {
        try {
          const result = await this.fileStorage.saveToFile(state, false, { preSerialized: false });
          localOutcome = this._normalizeSaveOutcome(result);
        } catch (error) {
          console.error(`[SaveCoordinator] flush(${reason}) local write failed:`, error);
          localOutcome = { status: 'failed', reason: error?.message || 'write error' };
        }
      }

      if (this.gitSyncEngine && this.gitSyncEngine.isHealthy()) {
        try {
          if (terminal && typeof this.gitSyncEngine.forceCommit === 'function') {
            // The app is exiting — no later commit loop will run.
            await this.gitSyncEngine.forceCommit(state);
          } else {
            this.gitSyncEngine.updateState(state);
          }
        } catch (gitError) {
          console.warn(`[SaveCoordinator] flush(${reason}) git commit failed:`, gitError);
        }
      }

      if (localOutcome.status === 'saved' || localOutcome.status === 'skipped') {
        this._onSaveConfirmed(state, this.pendingHash);
        return true;
      }
      this.isDirty = true;
      return false;
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Emits a throttled warning when a git-enabled universe's sync engine is
   * unhealthy at save time — otherwise edits silently stop reaching Git while
   * the UI still reports local success.
   *
   * @private
   */
  _notifyGitUnhealthy() {
    const now = Date.now();
    if (now - this._lastGitUnhealthyWarnTime < 30000) return;
    this._lastGitUnhealthyWarnTime = now;
    console.warn('[SaveCoordinator] Git sync engine unhealthy — state not queued for commit');
    this.notifyStatus('warning', 'Git sync is unavailable — changes are saved locally but not synced.', { persistent: true });
  }

  /**
   * Performs an immediate, awaitable save bypassing the shrinkage guard.
   *
   * Used by the "Save Now" UI button. Cancels pending debounce timers, awaits
   * `fileStorage.saveToFile`, queues a Git update, then resets `dataBaseline` to
   * the current state so subsequent autosaves are not blocked by the guard.
   *
   * @param {Object} state - Zustand store snapshot to save.
   * @returns {Promise<true>} Resolves `true` on success.
   * @throws {Error} If the coordinator is not initialized or the local save fails.
   */
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
      
      // For force save, we await the local write and surface its real
      // outcome — reporting success when nothing was written is how users
      // lose hours of work believing they were saved.
      let localOutcome = { status: 'skipped', reason: 'no-file-storage' };
      if (this.fileStorage && typeof this.fileStorage.saveToFile === 'function') {
        try {
          const result = await this.fileStorage.saveToFile(state, false, {
            preSerialized: false // Force re-serialize for explicit save
          });
          localOutcome = this._normalizeSaveOutcome(result);
        } catch (error) {
          console.error('[SaveCoordinator] Force save local file failed:', error);
          localOutcome = { status: 'failed', reason: error?.message || 'write error' };
        }
      }

      // Queue Git save (non-blocking)
      if (this.gitSyncEngine && this.gitSyncEngine.isHealthy()) {
        this.gitSyncEngine.updateState(state);
      } else if (this.gitSyncEngine) {
        this._notifyGitUnhealthy();
      }

      if (localOutcome.status === 'failed' || localOutcome.status === 'blocked') {
        // Keep the state dirty so autosave keeps retrying, and tell the
        // caller the truth.
        this.isDirty = true;
        this.isSaving = false;
        const message = `Save failed: ${localOutcome.reason}`;
        this.notifyStatus('error', message, { persistent: true });
        throw new Error(message);
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

  /**
   * Computes an FNV-1a content hash of the store's graph/prototype/edge data.
   *
   * Mirrors the logic in `save.worker.js`. Used as a fallback when the worker is
   * unavailable. Strips viewport and image fields before hashing to avoid
   * false positives and OOM on large data URLs.
   *
   * @param {Object} state - Zustand store snapshot.
   * @returns {string} 32-bit unsigned integer as a decimal string.
   */
  generateStateHash(state) {
    // Delegates to the shared saveHash module so the main-thread fallback and
    // the worker can never drift (they used to, and both were blind to
    // Maps/Sets). Fails open: a hash error returns a unique value so a save
    // still fires rather than being silently skipped.
    try {
      return computeStateHash(state);
    } catch (error) {
      console.warn('[SaveCoordinator] Hash generation failed:', error);
      return Date.now().toString();
    }
  }

  /**
   * Returns the most recent store snapshot seen by the coordinator.
   *
   * Falls back to the Git sync engine's local state if `lastState` is unset.
   *
   * @returns {Object|null} Latest store snapshot, or `null` if none available.
   */
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

  /**
   * Returns the pre-serialized JSON string produced by the save worker.
   *
   * Used by `GitAutosavePolicy` to avoid redundant `JSON.stringify` calls when
   * committing the same state that was already serialized for the local write.
   *
   * @returns {string|null} Pre-serialized JSON, or `null` if not yet available.
   */
  getPendingString() {
    return this.pendingString;
  }

  /**
   * Returns a summary of the coordinator's current state for UI display.
   *
   * @returns {{ isEnabled: boolean, isSaving: boolean, hasPendingSave: boolean, lastError: Error|null, gitAutosavePolicy: Object }} Status snapshot.
   */
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      isSaving: this.isSaving,
      hasPendingSave: this.saveTimer !== null || this.pendingHash !== null,
      lastError: this.lastError,
      gitAutosavePolicy: gitAutosavePolicy.getStatus()
    };
  }

  /**
   * Returns a verbose diagnostic snapshot of all autosave gate flags.
   *
   * Surfaces exactly the state that can block autosave — used on mobile where
   * devtools are unavailable. Includes worker state, timer state, interaction
   * gate, data-loss guard, and storage backend health.
   *
   * @returns {Object} Diagnostic snapshot with `isEnabled`, `isSaving`, `isDirty`,
   *   `isGlobalDragging`, `hasLoadedFromFile`, worker/timer flags, and more.
   */
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

  /**
   * Enables or disables the save coordinator.
   *
   * Disabling cancels the pending save timer. Re-enabling notifies status handlers
   * but does not replay any missed state changes.
   *
   * @param {boolean} enabled - `true` to enable, `false` to disable.
   */
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

  /**
   * Counts user-created nodes and graphs, excluding built-in base prototypes.
   *
   * Used by the shrinkage guard to distinguish an intentionally empty universe
   * from a surprise data-loss event. Handles both `Map` and plain-object forms
   * of `nodePrototypes` and `graphs`.
   *
   * @private
   * @param {Object} state - Zustand store snapshot.
   * @returns {{ nodes: number, graphs: number }} Counts of user prototypes and graphs.
   */
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

  /**
   * Cancels all pending saves and resets coordinator state.
   *
   * Used during universe switching and deletion to prevent stale state from one
   * universe contaminating the next. Resets `hasLoadedFromFile` so the next
   * universe's load must re-establish the baseline before saves are allowed.
   */
  cancelPendingSaves() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.workerTimer) { clearTimeout(this.workerTimer); this.workerTimer = null; }
    if (this.workerWatchdogTimer) { clearTimeout(this.workerWatchdogTimer); this.workerWatchdogTimer = null; }
    if (this._dragGateFailsafe) { clearTimeout(this._dragGateFailsafe); this._dragGateFailsafe = null; }
    this.isGlobalDragging = false;
    this.workerProcessing = false;
    this.workerDirty = false;
    this.pendingHash = null;
    this.pendingString = null;
    this.pendingRedstringData = null;
    this.pendingStringState = null;
    this.lastState = null;
    this.isDirty = false;
    this.retryAttempt = 0;
    // Reset the data-loss guard. The new universe's load needs to happen
    // before saves are allowed again.
    this.hasLoadedFromFile = false;
    this._loggedLoadGuard = false;
    this.dataBaseline = { nodes: 0, graphs: 0 };
  }

  /**
   * Returns `true` if there are changes not yet written to disk.
   *
   * @returns {boolean} `true` when `isDirty` or a pending hash is queued.
   */
  hasUnsavedChanges() {
    return this.isDirty || (this.pendingHash !== null);
  }

  /**
   * Replaces the active Git sync engine.
   *
   * Also updates the reference held by `gitAutosavePolicy` so policy decisions
   * use the new engine immediately.
   *
   * @param {Object|null} gitSyncEngine - New GitSyncEngine instance, or `null` to disable Git saves.
   */
  setGitSyncEngine(gitSyncEngine) {
    this.gitSyncEngine = gitSyncEngine;
    if (gitAutosavePolicy) {
      gitAutosavePolicy.gitSyncEngine = gitSyncEngine;
    }
  }

  /**
   * Disables the coordinator and clears all status handlers.
   *
   * Called when the component tree unmounts. Does not flush pending saves.
   */
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
