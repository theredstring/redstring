/**
 * Git Sync Engine - Implements the Git-Native Protocol's rapid synchronization pattern
 * Real-time local state + background persistence with 5-second auto-commits
 */

import { exportToRedstring } from '../formats/redstringFormat.js';
import { computeImageRef, isDataUrl, refToBlobPath } from '../formats/imageRefs.js';
import { countUserPrototypes, isRecognizedShape, isEffectivelyEmpty } from '../formats/userDataCounts.js';
import { checkDestinationBeforeEmptyWrite, isConfirmedNotFound } from './emptyWriteGuard.js';
import { registerBlobSource, primeImageRef } from './imageBlobStore.js';
import { vlog } from '../utils/verboseLog.js';
import { msSinceActive, msSinceCameraMoved } from './cameraActivity.js';
import { generateDocumentHash, generateHash } from './saveHash.js';
import { serializeRedstring } from '../formats/universeBytes.js';
import { describeChanges, rebaseSummary } from '../formats/changeSummary.js';
import { GIT_READ_CAP_DESKTOP_BYTES } from './gitNativeProvider.js';

// GitHub's reads trail its writes by a few seconds. A version this device
// moved past less than this long ago, read back, is a stale read.
const STALE_READ_WINDOW_MS = 2 * 60 * 1000;
// How long to wait between reads when the host refused a save but a read still
// shows the old version (7.5 s in all, then the save is retried later).
const STALE_READ_RETRY_MS = [500, 1000, 2000, 4000];

// An autosave commit waits until the person has been idle this long (no
// change, the camera still): building and sending the file runs on the main
// thread, and on a big universe it ran under the next pan or edit. The local
// file is written first, on its own shorter wait (SaveCoordinator QUIET_MS).
const GIT_IDLE_MS = 3000;
// However busy they stay, a change waits no longer than this; then only a
// moving camera holds the commit, for GIT_CAMERA_STILL_MS.
const GIT_MAX_IDLE_WAIT_MS = 30000;
const GIT_CAMERA_STILL_MS = 300;

/**
 * The largest universe file Git sync writes: the most any device will read
 * back (gitNativeProvider's read cap). Writing more would leave a remote that
 * nothing can open.
 */
export const GIT_WRITE_CAP_BYTES = GIT_READ_CAP_DESKTOP_BYTES;

// Source of truth modes
const SOURCE_OF_TRUTH = {
  LOCAL: 'local',    // Redstring file is authoritative
  GIT: 'git'         // Git repository is authoritative (default)
};

/**
 * Canonical remote file base name. The SINGLE place this sanitization lives —
 * every reader and writer of `universes/<folder>/<base>.redstring` must agree
 * on the name, or a universe with spaces/special chars in its filename forks
 * into two remote files (engine writes the sanitized name while direct reads
 * look at the raw one, and neither sees the other's data).
 */
export const sanitizeGitFileBaseName = (name) => (name || 'universe')
  .replace(/\.redstring$/i, '')
  .replace(/[^a-zA-Z0-9-_]/g, '-') // Replace spaces and special chars with hyphens
  .replace(/-+/g, '-') // Collapse multiple hyphens
  .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

class GitSyncEngine {
  constructor(provider, sourceOfTruth = SOURCE_OF_TRUTH.GIT, universeSlug = 'default', fileBaseName = 'universe', universeFolder = null) {
    this.provider = provider;
    this.sourceOfTruth = sourceOfTruth; // Configurable source of truth
    this.universeSlug = (universeSlug || 'default').trim() || 'default';
    // Universe folder in the repo (e.g., "default") - defaults to slug if not provided
    this.universeFolder = universeFolder || this.universeSlug;
    // Canonical sanitized base name (see sanitizeGitFileBaseName)
    this.fileBaseName = sanitizeGitFileBaseName(fileBaseName);
    this.localState = new Map(); // Instant updates
    this.pendingCommits = []; // Queue of pending changes
    // Optimized auto-save settings based on authentication method
    this.isGitHubApp = provider.authMethod === 'github-app';
    // Aggressive timing: GitHub App = 3s, OAuth = 5s
    // GitHub App limit: 5000 req/hr (83/min) - 3s = 20/min ✓
    // OAuth limit: 5000 req/hr (83/min) - 5s = 12/min ✓
    this.commitInterval = this.isGitHubApp ? 3000 : 5000;
    this.autoSaveEnabled = this.isGitHubApp; // Enable optimized auto-save for GitHub App

    this.isRunning = false;
    this.lastCommitTime = 0; // rate limiting; a failed write backdates it
    // When this device's changes last reached the repository (any write: an
    // autosave, a merge, a resolution). What "Last saved" shows.
    this.lastSavedAt = 0;
    this.onSaved = null; // set by universeBackend: (timestamp) => void
    this.commitLoop = null;
    this.lastCommittedHash = null; // Hash of last committed state
    // Node count of the last successful commit. Used as the floor for the
    // empty-state guard in updateState: if the repo demonstrably had nodes,
    // we refuse to enqueue a commit that would shrink it back to zero — that
    // pattern was wiping repos when a transient empty store change raced
    // the autosave dispatch during source-of-truth swaps and page-load handoffs.
    this.lastCommittedNodeCount = 0;
    this.hasChanges = false; // Track if there are actual changes
    this.isCommitInProgress = false; // Prevent overlapping commits
    this.isPaused = false; // Allow external pausing of operations
    // Set when a commit was refused for size: { bytes, items } of that
    // universe, so later changes can be estimated without building the file.
    this.tooLargeToSync = null;
    // The repository is holding an older copy than this device: called with
    // { bytes } when a commit is refused for size, and with null once a commit
    // lands again. The backend remembers it, so the next load doesn't take the
    // repository's older copy over this device's.
    this.onSyncHeld = null;
    // Called with each state this engine won't send because it's too large,
    // so a universe kept only in the repository can keep it somewhere.
    this.onHeldState = null;

    // Rate limiting and debouncing - aggressive but safe for GitHub API
    this.minCommitInterval = this.isGitHubApp ? 2000 : 3000; // Min 2-3s between commits
    this.debounceTimeout = null; // For debouncing rapid updates
    this.debounceDelay = 1000; // 1 second debounce for continuous operations (faster response)
    this.changesSince = 0; // When the oldest change not yet committed arrived; see GIT_MAX_IDLE_WAIT_MS
    this.isDragging = false; // Track if we're in a dragging operation
    this.dragStartTime = 0; // Track when dragging started

    // Error handling and recovery
    this.consecutiveErrors = 0; // Track consecutive failures
    this.maxConsecutiveErrors = 3; // Stop after 3 consecutive failures
    this.errorBackoffDelay = 10000; // 10 second backoff after max errors
    this.lastErrorTime = 0; // Track when last error occurred
    this.isInErrorBackoff = false; // Track if we're in error backoff mode
    this.persistentFailures = new Map(); // Track specific failure types

    // Circuit breaker for API spam protection
    this.circuitBreakerOpen = false; // Track if circuit breaker is open
    this.circuitBreakerOpenTime = 0; // When the circuit breaker was opened
    this.circuitBreakerTimeout = 60000; // Keep circuit breaker open for 60 seconds
    this.recentApiCalls = []; // Track recent API calls for rate limiting

    // Optional UI status handler
    this.statusHandler = null;

    // Optimistic concurrency state.
    // `undefined` = we've never observed the remote — the first write runs
    //               _firstContactCheck (read-before-write, never blind);
    // `null`      = remote confirmed absent (create);
    // string      = SHA from our last successful read or write.
    // Every push asserts this SHA — a mismatch means another device moved
    // the remote, and we pull-and-compare instead of overwriting their work.
    this.lastKnownRemoteSha = undefined;

    // Set by universeBackend: async ({ remoteData, universeSlug }) =>
    // 'overwrite' | 'conflict'. Called when a push discovers the remote
    // changed under us. 'overwrite' = contents are equivalent/safe, retry the
    // push; 'conflict' = real divergence, block pushes until resolved.
    this.onRemoteDivergence = null;

    // True while a remote divergence awaits user resolution. Blocks the
    // autosave queue (updateState/processPendingCommits) AND forceCommit —
    // only a forceCommit carrying `isConflictResolution: true` (the explicit
    // resolution save) may push, and it clears the flag on success. Without
    // the forceCommit block, GitAutosavePolicy's retry loop would re-push
    // with the now-known SHA and overwrite the very data the user is being
    // asked to adjudicate.
    this.remoteConflictPending = false;

    // Latched when the remote file exists but cannot be read as a universe
    // (unparseable, or an API envelope served by a cache). Informational —
    // the real protection is that `lastKnownRemoteSha` stays undefined, so
    // first contact re-reads and re-refuses on every write attempt. Cleared
    // by any clean read.
    this.remoteUnrecognized = false;

    // Shared-universe merge (documentation/core-system/SHARED_UNIVERSE_SYNC.md).
    //
    // `syncBaseSha` is the remote version the store on the canvas grew from:
    // the merge base. It is NOT lastKnownRemoteSha. That one only says what a
    // read saw, and reads set it even when what they read is never applied (a
    // conflict dialog, a discarded background load). The base moves only when
    // the store is known to hold that version: this device wrote it, a read of
    // it was applied, or the store was loaded from a local copy whose record
    // names it (adoptBase). Never from storage alone — a base the store does
    // not descend from makes a merge read whatever the store lacks as deleted.
    this.syncBaseSha = null;
    // Every store state SaveCoordinator hands on is stamped (stampState) with
    // the base it grew from and the count of remote applies so far. A state
    // stamped before an apply is stale — it lacks what the apply brought in —
    // so it is never committed (the apply's own save carries its edits), and
    // a local copy saved from it records the base it really grew from.
    this._remoteGeneration = 0;
    this._stamps = new WeakMap(); // storeState → { gen, base }
    // Versions this device moved past, and when (see _isRecentlySuperseded).
    this._supersededAt = new Map();
    // Waits between reads while the host still shows a refused version (tests shorten them).
    this.staleReadRetryMs = STALE_READ_RETRY_MS;
    // Wait before retrying a save that failed on the network, times the attempt (tests shorten it).
    this.networkRetryMs = 1000;
    // Set by universeBackend: async ({ baseText, localJson, applyBaseJson,
    // remoteData, remoteText, remoteSha }) => null | { content,
    // apply: async () => ({ state, before })|null } — `state` is the store
    // after applying, `before` the store just before. null = can't merge safely
    // here; the old pull-and-compare flow (and its dialog) takes over.
    this.onMergeRemote = null;
    // Set by universeBackend: async ({ baseText, remoteData, remoteText,
    // remoteSha }) => ({ state, before })|null. Brings someone else's saved changes
    // onto the canvas when this device has nothing waiting to push.
    this.onRemoteUpdate = null;
    // The remote version a conflict dialog was shown against. A resolution
    // save asserts it, and merges onto anything newer that landed meanwhile.
    this._conflictRemoteSha = null;
    // The store state the repository's latest version holds, for the line
    // each commit carries about what it changed (describeChanges): History's
    // Git list shows it beside the account that saved. null = unknown, and
    // the commit goes out with the host's plain message.
    this._summaryBase = null;
    // Said once, by the next commit, instead of what it changed (a restore).
    this.nextCommitMessage = null;
    // The store state a commit in flight is sending (see _adoptAppliedState).
    this._committingState = null;

    // Restore the persisted commit floor for this universe slug. Without this,
    // a fresh engine after page refresh has lastCommittedNodeCount=0 — meaning
    // the empty-state guard in updateState is disarmed for the first save,
    // and an autosave racing the load can wipe the repo before the engine
    // has had a chance to record its real floor from a successful commit.
    this._restorePersistedFloor();

    vlog('[GitSyncEngine] Initialized with provider:', provider.name);
    vlog('[GitSyncEngine] Authentication method:', this.isGitHubApp ? 'GitHub App' : 'OAuth');
    vlog('[GitSyncEngine] Auto-save optimized:', this.autoSaveEnabled);
    vlog('[GitSyncEngine] Commit interval:', this.commitInterval + 'ms');
    vlog('[GitSyncEngine] Source of truth:', this.sourceOfTruth);
    vlog('[GitSyncEngine] Universe slug:', this.universeSlug);
    vlog('[GitSyncEngine] Sanitized file base name:', this.fileBaseName);
    vlog('[GitSyncEngine] Restored commit floor:', this.lastCommittedNodeCount);
  }

  _getFloorStorageKey() {
    return `redstring-gitengine-floor:${this.universeSlug}`;
  }

  _persistFloor() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const payload = {
        lastCommittedNodeCount: this.lastCommittedNodeCount,
        lastCommittedHash: this.lastCommittedHash,
        ts: Date.now()
      };
      window.localStorage.setItem(this._getFloorStorageKey(), JSON.stringify(payload));
    } catch (_) { /* non-fatal */ }
  }

  _restorePersistedFloor() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem(this._getFloorStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.lastCommittedNodeCount === 'number') {
        this.lastCommittedNodeCount = parsed.lastCommittedNodeCount;
      }
    } catch (_) { /* non-fatal */ }
  }

  /** Record that the store now holds remote version `sha`. See syncBaseSha. */
  _setSyncBase(sha) {
    if (typeof sha !== 'string' || !sha) return;
    if (this.syncBaseSha && this.syncBaseSha !== sha) this._markSuperseded(this.syncBaseSha);
    this.syncBaseSha = sha;
  }

  /** A version the current one already contains (an old base, or one merged with). */
  _markSuperseded(sha) {
    if (typeof sha !== 'string' || !sha) return;
    this._supersededAt.set(sha, Date.now());
    if (this._supersededAt.size > 50) this._supersededAt.delete(this._supersededAt.keys().next().value);
  }

  /**
   * Is `sha` a version this device moved past moments ago? Then a read showing
   * it is stale: GitHub's reads trail its writes for a few seconds, and taking
   * a stale read for someone else's save would undo this device's own work on
   * the canvas. Saved files carry their save time, so a real save never
   * repeats an old version's bytes; past the window, a matching SHA is
   * believed (a file put back by hand).
   */
  _isRecentlySuperseded(sha) {
    const at = this._supersededAt.get(sha);
    return !!at && Date.now() - at < STALE_READ_WINDOW_MS;
  }

  /**
   * Read the file after the host refused a write that asserted `refusedSha`.
   * The host has a newer version than that, so a read still showing it (or
   * any version this device moved past, or no file at all) is stale: wait and
   * read again. Throws REMOTE_READ_STALE if it stays stale; the save is kept
   * and retried like any failed save.
   */
  async _readRemoteAfterRefusal(path, refusedSha) {
    for (let attempt = 0; ; attempt++) {
      let remote = null;
      try {
        remote = await this.provider.readFileRawWithMeta(path);
      } catch (error) {
        // A file we asserted a version of can't have vanished this quickly.
        if (error?.code !== 'FILE_NOT_FOUND' || typeof refusedSha !== 'string') throw error;
      }
      const stale = !remote || remote.sha === refusedSha || this._isRecentlySuperseded(remote.sha);
      if (!stale) return remote;
      if (attempt >= this.staleReadRetryMs.length) {
        const error = new Error('The repository refused the save but still shows an older version. Trying again shortly.');
        error.code = 'REMOTE_READ_STALE';
        throw error;
      }
      console.warn(`[GitSyncEngine] The repository still shows an older version of ${path} — reading again`);
      await new Promise((resolve) => setTimeout(resolve, this.staleReadRetryMs[attempt]));
    }
  }

  /**
   * The store was just loaded from this device's own copy, whose record says
   * it grew from `sha` (null: the record is missing or doesn't match, so the
   * lineage is unknown and no merge may assume one).
   */
  adoptBase(sha) {
    this.syncBaseSha = typeof sha === 'string' && sha ? sha : null;
    this._summaryBase = null;
  }

  /** The line this commit carries about what it changed, or undefined for the host's plain one. */
  _commitMessageFor(storeState) {
    if (this.nextCommitMessage) return this.nextCommitMessage;
    try {
      return (this._summaryBase && describeChanges(this._summaryBase, storeState)) || undefined;
    } catch (error) {
      console.warn('[GitSyncEngine] Could not describe this commit:', error?.message || error);
      return undefined;
    }
  }

  /** A commit of `storeState` landed: the next one is described from here. */
  _noteCommitted(storeState, writeResult) {
    this.nextCommitMessage = null;
    // A merge already set it from the state it brought onto the canvas.
    if (!writeResult?.merged) this._summaryBase = storeState;
  }

  /** SaveCoordinator saw this store state: remember what it grew from. */
  stampState(storeState) {
    if (!storeState || typeof storeState !== 'object') return;
    if (!this._stamps.has(storeState)) {
      this._stamps.set(storeState, { gen: this._remoteGeneration, base: this.syncBaseSha });
    }
  }

  /** Was this state captured before a remote apply (so it lacks what that apply brought in)? */
  _isStale(storeState) {
    const stamp = storeState && typeof storeState === 'object' ? this._stamps.get(storeState) : null;
    return !!stamp && stamp.gen < this._remoteGeneration;
  }

  /**
   * The remote version a store state grew from, for the record kept beside a
   * local copy saved from it. null when unknown: a state never stamped, or
   * one that grew from no known version.
   */
  baseForState(storeState) {
    const stamp = storeState && typeof storeState === 'object' ? this._stamps.get(storeState) : null;
    return stamp?.base || null;
  }

  /** A write of OUR content landed: the remote is at `sha` and the store descends from it. */
  _noteOwnWrite(result) {
    const sha = result?.content?.sha;
    if (typeof sha === 'string' && sha) {
      this.lastKnownRemoteSha = sha;
      this._setSyncBase(sha);
    }
    this._noteSaved();
  }

  /**
   * A commit landed: drop the queued states it covers (`through` and
   * everything queued before it, and any with the same content), keep the
   * ones queued while it was in flight. Clearing the whole queue lost an edit
   * made during a commit: it never went out until the next edit.
   */
  _clearCommitted(through, committedHash) {
    const at = through ? this.pendingCommits.indexOf(through) : -1;
    const newer = at >= 0 ? this.pendingCommits.slice(at + 1) : (through ? this.pendingCommits.filter((c) => c.timestamp > through.timestamp) : this.pendingCommits);
    this.pendingCommits = newer.filter((c) => c.hash !== committedHash);
    this.hasChanges = this.pendingCommits.length > 0;
  }

  /** This device's changes reached the repository (what "Last saved" shows). */
  _noteSaved() {
    this.lastSavedAt = Date.now();
    try { this.onSaved?.(this.lastSavedAt); } catch (_) { /* display only */ }
  }

  /** Remote changes reached the canvas: every state captured before now is stale. */
  _noteRemoteApplied() {
    this._remoteGeneration++;
  }

  // Allow UI to subscribe to status updates
  onStatusChange(handler) {
    this.statusHandler = typeof handler === 'function' ? handler : null;
  }

  notifyStatus(type, status) {
    try {
      if (this.statusHandler) {
        // Rate limit error notifications to prevent spam
        if (type === 'error') {
          const now = Date.now();
          const timeSinceLastError = now - (this.lastErrorNotification || 0);

          // Only show error notifications every 5 seconds max
          if (timeSinceLastError < 5000) {
            return; // Skip this error notification
          }

          this.lastErrorNotification = now;
        }

        this.statusHandler({ type, status });
      }
    } catch (_) { }
  }

  getLatestPath() {
    return `universes/${this.universeFolder}/${this.fileBaseName}.redstring`;
  }

  /**
   * Move full-resolution image bytes out of the JSON and into content-addressed
   * blobs beside it, leaving a `redstring:imageRef` on each prototype.
   *
   * WHY THIS IS HERE AND NOT IN THE FORMAT LAYER
   * --------------------------------------------
   * A `.redstring` on local disk holding a base64 photograph is merely large.
   * The same file over git is broken: this engine writes ONE file, so every
   * autosave re-uploads every image and git stores a fresh multi-megabyte blob
   * per commit. The problem is git-shaped, so the fix is git-shaped — local
   * single-file saves keep their images inline and need no directory handle.
   *
   * It also operates on the EXPORTED JSON, never on the store. The in-memory
   * prototype keeps its data URL, so the panel keeps rendering instantly for
   * the rest of the session, undo history stays clean, and nothing has to be
   * fetched back from a remote the user may not have pushed to yet.
   *
   * Properties worth preserving if this is ever touched:
   *   - Idempotent. The address IS the content hash, so re-running produces the
   *     same paths; an already-uploaded blob is skipped.
   *   - Resumable. Per-prototype. A failure leaves THAT image inline and valid,
   *     and the next commit retries it. A universe may sit half-migrated
   *     indefinitely with no ill effect, because both forms are readable.
   *   - Lossless on failure. Every bail-out path keeps the inline image. The
   *     inline copy is only cleared after the blob write has resolved.
   *
   * @param {Object} redstringData - freshly exported document (mutated in place;
   *   it is a throwaway built for this commit)
   * @returns {Promise<Object>} the same document, with images externalized
   * @private
   */
  async _externalizeImages(redstringData) {
    const prototypes = redstringData?.prototypeSpace?.prototypes;
    if (!prototypes || typeof prototypes !== 'object') return redstringData;
    if (typeof this.provider?.writeFileRaw !== 'function') return redstringData;

    // Refs this engine has already written in this session. Saves a probe per
    // image per commit, which is the difference between one API call on the
    // commit that introduces an image and one on every commit thereafter.
    if (!this._uploadedRefs) this._uploadedRefs = new Set();
    // The store keeps its inline data URL for the whole session (we transform
    // the exported copy, never the store), so without a memo every autosave
    // would re-hash every image — megabytes of SHA-256 every few seconds just
    // to rediscover an address we already know. Keys are strings the store
    // already retains; values are only { ref, ext }. Keeping computeImageRef's
    // decoded bytes here as well pinned every photo twice more (about 2.3x its
    // file size) for the rest of the session.
    if (!this._refByDataUrl) this._refByDataUrl = new Map();
    const current = new Set();

    let externalized = 0;
    let failed = 0;

    for (const proto of Object.values(prototypes)) {
      if (!proto || typeof proto !== 'object') continue;

      const visual = proto['redstring:visualProperties'];
      const inline = visual?.['redstring:imageSrc'];

      // An inline data URL is always the truth, even when a ref is also present.
      // Replacing a node's image leaves the OLD ref on the prototype alongside
      // the NEW base64, so skipping on "has a ref" would both refuse to
      // externalize the new image and keep publishing a ref to the old one.
      // Deciding it here rather than trusting every upload site to clear the
      // ref keeps the invariant in one place.
      if (!isDataUrl(inline)) continue;
      current.add(inline);

      try {
        const memo = this._refByDataUrl.get(inline);
        const computed = memo || await computeImageRef(inline);
        // No WebCrypto (non-secure context) or unparseable base64: keep it
        // inline. Wasteful, but the user's photograph survives, which is the
        // only acceptable outcome.
        if (!computed) continue;
        if (!memo) {
          this._refByDataUrl.set(inline, { ref: computed.ref, ext: computed.ext });
          // Bound the memo. Insertion-ordered, so the oldest entry goes first —
          // a user who replaces one node's image repeatedly can't grow this
          // without limit.
          if (this._refByDataUrl.size > 64) {
            this._refByDataUrl.delete(this._refByDataUrl.keys().next().value);
          }
        }

        const { ref, ext } = computed;
        const path = refToBlobPath(ref, this.universeFolder, ext);

        if (!this._uploadedRefs.has(ref)) {
          // Blobs are immutable, so an existing one at this path already holds
          // exactly these bytes — skip the upload rather than rewriting it.
          let exists = false;
          try {
            exists = !!(await this.provider.readBinaryFile(path));
          } catch (_) {
            exists = false;
          }
          if (!exists) {
            // A memo hit carries no bytes; decode them again only to upload.
            const bytes = computed.bytes || (await computeImageRef(inline))?.bytes;
            if (!bytes) throw new Error('image bytes unavailable');
            await this.provider.writeFileRaw(path, bytes);
          }
          this._uploadedRefs.add(ref);
        }

        // Only now is it safe to drop the inline copy.
        proto['redstring:imageRef'] = ref;
        proto['redstring:imageRefExt'] = ext;
        visual['redstring:imageSrc'] = null;

        // The bytes are already in hand — seed the read cache so viewing this
        // image in the panel this session does not round-trip the remote.
        primeImageRef(ref, inline);
        externalized++;
      } catch (err) {
        // Leave this prototype fully inline and carry on. The commit still
        // succeeds with a valid (larger) file, and the next one retries.
        failed++;
        console.warn('[GitSyncEngine] Image externalization failed, keeping inline:', err?.message || err);
      }
    }

    // A replaced or deleted image's data URL would otherwise stay pinned as a
    // memo key until 64 newer images pushed it out.
    for (const key of this._refByDataUrl.keys()) {
      if (!current.has(key)) this._refByDataUrl.delete(key);
    }

    if (externalized > 0) {
      vlog(`[GitSyncEngine] Externalized ${externalized} image(s) to content-addressed blobs`);
    }
    if (failed > 0) {
      console.warn(`[GitSyncEngine] ${failed} image(s) stayed inline this commit; will retry next commit`);
    }

    return redstringData;
  }

  /**
   * Build the JSON payload for a commit: export, then externalize images.
   * The single place both commit paths agree on what gets written.
   * @private
   */
  async _buildCommitPayload(storeState) {
    const redstringData = await this._externalizeImages(exportToRedstring(storeState));
    // Built a piece at a time (formats/universeBytes.js); the same bytes the
    // local file gets, compact when the universe is large.
    const bytes = serializeRedstring(redstringData);
    if (bytes.length > GIT_WRITE_CAP_BYTES) {
      this.tooLargeToSync = { bytes: bytes.length, items: this._itemsOf(storeState) };
      this._report(this.onSyncHeld, { bytes: bytes.length, limit: GIT_WRITE_CAP_BYTES });
      throw this._tooLargeError(bytes.length);
    }
    this.tooLargeToSync = null;
    // Under the cap, so safe to hold as text for the provider.
    return new TextDecoder().decode(bytes);
  }

  /** Call a listener the backend set, never letting it break a commit. */
  _report(listener, value) {
    try { listener?.(value); } catch (error) { console.warn('[GitSyncEngine] Listener failed:', error); }
  }

  /** Things plus webs: what a universe file's size follows. */
  _itemsOf(storeState) {
    return (storeState?.nodePrototypes?.size || 0) + (storeState?.graphs?.size || 0);
  }

  /**
   * Whether this state is still too large to sync, judged from the last
   * refused commit's bytes per Thing or web, without building the file:
   * building it means exporting and serializing the whole universe on the
   * main thread, seconds for a universe this size, on every change.
   */
  _stillTooLarge(storeState) {
    if (!this.tooLargeToSync) return false;
    const { bytes, items } = this.tooLargeToSync;
    if (!items) return false;
    return this._itemsOf(storeState) * (bytes / items) > GIT_WRITE_CAP_BYTES;
  }

  _tooLargeError(bytes) {
    const mb = (n) => Math.round(n / (1024 * 1024));
    const error = new Error(`This universe is ${mb(bytes)} MB, over the ${mb(GIT_WRITE_CAP_BYTES)} MB Git sync can carry. It is saved on this device; Git sync resumes when it is smaller.`);
    error.code = 'FILE_TOO_LARGE';
    error.size = bytes;
    error.limit = GIT_WRITE_CAP_BYTES;
    return error;
  }

  // Backup paths removed for rate limit efficiency
  // getBackupPath() {
  //   const ts = new Date();
  //   const pad = (n) => String(n).padStart(2, '0');
  //   const stamp = `${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  //   return `universes/${this.universeSlug}/backups/${this.fileBaseName}-${stamp}.redstring`;
  // }

  /**
   * Set the source of truth mode
   * @param {string} mode - 'local' or 'git'
   */
  setSourceOfTruth(mode) {
    if (mode !== SOURCE_OF_TRUTH.LOCAL && mode !== SOURCE_OF_TRUTH.GIT) {
      throw new Error(`Invalid source of truth mode: ${mode}. Must be 'local' or 'git'`);
    }

    const oldMode = this.sourceOfTruth;
    this.sourceOfTruth = mode;

    vlog(`[GitSyncEngine] Source of truth changed from '${oldMode}' to '${mode}'`);

    if (mode === SOURCE_OF_TRUTH.GIT) {
      vlog('[GitSyncEngine] Git mode enabled - Git repository is source of truth');
    }
  }

  /**
   * Get current source of truth mode
   */
  getSourceOfTruth() {
    return this.sourceOfTruth;
  }

  /**
   * Merge Git data with existing local content
   * Behavior depends on source of truth setting
   */
  mergeWithLocalContent(gitData, localState) {
    vlog(`[GitSyncEngine] Evaluating Git data against local Redstring content (source: ${this.sourceOfTruth})...`);

    // Debug: log the actual gitData structure
    vlog('[GitSyncEngine] DEBUG: gitData structure:', gitData ? {
      // Top level keys
      topLevelKeys: Object.keys(gitData),

      // New format (v2.0.0-semantic)
      hasPrototypeSpace: !!gitData.prototypeSpace,
      prototypeSpaceKeys: gitData.prototypeSpace ? Object.keys(gitData.prototypeSpace) : null,
      prototypesCount: gitData.prototypeSpace?.prototypes ? Object.keys(gitData.prototypeSpace.prototypes).length : 0,

      hasSpatialGraphs: !!gitData.spatialGraphs,
      spatialGraphsKeys: gitData.spatialGraphs ? Object.keys(gitData.spatialGraphs) : null,
      spatialGraphsCount: gitData.spatialGraphs?.graphs ? Object.keys(gitData.spatialGraphs.graphs).length : 0,

      hasRelationships: !!gitData.relationships,
      relationshipsKeys: gitData.relationships ? Object.keys(gitData.relationships) : null,
      relationshipsCount: gitData.relationships?.edges ? Object.keys(gitData.relationships.edges).length : 0,

      // Legacy format
      hasLegacy: !!gitData.legacy,
      legacyKeys: gitData.legacy ? Object.keys(gitData.legacy) : null,

      // Old legacy format
      hasGraphs: !!gitData.graphs,
      graphsKeys: gitData.graphs ? Object.keys(gitData.graphs) : null,
      hasNodePrototypes: !!gitData.nodePrototypes,
      nodePrototypesKeys: gitData.nodePrototypes ? Object.keys(gitData.nodePrototypes) : null,
      hasEdges: !!gitData.edges,
      edgesKeys: gitData.edges ? Object.keys(gitData.edges) : null
    } : 'null');

    // Check for content in any of the supported Redstring formats
    const gitHasContent = gitData && (
      // New format (v2.0.0-semantic): prototypeSpace, spatialGraphs, relationships
      (gitData.prototypeSpace && gitData.prototypeSpace.prototypes && Object.keys(gitData.prototypeSpace.prototypes).length > 0) ||
      (gitData.spatialGraphs && gitData.spatialGraphs.graphs && Object.keys(gitData.spatialGraphs.graphs).length > 0) ||
      (gitData.relationships && gitData.relationships.edges && Object.keys(gitData.relationships.edges).length > 0) ||

      // Legacy format with legacy section
      (gitData.legacy && gitData.legacy.graphs && Object.keys(gitData.legacy.graphs).length > 0) ||
      (gitData.legacy && gitData.legacy.nodePrototypes && Object.keys(gitData.legacy.nodePrototypes).length > 0) ||
      (gitData.legacy && gitData.legacy.edges && Object.keys(gitData.legacy.edges).length > 0) ||

      // Old legacy format (v1.0.0): direct properties
      (gitData.graphs && Object.keys(gitData.graphs).length > 0) ||
      (gitData.nodePrototypes && Object.keys(gitData.nodePrototypes).length > 0) ||
      (gitData.edges && Object.keys(gitData.edges).length > 0)
    );

    vlog('[GitSyncEngine] DEBUG: gitHasContent =', gitHasContent);

    const localHasContent = localState && (
      localState.graphs.size > 0 ||
      localState.nodePrototypes.size > 0 ||
      localState.edges.size > 0
    );

    // LOCAL MODE: Redstring file is source of truth (default, safe)
    if (this.sourceOfTruth === SOURCE_OF_TRUTH.LOCAL) {
      if (!gitHasContent && localHasContent) {
        vlog('[GitSyncEngine] LOCAL MODE: Git has no content, preserving local Redstring content');
        return null; // Keep local content, sync to Git
      }

      if (gitHasContent && !localHasContent) {
        vlog('[GitSyncEngine] LOCAL MODE: Local has no content, using Git data as backup');
        return gitData; // Use Git data only if local is empty
      }

      if (gitHasContent && localHasContent) {
        vlog('[GitSyncEngine] LOCAL MODE: Both have content - Redstring is source of truth, preserving local content');
        return null; // Keep local content, sync to Git
      }

      vlog('[GitSyncEngine] LOCAL MODE: Neither has content, starting fresh');
      return null; // Start fresh
    }

    // GIT MODE: Git repository is source of truth (default)
    if (this.sourceOfTruth === SOURCE_OF_TRUTH.GIT) {
      if (!gitHasContent && localHasContent) {
        vlog('[GitSyncEngine] GIT MODE: Git has no content, preserving local content and syncing to Git');
        return null; // Keep local content, sync to Git
      }

      if (gitHasContent && !localHasContent) {
        vlog('[GitSyncEngine] GIT MODE: Local has no content, using Git data as source');
        return gitData; // Use Git data
      }

      if (gitHasContent && localHasContent) {
        vlog('[GitSyncEngine] GIT MODE: Both have content - Git is source of truth, using Git data');
        return gitData; // Use Git data as source of truth
      }

      vlog('[GitSyncEngine] GIT MODE: Neither has content, starting fresh');
      return null; // Start fresh
    }
  }

  /**
   * Start the background commit loop
   */
  start() {
    if (this.isRunning) {
      vlog('[GitSyncEngine] Already running');
      return;
    }

    this.isRunning = true;
    vlog('[GitSyncEngine] Starting commit loop (every', this.commitInterval, 'ms)');

    // Let the panel resolve this universe's content-addressed image blobs.
    // Registered on start rather than in the constructor so the LAST engine to
    // actually start — the active universe — is the one that owns resolution.
    registerBlobSource(this.provider, this.universeFolder);

    // Auto-commit loop with aggressive conflict prevention
    vlog('[GitSyncEngine] Auto-commit enabled with conflict prevention - every', this.commitInterval, 'ms');

    this.commitLoop = setInterval(async () => {
      // Only auto-commit if no manual commit is in progress
      if (!this.isCommitInProgress) {
        await this.processPendingCommits();
      } else {
        vlog('[GitSyncEngine] Skipping auto-commit - manual commit in progress');
      }
    }, this.commitInterval);
  }

  /**
   * Stop the background commit loop
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.commitLoop) {
      clearInterval(this.commitLoop);
      this.commitLoop = null;
    }

    // Clear any pending debounce timeouts
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }

    vlog('[GitSyncEngine] Stopped commit loop');
  }

  /**
   * Restart the sync engine (recovery mechanism)
   */
  restart() {
    vlog('[GitSyncEngine] Restarting sync engine...');
    this.stop();

    // Reset error state
    this.consecutiveErrors = 0;
    this.isInErrorBackoff = false;
    this.lastErrorTime = 0;
    this.persistentFailures.clear();

    // Restart
    this.start();
    this.notifyStatus('info', 'Sync engine restarted');
  }

  /**
   * Pause operations (useful when UI is not visible)
   */
  pause() {
    this.isPaused = true;
    vlog('[GitSyncEngine] Operations paused');
  }

  /**
   * Resume operations
   */
  resume() {
    this.isPaused = false;
    vlog('[GitSyncEngine] Operations resumed');
  }

  /**
   * Check if sync engine is healthy
   */
  isHealthy() {
    const healthy = this.isRunning && !this.isInErrorBackoff && this.consecutiveErrors < this.maxConsecutiveErrors;

    // If unhealthy due to errors but enough time has passed, attempt self-recovery
    if (!healthy && this.consecutiveErrors >= this.maxConsecutiveErrors) {
      const timeSinceLastError = Date.now() - this.lastErrorTime;

      // After 30 seconds of being in error state, attempt recovery
      if (timeSinceLastError > 30000) {
        vlog('[GitSyncEngine] Attempting self-recovery after 30s error backoff');
        this.consecutiveErrors = 0;
        this.isInErrorBackoff = false;
        this.lastErrorTime = 0;
        this.notifyStatus('info', 'Attempting automatic recovery from error state');

        // Restart if needed
        if (!this.isRunning) {
          this.restart();
        }

        return true; // Report as healthy after recovery attempt
      }
    }

    return healthy;
  }

  /**
   * Generate a hash of the store state for change detection
   * Only includes content changes, not viewport changes
   */
  /**
   * What decides whether there is anything to commit: the shared document
   * (saveHash's per-entry hash, which sees the Maps and Sets inside webs and
   * connections: positions, groups, arrow directions) plus each web's camera
   * and the duplicate-pair rulings.
   * Plain JSON.stringify made every Map `{}`, so moving Things, auto layout,
   * groups and arrows never committed on their own. No `this`: universeBackend
   * calls it unbound.
   */
  generateStateHash(storeState) {
    const views = Array.from(storeState?.graphs?.entries?.() || []).map(([id, graph]) => {
      const { panOffset, zoomLevel } = graph || {};
      const x = Math.round(((panOffset?.x ?? 0) + Number.EPSILON) * 100) / 100;
      const y = Math.round(((panOffset?.y ?? 0) + Number.EPSILON) * 100) / 100;
      const zoom = typeof zoomLevel === 'number' ? Math.round((zoomLevel + Number.EPSILON) * 10000) / 10000 : 1;
      return `${id}@${x},${y},${zoom}`;
    }).join('|');
    // Duplicate-pair rulings are shared too (in the file, merged), but live
    // outside the entity maps.
    const rulings = JSON.stringify(storeState?.mergeDismissals || {});
    return `${generateDocumentHash(storeState)}:${generateHash(views)}:${generateHash(rulings)}`;
  }

  /**
   * Update local state instantly (user operations)
   * Now with intelligent rate limiting and debouncing
   */
  /**
   * Count USER prototypes in a store state (Map or plain object).
   * The "did the repo ever have data" floor for the empty-state guard.
   *
   * Excludes the seeded base Thing/Connection: counting them meant a wiped
   * store that the UI had re-seeded reported 1 node, cleared every
   * `=== 0` check, and got committed over a repo whose floor said 1822.
   */
  _countNodes(storeState) {
    return countUserPrototypes(storeState);
  }

  updateState(storeState, force = false) {
    // Identity guard: state stamped for a different universe must never be
    // committed through this engine. GitAutosavePolicy is a singleton whose
    // engine pointer is hot-swapped on universe switch — an idle timer
    // straddling the switch could otherwise commit universe A's content to
    // universe B's remote file.
    if (storeState?._universeSlug && storeState._universeSlug !== this.universeSlug) {
      console.warn(`[GitSyncEngine] Refusing updateState: state belongs to "${storeState._universeSlug}" but this engine syncs "${this.universeSlug}"`);
      return;
    }

    // A remote divergence is awaiting user resolution — queuing more commits
    // would just hammer the conflict. The resolution flow uses forceCommit.
    if (this.remoteConflictPending) {
      return;
    }

    // Captured before remote changes reached the canvas: committing it would
    // revert them in the repository. The canvas kept its edits, and the
    // apply's own save brings a state with both.
    if (this._isStale(storeState)) {
      vlog('[GitSyncEngine] Dropping a state captured before remote changes arrived');
      return;
    }

    // Empty-state guard: refuse to queue a commit that would shrink a known-
    // non-empty repo to zero nodes. This catches transient empty store states
    // (e.g. during source-of-truth handoff or page-load races) that would
    // otherwise propagate through processPendingCommits and wipe the repo.
    // `force=true` lets explicit user actions bypass — including legitimate
    // "clear universe" flows that go through forceCommit, which doesn't call
    // updateState anyway.
    if (!force && this.lastCommittedNodeCount > 0) {
      const incomingCount = this._countNodes(storeState);
      if (incomingCount === 0) {
        console.warn('[GitSyncEngine] Refusing updateState: incoming state has 0 nodes but last commit had', this.lastCommittedNodeCount, '— likely a transient empty state, not a real edit.');
        return;
      }
    }

    // Too large to sync: don't fingerprint or queue it (both mean holding
    // the whole universe as text on the main thread). Hand it to whoever keeps
    // it on this device instead.
    if (this._stillTooLarge(storeState)) {
      this._report(this.onHeldState, storeState);
      return;
    }

    // Store the current state for background persistence
    this.localState.set('current', storeState);

    // Check if there are actual changes (content only, not viewport)
    const currentHash = this.generateStateHash(storeState);
    const hasChanges = this.lastCommittedHash !== currentHash;

    if (!hasChanges && !force) {
      return; // No changes, nothing to do (unless forced by SaveCoordinator)
    }

    // Detect if this might be a dragging operation
    const now = Date.now();
    const timeSinceLastUpdate = now - (this.pendingCommits.length > 0 ? this.pendingCommits[this.pendingCommits.length - 1].timestamp : 0);

    // Cap how long we'll stay in "drag debounce" mode. On mobile, touch
    // events / continuous React effects can fire faster than every 100ms
    // indefinitely, which would otherwise keep the debounce timer perpetually
    // resetting (clearTimeout on every new update below) — saves stall
    // forever because processPendingCommits bails when isDragging is true.
    // After this window, treat the run as no-longer-a-drag and let commits
    // flush on the normal interval.
    const MAX_DRAG_DEBOUNCE_MS = 5000;
    if (this.isDragging && this.dragStartTime && (now - this.dragStartTime) > MAX_DRAG_DEBOUNCE_MS) {
      vlog('[GitSyncEngine] Drag debounce capped at 5s, flushing pending commits');
      this.isDragging = false;
      this.dragStartTime = 0;
    }

    // If updates are coming very rapidly (less than 100ms apart), likely dragging
    if (timeSinceLastUpdate < 100) {
      this.isDragging = true;
      this.dragStartTime = this.dragStartTime || now;
      vlog('[GitSyncEngine] Detected rapid updates (likely dragging), debouncing...');
    }

    // Clear any existing debounce timeout
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    // Add to pending commits. Only the newest is ever committed
    // (processPendingCommits), so older ones are dropped here rather than
    // queued: each held its own copy of the store's top-level Maps, and the
    // queue grew through every slow upload, backoff and circuit-breaker pause.
    // _clearCommitted falls back to timestamps when the entry a commit started
    // from is no longer in the queue.
    if (this.pendingCommits.length > 1) this.pendingCommits = this.pendingCommits.slice(-1);
    this.pendingCommits.push({
      type: 'state_update',
      timestamp: now,
      data: storeState,
      hash: currentHash,
      isDragging: this.isDragging
    });

    if (!this.hasChanges || !this.changesSince) this.changesSince = now;
    this.hasChanges = true;

    // If we're dragging, use debounced commit
    if (this.isDragging) {
      this.debounceTimeout = setTimeout(() => {
        vlog('[GitSyncEngine] Dragging finished, committing final state');
        this.isDragging = false;
        this.dragStartTime = 0;
        this.processPendingCommits();
      }, this.debounceDelay);
    } else {
      // Normal update, log but don't spam
      vlog('[GitSyncEngine] Content updated, pending commits:', this.pendingCommits.length);
    }
  }

  /**
   * Push serialized content to the remote with optimistic concurrency.
   *
   * Asserts `lastKnownRemoteSha`. If the remote moved (another device pushed
   * since our last sync), pulls the current remote, asks `onRemoteDivergence`
   * whether the divergence is safe (identical/equivalent content → retry) or
   * real (surface the conflict flow and block pushes). NEVER blind-overwrites
   * a diverged remote.
   *
   * @private
   * @param {string} jsonString - Serialized universe content.
   * @param {Object} [options]
   * @param {boolean} [options.outgoingEmpty=false] - The state being written
   *   holds no user prototypes. Triggers a read of the destination before the
   *   write; see below.
   * @returns {Promise<Object>} Provider write result.
   */
  async _commitToRemote(jsonString, { outgoingEmpty = false, resolution = false, localHash = null, message = undefined } = {}) {
    const path = this.getLatestPath();

    // A resolution save is the user's answer to a dialog shown against one
    // remote version: assert exactly that version. Anything newer that landed
    // since is merged on top below, with that version as the base.
    if (resolution && this.lastKnownRemoteSha === undefined && this._conflictRemoteSha) {
      this.lastKnownRemoteSha = this._conflictRemoteSha;
    }

    // NEVER write to a remote this session has not read. Before the first
    // write of a session, pull the remote and run the same safety decision
    // used for diverged pushes. The old behavior (provider probes for the
    // SHA and overwrites) is how a save racing a slow universe load could
    // wipe a populated repo: on a device with no persisted guard state
    // (fresh mobile browser, evicted localStorage) every "did the repo have
    // data" floor reads zero, so nothing downstream stops the overwrite.
    if (this.lastKnownRemoteSha === undefined) {
      const merged = await this._firstContactCheck(path, { localJson: jsonString, outgoingEmpty, localHash, message });
      if (merged) return merged;
    }

    // Last-resort check, and the only one that cannot be wrong: if we are
    // about to write nothing, ask the DESTINATION what is there right now.
    // Every other guard answers "what do I remember about this universe" from
    // device-local bookkeeping; this one reads the file being overwritten.
    // Costs an extra read only in the rare empty case.
    if (outgoingEmpty) {
      const verdict = await checkDestinationBeforeEmptyWrite({
        readDestination: async () => (await this.provider.readFileRawWithMeta(path)).content,
        label: path
      });
      if (!verdict.safe) {
        this.notifyStatus('warning', 'Commit blocked: the repository file holds things this universe does not. Reload to recover them. Emptying a universe completely is not supported yet.');
        const blocked = new Error(`Refusing to write an empty universe over ${path}: ${verdict.reason}`);
        blocked.code = 'EMPTY_WRITE_BLOCKED';
        blocked.reason = verdict.reason;
        throw blocked;
      }
    }

    // Assert the version the store grew from, not merely the last one seen:
    // a read that was never applied (a discarded load) leaves
    // lastKnownRemoteSha ahead of the store, and asserting it would overwrite
    // that version's changes instead of merging them. A resolution save is
    // the user's explicit answer about the version the dialog showed.
    const assertSha = !resolution && typeof this.lastKnownRemoteSha === 'string' && typeof this.syncBaseSha === 'string'
      ? this.syncBaseSha
      : this.lastKnownRemoteSha;
    const options = { expectedSha: assertSha, message };

    try {
      const result = await this.provider.writeFileRaw(path, jsonString, options);
      this._noteOwnWrite(result);
      this.remoteConflictPending = false;
      this._conflictRemoteSha = null;
      return result;
    } catch (error) {
      if (error?.code !== 'REMOTE_DIVERGED') throw error;

      console.warn('[GitSyncEngine] Remote moved since last sync — pulling to compare before any overwrite');
      // The version this content was built on: the merge base. For a
      // resolution save, the version the user adjudicated.
      const baseSha = resolution ? (this._conflictRemoteSha || this.syncBaseSha) : this.syncBaseSha;
      const remote = await this._readRemoteAfterRefusal(path, assertSha);
      this.lastKnownRemoteSha = remote.sha;

      let remoteData = null;
      let remoteUnparseable = false;
      try {
        // Guard the empty case exactly as _firstContactCheck does. A bare
        // JSON.parse('') throws, which would misreport a legitimately
        // zero-byte remote as unreadable and block every save for the session.
        remoteData = remote.content && remote.content.trim() ? JSON.parse(remote.content) : null;
      } catch (parseError) {
        console.warn('[GitSyncEngine] Diverged remote content is unparseable:', parseError.message);
        remoteUnparseable = true;
      }

      // A genuinely empty remote file (no bytes) is safe to write over.
      if (remoteData === null && !remoteUnparseable) {
        const retry = await this.provider.writeFileRaw(path, jsonString, { expectedSha: this.lastKnownRemoteSha, message });
        this._noteOwnWrite(retry);
        this.remoteConflictPending = false;
        return retry;
      }

      // An unreadable remote is never "safe to overwrite". It used to be
      // treated as such ("git history retains it"), but a remote that fails
      // to parse is as likely to be the user's real universe arriving
      // corrupt as it is to be junk — and this is the same shape as the
      // 2026-09-12 wipe, where the unreadable thing WAS the universe.
      if (remoteUnparseable || !isRecognizedShape(remoteData)) {
        this.remoteConflictPending = true;
        this.remoteUnrecognized = true;
        this.lastKnownRemoteSha = undefined; // keep first contact armed
        this.notifyStatus('warning', 'The repository file could not be read as a universe. Saving is paused so it is not overwritten — reload to try reading it again.');
        const unrecognized = new Error(
          `Remote file at ${path} is ${remoteUnparseable ? 'not valid JSON' : 'not a recognizable Redstring document'} — refusing to overwrite it.`
        );
        unrecognized.code = 'REMOTE_UNRECOGNIZED';
        throw unrecognized;
      }

      // Someone else saved since our last sync. Merge their work with ours.
      if (!outgoingEmpty) {
        const merged = await this._mergeWithRemote({ path, localJson: jsonString, remote, remoteData, baseSha, localHash, message });
        if (merged) return merged;
      }

      let decision = 'conflict';
      if (typeof this.onRemoteDivergence === 'function') {
        try {
          decision = await this.onRemoteDivergence({ remoteData, universeSlug: this.universeSlug });
        } catch (handlerError) {
          console.warn('[GitSyncEngine] onRemoteDivergence handler failed — treating as conflict:', handlerError);
          decision = 'conflict';
        }
      }
      // No handler wired: default to conflict — never silently overwrite.

      if (decision === 'overwrite') {
        const retry = await this.provider.writeFileRaw(path, jsonString, { expectedSha: this.lastKnownRemoteSha, message });
        this._noteOwnWrite(retry);
        this.remoteConflictPending = false;
        return retry;
      }

      this._armConflict(remote.sha);
      this.notifyStatus('warning', 'This universe changed on another device — choose which version to keep.');
      const conflictError = new Error('Remote universe changed since last sync — resolution required before pushing.');
      conflictError.code = 'REMOTE_CONFLICT';
      throw conflictError;
    }
  }

  /**
   * First-contact safety check: read the remote before the FIRST write of a
   * session (`lastKnownRemoteSha === undefined`).
   *
   * This is the structural fix for the mobile repo-wipe class of bug: a
   * git-only universe on a slow connection times out its initial load, the
   * UI is released with a near-empty store, an incidental edit unblocks the
   * autosave pipeline, and the first push lands on a repo this session never
   * read. Every existing floor/guard is armed from device-local storage
   * (localStorage floors, universe metadata) which a fresh or evicted mobile
   * browser doesn't have — so the only reliable arbiter is the remote itself.
   *
   * Outcomes:
   * - confirmed 404 → `lastKnownRemoteSha = null`, write proceeds as create
   * - readable but empty/unparseable → write proceeds (git history retains)
   * - readable with data → arm the node-count floor from the REMOTE, then run
   *   `onRemoteDivergence`; only an explicit 'overwrite' verdict (contents
   *   equivalent / remote effectively empty) lets the write proceed. Anything
   *   else surfaces the conflict flow and throws REMOTE_CONFLICT.
   * - unreadable (auth/network/5xx) → throw; unknown remote content must
   *   never be overwritten.
   *
   * @private
   * @param {string} path - Remote universe file path.
   */
  async _firstContactCheck(path, { localJson = null, outgoingEmpty = false, localHash = null, message = undefined } = {}) {
    console.warn('[GitSyncEngine] First write of this session — reading remote before any overwrite');

    let remote;
    try {
      remote = await this.provider.readFileRawWithMeta(path);
    } catch (error) {
      // Structured codes only: an error whose MESSAGE mentions "File not
      // found" or 404 is not a confirmed 404, and treating it as one is what
      // arms a create over a file this session could not read.
      if (isConfirmedNotFound(error)) {
        this.lastKnownRemoteSha = null; // confirmed absent — creating is safe
        return;
      }
      // Remote content is UNKNOWN, not missing — refuse to write over it.
      console.error('[GitSyncEngine] First-contact read failed (not a 404) — refusing to write:', error?.message || error);
      throw error;
    }

    let remoteData = null;
    let unparseable = false;
    try {
      remoteData = remote.content && remote.content.trim() ? JSON.parse(remote.content) : null;
    } catch (parseError) {
      console.warn('[GitSyncEngine] First-contact remote content is unparseable:', parseError.message);
      unparseable = true;
    }

    // Something IS at that path and we cannot tell what it is — unparseable,
    // or parseable but not a universe. Never overwrite it. "Git history
    // retains it" used to justify clobbering here, but the thing that fails
    // to parse is just as likely to be the user's real universe arriving
    // corrupt or truncated as it is to be junk, and history is a poor trade
    // for their live file.
    //
    // The SHA is deliberately NOT recorded before this throw: leaving
    // `lastKnownRemoteSha` undefined keeps first contact armed, so a later
    // write in the same session re-reads and re-refuses. Recording it would
    // satisfy the gate permanently, and dismissing the conflict dialog would
    // then be enough to let the next autosave overwrite the unread file.
    if (unparseable || !isRecognizedShape(remoteData)) {
      if (remoteData === null && !unparseable) {
        // Genuinely empty file (no bytes at all) — safe to create over.
        this.lastKnownRemoteSha = remote.sha;
        return;
      }
      this.remoteConflictPending = true;
      this.remoteUnrecognized = true;
      this.notifyStatus('warning', 'The repository file could not be read as a universe. Saving is paused so it is not overwritten — reload to try reading it again.');
      const unrecognized = new Error(
        `Remote file at ${path} is ${unparseable ? 'not valid JSON' : 'not a recognizable Redstring document'} — refusing to overwrite it.`
      );
      unrecognized.code = 'REMOTE_UNRECOGNIZED';
      throw unrecognized;
    }

    // The remote reads cleanly — clear any earlier "unreadable" latch.
    this.remoteUnrecognized = false;
    this.lastKnownRemoteSha = remote.sha;

    // Arm the shrink-to-zero floor from what the remote ACTUALLY holds, not
    // from device-local storage that may never have existed on this device.
    const remoteNodeCount = this._countNodesInRedstringData(remoteData);
    if (remoteNodeCount > this.lastCommittedNodeCount) {
      this.lastCommittedNodeCount = remoteNodeCount;
      this._persistFloor();
    }

    if (remoteNodeCount === 0) return; // genuinely empty universe file

    // The remote has data this session never loaded. If this device knows
    // which version its copy grew from, merge — this is how edits made
    // offline (or before a restart) reach a universe others kept editing.
    if (localJson && !outgoingEmpty && this.syncBaseSha) {
      const merged = await this._mergeWithRemote({ path, localJson, remote, remoteData, baseSha: this.syncBaseSha, localHash, message });
      if (merged) return merged;
    }

    // Otherwise reuse the divergence decision machinery: only a handler that
    // proves the contents equivalent (or the remote effectively empty) may
    // green-light the write.
    let decision = 'conflict';
    if (typeof this.onRemoteDivergence === 'function') {
      try {
        decision = await this.onRemoteDivergence({ remoteData, universeSlug: this.universeSlug });
      } catch (handlerError) {
        console.warn('[GitSyncEngine] onRemoteDivergence handler failed during first contact — treating as conflict:', handlerError);
      }
    }
    if (decision === 'overwrite') return;

    this._armConflict(remote.sha);
    this.notifyStatus('warning', 'The repository has existing data that was never loaded this session — choose which version to keep.');
    const conflictError = new Error('Remote universe has data this session never loaded — refusing to overwrite until resolved.');
    conflictError.code = 'REMOTE_CONFLICT';
    throw conflictError;
  }

  /**
   * Inform the engine that the remote WAS read this session by an external
   * path — universeBackend's `loadFromGitDirect` reads through the provider
   * and bypasses the engine entirely, so without this call the engine still
   * believes the remote is unobserved. The first autosave after the user
   * edits would then run `_firstContactCheck`, compare the EDITED store
   * against the remote, and flag a false conflict — silently blocking every
   * save ("stuck on Saving...") until refresh discards the user's work.
   *
   * A stale SHA is safe to seed: the write path asserts it, detects the
   * divergence, and pull-and-compares instead of overwriting.
   *
   * @param {Object} observation
   * @param {string|null} [observation.sha] - Remote file SHA from the read
   *   (`null` = confirmed absent). `undefined` leaves first-contact armed.
   * @param {number} [observation.nodeCount] - Node count of the remote
   *   content; ratchets the shrink-to-zero floor upward.
   */
  markRemoteObserved({ sha, nodeCount, contentHash = null, state = null } = {}) {
    if ((typeof sha === 'string' && sha) || sha === null) {
      this.lastKnownRemoteSha = sha;
    }
    // Only ever called once the read was APPLIED to the store, so the store
    // now holds this version: it is the merge base, and (given its hash) the
    // content the repository already has — nothing to commit until an edit.
    if (typeof sha === 'string' && sha) {
      this._setSyncBase(sha);
      if (typeof contentHash === 'string' && contentHash) this.lastCommittedHash = contentHash;
      // `state` is the store as that read left it, when it held exactly that version.
      this._summaryBase = state && typeof state === 'object' ? state : null;
    }
    const count = Number(nodeCount);
    if (Number.isFinite(count) && count > this.lastCommittedNodeCount) {
      this.lastCommittedNodeCount = count;
      this._persistFloor();
    }
  }

  /**
   * Forget that the remote was observed, re-arming `_firstContactCheck` for
   * the next write. Called when remote content was READ but ultimately NOT
   * applied to the store (e.g. a background load discarded in favor of the
   * user's racing edits) — pushing the store over that remote must go
   * through pull-and-compare, not assert a SHA from a read the store never
   * absorbed. The node-count floor deliberately stays armed.
   */
  invalidateRemoteObservation() {
    this.lastKnownRemoteSha = undefined;
    // The store didn't absorb that read, and what it holds instead is not
    // known to descend from anything: no merge may assume a base.
    this.syncBaseSha = null;
    this._summaryBase = null;
  }

  /**
   * A conflict dialog is about to be shown against remote version `sha`.
   * Pushes stop until it is answered, and the SHA is forgotten: a dismissed
   * dialog used to leave the remote's SHA in place, so the very next
   * autosave asserted it and overwrote the version the dialog was about.
   * Now the next write re-reads the remote and goes through first contact.
   */
  _armConflict(sha) {
    this.remoteConflictPending = true;
    this._conflictRemoteSha = typeof sha === 'string' ? sha : null;
    this.lastKnownRemoteSha = undefined;
  }

  /**
   * After remote changes landed on the canvas: if the canvas held nothing
   * newer than what this engine had already committed (`expectedHash`), what
   * it holds now IS what the repository holds, so record it as committed —
   * otherwise autosave pushes it straight back and two devices echo the same
   * change forever. If the canvas had edits of its own on the way, leave the
   * record alone so autosave sends them.
   */
  _adoptAppliedState({ state, before }, expectedHash, origin = this._summaryBase) {
    const unsynced = !before || !expectedHash || this.generateStateHash(before) !== expectedHash;
    if (!unsynced) this.lastCommittedHash = this.generateStateHash(state);
    // Edits of this canvas still on their way are described by the next
    // commit, not folded into the base: whatever changed since `origin` (the
    // repository's version, or the state a merging commit sent) goes back.
    this._summaryBase = unsynced ? rebaseSummary(origin, before, state) : state;
    this.lastCommittedNodeCount = this._countNodes(state);
    this._persistFloor();
  }

  /**
   * Merge this device's content with a remote someone else moved, write the
   * result, and bring it onto the canvas. Returns the write result (with
   * `merged: true`) or null when it can't merge safely here — no base, the
   * base can't be read, the backend says no (a mass deletion, say) — in which
   * case the caller falls back to the dialog flow. Never writes anything that
   * did not come out of a merge.
   *
   * @private
   */
  async _mergeWithRemote({ path, localJson, remote, remoteData, baseSha, localHash = null, applyBaseJson = localJson, attempt = 1, mergedShas = [], message = undefined }) {
    if (typeof this.onMergeRemote !== 'function' || typeof baseSha !== 'string' || !baseSha) return null;

    let baseText;
    if (baseSha === remote.sha) {
      baseText = remote.content;
    } else {
      if (typeof this.provider.readFileAtSha !== 'function') return null;
      try {
        baseText = await this.provider.readFileAtSha(path, baseSha);
      } catch (error) {
        console.warn(`[GitSyncEngine] Could not read the merge base ${baseSha.slice(0, 8)} — falling back to the conflict dialog:`, error?.message || error);
        return null;
      }
    }

    let plan = null;
    try {
      plan = await this.onMergeRemote({
        baseText,
        localJson,
        applyBaseJson,
        remoteData,
        remoteText: remote.content,
        remoteSha: remote.sha,
        universeSlug: this.universeSlug
      });
    } catch (error) {
      console.warn('[GitSyncEngine] Merge failed — falling back to the conflict dialog:', error);
      return null;
    }
    if (!plan || typeof plan.content !== 'string') return null;

    let result;
    if (plan.content === remote.content) {
      // Nothing of ours to add: the remote already is the merge.
      result = { content: { sha: remote.sha }, unchanged: true };
    } else {
      try {
        // What this side changed, measured against the version it merged with.
        result = await this.provider.writeFileRaw(path, plan.content, { expectedSha: remote.sha, message: this.nextCommitMessage || plan.message || message });
        this._noteSaved();
      } catch (error) {
        if (error?.code !== 'REMOTE_DIVERGED' || attempt >= 3) throw error;
        // Someone saved again while we merged. Merge once more on top, with
        // the version we just merged against as the base; the canvas still
        // only needs the changes since what it was built from.
        console.warn('[GitSyncEngine] Remote moved again during the merge — merging on top');
        const again = await this._readRemoteAfterRefusal(path, remote.sha);
        let againData = null;
        try {
          againData = again.content && again.content.trim() ? JSON.parse(again.content) : null;
        } catch (_) { againData = null; }
        if (!againData || !isRecognizedShape(againData)) {
          const unrecognized = new Error(`Remote file at ${path} stopped reading as a universe mid-merge — refusing to overwrite it.`);
          unrecognized.code = 'REMOTE_UNRECOGNIZED';
          throw unrecognized;
        }
        return this._mergeWithRemote({
          path, localJson: plan.content, remote: again, remoteData: againData,
          baseSha: remote.sha, localHash, applyBaseJson, attempt: attempt + 1,
          mergedShas: [...mergedShas, remote.sha], message
        });
      }
    }

    const newSha = result?.content?.sha || remote.sha;
    // The saved merge contains every version it merged with: a read showing
    // one of them now is stale, not news.
    for (const sha of [...mergedShas, remote.sha]) if (sha !== newSha) this._markSuperseded(sha);
    this.lastKnownRemoteSha = newSha;
    this.remoteConflictPending = false;
    this._conflictRemoteSha = null;

    let applied = null;
    try {
      applied = await plan.apply();
    } catch (error) {
      console.warn('[GitSyncEngine] Merged and saved, but could not show it on the canvas:', error);
    }
    if (applied?.state) {
      this._setSyncBase(newSha);
      this._noteRemoteApplied();
      this._adoptAppliedState(applied, localHash, this._committingState || this._summaryBase);
    } else {
      // The repository holds the merge but the store does not. Forget the SHA
      // so the next write merges again instead of asserting it and
      // overwriting the other side's work with this device's older copy.
      this.lastKnownRemoteSha = undefined;
    }
    return { ...result, merged: true, applied: !!applied?.state };
  }

  /**
   * Has anyone else saved? A cheap check (the remote's SHA, no download).
   * If they have and this device has nothing waiting to push, bring their
   * changes onto the canvas. If this device does have changes waiting, do
   * nothing: the commit merges on its way out.
   *
   * @returns {Promise<{changed?: boolean, applied?: boolean, skipped?: string, error?: Error}>}
   */
  async checkRemote() {
    if (this._checkingRemote) return { skipped: 'busy' };
    if (this.isPaused || this.remoteConflictPending || this.isCommitInProgress) return { skipped: 'busy' };
    if (typeof this.provider?.getRemoteFileSha !== 'function' || typeof this.onRemoteUpdate !== 'function') return { skipped: 'unsupported' };
    // The store must be known to descend from a version; compare against that,
    // not the last version merely seen (which may never have been applied).
    if (!this.syncBaseSha) return { skipped: 'unsynced' };
    if (this.hasChanges || this.pendingCommits.length > 0) return { skipped: 'local-changes' };

    this._checkingRemote = true;
    try {
      const path = this.getLatestPath();
      const sha = await this.provider.getRemoteFileSha(path);
      if (!sha || sha === this.syncBaseSha) return { changed: false };
      if (this._isRecentlySuperseded(sha)) return { changed: false, stale: true };

      const remote = await this.provider.readFileRawWithMeta(path);
      if (remote.sha === this.syncBaseSha) return { changed: false };
      if (this._isRecentlySuperseded(remote.sha)) return { changed: false, stale: true };
      let remoteData = null;
      try {
        remoteData = remote.content && remote.content.trim() ? JSON.parse(remote.content) : null;
      } catch (_) { remoteData = null; }
      if (!remoteData || !isRecognizedShape(remoteData)) return { skipped: 'unrecognized' };

      const baseSha = this.syncBaseSha;
      const baseText = baseSha === remote.sha ? remote.content : await this.provider.readFileAtSha(path, baseSha);

      // A commit may have started while we read, or a save begun. Let them merge.
      if (this.isCommitInProgress || this.hasChanges || this.pendingCommits.length > 0) return { skipped: 'local-changes' };
      if (typeof this.isLocalBusy === 'function' && this.isLocalBusy()) return { skipped: 'local-changes' };

      const applied = await this.onRemoteUpdate({
        baseText,
        remoteData,
        remoteText: remote.content,
        remoteSha: remote.sha,
        universeSlug: this.universeSlug
      });
      if (!applied?.state) return { changed: true, applied: false };

      this.lastKnownRemoteSha = remote.sha;
      this._setSyncBase(remote.sha);
      this._noteRemoteApplied();
      this._adoptAppliedState(applied, this.lastCommittedHash);
      return { changed: true, applied: true };
    } catch (error) {
      console.warn('[GitSyncEngine] Checking the repository for others\' changes failed:', error?.message || error);
      return { error };
    } finally {
      this._checkingRemote = false;
    }
  }

  /**
   * Count node prototypes in raw .redstring file data (NOT store state — for
   * store snapshots use `_countNodes`). Handles the current prototypeSpace
   * shape and the legacy top-level nodePrototypes shape.
   *
   * @private
   * @param {Object} redstringData - Parsed .redstring JSON.
   * @returns {number} Prototype count, 0 if the shape is unrecognized.
   */
  _countNodesInRedstringData(redstringData) {
    return countUserPrototypes(redstringData);
  }

  /**
   * Check circuit breaker status and manage API call rate
   */
  checkCircuitBreaker() {
    const now = Date.now();

    // Check if circuit breaker should be closed
    if (this.circuitBreakerOpen) {
      if (now - this.circuitBreakerOpenTime > this.circuitBreakerTimeout) {
        vlog('[GitSyncEngine] Circuit breaker closing - resuming operations');
        this.circuitBreakerOpen = false;
        this.consecutiveErrors = 0; // Reset error count
      } else {
        return false; // Circuit breaker is still open
      }
    }

    // Clean up old API call records (older than 5 minutes)
    this.recentApiCalls = this.recentApiCalls.filter(time => (now - time) < 300000);

    // If more than 10 API calls in the last 5 minutes, open circuit breaker
    if (this.recentApiCalls.length > 10) {
      console.error('[GitSyncEngine] CIRCUIT BREAKER OPENED - Too many API calls, preventing spam');
      this.circuitBreakerOpen = true;
      this.circuitBreakerOpenTime = now;
      this.notifyStatus('error', 'API rate limit protection activated - pausing for 60s');
      return false;
    }

    return true; // Circuit breaker is closed, OK to proceed
  }

  /**
   * Whether an autosave commit may run now: the person has been idle for
   * GIT_IDLE_MS, or a change has waited GIT_MAX_IDLE_WAIT_MS and the camera
   * is still, or the app is hidden (it may be suspended next, so commit while
   * it can). Saves the person asks for (forceCommit) don't ask.
   *
   * @param {number} [since] - when the oldest change waiting arrived
   * @returns {boolean}
   */
  isIdleEnoughToCommit(since = this.changesSince) {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
    if (since && Date.now() - since >= GIT_MAX_IDLE_WAIT_MS) return msSinceCameraMoved() >= GIT_CAMERA_STILL_MS;
    return msSinceActive() >= GIT_IDLE_MS;
  }

  /**
   * Process pending commits in batches
   * Now with rate limiting and intelligent batching
   */
  async processPendingCommits() {
    if (this.pendingCommits.length === 0) {
      return; // Nothing to commit
    }

    // Check circuit breaker first
    if (!this.checkCircuitBreaker()) {
      vlog('[GitSyncEngine] Circuit breaker open, skipping commit to prevent API spam');
      return;
    }

    // Check if operations are paused
    if (this.isPaused) {
      vlog('[GitSyncEngine] Operations paused, skipping commit');
      return;
    }

    // A conflict is awaiting user resolution. Commits queued BEFORE the
    // conflict surfaced must not retry — the SHA is known by now, so the
    // write would succeed and overwrite the data being adjudicated. Drop
    // the queue; the resolution save supersedes it.
    if (this.remoteConflictPending) {
      console.warn('[GitSyncEngine] Discarding pending commits: remote conflict awaiting resolution');
      this.pendingCommits = [];
      this.hasChanges = false;
      return;
    }

    const now = Date.now();
    const timeSinceLastCommit = now - this.lastCommitTime;
    const timeSinceLastError = now - this.lastErrorTime;

    // Check if we're in error backoff mode
    if (this.isInErrorBackoff && timeSinceLastError < this.errorBackoffDelay) {
      vlog('[GitSyncEngine] In error backoff mode, waiting...');
      return;
    }

    // Reset error backoff if enough time has passed
    if (this.isInErrorBackoff && timeSinceLastError >= this.errorBackoffDelay) {
      vlog('[GitSyncEngine] Error backoff period ended, resuming commits');
      this.isInErrorBackoff = false;
      this.consecutiveErrors = 0;
    }

    // Rate limiting: enforce minimum interval between commits
    if (timeSinceLastCommit < this.minCommitInterval) {
      vlog('[GitSyncEngine] Rate limited: too soon since last commit');
      this.notifyStatus('info', 'Rate limited: waiting before next commit');
      return;
    }

    // Check if there are actual changes to commit
    if (!this.hasChanges) {
      vlog('[GitSyncEngine] No changes detected, skipping commit');
      return;
    }

    // If we're currently dragging, don't commit yet (let debounce handle it)
    if (this.isDragging) {
      vlog('[GitSyncEngine] Currently dragging, waiting for drag to finish');
      return;
    }

    // Not while the person is working (GIT_IDLE_MS). The loop comes back.
    if (!this.isIdleEnoughToCommit()) {
      vlog('[GitSyncEngine] Waiting for the person to be idle before committing');
      return;
    }

    if (this.isCommitInProgress) {
      vlog('[GitSyncEngine] Commit already in progress, skipping this cycle');
      return;
    }
    this.isCommitInProgress = true;
    try {
      const commitCount = this.pendingCommits.length;
      const isFromDragging = this.pendingCommits.some(commit => commit.isDragging);

      vlog(`[GitSyncEngine] Processing ${commitCount} pending commits${isFromDragging ? ' (from dragging)' : ''}...`);
      this.notifyStatus('info', `Committing ${commitCount} update${commitCount === 1 ? '' : 's'}...`);

      // States captured before remote changes reached the canvas would revert
      // them (see updateState); the apply's own save brings a newer one.
      this.pendingCommits = this.pendingCommits.filter((commit) => !this._isStale(commit.data));
      if (this.pendingCommits.length === 0) {
        this.hasChanges = false;
        return;
      }

      // Get the most recent state (always use the latest, discard intermediate states)
      const latestEntry = this.pendingCommits[this.pendingCommits.length - 1];
      const latestState = latestEntry.data;
      const latestHash = latestEntry.hash;

      // Defense-in-depth empty-state guard. The updateState path also checks
      // this, but the auto-commit loop is the only thing that actually pushes
      // bytes — so the floor lives here too. If the repo previously had data
      // and we're about to push zero nodes, abort and discard the pending
      // commits so the loop doesn't retry the same empty payload forever.
      const latestNodeCount = this._countNodes(latestState);
      if (this.lastCommittedNodeCount > 0 && latestNodeCount === 0) {
        console.warn('[GitSyncEngine] processPendingCommits refused: pending state has 0 nodes but last committed had', this.lastCommittedNodeCount, '— discarding pending and waiting for a real edit.');
        this.notifyStatus('warning', 'Commit blocked: pending state is empty');
        this.pendingCommits = [];
        this.hasChanges = false;
        return;
      }

      // Still too large to sync: nothing to send, and nothing to retry.
      if (this._stillTooLarge(latestState)) {
        this.pendingCommits = [];
        this.hasChanges = false;
        return;
      }

      // Export to Redstring format (raw JSON write, not TTL), moving
      // full-resolution images out to content-addressed blobs on the way.
      const jsonString = await this._buildCommitPayload(latestState);

      // Track API call for circuit breaker
      this.recentApiCalls.push(Date.now());

      // Save latest snapshot to a fixed path with retry logic for network errors
      let writeSuccess = false;
      let lastWriteError = null;

      const outgoingEmpty = isEffectivelyEmpty(latestState);
      const message = this._commitMessageFor(latestState);
      this._committingState = latestState;

      let writeResult = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          writeResult = await this._commitToRemote(jsonString, { outgoingEmpty, localHash: latestHash, message });
          writeSuccess = true;
          break;
        } catch (writeError) {
          lastWriteError = writeError;

          // A surfaced conflict is not retryable here — the user must resolve.
          // Nor is a blocked empty write or an unreadable remote: retrying
          // just re-runs the same refusal, and the retry loop is exactly how
          // an earlier wipe pushed through a block once the SHA was known.
          if (writeError.code === 'REMOTE_CONFLICT'
            || writeError.code === 'EMPTY_WRITE_BLOCKED'
            || writeError.code === 'REMOTE_UNRECOGNIZED') {
            this.pendingCommits = [];
            throw writeError;
          }

          // Check if this is a transient network error
          const isNetworkError = writeError.message?.includes('network') ||
            writeError.message?.includes('fetch') ||
            writeError.message?.includes('NETWORK_CHANGED');

          if (isNetworkError && attempt < 3) {
            vlog(`[GitSyncEngine] Network error on commit attempt ${attempt}, retrying...`);
            // Wait with exponential backoff: 1s, 2s
            await new Promise(resolve => setTimeout(resolve, this.networkRetryMs * attempt));
            continue;
          }

          // Non-network error or last attempt, throw it
          throw writeError;
        }
      }

      if (!writeSuccess) {
        throw lastWriteError || new Error('Write failed after retries');
      }

      // Skip backup writes for rate limit efficiency - main file is sufficient
      // await this.provider.writeFileRaw(this.getBackupPath(), jsonString);

      // Update tracking. A merge already recorded what the store now holds
      // (ours plus theirs); the pre-merge hash would make autosave re-push it.
      if (!writeResult?.merged) {
        this.lastCommittedHash = latestHash;
        this.lastCommittedNodeCount = this._countNodes(latestState);
      }
      this._clearCommitted(latestEntry, latestHash);
      this._noteCommitted(latestState, writeResult);
      this.lastCommitTime = now;
      this._persistFloor();
      this._report(this.onSyncHeld, null);

      vlog(`[GitSyncEngine] Successfully committed changes to Git repository (${commitCount} updates batched)`);
      this.notifyStatus('success', `Committed ${commitCount} update${commitCount === 1 ? '' : 's'} to Git`);

      // Reset error tracking on successful commit
      this.consecutiveErrors = 0;
      this.isInErrorBackoff = false;

    } catch (error) {
      // Too large to sync isn't a failure to retry: say so once, drop the
      // queue, and wait for the universe to shrink (_stillTooLarge).
      if (error?.code === 'FILE_TOO_LARGE') {
        console.warn('[GitSyncEngine] Not committing:', error.message);
        this.notifyStatus('warning', error.message);
        this.pendingCommits = [];
        this.hasChanges = false;
        return;
      }

      console.error('[GitSyncEngine] Failed to commit:', error);

      // Track consecutive errors for backoff
      this.consecutiveErrors++;
      this.lastErrorTime = Date.now();

      // Check if we've hit the maximum consecutive errors
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        console.warn(`[GitSyncEngine] ${this.consecutiveErrors} consecutive errors, entering backoff mode for ${this.errorBackoffDelay}ms`);
        this.isInErrorBackoff = true;
        this.notifyStatus('warning', `Too many errors, pausing sync for ${this.errorBackoffDelay / 1000}s`);

        // Keep ONLY the latest snapshot so it retries once backoff ends.
        // Clearing the queue entirely meant a user who stopped editing and
        // closed the tab lost their last edits from Git forever, while the
        // UI had long since said "Saved". Backoff + rate limiting already
        // prevent an infinite retry loop; the retained snapshot just gives
        // the recovery cycle something to push.
        this.pendingCommits = this.pendingCommits.slice(-1);
        this.hasChanges = this.pendingCommits.length > 0;
      } else {
        // Normal error handling
        this.notifyStatus('error', `Commit failed: ${error.message || 'Unknown error'}`);

        // Check if it's a 409 conflict (file modified since last read)
        if (error.message && error.message.includes('409')) {
          vlog('[GitSyncEngine] 409 conflict detected, will retry on next cycle');
          // Keep the commits for retry, but add a delay to avoid rapid retries
          this.lastCommitTime = Date.now() - (this.minCommitInterval - 2000); // Allow retry in 2 seconds
        } else {
          // For other errors, limit the queue size to prevent memory issues
          if (this.pendingCommits.length > 20) {
            console.warn('[GitSyncEngine] Too many pending commits, keeping only latest 10');
            this.pendingCommits = this.pendingCommits.slice(-10);
          }
        }
      }
    } finally {
      this.isCommitInProgress = false;
      this._committingState = null;
    }
  }

  /**
   * Immediate commit path (Save Now, quit flush, conflict resolution,
   * migration write-back).
   *
   * Guards applied: universe identity, empty-state floor (opt out with
   * `options.allowEmpty` for intentional clears), redundancy, rate limiting.
   * Writes go through the optimistic-concurrency path — a diverged remote
   * surfaces the conflict flow instead of being overwritten.
   *
   * @param {Object} storeState - Store snapshot to commit.
   * @param {Object} [options={}]
   * @param {boolean} [options.allowEmpty=false] - Permit committing zero
   *   nodes over a previously non-empty remote (intentional clear).
   * @param {boolean} [options.isConflictResolution=false] - This is the
   *   explicit conflict-resolution save; permitted to push while
   *   `remoteConflictPending` is set (and clears it on success).
   * @returns {Promise<boolean>} `true` if committed; `false` if skipped
   *   (rate limited / no changes / conflict pending). Throws on failure or
   *   unresolved conflict.
   */
  async forceCommit(storeState, options = {}) {
    try {
      // Identity guard — see updateState for rationale.
      if (storeState?._universeSlug && storeState._universeSlug !== this.universeSlug) {
        console.warn(`[GitSyncEngine] Refusing forceCommit: state belongs to "${storeState._universeSlug}" but this engine syncs "${this.universeSlug}"`);
        return false;
      }

      // A conflict is awaiting the user's decision. Only the explicit
      // resolution save may push — without this, GitAutosavePolicy's retry
      // loop (and manual Save Now) would re-push with the now-known SHA and
      // overwrite the very data the user is being asked to adjudicate.
      if (this.remoteConflictPending && !options.isConflictResolution) {
        console.warn('[GitSyncEngine] Refusing forceCommit: remote conflict pending user resolution.');
        this.notifyStatus('warning', 'Save blocked: resolve the version conflict first.');
        return false;
      }

      // Captured before remote changes reached the canvas (see updateState).
      if (this._isStale(storeState) && !options.isConflictResolution) {
        vlog('[GitSyncEngine] forceCommit: dropping a state captured before remote changes arrived');
        return false;
      }

      // Empty-state floor. updateState and processPendingCommits both refuse
      // to shrink a known-non-empty remote to zero — but forceCommit is the
      // path autosave policies and quit flushes actually use, so without the
      // same floor here a transient empty snapshot (universe switch, HMR
      // reset) could wipe the remote AND then persist floor=0, disarming the
      // guard for all subsequent commits.
      if (options.allowEmpty && this._countNodes(storeState) === 0 && this.lastCommittedNodeCount > 0) {
        // Loud on purpose: this waives the remembered floor. The destination
        // read in _commitToRemote still stands, so this cannot by itself
        // clear a remote that holds data.
        console.warn(`[GitSyncEngine] allowEmpty honored for "${this.universeSlug}": committing 0 user prototypes over a floor of ${this.lastCommittedNodeCount}. The destination check still applies.`);
      }

      if (!options.allowEmpty && this.lastCommittedNodeCount > 0) {
        const incomingCount = this._countNodes(storeState);
        if (incomingCount === 0) {
          console.warn('[GitSyncEngine] Refusing forceCommit: state has 0 nodes but last commit had', this.lastCommittedNodeCount, '— pass allowEmpty to clear intentionally.');
          this.notifyStatus('warning', 'Commit blocked: this universe has no things but the repository copy does. Reload to recover it. Emptying a universe completely is not supported yet.');
          return false;
        }
      }

      // REASONABLE RATE LIMITING: Prevent too frequent commits but allow responsive saves
      const now = Date.now();
      const timeSinceLastCommit = now - this.lastCommitTime;
      const minInterval = 2000; // Minimum 2 seconds between commits - responsive but prevents spam

      if (timeSinceLastCommit < minInterval) {
        vlog(`[GitSyncEngine] Rate limited: ${timeSinceLastCommit}ms since last commit, minimum ${minInterval}ms required`);
        this.notifyStatus('info', `Rate limited: waiting ${Math.ceil((minInterval - timeSinceLastCommit) / 1000)}s`);
        return false;
      }

      // Still too large to sync (see _stillTooLarge): say so, without
      // fingerprinting or building the whole universe again.
      if (this._stillTooLarge(storeState)) {
        const { bytes, items } = this.tooLargeToSync;
        const error = this._tooLargeError(Math.round(this._itemsOf(storeState) * (bytes / items)));
        this.notifyStatus('warning', error.message);
        throw error;
      }

      // Check for redundant commits - don't commit identical content.
      // Hash first: no point externalizing images for a commit we then skip.
      const currentHash = this.generateStateHash(storeState);

      if (this.lastCommittedHash === currentHash) {
        vlog('[GitSyncEngine] Redundant commit prevented - content unchanged');
        // A resolution save whose chosen content already matches the last
        // commit still resolves the conflict — clear the block so autosave
        // resumes instead of staying wedged for the session.
        if (options.isConflictResolution) this.remoteConflictPending = false;
        this.notifyStatus('info', 'No changes to commit');
        return false;
      }

      this.notifyStatus('info', 'Committing changes...');

      // Clear any pending debounce
      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
        this.debounceTimeout = null;
      }

      // Reset dragging state
      this.isDragging = false;
      this.dragStartTime = 0;

      // Wait if background commit is in progress
      while (this.isCommitInProgress) {
        await new Promise(r => setTimeout(r, 100));
      }
      this.isCommitInProgress = true;
      // What's queued now is older than this state; what's queued from here on
      // (edits made while this commit is in flight) still has to go out.
      const queuedBefore = this.pendingCommits[this.pendingCommits.length - 1] || null;

      // Export + externalize images. Done after the redundancy check and inside
      // the in-progress guard so blob uploads can't overlap another commit.
      let jsonString;
      try {
        jsonString = await this._buildCommitPayload(storeState);
      } catch (error) {
        if (error?.code === 'FILE_TOO_LARGE') this.notifyStatus('warning', error.message);
        throw error;
      }

      // Track API call for circuit breaker
      this.recentApiCalls.push(Date.now());

      // Optimistic-concurrency write: retries only for transient network
      // errors. A diverged remote goes through pull-and-compare inside
      // _commitToRemote and either safely retries or surfaces the conflict.
      let lastError = null;
      // `allowEmpty` waives the node-count FLOOR (a remembered number). It
      // never waives the destination read below — that one looks at the file
      // itself, and no caller today may clear a remote that still holds data.
      const outgoingEmpty = isEffectivelyEmpty(storeState);
      const message = this._commitMessageFor(storeState);
      this._committingState = storeState;
      let writeResult = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          writeResult = await this._commitToRemote(jsonString, { outgoingEmpty, resolution: options.isConflictResolution === true, localHash: currentHash, message });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (error.code === 'REMOTE_CONFLICT'
            || error.code === 'EMPTY_WRITE_BLOCKED'
            || error.code === 'REMOTE_UNRECOGNIZED') break;
          const isNetworkError = error.message?.includes('network') ||
            error.message?.includes('fetch') ||
            error.message?.includes('NETWORK_CHANGED');
          if (isNetworkError && attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, this.networkRetryMs * attempt));
            continue;
          }
          break;
        }
      }

      if (lastError) {
        console.error('[GitSyncEngine] forceCommit failed:', lastError);
        this.notifyStatus('error', `Commit failed: ${lastError.message || 'Unknown error'}`);
        throw lastError;
      }

      // Success! Update tracking (a merge already recorded what the store holds)
      if (!writeResult?.merged) {
        this.lastCommittedHash = currentHash;
        this.lastCommittedNodeCount = this._countNodes(storeState);
      }
      this._clearCommitted(queuedBefore, currentHash);
      this._noteCommitted(storeState, writeResult);
      this.lastCommitTime = now; // Use original timestamp for rate limiting
      this._persistFloor();
      this._report(this.onSyncHeld, null);

      // Reset error tracking on successful commit
      this.consecutiveErrors = 0;
      this.isInErrorBackoff = false;

      vlog('[GitSyncEngine] forceCommit successful');
      this.notifyStatus('success', 'Commit successful');
      return true;

    } finally {
      this.isCommitInProgress = false;
      this._committingState = null;
    }
  }

  /**
   * Load state from Git repository.
   *
   * Returns `null` ONLY for a confirmed-missing or confirmed-empty file
   * ("start fresh" is safe). Every other failure — network, auth, truncated
   * read, corrupted JSON — THROWS: conflating them with "no file" let stale
   * browser-cache data load instead and later overwrite a newer remote.
   */
  async loadFromGit() {
    vlog('[GitSyncEngine] Loading from Git repository...');

    let content;
    let sha = null;
    try {
      const result = await this.provider.readFileRawWithMeta(this.getLatestPath());
      content = result.content;
      sha = result.sha;
      vlog('[GitSyncEngine] Loaded main universe file');
    } catch (error) {
      if (isConfirmedNotFound(error)) {
        vlog('[GitSyncEngine] Main file not found for slug, starting fresh');
        this.lastKnownRemoteSha = null; // confirmed absent
        return null;
      }
      // Auth/network/truncation — remote content is UNKNOWN, not missing.
      console.error('[GitSyncEngine] Failed to read from Git (not a 404 — surfacing):', error?.message || error);
      throw error;
    }

    this.lastKnownRemoteSha = sha;

    // Check if content is empty or whitespace
    if (!content || content.trim() === '') {
      vlog('[GitSyncEngine] File is empty, starting fresh');
      return null;
    }

    // Try to parse the content
    try {
      const redstringData = JSON.parse(content);
      vlog('[GitSyncEngine] Successfully parsed Redstring data');
      // A clean read clears any earlier "could not read the remote" latch.
      this.remoteUnrecognized = false;
      // Arm the shrink-to-zero floor from what the remote actually holds.
      // On a device that never committed (fresh mobile browser, evicted
      // localStorage) the persisted floor is 0 — this re-arms the guard
      // from truth the moment the remote is read.
      const remoteNodeCount = this._countNodesInRedstringData(redstringData);
      if (remoteNodeCount > this.lastCommittedNodeCount) {
        this.lastCommittedNodeCount = remoteNodeCount;
        this._persistFloor();
      }
      return redstringData;
    } catch (parseError) {
      console.warn('[GitSyncEngine] Failed to parse JSON, file may be corrupted:', parseError.message);
      const err = new Error(`Remote universe file is corrupted (invalid JSON): ${parseError.message}`);
      err.code = 'REMOTE_CORRUPT';
      throw err;
    }
  }

  /**
   * Manually end dragging state (useful for edge cases)
   */
  endDragging() {
    if (this.isDragging) {
      vlog('[GitSyncEngine] Manually ending dragging state');
      this.isDragging = false;
      this.dragStartTime = 0;

      // Clear debounce and commit immediately
      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
        this.debounceTimeout = null;
      }

      // Process any pending commits
      this.processPendingCommits();
    }
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      isRunning: this.isCommitInProgress, // TRUE means actively committing, not just background loop running
      isPaused: this.isPaused,
      pendingCommits: this.pendingCommits.length,
      lastCommitTime: this.lastCommitTime,
      lastSavedAt: this.lastSavedAt,
      provider: this.provider.name,
      sourceOfTruth: this.sourceOfTruth,
      hasChanges: this.hasChanges,
      lastCommittedHash: this.lastCommittedHash ? this.lastCommittedHash.substring(0, 8) : null,
      isDragging: this.isDragging,
      debounceActive: !!this.debounceTimeout,
      // Error tracking
      consecutiveErrors: this.consecutiveErrors,
      isInErrorBackoff: this.isInErrorBackoff,
      isHealthy: this.isHealthy(),
      lastErrorTime: this.lastErrorTime
    };
  }
}

export { GitSyncEngine, SOURCE_OF_TRUTH }; 