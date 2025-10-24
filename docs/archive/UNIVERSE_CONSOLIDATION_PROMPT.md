# Universe Manager Consolidation Prompt

## Task
Consolidate `src/services/universeManager.js` (2,283 lines) into `src/services/universeBackend.js` (1,587 lines) to eliminate architectural duplication and synchronization bugs.

## Current Problem
- **Two services** managing the same state: `universeManager` (real logic) + `universeBackend` (hollow facade)
- **39 delegation calls** in universeBackend that just forward to universeManager
- **Duplicate state** causing sync bugs (fileHandles, gitSyncEngines in both)
- **1,500+ lines** of pointless delegation code

## What to Do

### Step 1: Copy Core State from universeManager to universeBackend
Add these to `universeBackend.js` constructor:
```javascript
// Core universe state (from universeManager)
this.universes = new Map(); // slug -> universe data
this.activeUniverseSlug = null;
this.deviceConfig = null;
this.watchdogInterval = null;
this.initializationPromise = null;
```

### Step 2: Copy Essential Methods
Copy these methods from `universeManager.js` into `universeBackend.js` WITH their implementations (not delegation):

**Core Universe Management:**
- `loadFromStorage()` - Load universes from browser storage
- `getAllUniverses()` - Return array of all universes
- `getUniverse(slug)` - Get specific universe
- `createUniverse(name, options)` - Create new universe
- `updateUniverse(slug, updates)` - Update universe properties
- `deleteUniverse(slug)` - Delete universe
- `getActiveUniverse()` - Get currently active universe
- `setActiveUniverse(slug)` - Switch active universe

**Data Loading/Saving:**
- `loadUniverseData(universe)` - Load universe data into store
- `saveActiveUniverse(storeState)` - Save current universe data
- `loadFromGit(universe)` - Load from Git repository
- `loadFromLocalFile(universe)` - Load from local file
- `loadFromBrowserStorage(universe)` - Load from browser storage
- `saveToGit(universe, data)` - Save to Git
- `saveToLocalFile(universe, data)` - Save to local file
- `saveToBrowserStorage(universe, data)` - Save to browser storage

**File Handle Management:**
- `setFileHandle(slug, handle)` - Store file handle
- `getFileHandle(slug)` - Get file handle
- `removeFileHandle(slug)` - Remove file handle

**Background Services:**
- `initializeBackgroundSync()` - Start background sync
- `setupDeviceConfig()` - Configure device settings
- `startWatchdog()` - Start file watching
- `stopWatchdog()` - Stop file watching

### Step 3: Replace All Delegation Calls
Find all 39 instances of `universeManager.method()` in universeBackend and replace with `this.method()`.

**Search pattern:** `universeManager\.`
**Replace with:** `this.`

### Step 4: Remove universeManager Loading Code
Delete these lines from universeBackend:
```javascript
// Lines 10-11: Remove this
let universeManager = null;

// Lines 76-82: Remove the loading block
if (!universeManager) {
  const module = await import('../backend/universes/index.js');
  universeManager = module.default || module.universeManager;
}
```

### Step 5: Update Method Calls
Replace all `universeManager.` calls with `this.` in the initialization and other methods.

### Step 6: Delete universeManager.js
Once universeBackend is self-contained, delete `src/services/universeManager.js`.

## Files to Update
1. `src/services/universeBackend.js` - Main consolidation work
2. `src/services/gitSyncEngine.js` - Update import if needed
3. `src/components/FederationBootstrap.jsx` - Update import
4. `src/components/UniverseBrowser.jsx` - Update import

## Testing Checklist
- [ ] App builds without errors
- [ ] Universe creation works
- [ ] Universe switching works  
- [ ] Local file linking works
- [ ] Git repository linking works
- [ ] Data persists on refresh
- [ ] File handles work correctly
- [ ] No "universeManager" references in console

## Key Benefits
- ✅ Single source of truth for universe state
- ✅ No more manual synchronization bugs
- ✅ ~1,500 lines of delegation code deleted
- ✅ Clear, simple API
- ✅ No circular dependencies

## Critical Notes
- Keep the `src/backend/universes/index.js` adapter - it provides backward compatibility
- The `SOURCE_OF_TRUTH` constant can stay in the adapter
- Don't break the existing `forceSave` multi-storage logic
- Preserve all the file handle persistence logic

## Success Criteria
After completion:
- universeBackend.js is self-contained (no universeManager imports)
- All 39 delegation calls replaced with direct method calls
- universeManager.js is deleted
- App builds and runs without errors
- All universe operations work correctly

This consolidation will eliminate the synchronization bugs and architectural bloat that's been causing issues.
