# Git Federation Frontend Integration: System Implementation Plan

## Context and Scope

You are tasked with fixing the user experience flows in the Git Federation UI component of a React application. This is STRICTLY a frontend integration task - all backend APIs, save/load mechanics, and Git sync functionality are working perfectly. Do not modify any backend services, API endpoints, or core save/load logic.

### What Works Perfectly (DO NOT MODIFY)
- Save coordination and debouncing (500ms)
- Git sync engine and commit batching
- Local file storage via File System API
- State persistence to Git repositories
- Real-time sync status indicators ("Saving...", "Not Saved", "Saved")
- Viewport and node data persistence
- All backend services in src/services/

### What Needs Fixing (FRONTEND ONLY)
The issue is NOT with saving or loading mechanics. The issue is with the USER FLOWS for:
1. Returning users accessing their previously saved data
2. Importing existing universes from GitHub repositories
3. Connecting local universes to remote repositories
4. Session continuation - how users get their data back after closing the browser

Think of it like this: The "File > Save" functionality works perfectly. The "File > Open Recent" and "File > Open from Repository" flows are broken.

---

## Current State Analysis

### The Core Problem
When a user returns to the application after closing their browser, they need to be able to:
1. Load their previously linked universe from a GitHub repository
2. Import someone else's universe from a shared repository
3. Attach a new repository to an existing local universe

Currently, these flows are broken or confusing in the FRONTEND UI, despite the backend operations working correctly.

### Critical Issues in GitNativeFederation.jsx

#### Issue 1: "Load from Repo" Button Does Nothing
Location: src/components/git-federation/UniversesList.jsx line 106-111

Current behavior:
The handleLoadFromRepoClick calls onLoadFromRepo which opens the repository manager, but repositoryTargetSlug is null. When a repository is selected, handleRepositorySelect() has no context about what to do. It expects to be attaching a repo to an EXISTING universe, but the user wants to CREATE a new universe from repo data.

Expected flow:
- User clicks "Load > From Repository"
- Selects a GitHub repository
- System discovers .redstring files in that repository
- User selects which file to import
- System creates a NEW local universe with that data
- New universe appears in the universes list

#### Issue 2: Ambiguous Button Labels in Universe File Selector
Location: GitNativeFederation.jsx line 2028-2048 (Universe File Selection Modal)

Current labels:
- "Create New Universe File" - Sounds like creating a new local universe, but actually means "push my local data to a new file in the repo"
- "Or link to existing file:" - Sounds passive, but actually pulls remote data and can overwrite local

Problem: Users expect "Create New" to create something locally. They expect "Load from Repo" to pull data FROM the repo. The current labels are backwards from user mental model.

#### Issue 3: No Warnings Before Data Loss
Location: handleUniverseFileSelection() in GitNativeFederation.jsx line 897-1010

Current behavior: When linking a discovered universe file that has a different name than the local universe, the system pulls remote data and overwrites local data with only a name mismatch dialog.

Problem: Users can lose their work without understanding the consequences. The name mismatch dialog asks about renaming but doesn't clearly explain that one direction overwrites their local data.

#### Issue 4: Missing "Import Mode" Context
Location: handleRepositorySelect() in GitNativeFederation.jsx line 712-739

Current behavior: The repository selection modal is used for multiple purposes (attaching to existing universe, browsing repos, loading new universe) but has no way to distinguish intent.

Problem: The same modal and handler serve multiple user flows, but the code doesn't track which flow the user initiated, leading to incorrect behavior.

#### Issue 5: Confusing Discovery "Link" Button
Location: Rendered in GitNativeFederation.jsx around line 1640

Current behavior: When discovering universes in a repository source, each result has buttons like "Import Copy" and "Sync to Universe".

Problem: Clicking these on a discovered universe can pull that data into the CURRENT universe, potentially overwriting the user's work. There's insufficient warning and the action labels don't clearly communicate the consequences.

---

## Required Changes (Frontend Only)

### Change 1: Add Intent Tracking to Repository Modal Flow

Add state variable in GitNativeFederation.jsx:

```javascript
const [repositoryIntent, setRepositoryIntent] = useState(null);
// Possible values: 'import' | 'attach' | 'browse' | null
```

Update handlers:

```javascript
// When "Load from Repo" is clicked
const handleLoadFromRepo = () => {
  setRepositoryIntent('import');  // NEW: Set intent
  setRepositoryTargetSlug(null);   // No target universe
  setShowRepositoryManager(true);
};

// When "Add Repository" on universe card is clicked (via onLinkRepo prop)
const handleAttachRepo = (slug) => {
  setRepositoryIntent('attach');   // NEW: Set intent
  setRepositoryTargetSlug(slug);   // Target universe
  setShowRepositoryManager(true);
};
```

Update handleRepositorySelect to branch on intent:

```javascript
const handleRepositorySelect = async (repo) => {
  if (!repo) {
    setRepositoryIntent(null);
    setRepositoryTargetSlug(null);
    setShowRepositoryManager(false);
    return;
  }

  if (repositoryIntent === 'import') {
    // NEW FLOW: Import universe from repo as NEW universe
    await handleImportFromRepository(repo);
    return;
  }

  if (repositoryIntent === 'attach' && repositoryTargetSlug) {
    // EXISTING FLOW: Attach repo to existing universe
    await handleAttachRepoToUniverse(repo, repositoryTargetSlug);
    return;
  }

  // Fallback: close the modal if no intent/target was specified
  setRepositoryIntent(null);
  setRepositoryTargetSlug(null);
  setShowRepositoryManager(false);
};
```

### Change 2: Implement Import Flow

Add new handler for importing universes:

```javascript
const handleImportFromRepository = async (repo) => {
  const owner = repo.owner?.login || repo.owner?.name || repo.owner || repo.full_name?.split('/')[0];
  const repoName = repo.name || repo.full_name?.split('/').pop();

  if (!owner || !repoName) {
    setError('Selected repository is missing owner/name metadata.');
    setRepositoryIntent(null);
    setShowRepositoryManager(false);
    return;
  }

  try {
    setLoading(true);
    setShowRepositoryManager(false);
    setRepositoryTargetSlug(null);

    const repoKey = `${owner}/${repoName}`;
    const alreadyManaged = managedRepositories.some(r =>
      `${r.owner?.login || r.owner}/${r.name}` === repoKey
    );

    if (!alreadyManaged) {
      const newList = [...managedRepositories, repo];
      setManagedRepositories(newList);
      localStorage.setItem('redstring-managed-repositories', JSON.stringify(newList));
      console.log(`[GitNativeFederation] Auto-added ${repoKey} to managed repositories for import`);
    }

    console.log(`[GitNativeFederation] Import discovery for ${owner}/${repoName}`);
    const discovered = await gitFederationService.discoverUniverses({
      user: owner,
      repo: repoName,
      authMethod: dataAuthMethod || 'oauth'
    });

    if (!Array.isArray(discovered) || discovered.length === 0) {
      setError(`No universe files found in ${owner}/${repoName}`);
      return;
    }

    setPendingRepoAttachment({
      repo,
      owner,
      repoName,
      mode: 'import'  // NEW: Mark as import mode
    });
    setDiscoveredUniverseFiles(discovered);
    setShowUniverseFileSelector(true);
  } catch (err) {
    console.error('[GitNativeFederation] Import discovery failed:', err);
    setError(`Failed to discover universes: ${err.message}`);
  } finally {
    setLoading(false);
    setRepositoryIntent(null);
  }
};
```

### Change 3: Update Universe File Selection Logic

Modify handleUniverseFileSelection to handle import vs attach modes:

```javascript
const handleUniverseFileSelection = async (selectedFile) => {
  if (!pendingRepoAttachment) return;

  const { owner, repoName, repo, universeSlug, mode } = pendingRepoAttachment;
  const targetSlug = universeSlug || repositoryTargetSlug;

  const resolveCount = (value) => (typeof value === 'number' && !Number.isNaN(value) ? value : 'unknown');
  let preserveSelectionState = false;

  try {
    setLoading(true);

    if (mode === 'import') {
      if (selectedFile === 'CREATE_NEW') {
        setError('Cannot create a new repository file while importing. Use "Add Repository" on an existing universe to push local data.');
        preserveSelectionState = true;
        return;
      }

      setShowUniverseFileSelector(false);

      const resultState = await gitFederationService.linkDiscoveredUniverse(selectedFile, {
        user: owner,
        repo: repoName,
        authMethod: dataAuthMethod || 'oauth'
      });

      const importedName = selectedFile.name || selectedFile.slug || 'Imported universe';
      const importedSlug = resultState?.activeUniverseSlug || selectedFile.slug || selectedFile.name;

      if (importedSlug) {
        try {
          await gitFederationService.forceSave(importedSlug);
        } catch (err) {
          console.warn('[GitNativeFederation] Initial sync after import failed:', err);
        }
      }

      setSyncStatus({ type: 'success', message: `Imported universe "${importedName}" from repository` });
      await refreshState();
      return;
    }

    if (!targetSlug) {
      setError('No universe selected for attachment. Choose a universe before syncing repository files.');
      preserveSelectionState = true;
      return;
    }

    if (selectedFile === 'CREATE_NEW') {
      setShowUniverseFileSelector(false);
      await handleAttachRepoCreateNew(owner, repoName, repo, targetSlug);
      return;
    }

    const localUniverse = serviceState.universes.find(u => u.slug === targetSlug);
    const localName = localUniverse?.name || localUniverse?.slug || targetSlug;
    const remoteName = selectedFile.name || selectedFile.slug || 'Repository universe';
    const localNodeCount = resolveCount(localUniverse?.nodeCount ?? localUniverse?.stats?.nodeCount ?? localUniverse?.metadata?.nodeCount);
    const remoteNodeCount = resolveCount(selectedFile.nodeCount ?? selectedFile.stats?.nodeCount ?? selectedFile.metadata?.nodeCount);

    const overwriteMessage =
      `WARNING: Syncing with "${remoteName}" will replace your local data for "${localName}".\n\n` +
      `Local data: ${localName} (${localNodeCount} nodes)\n` +
      `Remote data: ${remoteName} (${remoteNodeCount} nodes)\n\n` +
      `This action cannot be undone. Continue?`;

    const confirmed = typeof window !== 'undefined' ? window.confirm(overwriteMessage) : true;
    if (!confirmed) {
      preserveSelectionState = true;
      return;
    }

    let renameLocal = false;
    const repoFileSlug = selectedFile.slug || selectedFile.name;
    if (localUniverse && repoFileSlug && localUniverse.slug !== repoFileSlug) {
      const renamePrompt =
        `The repository file uses the name "${remoteName}" (slug: ${repoFileSlug}).\n\n` +
        `Select OK to rename your local universe to match the repository before syncing.\n` +
        `Select Cancel to keep the current local name; the repository will adopt your local name on next save.`;
      renameLocal = typeof window !== 'undefined' ? window.confirm(renamePrompt) : false;

      if (renameLocal) {
        console.log(`[GitNativeFederation] Renaming local universe to match repo: ${repoFileSlug}`);
        setSyncStatus({ type: 'info', message: `Renaming local universe to "${remoteName}" before syncing...` });
      } else {
        console.log(`[GitNativeFederation] Keeping local universe name while syncing repo file ${repoFileSlug}`);
        setSyncStatus({ type: 'info', message: `Keeping local name "${localName}" while syncing repository file` });
      }
    }

    setShowUniverseFileSelector(false);

    await gitFederationService.linkDiscoveredUniverse(selectedFile, {
      user: owner,
      repo: repoName,
      authMethod: dataAuthMethod || 'oauth'
    });

    setSyncStatus({ type: 'success', message: `Synced repository data from "${remoteName}"` });
    await refreshState();
  } catch (err) {
    console.error('[GitNativeFederation] Universe file selection failed:', err);
    setError(`Failed to process universe file: ${err.message}`);
  } finally {
    setLoading(false);
    if (!preserveSelectionState) {
      setRepositoryTargetSlug(null);
      setRepositoryIntent(null);
      setPendingRepoAttachment(null);
      setDiscoveredUniverseFiles([]);
    }
  }
};
```

### Change 4: Update Modal UI Labels Based on Mode

Update the Universe File Selection Modal content (around line 2206-2426) to show different UI based on pendingRepoAttachment.mode:

```javascript
<Modal
  isOpen={showUniverseFileSelector}
  onClose={() => {
    setShowUniverseFileSelector(false);
    setPendingRepoAttachment(null);
    setDiscoveredUniverseFiles([]);
    setRepositoryIntent(null);
  }}
  title={isUniverseImportMode ? 'Import Universe File' : 'Select Repository File'}
  size="medium"
>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>
      {isUniverseImportMode
        ? `Select a universe file from ${universeFileRepoLabel} to import as a new universe.`
        : `Choose how you want to sync ${universeFileRepoLabel} with your local universe.`}
    </p>

    {isUniverseImportMode ? (
      // IMPORT MODE: Only show files to import
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {discoveredUniverseFiles.length === 0 && (
          <div style={{
            padding: 14,
            border: '1px dashed #979090',
            borderRadius: 8,
            backgroundColor: 'rgba(38,0,0,0.04)',
            fontSize: '0.8rem',
            color: '#444'
          }}>
            No universe files were discovered in {universeFileRepoLabel}.
          </div>
        )}

        {discoveredUniverseFiles.map((file, idx) => (
          <button
            key={idx}
            onClick={() => handleUniverseFileSelection(file)}
            style={{
              ...buttonStyle('outline'),
              width: '100%',
              padding: 16,
              justifyContent: 'flex-start',
              border: '2px solid #979090',
              backgroundColor: '#f9f9f9',
              transition: 'all 0.2s ease'
            }}
          >
            <GitBranch size={18} style={{ flexShrink: 0 }} />
            <div style={{ textAlign: 'left', flex: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: '#260000', fontSize: '0.9rem' }}>
                {file.name || file.slug || 'Universe File'}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: 4 }}>
                {file.path || file.location || 'Unknown path'}
              </div>
              <div style={{
                display: 'flex',
                gap: 12,
                fontSize: '0.7rem',
                color: '#1565c0',
                marginTop: 6,
                paddingTop: 6,
                borderTop: '1px solid #e0e0e0'
              }}>
                {file.nodeCount !== undefined && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontWeight: 600 }}>{file.nodeCount}</span> nodes
                  </span>
                )}
                {file.connectionCount !== undefined && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontWeight: 600 }}>{file.connectionCount}</span> connections
                  </span>
                )}
                {file.graphCount !== undefined && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontWeight: 600 }}>{file.graphCount}</span> webs
                  </span>
                )}
              </div>
              {file.lastModified && (
                <div style={{ fontSize: '0.65rem', color: '#999', marginTop: 4 }}>
                  Last updated: {file.lastModified}
                </div>
              )}
            </div>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#1565c0' }}>Import</span>
          </button>
        ))}
      </div>
    ) : (
      // ATTACH MODE: Existing UI with "Create New" or sync options
      // ... keep existing attach mode UI ...
    )}
  </div>
</Modal>
```

### Change 5: Add Context Header to Repository Selection Modal

Update RepositorySelectionModal component to accept and display intent context:

Add props to the component:
```javascript
function RepositorySelectionModal({ 
  isOpen, 
  onClose, 
  onSelectRepository,
  intent = null,           // NEW: 'import' | 'attach' | 'browse'
  managedRepositories,
  onAddToManagedList
}) {
```

Add context header in the modal UI:
```javascript
{intent && (
  <div style={{ 
    marginBottom: 16, 
    padding: 12, 
    backgroundColor: '#f5f5f5', 
    borderRadius: 6,
    border: '1px solid #e0e0e0'
  }}>
    {intent === 'import' && (
      <div>
        <strong style={{ fontSize: '0.95rem' }}>Import Universe from Repository</strong>
        <div style={{ fontSize: '0.85rem', color: '#666', marginTop: 4 }}>
          Select a repository to discover and import universe files as a new universe
        </div>
      </div>
    )}
    {intent === 'attach' && (
      <div>
        <strong style={{ fontSize: '0.95rem' }}>Link Repository to Universe</strong>
        <div style={{ fontSize: '0.85rem', color: '#666', marginTop: 4 }}>
          Select a repository to sync with your existing universe
        </div>
      </div>
    )}
  </div>
)}
```

Update the RepositorySelectionModal call in GitNativeFederation.jsx:
```javascript
<RepositorySelectionModal
  isOpen={showRepositoryManager}
  onClose={() => {
    setShowRepositoryManager(false);
    setRepositoryTargetSlug(null);
    setRepositoryIntent(null);
  }}
  onSelectRepository={handleRepositorySelect}
  onAddToManagedList={handleAddToManagedList}
  managedRepositories={managedRepositories}
  intent={repositoryIntent}  // NEW: Pass intent
/>
```

---

## Testing Requirements

After implementing changes, verify these user flows work correctly:

### Test 1: New User Loading Universe from Repository
Steps:
1. User has no universes in their workspace
2. Click "Load" dropdown in Universes section
3. Click "From Repository"
4. Verify modal shows context: "Import Universe from Repository"
5. Select a repository
6. Verify system discovers .redstring files
7. Verify modal shows "Select a universe file to import"
8. Select a universe file
9. Verify new universe is created in the list
10. Verify universe has correct data loaded from repository

### Test 2: Existing User Attaching Repository
Steps:
1. User has universe "My Work" with 50 nodes
2. Click "Add Repository" button on "My Work" card
3. Verify modal shows context: "Link Repository to Universe"
4. Select a repository
5. If no files exist: Verify option to "Push Local Data to New File"
6. If files exist: Verify options to push or sync
7. Select mismatched file
8. Verify warning dialog shows node counts and data loss risk
9. Cancel and verify no changes
10. Accept and verify sync works correctly

### Test 3: Discovery Without Data Loss
Steps:
1. User has universe "Important Work" with 100 nodes
2. Repository is already linked as source
3. Click "Discover universes" button on source
4. Verify discovered files show with stats
5. Click "Import Copy"
6. Verify creates NEW universe without touching "Important Work"
7. Verify both universes exist in the list

### Test 4: Return User Loading Previous Session
Steps:
1. User has universe linked to GitHub repo
2. User closes browser
3. User returns and opens app
4. Universe list should show their universes
5. User can switch to their universe
6. Verify data loads correctly from repository
7. Verify sync continues to work

---

## Files to Modify

### Primary Files
1. src/GitNativeFederation.jsx - Main component with flow logic
   - Add repositoryIntent state
   - Add handleImportFromRepository function
   - Update handleRepositorySelect branching
   - Update handleUniverseFileSelection with mode handling
   - Update modal UI conditionals
   - Add/improve warning dialogs

2. src/components/modals/RepositorySelectionModal.jsx
   - Add intent prop
   - Add context header section
   - Pass props through correctly

3. src/components/git-federation/UniversesList.jsx
   - Verify handleLoadFromRepoClick calls onLoadFromRepo correctly
   - Verify props are passed through properly

### Do Not Modify
- Any files in src/services/ (backend services working perfectly)
- src/services/SaveCoordinator.js (working perfectly)
- src/services/gitSyncEngine.js (working perfectly)
- src/services/universeBackend.js (working perfectly)
- src/formats/redstringFormat.js (working perfectly)
- Any middleware or store files

---

## Implementation Notes

### State Management
All changes are in React component state (useState hooks). Do not modify Zustand store or middleware.

### Existing APIs to Use
The following service methods already exist and work correctly - use them as-is:
- gitFederationService.discoverUniverses(params) - Discovers .redstring files in a repo
- gitFederationService.linkDiscoveredUniverse(file, repoInfo) - Links a discovered file
- gitFederationService.attachGitRepository(slug, repoInfo) - Attaches repo to universe
- gitFederationService.refreshUniverses() - Refreshes universe list
- gitFederationService.forceSave(slug) - Forces a manual save

Do not create new service methods. Use existing APIs only.

### Error Handling
Maintain existing error handling patterns:
- Try/catch blocks around all async operations
- Set error state with setError(message)
- Clear loading state in finally blocks
- Log errors with console.error for debugging

### User Messaging
Update success/error messages to be clear about what happened:
- "Imported universe 'Name' from repository" (not just "linked")
- "Synced with remote file 'Name'" (not "attached")
- "WARNING: This will replace your local data" (explicit about consequences)

---

## Success Criteria

Implementation is complete and successful when:
1. "Load from Repo" button successfully imports universes from repositories as NEW universes
2. No data loss occurs without explicit user confirmation with clear warnings
3. All button labels and modal titles accurately describe the actions they perform
4. Modal titles show clear context about which operation is being performed
5. Users can clearly distinguish between "import new universe" vs "attach to existing universe"
6. All existing save/load/sync functionality continues to work exactly as before
7. All test scenarios listed above pass successfully
8. No console errors or warnings related to the changes

---

## Key Constraints and Reminders

CRITICAL: This is a frontend-only user flow task. Do not:
- Modify any backend services or APIs
- Change save/load mechanics or timing
- Alter Git sync engine behavior
- Modify state persistence logic
- Change how data is stored or retrieved from repositories
- Touch any files in src/services/ directory

Only modify:
- React component UI rendering and state management
- User flow logic (which modal opens when, what context is shown)
- Button labels, modal titles, and informational text
- Confirmation dialogs and warning messages
- Intent tracking and conditional branching in handlers
- Props passed between components

The backend works perfectly. The save/load mechanics work perfectly. This task is purely about making the frontend UI flows intuitive and preventing users from accidentally losing data by clearly communicating what each action will do.

Remember: We're fixing the "File > Open" UX, not the "File > Save" mechanics.
