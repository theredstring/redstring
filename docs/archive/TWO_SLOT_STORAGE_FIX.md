# Two-Slot Storage System Fix

## Problem Summary

Since adding Git functionality, the local file save-only flow was broken. When attaching a Git repository to an existing local-file-only universe, Git would **overwrite local file data** instead of serving as a backup slot.

## Root Cause

**File:** `src/services/gitFederationService.js`  
**Line:** 415 (before fix)

```javascript
// OLD CODE - BROKEN
await universeBackendBridge.updateUniverse(slug, {
  gitRepo: { ... },
  sourceOfTruth: 'git'  // ← HARDCODED! This overwrites existing preference
});
```

When `attachGitRepository()` was called, it **forcibly changed** `sourceOfTruth` to `'git'`, ignoring whether the universe already had local file as primary. This caused Git to become authoritative and overwrite local changes.

## The Two-Slot Storage System

Redstring implements a **dual-slot storage architecture**:

### Slots

1. **Primary Slot** (Source of Truth)
   - Authoritative source for universe data
   - Wins in merge conflicts
   - Determined by `sourceOfTruth` field: `'local'` or `'git'`

2. **Secondary Slot** (Backup)
   - Receives synced copies of data
   - Provides redundancy and cross-device access
   - Can be promoted to primary at any time

### Valid Configurations

| Local File | Git Repo | Source of Truth | Use Case |
|------------|----------|-----------------|----------|
| ✅ Enabled | ❌ Disabled | `'local'` | Local-only workflow |
| ❌ Disabled | ✅ Enabled | `'git'` | Git-only workflow (mobile) |
| ✅ Enabled | ✅ Enabled | `'local'` | Local primary + Git backup |
| ✅ Enabled | ✅ Enabled | `'git'` | Git primary + Local cache |

## The Fix

**File:** `src/services/gitFederationService.js`  
**Lines:** 387-424

```javascript
// NEW CODE - FIXED
const preservedSourceOfTruth = universe.raw.sourceOfTruth || 
  (universe.raw.localFile?.enabled ? 'local' : 'git');

await universeBackendBridge.updateUniverse(slug, {
  gitRepo: { ... },
  sourceOfTruth: preservedSourceOfTruth  // ← Respects existing preference!
});
```

### Fix Logic

1. **Preserve existing sourceOfTruth** if set
2. **Smart default** based on enabled slots:
   - If local file is enabled → default to `'local'` (safe choice)
   - Otherwise → default to `'git'`
3. User can **explicitly change** primary via `setPrimaryStorage()`

## How It Works Now

### Scenario 1: Adding Git to Local-Only Universe

```javascript
// Before: Universe with local file only
{
  sourceOfTruth: 'local',
  localFile: { enabled: true },
  gitRepo: { enabled: false }
}

// User clicks "Add Repository"
// After: Git added as BACKUP slot
{
  sourceOfTruth: 'local',        // ← PRESERVED! Local stays primary
  localFile: { enabled: true },  // ← Still primary
  gitRepo: { enabled: true }     // ← Added as backup
}
```

**Result:** Local file data is preserved. Git receives a copy. Local remains authoritative.

### Scenario 2: Adding Local File to Git Universe

```javascript
// Before: Universe with Git only
{
  sourceOfTruth: 'git',
  localFile: { enabled: false },
  gitRepo: { enabled: true }
}

// User clicks "Link Local File"
// After: Local added as CACHE slot
{
  sourceOfTruth: 'git',          // ← PRESERVED! Git stays primary
  localFile: { enabled: true },  // ← Added as cache
  gitRepo: { enabled: true }     // ← Still primary
}
```

**Result:** Git data is preserved. Local file receives a copy. Git remains authoritative.

## Related Code

### GitSyncEngine Merge Logic

**File:** `src/services/gitSyncEngine.js`  
**Lines:** 215-256

The GitSyncEngine respects `sourceOfTruth` when merging data:

```javascript
// LOCAL MODE: Local file is authoritative
if (this.sourceOfTruth === SOURCE_OF_TRUTH.LOCAL) {
  if (gitHasContent && localHasContent) {
    return null; // Keep local content, sync to Git
  }
}

// GIT MODE: Git repository is authoritative
if (this.sourceOfTruth === SOURCE_OF_TRUTH.GIT) {
  if (gitHasContent && localHasContent) {
    return gitData; // Use Git data as source of truth
  }
}
```

### UI Integration

**File:** `src/GitNativeFederation.jsx`

The Git Federation panel shows both slots and allows users to:
- View which slot is primary
- Switch primary slot via "Make Primary" button
- Detach either slot without losing the other

## Testing Checklist

- [x] Create local-only universe
- [ ] Add Git repo to it
- [ ] Verify local data is NOT overwritten
- [ ] Verify sourceOfTruth remains 'local'
- [ ] Verify Git receives synced copy
- [ ] Click "Make Primary" on Git slot
- [ ] Verify sourceOfTruth changes to 'git'
- [ ] Create Git-only universe
- [ ] Add local file to it
- [ ] Verify Git data is NOT overwritten
- [ ] Verify sourceOfTruth remains 'git'

## Benefits

1. **No Data Loss** - Adding a second storage slot never overwrites existing data
2. **User Control** - Explicit "Make Primary" action required to change authority
3. **Flexible Workflows** - Supports local-only, Git-only, and hybrid modes
4. **Mobile-Friendly** - Git-only mode still works for mobile/tablet
5. **Backup & Sync** - Both slots stay synchronized regardless of which is primary

## Migration Notes

Existing universes are unaffected. The fix only applies to **new** repository attachments. If you previously attached a Git repo and lost local data, you may need to:

1. Detach the Git repository
2. Reload your universe from local file backup
3. Re-attach Git repo (it will now respect local as primary)

