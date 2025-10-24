# Git Federation UX: Action Plan

## 🎯 TL;DR - Top 3 Critical Issues

1. **"Load from Repo" is completely broken** - No way to import a universe from a repository as a new universe
2. **Data loss risks** - Users can accidentally overwrite their work with no warning
3. **Confusing button labels** - "Create New Universe File" means the opposite of what users expect

---

## 🚀 Phase 1: Critical Fixes (Do First)

### Fix 1: Make "Load from Repo" Actually Work

**Current:** Opens repo modal but does nothing  
**Fix:** Add proper import flow

```javascript
// In GitNativeFederation.jsx

const handleLoadFromRepo = () => {
  // Set intent to 'import' mode
  setRepositoryIntent('import');
  setRepositoryTargetSlug(null); // No target, creating new
  setShowRepositoryManager(true);
};

const handleRepositorySelect = async (repo) => {
  if (repositoryIntent === 'import') {
    // NEW: Import flow for creating new universes from repo
    await handleImportUniverseFromRepo(repo);
  } else if (repositoryIntent === 'attach' && repositoryTargetSlug) {
    // EXISTING: Attach flow for existing universes
    await handleAttachRepoToExistingUniverse(repo, repositoryTargetSlug);
  }
};

const handleImportUniverseFromRepo = async (repo) => {
  // Discover universe files in repo
  const discovered = await gitFederationService.discoverUniverses({...});
  
  if (discovered.length === 0) {
    setError('No universe files found in this repository');
    return;
  }
  
  // Show selection modal with IMPORT options
  setDiscoveredUniverseFiles(discovered);
  setImportMode(true); // NEW flag
  setShowUniverseFileSelector(true);
};
```

**Result:** "Load from Repo" will actually import universes from repositories

---

### Fix 2: Add Warnings Before Data Loss

**Current:** No warnings when pulling remote data overwrites local  
**Fix:** Add confirmation dialogs

```javascript
const handleUniverseFileSelection = async (selectedFile) => {
  if (importMode) {
    // IMPORT MODE: Always safe, creates new universe
    await createNewUniverseFromFile(selectedFile);
  } else {
    // ATTACH MODE: Check if this will overwrite local data
    const localUniverse = serviceState.universes.find(u => u.slug === repositoryTargetSlug);
    const willOverwriteLocal = selectedFile.slug !== localUniverse.slug;
    
    if (willOverwriteLocal) {
      // Show warning dialog
      const confirmed = window.confirm(
        `⚠️ WARNING: This will overwrite your local data\n\n` +
        `Your universe: ${localUniverse.name} (${localUniverse.nodeCount} nodes)\n` +
        `Remote file: ${selectedFile.name} (${selectedFile.nodeCount} nodes)\n\n` +
        `Your current data will be archived as backup.\n\n` +
        `Continue?`
      );
      
      if (!confirmed) return;
      
      // Create backup first
      await createBackup(localUniverse);
    }
    
    // Proceed with linking
    await linkToRemoteFile(selectedFile);
  }
};
```

**Result:** Users get clear warnings before losing data

---

### Fix 3: Rename Confusing Buttons

**Changes needed:**

| Current | New | Context |
|---------|-----|---------|
| "Create New Universe File" | "Push My Data to Repo" | When attaching repo to existing universe |
| "Link" (in discovery) | "Import as New Universe" | When discovering universes in a repo |
| "Link to existing file" | "Sync with Remote File" | When choosing to sync with remote |

**Result:** Button labels match what actually happens

---

## 🎨 Phase 2: UX Improvements (Do Next)

### Improvement 1: Add Context Headers to Modals

```jsx
// Repository Selection Modal
<RepositorySelectionModal
  isOpen={showRepositoryManager}
  header={
    repositoryIntent === 'import' 
      ? 'Import Universe from Repository'
      : repositoryIntent === 'attach'
        ? `Link Repository to: ${targetUniverse?.name}`
        : 'Browse Repositories'
  }
  intent={repositoryIntent}
  onSelectRepository={handleRepositorySelect}
/>
```

**Result:** Users always know what action they're performing

---

### Improvement 2: Add Preview Before Importing

```jsx
// Show preview card for each discovered universe
<UniversePreviewCard
  name={file.name}
  stats={{
    nodes: file.nodeCount,
    connections: file.connectionCount,
    webs: file.graphCount,
    lastModified: file.lastModified
  }}
  onImport={() => importAsNewUniverse(file)}
  onPreview={() => showDetailedPreview(file)}
/>
```

**Result:** Users can see what they're importing before committing

---

### Improvement 3: Better Name Mismatch Handling

```javascript
if (nameM ismatch) {
  // Show dialog with 3 clear options:
  // 1. Rename local to match remote (pull remote data)
  // 2. Keep local name (push local data, rename remote)
  // 3. Cancel and choose different file
}
```

**Result:** Users understand consequences of each choice

---

## ✅ Testing Checklist

After implementing fixes, test these scenarios:

### Scenario 1: Import Universe from Repo (New User)
- [ ] User has no universes
- [ ] Clicks "Load" → "From Repository"
- [ ] Selects a repo with universe files
- [ ] Sees list of discovered files with stats
- [ ] Clicks "Import as New Universe"
- [ ] New universe appears in list
- [ ] Can switch to it and see the data

### Scenario 2: Attach Repo to Existing Universe
- [ ] User has universe "My Work" with 50 nodes
- [ ] Clicks "Add Repository" on "My Work" card
- [ ] Modal header shows "Link Repository to: My Work"
- [ ] Selects a repo
- [ ] If repo has no files: Shows "Push My Data to Repo" option
- [ ] If repo has files: Shows "Sync with Remote File" or "Push New File"
- [ ] Selecting mismatched file shows warning with node counts
- [ ] Warning offers backup option
- [ ] After linking, syncs work correctly

### Scenario 3: Discover and Import from Sources
- [ ] User has universe with repo source linked
- [ ] Clicks "Discover universes" on source
- [ ] Sees discovered files with stats
- [ ] Clicks "Import as New Universe"
- [ ] Creates NEW universe (doesn't overwrite current)
- [ ] Original universe unchanged

### Scenario 4: Name Match (Happy Path)
- [ ] User has universe "shared-knowledge"
- [ ] Attaches repo that has "shared-knowledge.redstring"
- [ ] System detects name match
- [ ] Shows "✨ Sync with Matching File" as recommended option
- [ ] Linking works smoothly without overwrites

---

## 📦 Files to Modify

1. **GitNativeFederation.jsx** (main file)
   - Add `repositoryIntent` state
   - Split `handleRepositorySelect` into import vs attach flows
   - Add `handleImportUniverseFromRepo` function
   - Add warnings before data overwrites
   - Update universe file selection logic

2. **RepositorySelectionModal.jsx**
   - Add `intent` prop
   - Add `header` prop for context
   - Update UI to show current action

3. **UniversesList.jsx**
   - Update `handleLoadFromRepoClick` to set intent to 'import'

4. **Git Federation Service**
   - Add `createUniverseFromDiscovered(file, repoInfo)` function
   - Ensure discovery includes stats (nodeCount, etc.)

---

## 🎯 Success Metrics

After fixes:
- ✅ "Load from Repo" successfully imports universes
- ✅ Zero accidental data loss incidents
- ✅ Users understand what each button does
- ✅ Clear visual context in all modals
- ✅ Warnings before any destructive action

---

## 💬 Quick Win: Update Just the Button Labels

If you want ONE quick fix that improves UX immediately:

```javascript
// Universe File Selector Modal - just change the text

// ❌ OLD
<button>Create New Universe File</button>
<div>Or link to existing file:</div>

// ✅ NEW
<button>📤 Push My Data (Create New File in Repo)</button>
<div>Or pull data from existing file:</div>
<button>📥 Import: {file.name}</button>
```

This single change makes it WAY clearer what's happening, even without fixing the underlying flows.

