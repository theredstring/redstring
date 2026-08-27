# Git Federation in Redstring (Single-Source Guide)

Status: Authoritative overview of the current system

This guide explains how Redstring’s Git-first federation works today: how universes are stored, how syncing operates, how UI flows map to services, and what repo structures are expected.

## Core Concepts

- **Universe**: A Redstring workspace. In Git mode it lives under `universes/<slug>/<file>.redstring`.
- **Source of Truth**: Which storage defines what appears on screen. Options: `git` (default), `local` file, or `browser` fallback.
- **Two-Slot Storage System** per universe:
  - **Primary Slot**: Authoritative source of truth (determined by `sourceOfTruth` field)
  - **Secondary Slot**: Backup/sync target that receives copies
  - Available slots: Git repository, Local `.redstring` file, Browser storage (IndexedDB)
  - **IMPORTANT**: Adding a second storage slot preserves the existing `sourceOfTruth` to prevent data loss
  - Users can explicitly promote secondary → primary via UI or `setPrimaryStorage()` API

## Repository Layout

- Primary file path used by sync: `universes/<slug>/<fileBaseName>.redstring`
  - Defaults: folder `universes/<slug>`, file `<slug>.redstring` unless configured otherwise
  - Created automatically if missing when reading in Git mode

Optional (not required by the current engine):
- You may keep sharded mirrors (e.g., `universe/nodes/*.json`) for human PR ergonomics. The engine reads/writes the canonical JSON `.redstring` file.

## Architecture and Services

- `src/services/universeManager.js` (UniverseManager)
  - Orchestrates universes, switching, saving, loading
  - Knows source-of-truth per universe and chooses load path: Git → Local → Browser
  - Can read Git directly without a registered engine when needed

- `src/services/gitSyncEngine.js` (GitSyncEngine)
  - Background sync to Git provider with batching and rate-limit aware commits
  - Writes raw JSON snapshots to `universes/<slug>/<file>.redstring`
  - Conflict handling, backoff, and a force-commit path for user-invoked saves
  - Modes: `git` (default) or `local` source-of-truth for merge decisions

- `src/services/gitNativeProvider.js` (SemanticProvider + GitHub provider)
  - Uniform provider interface with raw read/write methods
  - Current implementation targets GitHub REST API with OAuth or GitHub App tokens
  - Handles base64 encoding, SHA-based updates, and 409 conflict retry

- `src/services/gitFederationService.js`
  - UI bridge for listing universes, attaching repos, and toggling storage slots
  - Computes per-universe status and exposes helpers used by federation UI

- UI Surfaces
  - `src/GitNativeFederation.jsx`: Federated storage panel (connect Git, manage universes, inspect sync)
  - `src/components/UniverseOperationsDialog.jsx`: Centralized universe management, source-of-truth selection, storage toggles

## Source of Truth Behavior

The GitSyncEngine merges based on the selected source-of-truth:
- `git` mode (default): If Git has content, Git wins. If Git empty and local has content, keep local and sync on next commit.
- `local` mode: Local is authoritative; Git is a backup target.
- Browser fallback is used for mobile or when neither Git nor Local can serve content.

Note: The engine writes a single canonical JSON `.redstring` file. It does not currently shard or maintain multiple mirrors.

## Authentication

- Preferred: GitHub App installation tokens when available (automatic refresh; reduced rate limits)
- Fallback: OAuth token stored locally via `persistentAuth`
- Provider is checked for availability before Git reads; the UI surfaces errors when auth is missing

### Auth Auto-Connect and Installation Discovery

- `src/services/persistentAuth.js`
  - On startup (`initialize()`), triggers `attemptAutoConnect()` in the background.
  - GitHub App path: if no stored installation, it now queries the backend for existing installations (`GET /api/github/app/installations`), selects the most recent, fetches an installation token (`POST /api/github/app/installation-token`), pulls installation details (`GET /api/github/app/installation/:id`), stores them, and emits connected events. This fixes the “already installed then click back” loop.
  - OAuth path: validates existing tokens via backend validation (`POST /api/github/oauth/validate`), stores/extends expiry, and emits events.
  - Emits window events consumed across the app: `redstring:auth-token-stored` and `redstring:auth-connected`.

- `src/services/oauthAutoConnect.js`
  - Session-scoped auto-connect service (optional/secondary) with similar logic. If no auth at all, it can trigger the OAuth flow by redirecting to GitHub after fetching the client id from `GET /api/github/oauth/client-id`.

- `src/components/FederationBootstrap.jsx`
  - Runs at app startup, calls `persistentAuth.initialize()`, initializes background sync, and wires `SaveCoordinator` to the current universe/sync engine.

### Backend Endpoints (oauth-server.js)

- OAuth: `GET /api/github/oauth/client-id`, `POST /api/github/oauth/token`, `POST /api/github/oauth/validate`, `DELETE /api/github/oauth/revoke`.
- GitHub App: `GET /api/github/app/installations`, `GET /api/github/app/installation/:installation_id`, `POST /api/github/app/installation-token`, `GET /api/github/app/info`.

### Storage Keys and Events (for debugging)

- Local/session storage keys:
  - `github_access_token`, `github_token_expiry`, `github_user_data`
  - `github_app_installation_id`, `github_app_access_token`, `github_app_repositories`, `github_app_user_data`, `github_app_last_updated`
  - Session: `oauth_autoconnect_attempted`, `github_oauth_pending`, `github_oauth_state`
- Window events to watch: `redstring:auth-token-stored`, `redstring:auth-connected`
- Common symptoms:
  - Already-installed GitHub App but UI asks to reinstall → installation discovery should auto-connect on load.
  - 401 while listing repos → token invalid; `persistentAuth` will clear and re-auth.
  - Rate-limit/info spam in sync → circuit breaker active in `gitSyncEngine`.

## Sync Model

- Real-time local updates are recorded in memory; commits are batched on an interval (20–30s depending on auth method)
- Intelligent debouncing during drag operations reduces churn
- Circuit breaker prevents API spam; error backoff after repeated failures
- Force save path allows immediate overwrite with exponential backoff for 409 conflicts

## Typical Flows

1) Connect a Git repository
   - From the federation panel, attach a repo to a universe
   - Set source of truth to `git` to drive the UI from the remote file

2) Load a universe from Git URL
   - Use the Universe Operations dialog’s Git flow
   - If the target file is missing, the manager seeds a new empty universe file remotely

3) Edit and persist
   - UI edits are immediate; background sync writes JSON to Git
   - You can also trigger a force save from UI if needed

4) Switch universes
   - Switching swaps active datasets; each universe retains its own storage configuration

## Conflict and Rate Limits

- 409 conflicts are retried with fresh SHAs and small exponential backoff
- Minimum intervals between commits, plus batching, reduce provider rate pressure
- Circuit breaker opens when too many API calls occur; resumes after cooldown

## File Names and Paths

- Folder and filename are configurable per universe: `gitRepo.universeFolder`, `gitRepo.universeFile`
- Defaults are computed from the universe slug
- The engine sanitizes `fileBaseName` to avoid encoding issues

## Provider Notes (GitHub Today)

- REST API for file contents is used, not the native Git protocol
- Auth header differs for GitHub App vs OAuth tokens
- Read/write endpoints are wrapped with retry and basic error reporting

## Backward Compatibility

- Local `.redstring` files continue to work; users can set local as source of truth
- Browser storage enables mobile use without the File System Access API
- Sharded mirrors are optional and not required by the current sync engine

## Guidance for Repos

- Keep universes under `universes/<slug>/` with one canonical JSON file
- Use branches and PRs normally; reviewers can diff the JSON
- If you need human-friendly merges, you may introduce sharded mirrors in a parallel structure, but Redstring’s sync currently interacts with the canonical JSON file only

## Where to Look in Code

- Universe orchestration: `src/services/universeManager.js`
- Sync engine: `src/services/gitSyncEngine.js`
- Git provider abstraction + GitHub implementation: `src/services/gitNativeProvider.js`
- Federation UI service: `src/services/gitFederationService.js`
- UI: `src/GitNativeFederation.jsx`, `src/components/UniverseOperationsDialog.jsx`

## Universe Coordination

- `src/services/universeManager.js` is currently the orchestration layer for:
  - Managing universes (create/delete/rename, active universe, storage slots, source-of-truth)
  - Loading/saving data via Git, local files, or browser storage
  - Registering and exposing `GitSyncEngine` instances per universe
- `src/services/universeBackend.js` is a façade used by UI components, but it delegates extensively to `universeManager` for the operations above. Removing `universeManager` without consolidation would break:
  - Active universe switching, data loading piped into the store, file-handle flows
  - Engine registration and lifecycle wiring
  - Git discovery/link flows
- Consolidation path: migrate `universeManager` responsibilities into `universeBackend` (single backend surface), update imports in UI (`UniverseOperationsDialog`, `FederationBootstrap`, etc.), and decouple `GitSyncEngine` from requiring a manager reference.

## Two-Slot Storage System Implementation

### Fix for Local File Preservation (2025-01)

**Problem**: When attaching a Git repository to an existing local-file-only universe, the system was forcibly changing `sourceOfTruth` to `'git'`, causing Git to overwrite local file data.

**Solution**: Modified `gitFederationService.attachGitRepository()` to **preserve** existing `sourceOfTruth`:

```javascript
// Before (BROKEN - caused data loss):
sourceOfTruth: 'git'  // Hardcoded, overwrote user's preference

// After (FIXED - preserves user's workflow):
const preservedSourceOfTruth = universe.raw.sourceOfTruth || 
  (universe.raw.localFile?.enabled ? 'local' : 'git');
```

**Benefits**:
- Local-only workflows can add Git as backup without data loss
- Git-only workflows can add local cache without confusion
- User must explicitly promote secondary → primary (safe by default)
- Supports flexible hybrid workflows (local primary + Git backup, or vice versa)

**See Also**: `TWO_SLOT_STORAGE_FIX.md` for detailed explanation and testing checklist.

## Recent Fixes

### Local File Import Fix (2025-01)

**Problem**: When loading a local `.redstring` file, the system would crash with error: `TypeError: Cannot read properties of undefined (reading 'getState')`.

**Root Cause**: `graphStore.jsx` exports `useGraphStore` as a default export, but several files were attempting to use named import syntax:
```javascript
// BROKEN - Named import from default export
const { useGraphStore } = await import('./store/graphStore.jsx');
```

**Solution**: Fixed all dynamic imports to use correct default export syntax:
```javascript
// FIXED - Proper default import
const useGraphStore = (await import('./store/graphStore.jsx')).default;
```

**Files Updated**:
- `src/GitNativeFederation.jsx` (2 instances)
- `src/services/universeBackend.js` (2 instances)

**Impact**: Local file loading and universe import flows now work correctly.

### Data Loss on File Link Fix (2025-01)

**Problem**: When linking a local file to the current universe, the file would parse successfully but the universe would show 0 nodes instead of the actual data.

**Root Cause**: Unnecessary `switchUniverse()` call was reloading empty state AFTER file data was loaded, wiping it out. Since we're linking a file to the *current* universe, switching is both unnecessary and destructive.

**Solution**: Removed the `switchUniverse()` call entirely and load data directly:
```javascript
// FIXED: Load directly without switching (we're already in the target universe)
const storeState = importFromRedstring(parsedData);
console.log('[GitNativeFederation] Parsed file data:', { nodeCount: ... });

const useGraphStore = (await import('./store/graphStore.jsx')).default;
const storeActions = useGraphStore.getState();
storeActions.loadUniverseFromFile(storeState);  // Load directly

await universeBackend.setFileHandle(slug, fileHandle);
await universeBackend.linkLocalFileToUniverse(slug, file.name);
// No switch needed - we're already here!
```

**Files Updated**:
- `src/GitNativeFederation.jsx` (lines 1478-1497)

**Impact**: File data now loads correctly into the current universe without being wiped out.

**Note**: Added console logging to track the data flow for debugging.

### File Name Mismatch Handling (2025-01)

**Enhancement**: Added name reconciliation flow when linking local files with names that don't match the target universe.

**Implementation**: Similar to the Git repository file selection flow (lines 1018-1040), when a user links a local file with a mismatched name, the system now:
1. Detects name mismatch between file and universe
2. Shows warning dialog explaining the mismatch
3. Allows user to confirm or cancel
4. Proceeds with linking only after explicit confirmation

**Code Changes**: `src/GitNativeFederation.jsx` (lines 1512-1555)

**Benefits**:
- Prevents accidental data replacement from wrong files
- Makes naming conflicts explicit and user-controlled
- Consistent UX with Git repository sync flow
- Users understand when file name ≠ universe name

### Format Versioning System (2025-01)

**Problem**: Risk of data loss during format updates, no way to handle incompatible file versions, and no migration path for older files.

**Solution**: Implemented comprehensive versioning and migration system for `.redstring` files.

**Implementation**:

1. **Version Metadata** - Every exported file now includes:
   ```json
   {
     "format": "redstring-v3.0.0",
     "metadata": {
       "version": "3.0.0",
       "formatHistory": { ... }
     }
   }
   ```

2. **Validation** - Before importing, files are validated:
   - Check version is within supported range (1.0.0 to 3.0.0)
   - Detect if migration is needed
   - Provide clear error messages for incompatible versions

3. **Automatic Migration** - Files from older versions are automatically migrated:
   - v1.0.0 → v2.0.0-semantic → v3.0.0
   - Migration metadata is preserved
   - Users see progress messages during migration

4. **User Feedback**:
   - "Migrating file from format 2.0.0 to 3.0.0..."
   - "File migrated from format 2.0.0 to 3.0.0"
   - Clear errors for incompatible versions

**Code Changes**:
- `src/formats/redstringFormat.js`:
  - Added `CURRENT_FORMAT_VERSION`, `MIN_SUPPORTED_VERSION`, `VERSION_HISTORY` constants
  - Added `parseVersion()`, `compareVersions()` helper functions
  - Added `validateFormatVersion()` for validation
  - Added `migrateFormat()` for automatic migration
  - Updated `exportToRedstring()` to include version metadata
  - Updated `importFromRedstring()` to validate and migrate
- `src/GitNativeFederation.jsx`:
  - Updated `handleLinkLocalFile()` to validate before importing (lines 1488-1536)
  - Added migration progress messages
  - Added helpful error messages for version mismatches

**Benefits**: 
- User data is protected during updates
- Old files can be automatically migrated
- Clear feedback about version compatibility
- Foundation for future format evolution
- Peace of mind for production releases

**Documentation**: See `REDSTRING_FORMAT_VERSIONING.md` for complete developer guide and API reference.

### Local-First Storage Architecture (2025-01)

**Problem**: The system was too Git-centric, always trying to create Git engines even when Git wasn't enabled. This made local file storage feel like a fallback rather than a first-class feature.

**Solution**: Completely rewrote the `forceSave` method in `universeBackend.js` to support **multi-storage sync** with local-first design.

**New Multi-Storage Sync System**:

When you save, the system saves to **ALL enabled storage locations** to keep them in sync:

1. **Local File Storage** (if enabled and has file handle)
   - Saves directly to the linked `.redstring` file
   - Works completely independently of Git
   - First-class storage option

2. **Git Repository** (if linked and authenticated)
   - Saves to GitHub/Gitea repository
   - Enabled when user explicitly links a repo
   - Requires authentication
   - Opt-in, not required

3. **Browser Storage** (always enabled)
   - Universal fallback/cache for all universes
   - Always saves as backup
   - Available offline

**Source of Truth**: Only matters when **LOADING** data. If you have both local file and Git enabled, "source of truth" determines which one to trust when they differ. When **SAVING**, both get updated to stay in sync.

**Code Changes**: `src/services/universeBackend.js` (lines 932-1073)
- Removed automatic Git engine creation
- Saves to all enabled storage locations concurrently
- Added detailed logging for each storage method
- Returns detailed results showing what was saved where
- Git only activates when explicitly linked

**Benefits**:
- Local file storage works independently without Git
- Multiple storage locations stay in sync automatically
- Git cannot access data unless explicitly enabled
- Clear separation between storage methods
- GitHub only has access when user explicitly links it
- Resilient: if one storage fails, others still succeed

**Impact**: Users can work entirely with local files, or enable Git for collaboration, or use both. Storage options are additive, not exclusive. Git federation is a feature you opt into, not a requirement.

### File Handle Synchronization Fix (2025-01)

**Problem**: File handles were being stored in `universeBackend.fileHandles` but `universeManager.loadFromLocalFile()` was looking in `universeManager.fileHandles` - two separate Maps! This caused "No file handle available" errors on universe refresh/reload.

**Solution**: When storing a file handle, now store it in BOTH `universeBackend.fileHandles` AND `universeManager.fileHandles` so both services can access it.

**Code Changes**: `src/services/universeBackend.js` (line 1199)
- Added `universeManager.fileHandles.set(universeSlug, fileHandle);` to `setFileHandle()` method
- File handles now accessible to both backend and manager

**Impact**: Local file data now persists correctly across universe switches and page refreshes. The UI correctly shows linked local files after refresh.

## Roadmap Highlights

- Additional providers (GitLab/Gitea) using the same provider interface
- Optional sharded files maintained by the engine for lower-conflict PRs
- Richer semantic diffs in PR templates and CI validation


