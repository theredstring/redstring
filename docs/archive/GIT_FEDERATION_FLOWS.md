# Git Federation User Flows: Current vs. Proposed

## 🔴 Current Broken Flow: "Load from Repo"

```
User: "I want to load a universe from a GitHub repository"

[Universes Panel]
  ↓
Click "Load" → "From Repository"
  ↓
[Repository Selection Modal Opens]
  ↓
Select a repository
  ↓
🔴 BREAKS: handleRepositorySelect() expects repositoryTargetSlug
🔴 Since repositoryTargetSlug is null → undefined behavior
🔴 No NEW universe is created
🔴 User is confused, nothing happens

Expected: New universe should be created from repo data
```

---

## ✅ Proposed Fixed Flow: "Load from Repo"

```
User: "I want to load a universe from a GitHub repository"

[Universes Panel]
  ↓
Click "Load" → "From Repository"
  ↓
[Repository Selection Modal Opens]
  HEADER: "Import Universe from Repository"
  INTENT: "import"
  ↓
Select a repository
  ↓
[Discovering universe files...]
  ↓
[Universe File Selection Modal]
  HEADER: "Choose Universe to Import"
  
  OPTIONS:
  ┌──────────────────────────────────────┐
  │ ○ shared-knowledge.redstring         │
  │   📊 132 nodes, 89 connections       │
  │   🕐 Updated 2d ago                  │
  │   [Import as New Universe]           │
  ├──────────────────────────────────────┤
  │ ○ my-notes.redstring                 │
  │   📊 45 nodes, 23 connections        │
  │   🕐 Updated 1w ago                  │
  │   [Import as New Universe]           │
  └──────────────────────────────────────┘
  
  ↓
Click "Import as New Universe"
  ↓
[Creating universe from repo file...]
  ↓
✅ New universe appears in list
✅ Automatically linked to source repo
✅ User can switch to it
```

---

## 🔄 Current Confusing Flow: "Attach Repo to Existing Universe"

```
User: "I want to sync my universe with a GitHub repo"

[Universe Card: "My Work"]
  ↓
Click "Add Repository"
  ↓
[Repository Selection Modal Opens]
  NO CONTEXT: User doesn't know this is for "My Work"
  ↓
Select a repository
  ↓
[Discovering universe files...]
  ↓
[Universe File Selection Modal]
  CONFUSING HEADER: "Choose Universe File"
  
  OPTIONS:
  ┌──────────────────────────────────────┐
  │ [Create New Universe File]           │  ← CONFUSING: Sounds like creating
  │  Save current universe as new file   │     a new local universe
  │                                      │
  │ Or link to existing file:            │
  │  ○ work-universe.redstring           │
  │  ○ shared-knowledge.redstring        │
  └──────────────────────────────────────┘
  
  ↓
User clicks "Create New Universe File"
  ↓
❌ CONFUSING: Data is pushed TO repo, not pulled FROM repo
❌ User expected to load something FROM repo
❌ Button name doesn't match action
```

---

## ✅ Proposed Clear Flow: "Attach Repo to Existing Universe"

```
User: "I want to sync my universe 'My Work' with a GitHub repo"

[Universe Card: "My Work"]
  47 nodes, last saved 5m ago
  ↓
Click "Add Repository"
  ↓
[Repository Selection Modal Opens]
  HEADER: "Link Repository to Universe: My Work"
  INTENT: "attach"
  CONTEXT: Shows which universe you're linking to
  ↓
Select a repository
  ↓
[Discovering universe files...]
  ↓
[Sync Options Modal]
  HEADER: "Sync My Work with owner/repo"
  
  SCENARIO 1: No existing files found
  ┌──────────────────────────────────────┐
  │ This repository has no universe      │
  │ files yet.                           │
  │                                      │
  │ [Push Local Data to New File]        │
  │  Create my-work.redstring in repo    │
  │  and keep it synced                  │
  │                                      │
  │ [Cancel]                             │
  └──────────────────────────────────────┘
  
  SCENARIO 2: Existing files found
  ┌──────────────────────────────────────┐
  │ Choose how to sync:                  │
  │                                      │
  │ ○ Push My Data (Create New File)     │
  │   Create my-work.redstring in repo   │
  │   Keep: Your 47 nodes                │
  │                                      │
  │ ○ Sync with Existing File            │
  │   ├─ my-work.redstring ✨MATCH       │
  │   │  Keep both in sync (recommended) │
  │   │  47 nodes → your data            │
  │   │                                  │
  │   ├─ shared.redstring                │
  │   │  ⚠️ WARNING: Will overwrite      │
  │   │  Your 47 nodes → Remote 132 nodes│
  │   │                                  │
  │   └─ [Select File]                   │
  │                                      │
  │ [Continue] [Cancel]                  │
  └──────────────────────────────────────┘
  
  ↓
Clear action with clear consequences
✅ User understands what will happen
✅ Warnings before data loss
✅ Recommended option highlighted
```

---

## 🔍 Current Confusing Flow: "Discovery from Sources"

```
User has universe "My Work" with @owner/repo linked as source

[My Work Universe Card]
  Repository: @owner/repo
  ↓
Click "Discover universes"
  ↓
[Scanning repository...]
  ↓
[Discovery Results shown inline]
  ┌────────────────────────────┐
  │ shared-knowledge.redstring │
  │ [Link]                     │ ← DANGEROUS: What does Link do?
  └────────────────────────────┘
  
  ↓
User clicks "Link"
  ↓
❌ UNEXPECTED: Remote data is pulled into "My Work"
❌ User's 47 nodes might be overwritten by 132 nodes
❌ No warning, no preview, no confirmation
❌ User loses their work
```

---

## ✅ Proposed Safe Flow: "Discovery from Sources"

```
User has universe "My Work" with @owner/repo linked as source

[My Work Universe Card]
  Repository: @owner/repo
  ↓
Click "Discover universes"
  ↓
[Scanning repository...]
  ↓
[Discovery Results shown inline]
  ┌────────────────────────────────────────┐
  │ shared-knowledge.redstring             │
  │ 📊 132 nodes, 89 connections           │
  │ [Preview] [Import as New] [Replace My Work] │
  └────────────────────────────────────────┘
  
  ↓
User clicks "Preview"
  ↓
[Preview Modal]
  Shows: Node types, connection count, web count
  
  ↓
User clicks "Import as New"
  ↓
✅ Creates NEW universe "Shared Knowledge"
✅ Original "My Work" is unchanged
✅ User can switch between them

OR

User clicks "Replace My Work"
  ↓
[Confirmation Dialog]
  ⚠️ WARNING: This will replace your current data
  
  Your data: 47 nodes, 23 connections
  Remote data: 132 nodes, 89 connections
  
  Your current "My Work" will be archived as:
  my-work-backup-2025-10-05.redstring
  
  [I Understand, Replace My Data] [Cancel]
  
  ↓
✅ Clear warning
✅ Backup created
✅ User made informed choice
```

---

## 🎯 Key UX Principles

### 1. **Intent-Based Context**
Every modal should clearly show:
- What action you're performing
- Which universe you're affecting (if any)
- What the consequences will be

### 2. **No Surprise Data Loss**
- Always warn before overwriting local data
- Show data comparison (your 47 nodes vs remote 132 nodes)
- Offer backup/archive options

### 3. **Clear Action Labels**
- ❌ "Create New Universe File" (ambiguous)
- ✅ "Push My Data to New File in Repo" (clear)

- ❌ "Link" (what does this do?)
- ✅ "Import as New Universe" (clear)

### 4. **Recommended Paths**
- Highlight the safest/most common option
- Use visual hierarchy (primary vs secondary buttons)
- Add ✨ or other indicators for "smart" matches

### 5. **Progressive Disclosure**
- Start with simple choice
- Expand to show details only when needed
- Don't overwhelm with all options at once

---

## 📝 Implementation Notes

### State Management
```javascript
// Add intent to repository selection
const [repoModalIntent, setRepoModalIntent] = useState(null);
// 'import' | 'attach' | 'browse' | null

// Track which universe is being affected
const [targetUniverseSlug, setTargetUniverseSlug] = useState(null);

// Track discovered files for preview
const [discoveredFiles, setDiscoveredFiles] = useState([]);
```

### Modal Props
```jsx
<RepositorySelectionModal
  isOpen={showRepositoryModal}
  intent={repoModalIntent}
  targetUniverse={universes.find(u => u.slug === targetUniverseSlug)}
  onSelectRepository={(repo) => {
    if (repoModalIntent === 'import') {
      handleImportFromRepo(repo);
    } else if (repoModalIntent === 'attach') {
      handleAttachRepoToUniverse(repo, targetUniverseSlug);
    }
  }}
/>
```

### New Handlers
```javascript
// For "Load from Repo" button
const handleLoadFromRepoClick = () => {
  setRepoModalIntent('import');
  setTargetUniverseSlug(null);
  setShowRepositoryModal(true);
};

// For "Add Repository" on universe card
const handleAttachRepoClick = (universeSlug) => {
  setRepoModalIntent('attach');
  setTargetUniverseSlug(universeSlug);
  setShowRepositoryModal(true);
};
```

