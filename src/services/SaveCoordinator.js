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
 * - No write of any kind happens while a universe read is in flight
 *   (`beginLoad`/`endLoad`, armed by `universeBackend.loadUniverseData`).
 * - Saves are blocked until a `type:'load'` change context fires (`hasLoadedFromFile`).
 * - Catastrophic shrinkage (>90% drop from baseline) is refused; use `forceSave` to override.
 * - All interaction gates (drag, pan, pinch) defer serialization until `signalInteractionEnd`.
 */

import { exportToRedstring, PERSISTED_STORE_KEYS } from '../formats/redstringFormat.js';
import { createSaveMirrorSender } from './saveMirror.js';
import { msSinceCameraMoved } from './cameraActivity.js';
import { userDataCounts } from '../formats/userDataCounts.js';
import { gitAutosavePolicy } from './GitAutosavePolicy.js';
import { generateStateHash as computeStateHash } from './saveHash.js';
import { vlog } from '../utils/verboseLog.js';
import { getAutoSaveMode, autoSaves, universeItemCount, subscribeAutoSaveMode } from './autoSaveMode.js';

// SIMPLIFIED: No priorities - all changes batched together with a single debounce.
// With the 500ms worker debounce, an edit reaches the file about 1.5s later. It
// was 3000ms, which left local saves feeling slow; the interaction gate and the
// post-interaction cooldown (not this debounce) are what keep a write off a drag.
const DEBOUNCE_MS = 1000;

/**
 * What the save worker receives of a Thing: auto-enriched Wikipedia images are
 * left out (they're re-fetchable, and kept as URLs in the image cache). Only
 * when we have the thumbnail URL: a user-uploaded photo, even on a node that
 * was once auto-enriched, has no wikipediaThumbnail and must be kept, or the
 * save writes null over it.
 */
const stripReFetchableImages = (key, value) => {
  if (key !== 'nodePrototypes' || !value) return value;
  if (value.semanticMetadata?.autoEnriched && value.semanticMetadata?.wikipediaThumbnail) {
    const { imageSrc, thumbnailSrc, ...rest } = value;
    return rest;
  }
  return value;
};

// A change that only switched webs (see NAVIGATION_CHANGE_TYPES in graphStore)
// waits this long on a Git-backed universe before it starts a save, or rides
// along with the next real edit, whichever comes first. Clicking between webs
// otherwise rewrote the whole universe on every click. A universe whose local
// file is the source of truth saves it straight away, as before.
const NAVIGATION_SAVE_DELAY_MS = 3000;

// On a big universe every save rewrites a big file, so a change that only
// switched webs (NAVIGATION_CHANGE_TYPES in graphStore) waits until nothing has
// happened for this long, whatever the universe is saved to. An edit saves on
// the normal schedule and takes a waiting switch with it, and closing or
// hiding the app writes it straight away. Moving Things is an edit: a drop
// saves as soon as it settles.
const SETTLE_SAVE_DELAY_MS = 10000;

// How long the camera must be still before a due save is handed over.
const CAMERA_QUIET_MS = 300;

// Things plus webs at which a universe counts as big for SETTLE_SAVE_DELAY_MS.
export const LARGE_UNIVERSE_SIZE = 5000;

// How often the load-gate watchdog re-checks a token that hasn't settled. It
// is NOT a deadline on loading — a slow load releases normally via `finally`,
// however long it takes. It only decides when to look at a possibly-hung token
// and ask whether the universe has loaded by some other path.
const LOAD_GATE_CHECK_MS = 120000;

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
    this.navigationTimer = null; // A waiting web switch; see NAVIGATION_SAVE_DELAY_MS, SETTLE_SAVE_DELAY_MS

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

    // Load gate. Refcount of universe loads currently in flight, armed by
    // `universeBackend.loadUniverseData` for the whole read (network + parse +
    // apply). While > 0 NOTHING is written — not autosave, not flush, not
    // "Save Now".
    //
    // This is the one guard that is neither an inference nor device-local
    // state. Every other protection asks "does the store LOOK unloaded?"
    // (`hasLoadedFromFile`, `dataBaseline`, the engine's node-count floor) and
    // every one of them can read clean on a mobile browser: the 5s
    // LOAD_TIMEOUT_MS fast path flips `isUniverseLoading` to false while the
    // Git fetch is still running (that release exists to free the UI spinner,
    // not to declare the load done), and localStorage-backed floors are 0 or
    // absent on a fresh/evicted device. Slow cellular Git fetches sit squarely
    // in that window, which is why this only ever bit on mobile/tablet.
    this.loadInFlight = 0;
    this._loadGateTokens = new Map(); // token -> { label, startedAt, timer }
    this._loadGateSeq = 0;

    // Slug of the universe whose baseline is currently loaded. Used to key
    // persisted guard state in localStorage so the shrinkage guard has a
    // meaningful floor immediately after a page refresh (before the load
    // context fires).
    this.activeUniverseSlugForGuard = null;

    // Why the last write didn't happen (a guard refused it, or it failed), for
    // the save indicator. Cleared by the next confirmed save.
    this.lastBlockReason = null;

    // A change has arrived and not yet been hashed (the 500ms worker wait).
    // Counts as unsaved, so the indicator says "Saving..." the moment an edit
    // or a drop lands rather than half a second later.
    this.awaitingWorker = false;

    // Autosave can be off (Settings → Data, or a universe past Automatic's
    // limits; autoSaveMode.js). Changes are still noticed and the worker still
    // builds the file, but executeSave writes only once saveNow() asks.
    // `lastFileBytes`: the size of the file the worker last built, for
    // Automatic's limit. `manualSaveRequested`: a saveNow() is under way;
    // its callers wait in `_manualSaveWaiters` for whether it landed.
    this.lastFileBytes = 0;
    this.manualSaveRequested = false;
    this._manualSaveWaiters = [];

    // Turning autosave back on writes what's waiting.
    subscribeAutoSaveMode(() => {
      if (this.isEnabled && (this.isDirty || this.pendingHash !== null) && this.autoSaveActive()) {
        this.scheduleSave();
      }
      this.notifyStatus('info', 'Autosave setting changed');
    });

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
      // NOTE: `hasLoadedFromFile` is deliberately NOT restored. It means "this
      // session has observed a load", which is not a durable fact — a previous
      // session's success says nothing about whether THIS page load has read
      // the file yet. Restoring it silently disarmed the empty-state guard in
      // `onStateChange` for every returning device, which is exactly the
      // window a slow mobile Git fetch lives in. `dataBaseline`/`lastSaveHash`
      // are still restored: those only ratchet protection upward.
      this.activeUniverseSlugForGuard = slug;
      vlog('[SaveCoordinator] Restored persisted guard state for', slug, this.dataBaseline);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Points the data-loss guard at `slug`'s own floor.
   *
   * The shrinkage floor is per universe: 1,800 things in one universe say
   * nothing about the next. Switching used to depend on a `type:'load'` notice
   * reaching `onStateChange`, but the store batches its notices and a later
   * change in the same tick can replace that type, so the switch went unseen.
   * A universe created from the welcome screen then inherited the previous
   * universe's floor, and every save of its first few things read as a 99%
   * collapse and was refused: "Unsaved" until a reload, then empty
   * (2026-09-26). The state carries its universe stamp, so the guard follows
   * that instead.
   *
   * A null guard slug means the floor was set before any universe was known
   * (boot); that floor is kept and only tagged.
   *
   * @private
   * @param {string|null|undefined} slug - The universe the state belongs to.
   */
  _syncGuardUniverse(slug) {
    if (!slug || slug === this.activeUniverseSlugForGuard) return;
    if (this.activeUniverseSlugForGuard) {
      vlog(`[SaveCoordinator] Guard follows the universe switch: ${this.activeUniverseSlugForGuard} → ${slug}`);
      this.dataBaseline = { nodes: 0, graphs: 0 };
      this.retryAttempt = 0;
      this.lastBlockReason = null;
    }
    this.activeUniverseSlugForGuard = slug;
    this._restoreGuardState(slug);
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
    vlog(`[SaveCoordinator] Swap pause active: ${label}`);
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
    vlog(`[SaveCoordinator] Swap pause released: ${label}`);
    if (this.nextStateToProcess || this.isDirty) {
      this.scheduleSave();
    }
  }

  /**
   * Arms the load gate: no write of any kind may happen until the matching
   * `endLoad` fires. Refcounted, because loads legitimately overlap (the boot
   * race starts a second `loadUniverseData` when the first exceeds
   * LOAD_TIMEOUT_MS, and both are still running).
   *
   * Callers MUST call `endLoad(token)` in a `finally` — that covers every
   * normal outcome, success or failure, however slow. Each token also carries
   * a watchdog for the one case a `finally` can't reach: a promise that never
   * settles at all. See `_forceReleaseLoadGate` for what it is and is not
   * allowed to do.
   *
   * @param {string} [label='load'] - Diagnostic label logged with the gate event.
   * @returns {number} Token to pass back to `endLoad`.
   */
  beginLoad(label = 'load') {
    const token = ++this._loadGateSeq;
    const timer = setTimeout(() => this._forceReleaseLoadGate(token), LOAD_GATE_CHECK_MS);
    this._loadGateTokens.set(token, { label, startedAt: Date.now(), timer });
    this.loadInFlight = this._loadGateTokens.size;
    vlog(`[SaveCoordinator] Load gate armed (${label}), in flight: ${this.loadInFlight}`);
    return token;
  }

  /**
   * Releases one hold on the load gate. When the last hold clears, any state
   * that was queued while blocked is scheduled through the normal debounced
   * path so the user's edits aren't stranded.
   *
   * @param {number} token - Token returned by `beginLoad`.
   */
  endLoad(token) {
    const entry = this._loadGateTokens.get(token);
    if (!entry) return;
    clearTimeout(entry.timer);
    this._loadGateTokens.delete(token);
    this.loadInFlight = this._loadGateTokens.size;
    vlog(`[SaveCoordinator] Load gate released (${entry.label}, ${Date.now() - entry.startedAt}ms), in flight: ${this.loadInFlight}`);
    if (this.loadInFlight === 0 && (this.nextStateToProcess || this.isDirty)) {
      this.scheduleSave();
    }
  }

  /**
   * Watchdog for a load token that never settled — a promise nobody resolves
   * or rejects (dead socket). `endLoad` runs in a `finally`, so a load that
   * merely takes a long time releases normally no matter how long it takes;
   * only a genuine hang reaches this.
   *
   * It releases the token ONLY if the universe has actually loaded
   * (`hasLoadedFromFile` — set by a `type:'load'` context and cleared on every
   * universe switch by `cancelPendingSaves`). That is the whole rule:
   *
   *   - Loaded. The data is in the store. The one scenario this exists for is
   *     the boot race: `loadUniverseData` runs twice when the first exceeds
   *     LOAD_TIMEOUT_MS, the background one lands and applies, and the first
   *     one hangs forever holding a token. The universe is open and working,
   *     but a dead token would block saving for the rest of the session.
   *     Release it.
   *
   *   - Not loaded. There is an existing universe we never read. The store
   *     holds pre-load content, so there is nothing here worth writing and
   *     everything to lose by writing it. The gate stays SHUT — indefinitely,
   *     for as long as it takes. A clock does not get to decide that a
   *     universe which never loaded is safe to overwrite. Re-arm and re-check,
   *     so a load that lands late still cleans up its stuck sibling.
   *
   * @private
   * @param {number} token - Token whose watchdog fired.
   */
  _forceReleaseLoadGate(token) {
    const entry = this._loadGateTokens.get(token);
    if (!entry) return;

    if (!this.hasLoadedFromFile) {
      console.warn(`[SaveCoordinator] Load gate watchdog: "${entry.label}" has not settled in ${Date.now() - entry.startedAt}ms and the universe never loaded — holding the gate shut. Saving stays disabled until the load lands or the page is reloaded.`);
      this.notifyStatus('warning', 'Still waiting on this universe to load — saving is paused so it cannot overwrite unread data. Reload to retry.', { persistent: true });
      entry.timer = setTimeout(() => this._forceReleaseLoadGate(token), LOAD_GATE_CHECK_MS);
      return;
    }

    console.warn(`[SaveCoordinator] Load gate watchdog: "${entry.label}" never settled in ${Date.now() - entry.startedAt}ms, but the universe IS loaded (a sibling load applied it) — releasing the stuck token`);
    this.endLoad(token);
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
      // A drop usually ends here, not through an `end` change, so this is the
      // moment the indicator can say "Saving...". Only when the drag actually
      // changed something (the gate marks those dirty).
      if (this.isDirty) this._markAwaitingWorker();
      if (this.workerProcessing) {
        this.workerDirty = true;
      } else {
        if (this.workerTimer) clearTimeout(this.workerTimer);
        this.workerTimer = setTimeout(() => {
          this.workerTimer = null;
          this.sendToWorker();
        }, 300);
      }
    }
  }

  /**
   * Flags a change as waiting on the worker, and tells listeners once, on the
   * transition, so the indicator shows "Saving..." without waiting for a poll.
   *
   * @private
   */
  _markAwaitingWorker() {
    if (this.awaitingWorker) return;
    this.awaitingWorker = true;
    this.notifyStatus('info', 'Changes pending');
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
          this._syncGuardUniverse(activeSlug);
        }
      }
    } catch (e) {
      console.warn('[SaveCoordinator] Failed to restore guard state on initialize:', e);
    }

    // Initialize Save Worker
    try {
      // A new worker holds no copy of the universe yet.
      this.mirrorSender?.reset();
      this.saveWorker = new Worker(new URL('./save.worker.js', import.meta.url), { type: 'module' });
      this.saveWorker.onmessage = this.handleWorkerMessage.bind(this);
      this.saveWorker.onerror = (event) => {
        // Worker crashed (script error, OOM, etc.). Recover so the save loop
        // doesn't strand the user's edits — schedule a main-thread save with
        // whatever state we have, then drop the worker (we'll keep using the
        // main thread until the next page load).
        console.warn('[SaveCoordinator] Save worker error event:', event?.message || event);
        this.mirrorSender?.reset();
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
    const { type, hash, jsonBytes, jsonString, success, error, code } = e.data;

    if (this.workerSentAt) {
      this.lastWorkerMs = Date.now() - this.workerSentAt;
      this.workerSentAt = null;
    }

    // Worker responded — cancel the stall watchdog.
    if (this.workerWatchdogTimer) {
      clearTimeout(this.workerWatchdogTimer);
      this.workerWatchdogTimer = null;
    }

    this.workerProcessing = false;

    if (type === 'save_processed' && success) {
      // Worker finished processing

      // A check of the worker's kept pieces found one that no longer matched
      // its Thing or web. That save was written in full and the worker keeps
      // nothing for the rest of the session; this should never happen, so say so.
      if (Array.isArray(e.data.cacheMismatches) && e.data.cacheMismatches.length > 0) {
        console.error('[SaveCoordinator] The save worker found stale pieces in its cache. This save was written in full, and it will rebuild every save from now on.', e.data.cacheMismatches.slice(0, 20));
      }

      // The file's size, for Automatic's limit (autoSaveMode.js).
      const builtBytes = jsonBytes?.byteLength ?? (typeof jsonString === 'string' ? jsonString.length : 0);
      if (builtBytes > 0) this.lastFileBytes = builtBytes;

      // Check if hash changed
      if (hash !== this.lastSaveHash && hash !== this.pendingHash) {
        this.pendingHash = hash;
        // The file, pre-serialized: UTF-8 bytes from the worker (a string
        // from an older one). Every writer takes either.
        this.pendingString = jsonBytes || jsonString;
        this.pendingRedstringData = null;
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
      } else if (hash === this.pendingHash && hash !== this.lastSaveHash && (jsonBytes || jsonString)) {
        // The same content as the change already waiting, from a newer state
        // (a pan or a web switch since: those don't change the hash but are
        // written). Keep these bytes, for that newer state, so the write
        // doesn't rebuild the file on the main thread.
        this.pendingString = jsonBytes || jsonString;
        this.pendingRedstringData = null;
        this.pendingStringState = this.lastState;
      } else if (hash === this.lastSaveHash && this.pendingHash === null && this.isDirty) {
        // The content matches what was last saved (a press that moved nothing,
        // an edit undone). The drag gate marks every interaction dirty, and
        // nothing used to clear it, so the indicator went on to report a stall
        // over a file that was already up to date.
        this.isDirty = false;
      }
    } else if (type === 'prime-failed') {
      // Nothing was saving; the next save simply sends the whole state.
      this.mirrorSender?.reset();
      return;
    } else if (type === 'error' && code === 'no-mirror') {
      // The worker had no copy to apply a change list to (it restarted).
      // Send it the whole state again.
      this.mirrorSender?.reset();
      if (!this.nextStateToProcess && this.lastState) this.nextStateToProcess = this.lastState;
      this.workerDirty = false;
      this.sendToWorker();
      return;
    } else if (type === 'error') {
      // Its copy may be half-updated; the next message must be whole.
      this.mirrorSender?.reset();
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
    } else if (this.awaitingWorker && type === 'save_processed') {
      this.awaitingWorker = false;
      if (!this.hasUnsavedChanges()) this.notifyStatus('info', 'No changes to save');
    }

    // A save the user asked for was waiting on this pass.
    if (this.manualSaveRequested && !this.workerProcessing) this._continueManualSave();
  }

  /**
   * The message that brings the save worker's copy of the universe up to
   * `state`: the whole state the first time, then only what changed.
   * @private
   */
  _workerMessageFor(state) {
    // Extract ONLY the persisted data properties for the worker. Two reasons:
    // (1) the store contains functions (actions) that would throw
    // DataCloneError on postMessage; (2) the set of forwarded keys must EXACTLY
    // match what the serializer persists — deriving it from PERSISTED_STORE_KEYS
    // guarantees a new persisted field can't be silently dropped here (the bug
    // that erased wizardPlansByConversation on every autosave). Carry
    // _universeSlug through so downstream identity guards work.
    const cleanState = { _universeSlug: state._universeSlug };
    for (const key of PERSISTED_STORE_KEYS) {
      cleanState[key] = state[key];
    }
    // Read by exportToRedstring though not store data of their own: each web's
    // live pan and zoom, and fields quarantined from a newer format. The local
    // file write uses this string, so it must match a main-thread export.
    cleanState.graphViews = state.graphViews;
    cleanState._preserved = state._preserved;

    // The worker keeps its own copy, so after the first message only the
    // Things, webs and connections that changed are cloned across (see
    // saveMirror.js). Auto-enriched Wikipedia images are stripped on the way:
    // structured clone copies all data to the worker heap, and base64 data
    // URLs (100KB-5MB each) cause OOM in both the main thread and worker.
    // User-uploaded images (no autoEnriched flag) are preserved for save.
    if (!this.mirrorSender) this.mirrorSender = createSaveMirrorSender(stripReFetchableImages);
    return this.mirrorSender.build(cleanState);
  }

  /**
   * Give the save worker its copy of a universe that just loaded, so the
   * first save after opening sends only a change, not the whole universe
   * (about 0.4 s of a frozen app at 32,000 Things, on the first edit). The
   * copy goes while the app is still settling from the load, and the worker
   * neither exports nor replies.
   * @private
   */
  _primeWorker(state) {
    if (!this.saveWorker || !state || !this.isEnabled) return;
    try {
      this.saveWorker.postMessage({ type: 'prime', ...this._workerMessageFor(state), userDomain: null });
    } catch (e) {
      console.warn('[SaveCoordinator] Could not give the save worker its copy:', e);
      this.mirrorSender?.reset();
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
    if (!this.nextStateToProcess) {
      // Nothing left to hash. Unless a pass is still running (its reply
      // settles the flag), no change is waiting on the worker.
      if (!this.workerProcessing) this.awaitingWorker = false;
      return;
    }

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

    const message = this._workerMessageFor(this.nextStateToProcess);

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
    // A big universe takes the worker seconds (export, stringify and hash run
    // about 4 s at 32,000 Things), so a fixed 3 s called every save of one a
    // stall and redid the work on the main thread. Allow for the size, and for
    // how long the last pass actually took.
    const thingCount = stateToSend.nodePrototypes?.size || 0;
    const WORKER_STALL_MS = Math.min(60000, Math.max(3000 + thingCount * 0.3, (this.lastWorkerMs || 0) * 3));
    this.workerSentAt = Date.now();
    this.workerWatchdogTimer = setTimeout(() => {
      this.workerWatchdogTimer = null;
      this._handleWorkerStall('timeout');
    }, WORKER_STALL_MS);

    try {
      this.saveWorker.postMessage({
        type: 'process_save',
        ...message,
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
    this.awaitingWorker = false;
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
      } else if (hash === this.lastSaveHash && this.pendingHash === null) {
        this.isDirty = false;
      }
    } catch (err) {
      console.warn('[SaveCoordinator] Main-thread save processing failed, scheduling anyway:', err);
      // Hash failed but state exists — schedule a save anyway so edits aren't
      // stranded. The save dispatch tolerates a missing hash.
      this.isDirty = true;
      this.scheduleSave();
    }
    if (this.manualSaveRequested) this._continueManualSave();
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

    this._syncGuardUniverse(newState._universeSlug);

    // Any change that is not just navigation carries a waiting web switch
    // with it: it saves the whole state, the switch included. A camera move
    // saves nothing, so it must not cancel the wait either.
    if (this.navigationTimer && changeContext.navigationOnly !== true && changeContext.type !== 'viewport') {
      clearTimeout(this.navigationTimer);
      this.navigationTimer = null;
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
        this.awaitingWorker = false;
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
        // The worker's copy, while the load is still settling (see _primeWorker).
        setTimeout(() => {
          if (this.nextStateToProcess === newState) this._primeWorker(newState);
        }, 0);
        if (this._loggedLoadErrorGuard) this._loggedLoadErrorGuard = false;
        // Capture the data baseline we just loaded so we can detect a
        // catastrophic shrinkage on subsequent saves.
        try {
          this.dataBaseline = this._adoptBaseline(this._countDataItems(newState), newState, 'load');
        } catch (_) { /* non-fatal */ }
        return;
      }

      // A universe read is in flight. Queue the state, dispatch nothing. This
      // is checked BEFORE the `isUniverseLoading` guard below because that flag
      // is released early on purpose (LOAD_TIMEOUT_MS frees the UI spinner
      // while the fetch continues) — the gate is what actually tracks the read.
      if (this.loadInFlight > 0) {
        this.nextStateToProcess = newState;
        this.lastChangeContext = changeContext;
        if (!this._loggedLoadGateBlock) {
          console.warn(`[SaveCoordinator] Save deferred: ${this.loadInFlight} universe load(s) in flight. Changes are queued and will save once the load settles.`);
          this._loggedLoadGateBlock = true;
        }
        return;
      }
      this._loggedLoadGateBlock = false;

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
          this.dataBaseline = this._adoptBaseline(this._countDataItems(newState), newState, 'adopt');
        } catch { /* non-fatal */ }
        if (this._loggedLoadGuard) this._loggedLoadGuard = false;
        vlog('[SaveCoordinator] Adopting current non-empty state as load baseline (no explicit load context fired).');
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

      // Only switched webs, on a big universe, with nothing else in flight:
      // hold it until nothing has happened for a while. Each switch restarts
      // the wait. Like the Git wait below, it re-enters as an ordinary change,
      // so every guard above applies then.
      if (changeContext.navigationOnly === true && this._isLargeUniverse(newState) && this._pipelineIdle()) {
        this._holdForSettle(newState, changeContext);
        return;
      }

      // Only switched webs, on a Git-backed universe, with nothing else in
      // flight: hold it. When the wait ends it re-enters here as an ordinary
      // change, so every guard above applies to it then, not just now.
      if (changeContext.navigationOnly === true && this._navigationMayWait()) {
        this.nextStateToProcess = newState;
        this.lastChangeContext = changeContext;
        if (this.navigationTimer) clearTimeout(this.navigationTimer);
        this.navigationTimer = setTimeout(() => {
          this.navigationTimer = null;
          const latest = this.nextStateToProcess;
          if (latest) this.onStateChange(latest, { type: 'navigation_settled' });
        }, NAVIGATION_SAVE_DELAY_MS);
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

      this._markAwaitingWorker();

      // Debounce sending to worker to avoid flooding it
      // But ONLY if we're not in an interaction - worker serialization is expensive
      if (this.workerProcessing) {
        this.workerDirty = true;
      } else {
        // Clear existing debounce timer
        if (this.workerTimer) clearTimeout(this.workerTimer);
        
        this.workerTimer = setTimeout(() => {
          this.workerTimer = null;
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
   * Whether a navigation-only change may wait (NAVIGATION_SAVE_DELAY_MS).
   *
   * Only on a Git-backed universe: with the local file as source of truth
   * (or no Git engine at all) a switch saves straight away, as it always has.
   * And only while the pipeline is idle: if an edit is already on its way to
   * the file, the switch joins that save rather than splitting off from it.
   *
   * @private
   * @returns {boolean}
   */
  _navigationMayWait() {
    const engine = this.gitSyncEngine;
    if (!engine || engine.sourceOfTruth === 'local') return false;
    return this._pipelineIdle();
  }

  /**
   * Nothing is on its way to the file: no change waiting on the worker, no
   * write scheduled or running. A change that may wait only waits then;
   * otherwise it joins the save already coming.
   * @private
   */
  _pipelineIdle() {
    return !(this.workerTimer || this.workerProcessing || this.awaitingWorker
      || this.saveTimer || this._cameraWaitTimer || this.isSaving || this.isDirty || this.pendingHash !== null);
  }

  /**
   * Hold a web switch on a big universe until nothing has happened for
   * SETTLE_SAVE_DELAY_MS. Each call restarts the wait. When it ends, the state
   * re-enters onStateChange as an ordinary change and saves. While it waits,
   * nothing counts as unsaved (like the Git web-switch wait): the indicator
   * stays quiet, and flush() writes it if the app closes or hides.
   * @private
   */
  _holdForSettle(state, context = null) {
    this.nextStateToProcess = state;
    if (context) this.lastChangeContext = context;
    if (this.navigationTimer) clearTimeout(this.navigationTimer);
    this.navigationTimer = setTimeout(() => {
      this.navigationTimer = null;
      const latest = this.nextStateToProcess;
      if (latest) this.onStateChange(latest, { type: 'navigation_settled' });
    }, SETTLE_SAVE_DELAY_MS);
  }

  /**
   * Whether a universe is big enough that web switches wait
   * (LARGE_UNIVERSE_SIZE, SETTLE_SAVE_DELAY_MS).
   * @private
   */
  _isLargeUniverse(state) {
    return ((state?.nodePrototypes?.size || 0) + (state?.graphs?.size || 0)) >= LARGE_UNIVERSE_SIZE;
  }

  /**
   * Schedules a debounced write, resetting the timer on each call.
   *
   * Fires `executeSave` after `DEBOUNCE_MS` (1000ms) with no further calls.
   * Always cancels any previously pending timer before setting a new one.
   */
  scheduleSave() {
    // Clear existing timer
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    
    // console.log(`[SaveCoordinator] Scheduling write in ${DEBOUNCE_MS}ms`);
    
    // Schedule new save. The handle is cleared when it fires: a stale handle
    // reads as "a save is pending" to getStatus() and _navigationMayWait().
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
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
      vlog('[SaveCoordinator] executeSave deferred: swap in progress');
      return;
    }
    // Defense-in-depth: a save timer armed just before a load started must not
    // fire into the load window. endLoad() reschedules whatever is queued.
    if (this.loadInFlight > 0) {
      vlog('[SaveCoordinator] executeSave deferred: universe load in flight');
      return;
    }
    // Autosave is off for this universe (autoSaveMode.js): the change stays
    // unsaved, and the indicator offers Save, until saveNow() asks.
    if (!this.manualSaveRequested && !this.autoSaveActive(this.lastState)) {
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
    
    // Nor while the camera is moving (panning, zooming, WASD): hand the write
    // over once it has been still for a moment. Closing the app doesn't wait
    // on this; flush() writes directly.
    const sinceCameraMoved = msSinceCameraMoved();
    if (sinceCameraMoved < CAMERA_QUIET_MS) {
      if (this._cameraWaitTimer) clearTimeout(this._cameraWaitTimer);
      this._cameraWaitTimer = setTimeout(() => {
        this._cameraWaitTimer = null;
        this.executeSave();
      }, CAMERA_QUIET_MS - sinceCameraMoved);
      return;
    }

    // We need either a pending string (from worker) or a lastState (fallback)
    if (!this.pendingString && !this.lastState) {
      this._settleManualSave(false);
      return;
    }

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
    this._syncGuardUniverse(state?._universeSlug);
    if (this._isCatastrophicShrinkage(state)) {
      // Save Now confirms a PARTIAL shrink, but it cannot persist a universe
      // emptied completely — the destination guards refuse that, by design.
      // Naming Save Now unconditionally sent people down a dead end.
      const cleared = this._countDataItems(state).nodes === 0;
      this.notifyStatus('warning', cleared
        ? 'Save blocked: this universe now has no things but the saved copy does. Reload to recover it. Emptying a universe completely is not supported yet; leaving one thing in place and pressing Save Now does work.'
        : 'Save blocked: data shrank unexpectedly. Reload to recover, or use Save Now to confirm.');
      this.lastBlockReason = cleared
        ? 'This universe now has no things but its saved copy does. Reload to recover it.'
        : 'Much less is here than was last saved, so autosave stopped to be safe. Reload to recover, or press Save Now to keep this version.';
      // Don't clear pending — leave state as-is so a future legitimate save can fire.
      this.isSaving = false;
      this._settleManualSave(false);
      return;
    }

    // Mark as saving immediately
    this.isSaving = true;
    // This write is the one a waiting saveNow() asked for: it carries the
    // newest state (_continueManualSave saw to that before calling here).
    const manualWrite = this.manualSaveRequested;

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
        if (manualWrite) this._settleManualSave(false);
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
          if (manualWrite) this._settleManualSave(true);
        } else {
          // 'failed' (write error, disconnected handle) or 'blocked' (a
          // data-loss guard refused the write). Either way the data is NOT
          // on disk: keep the pending state and dirty flag, surface the
          // failure, and retry with backoff. Do NOT advance lastSaveHash —
          // that is what previously made failed saves unretryable (the
          // identical re-hash was skipped forever).
          this.isDirty = true;
          this.lastBlockReason = localOutcome.reason || 'The write was refused.';
          if (localOutcome.status === 'failed') {
            this.lastError = localOutcome.reason;
            this.notifyStatus('error', `Save failed: ${localOutcome.reason}. Changes are kept and will retry.`, { persistent: true });
          }
          // 'blocked' outcomes already emitted their own warning at the guard.
          if (manualWrite) this._settleManualSave(false);
          this._scheduleRetry();
        }
      } catch (error) {
        console.error('[SaveCoordinator] Save dispatch failed:', error);
        this.isDirty = true;
        this.notifyStatus('error', `Save failed: ${error.message}`);
        if (manualWrite) this._settleManualSave(false);
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
    this.lastBlockReason = null;

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
      this.saveTimer = null;
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
          message: 'If this was intentional, use forceSave() ("Save Now"). Note that a shrink to ZERO cannot be persisted — the destination guards refuse it; leave at least one thing in place.'
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
   * gates. Used on quit/close/tab-hide, where waiting out the debounce
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
   *
   * With autosave off (autoSaveMode.js) nothing is written: hiding or closing
   * the app isn't a save the user asked for. Closing asks first instead
   * (unsavedChanges.js), and saves through saveNow().
   * @returns {Promise<boolean>} `true` if a write was performed and confirmed.
   */
  async flush(reason = 'flush', { terminal = false } = {}) {
    if (!this.isEnabled || this.swapInProgress) return false;

    // Even a quit-flush must not write mid-load. The store still holds
    // pre-load content; persisting it on tab-hide is how a backgrounded mobile
    // browser overwrites the file it was in the middle of reading.
    if (this.loadInFlight > 0) {
      console.warn(`[SaveCoordinator] flush(${reason}) skipped: universe load in flight`);
      return false;
    }

    // Checked before any timer is cleared: the pipeline carries on as it was.
    if (!this.autoSaveActive(this.nextStateToProcess || this.lastState)) {
      vlog(`[SaveCoordinator] flush(${reason}) skipped: autosave is off for this universe`);
      return false;
    }

    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this._cameraWaitTimer) { clearTimeout(this._cameraWaitTimer); this._cameraWaitTimer = null; }
    if (this.workerTimer) { clearTimeout(this.workerTimer); this.workerTimer = null; }
    // A waiting web switch is written now, with everything else.
    if (this.navigationTimer) { clearTimeout(this.navigationTimer); this.navigationTimer = null; }

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

    vlog(`[SaveCoordinator] Flushing unsaved changes (${reason})`);
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
  /**
   * Records a write made outside this pipeline: "Save Now", and the first write
   * of a universe made during onboarding. Both go through
   * `universeBackend.forceSave`, which writes the file directly. Nothing told
   * this coordinator, so it kept the edit it was holding as unsaved and kept
   * refusing it: Save Now wrote the file while the indicator went on saying
   * "Unsaved", and a shrinkage refusal outlived the Save Now that was meant to
   * confirm it.
   *
   * Treated like `forceSave`: a deliberate write, so its shape becomes the
   * baseline. Pending work is cleared only when this state is the newest one
   * the coordinator has; a newer edit still saves on its own.
   *
   * @param {Object} state - The store snapshot that was written.
   */
  markSavedExternally(state) {
    if (!state) return;
    this._syncGuardUniverse(state._universeSlug);
    try {
      this.lastSaveHash = this.generateStateHash(state);
    } catch (hashErr) {
      console.warn('[SaveCoordinator] Hash after an external save failed:', hashErr);
    }
    try {
      this.dataBaseline = this._countDataItems(state);
      this.hasLoadedFromFile = true;
      if (this.activeUniverseSlugForGuard) this._persistGuardState(this.activeUniverseSlugForGuard);
    } catch (_) { /* non-fatal */ }
    this.retryAttempt = 0;
    this.lastError = null;
    this.lastBlockReason = null;

    const newest = this.nextStateToProcess;
    if (!newest || newest === state) {
      if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      this.pendingHash = null;
      this.pendingString = null;
      this.pendingRedstringData = null;
      this.pendingStringState = null;
      this.isDirty = false;
      this.awaitingWorker = false;
    }
    this.notifyStatus('success', 'Save completed');
  }

  async forceSave(state, { allowDuringLoad = false } = {}) {
    if (!this.isEnabled) {
      throw new Error('Save coordinator not initialized');
    }

    // "Save Now" pressed while the universe is still being read writes the
    // PRE-load store over the file being read. Refuse and say why — the user
    // can retry a second later. `allowDuringLoad` exists for conflict
    // resolution, where writing a deliberately-chosen state is the point.
    if (this.loadInFlight > 0 && !allowDuringLoad) {
      const message = 'Still loading this universe — save skipped so it cannot overwrite what is being read. Try again in a moment.';
      this.notifyStatus('warning', message);
      throw new Error(message);
    }

    try {
      // console.log('[SaveCoordinator] Force save requested');
      this.notifyStatus('info', 'Force saving...');
      
      if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      if (this.workerTimer) { clearTimeout(this.workerTimer); this.workerTimer = null; }
      // The change that armed the cancelled worker timer is part of this
      // write, so nothing waits on the worker any more. A change that arrives
      // during the write below re-arms it; a failed write sets isDirty.
      this.awaitingWorker = false;

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
      // Load gate — the first thing to check when saves appear stuck
      loadInFlight: this.loadInFlight,
      loadGateHolders: Array.from(this._loadGateTokens.values()).map(e => `${e.label} (${now - e.startedAt}ms)`),
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
      vlog('[SaveCoordinator] Enabled');
      this.notifyStatus('info', 'Save coordination enabled');
    } else if (!enabled && this.isEnabled) {
      this.isEnabled = false;
      
      // Clear pending timer
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      
      vlog('[SaveCoordinator] Disabled');
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
    const { nodes, graphs } = userDataCounts(state);
    return { nodes, graphs };
  }

  /**
   * Decide what the shrinkage baseline becomes after a load.
   *
   * Normally the loaded state IS the baseline. The exception is a load that
   * arrives EMPTY for a universe we already have a substantial baseline for:
   * on 2026-09-12 a bad read produced an empty universe, this method's
   * predecessor adopted `{nodes: 0}` as the baseline, and with the floor
   * lowered to zero `_isCatastrophicShrinkage` could never fire again — the
   * real file was overwritten 16 seconds later.
   *
   * Lowering a baseline to zero is never protective, so we keep the higher
   * one and let the shrinkage guard stay armed. A genuinely cleared universe
   * is still saveable through `forceSave`, which re-baselines deliberately.
   *
   * Only applies within the SAME universe — switching universes legitimately
   * resets the baseline (`cancelPendingSaves` zeroes it, `_restoreGuardState`
   * reloads per slug).
   *
   * @private
   */
  _adoptBaseline(counts, state, reason) {
    const prior = this.dataBaseline || { nodes: 0, graphs: 0 };
    const incomingSlug = state?._universeSlug || null;
    const sameUniverse = !incomingSlug || !this.activeUniverseSlugForGuard
      || incomingSlug === this.activeUniverseSlugForGuard;

    if (sameUniverse && counts.nodes === 0 && (prior.nodes || 0) >= 5) {
      console.warn(
        `[SaveCoordinator] ${reason}: state has no user things but the existing baseline was`,
        prior,
        '— keeping the higher baseline so the shrinkage guard stays armed. A universe emptied completely cannot be saved at all (the destination guards refuse it); leaving one thing in place and pressing Save Now does work.'
      );
      return {
        nodes: Math.max(prior.nodes || 0, counts.nodes),
        graphs: Math.max(prior.graphs || 0, counts.graphs)
      };
    }
    return counts;
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
    if (this._cameraWaitTimer) { clearTimeout(this._cameraWaitTimer); this._cameraWaitTimer = null; }
    if (this.navigationTimer) { clearTimeout(this.navigationTimer); this.navigationTimer = null; }
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
    this.awaitingWorker = false;
    this.retryAttempt = 0;
    this.lastBlockReason = null;
    this._settleManualSave(false);
    // Reset the data-loss guard. The new universe's load needs to happen
    // before saves are allowed again.
    this.hasLoadedFromFile = false;
    this._loggedLoadGuard = false;
    this.dataBaseline = { nodes: 0, graphs: 0 };
  }

  /**
   * Whether this universe saves on its own (autoSaveMode.js): the setting,
   * and for Automatic, the universe's size (Things plus webs, and the bytes
   * of the file the worker last built).
   *
   * @param {Object} [state] - defaults to the newest state the coordinator has
   * @returns {boolean}
   */
  autoSaveActive(state = this.nextStateToProcess || this.lastState) {
    return autoSaves(getAutoSaveMode(), { items: universeItemCount(state), bytes: this.lastFileBytes });
  }

  /**
   * Save now, because the user asked (the indicator's Save, Save Now in the
   * Universes panel, Cmd+S, "Save" when closing). Works the same whether
   * autosave is on or off.
   *
   * It goes the way an autosave goes, through every guard: the newest state
   * goes to the worker first if it hasn't yet, so the file written is the
   * worker's bytes for exactly that state and nothing is rebuilt on the main
   * thread, and then the write runs without waiting out the debounce.
   *
   * @param {Object} [options]
   * @param {boolean} [options.terminal=false] - the app is closing: commit to
   *   Git now as well (no later commit loop will run)
   * @returns {Promise<boolean>} whether the changes are now saved (true when
   *   there was nothing to save)
   */
  async saveNow({ terminal = false } = {}) {
    if (!this.isEnabled || this.swapInProgress || this.loadInFlight > 0 || !this.hasLoadedFromFile) {
      return false;
    }
    const done = new Promise((resolve) => this._manualSaveWaiters.push(resolve));
    if (!this.manualSaveRequested) {
      this.manualSaveRequested = true;
      this.notifyStatus('info', 'Saving...');
      // A held web switch is part of what's saved now.
      if (this.navigationTimer) { clearTimeout(this.navigationTimer); this.navigationTimer = null; }
      this._continueManualSave();
    }
    const saved = await done;
    if (saved && terminal && this.gitSyncEngine?.isHealthy?.() && typeof this.gitSyncEngine.forceCommit === 'function') {
      try {
        await this.gitSyncEngine.forceCommit(this.lastState);
      } catch (gitError) {
        console.warn('[SaveCoordinator] saveNow: Git commit on close failed:', gitError);
      }
    }
    return saved;
  }

  /**
   * The next step of a saveNow(): get the newest state through the worker,
   * then write it. Called again when the worker replies, and while another
   * write finishes.
   * @private
   */
  _continueManualSave() {
    if (!this.manualSaveRequested) return;
    // Its reply calls back here.
    if (this.workerProcessing) return;
    // Another write is landing (an autosave, a flush); then this one.
    if (this.isSaving) {
      setTimeout(() => this._continueManualSave(), 100);
      return;
    }
    // The newest state hasn't been through the worker (its 500ms wait, a
    // drag, a pan, a held web switch): send it now. The reply, or the
    // main-thread path when there is no worker, calls back here.
    if (this.nextStateToProcess && this.nextStateToProcess !== this.lastState) {
      if (this.workerTimer) { clearTimeout(this.workerTimer); this.workerTimer = null; }
      this.sendToWorker();
      return;
    }
    if (this.isDirty || this.pendingHash !== null) {
      if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      this.isGlobalDragging = false;
      this.executeSave();
      return;
    }
    // Nothing differs from the last save.
    this.awaitingWorker = false;
    this._settleManualSave(true);
  }

  /**
   * A saveNow() is over: tell whoever is waiting whether it landed.
   * @private
   */
  _settleManualSave(saved) {
    if (!this.manualSaveRequested && this._manualSaveWaiters.length === 0) return;
    this.manualSaveRequested = false;
    const waiters = this._manualSaveWaiters;
    this._manualSaveWaiters = [];
    for (const resolve of waiters) resolve(saved);
    this.notifyStatus(saved ? 'success' : 'warning', saved ? 'Saved' : 'Save did not finish');
  }

  /**
   * Returns `true` if there are changes not yet written to disk.
   *
   * @returns {boolean} `true` when `isDirty`, a pending hash is queued, or a
   *   change is waiting to be hashed.
   */
  hasUnsavedChanges() {
    // A move or web switch waiting out its delay doesn't count: the indicator
    // doesn't say "Saving..." for it, and closing or hiding the app writes it.
    return this.isDirty || (this.pendingHash !== null) || this.awaitingWorker;
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
    const previous = this.gitSyncEngine;
    this.gitSyncEngine = gitSyncEngine;
    if (gitAutosavePolicy) {
      gitAutosavePolicy.gitSyncEngine = gitSyncEngine;
      // A commit timer armed for the OUTGOING engine must not fire against the
      // incoming one (or against nothing at all, when Git is being unlinked).
      if (previous !== gitSyncEngine) {
        gitAutosavePolicy.clearPending();
      }
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
    vlog('[SaveCoordinator] Destroyed');
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
      vlog('[SaveCoordinator HMR] Restored guard state across hot reload', {
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
