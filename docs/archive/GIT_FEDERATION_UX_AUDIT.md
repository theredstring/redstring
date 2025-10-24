# Git Federation UX Audit: Loading & Connecting Universes

**Date:** 2025-10-05  
**Status:** Critical UX issues identified  
**Save mechanics:** ✅ Working perfectly

---

## 🔴 Critical Issues

### 1. **"Load from Repo" Flow is Broken**

**Current behavior:**
- User clicks "Load" → "From Repository" in UniversesList
- Opens repository selection modal
- User selects a repository
- `handleRepositorySelect()` expects `repositoryTargetSlug` to be set
- Since it's null, flow breaks or behaves unpredictably

**Problem:** There's no way to load a universe from a repository as a NEW universe. The system assumes you always have an existing local universe to attach a repo to.

**Expected behavior:**
- User clicks "Load from Repo"
- Selects a repository
- System discovers universe files in that repo
- User selects which universe file to load
- System creates a NEW local universe from that file
- New universe appears in the list and becomes active

---

### 2. **Confusing "Create New" vs "Link Existing" Language**

**Current UI in universe file selector modal:**
```
[Button] Create New Universe File
         Save current universe as a new file in this repository

[List] Or link to existing file:
       - universe1.redstring
       - universe2.redstring
```

**Problem:** "Create New Universe File" sounds like "create a new universe locally", but it actually means "push my current local data to a new file in the repo". This is backwards from user mental model.

**User mental model:**
- "Load from Repo" = Load something FROM the repo INTO my app
- "Create New" = Create a brand new empty thing
- "Link to existing" = Connect to something that already exists

**What it actually does:**
- "Create New Universe File" = Push my local data TO a new file in the repo
- "Link to existing file" = Pull data FROM repo file and sync with it

---

### 3. **No Clear "Import Universe from Repo" Flow**

**Missing flow:**
```
I want to: Load someone else's universe from their repository
Currently: No clear path exists

Should be:
1. Browse repositories (maybe they shared a link?)
2. Discover universe files in that repo
3. "Import as new universe" (downloads and creates local copy)
4. New universe appears in my list
5. Optionally: Keep it synced with source repo (read-only or fork?)
```

---

### 4. **Repository Selection Context is Lost**

**Problem:** When opening the repository modal, the system doesn't clearly indicate:
- Are we attaching a repo to an EXISTING universe?
- Are we loading a NEW universe from a repo?
- Are we just browsing repos to add to our managed list?

**Current issues:**
- `repositoryTargetSlug` state variable is overloaded for multiple purposes
- No visual indicator in the modal showing what action you're performing
- No breadcrumb or context header

---

### 5. **Name Mismatch Dialog is Confusing**

**Current dialog when names don't match:**
```
Name mismatch detected!

Local universe: "My Universe" (my-universe)
Repo file: "Their Universe" (their-universe)

Click OK to rename LOCAL universe to match repo file.
Click Cancel to keep local name (repo file will sync to match).
```

**Problems:**
- Users don't understand the consequences
- "Rename local to match repo" might overwrite their data
- "Keep local name" will rename the repo file on next save (unexpected side effect)
- No option to "keep both separate"

---

### 6. **Discovery Flow is Disconnected**

**Current behavior:**
- You can discover universes in a repo from the "Sources" section of an existing universe
- Discovery results show "Link" button
- Clicking "Link" loads that universe data into your current universe (potentially overwriting your work!)

**Problems:**
- No warning that linking will pull remote data into current universe
- No option to "load as new universe" instead
- Discovery results don't show stats/preview before linking

---

### 7. **"Managed Repositories" Purpose is Unclear**

**Current behavior:**
- You can browse and add repos to a "managed repositories" list
- This list persists in localStorage
- But it's unclear what "managing" a repo actually does
- Is it for quick access? Bookmarks? Something else?

---

## ✅ What Works Well

1. **Save mechanics** - Debounced saves, Git sync, viewport persistence all working perfectly
2. **Local file import/export** - Clean flow for loading .redstring files
3. **Active universe UI** - Clear indication of which universe is active
4. **Sync status display** - Shows "Saving...", "Not Saved", "Saved" clearly

---

## 🎯 Recommended Solutions

### Solution 1: Add "Intent" to Repository Selection

**New prop for RepositorySelectionModal:**
```jsx
<RepositorySelectionModal
  isOpen={showRepositoryManager}
  onClose={...}
  intent="attach" | "import" | "browse"
  targetUniverseSlug={repositoryTargetSlug}
  onSelectRepository={handleRepositorySelect}
/>
```

**Modal header changes based on intent:**
- `attach`: "Link Repository to Universe: My Universe"
- `import`: "Import Universe from Repository"
- `browse`: "Browse Repositories"

### Solution 2: Split Universe File Selection into Two Actions

**When discovering files in "import" mode:**
```
[Option 1] Import as New Universe
           Create a new local universe with this data
           └─ universe1.redstring
           └─ universe2.redstring

[Option 2] Cancel
```

**When discovering files in "attach" mode (existing universe):**
```
[Option 1] Push Local Data (Create New File)
           Save your current universe to a new file in this repo
           
[Option 2] Pull Remote Data (Overwrite Local)
           ⚠️ WARNING: This will replace your local data
           └─ universe1.redstring
           └─ universe2.redstring

[Option 3] Sync with Existing File
           Keep local and remote in sync (merge on conflicts)
           └─ universe1.redstring (if name matches)
```

### Solution 3: Improve Name Mismatch Handling

**New dialog options:**
```
Name mismatch detected!

Local: "My Universe" (my-universe) - 47 nodes
Repo:  "Shared Universe" (shared-universe) - 132 nodes

Choose how to proceed:

○ Rename local to "Shared Universe" and pull remote data
  Your current "My Universe" will be archived as backup

○ Keep local name and push your data to repo
  Remote file will be renamed to "My Universe" on next save

○ Keep both separate (don't link)
  Return to universe selection

[Continue] [Cancel]
```

### Solution 4: Add Preview Before Linking

**Show preview card before linking discovered universe:**
```
┌─────────────────────────────────────┐
│ shared-universe.redstring           │
│ ├─ 132 nodes                        │
│ ├─ 89 connections                   │
│ ├─ 3 webs                           │
│ └─ Last updated: 2d ago             │
│                                     │
│ [Preview Data] [Import as New]     │
│                [Cancel]             │
└─────────────────────────────────────┘
```

### Solution 5: Simplify the Mental Model

**New simplified flow:**

**For users without existing universes:**
1. "Load from Repo" → Show repositories
2. Select repo → Discover universe files
3. Select file → Import as new universe
4. Done!

**For users with existing universes:**
1. Click "Add Repository" on a universe card
2. Select repo → Discover universe files  
3. Choose action:
   - "Link to [matching file]" (if name matches)
   - "Push my data as new file"
   - "Pull [file] and overwrite my data" (with warning)

---

## 📋 Implementation Checklist

- [ ] Add `intent` prop to RepositorySelectionModal
- [ ] Create separate handlers for "import" vs "attach" flows
- [ ] Update universe file selector modal with clearer action buttons
- [ ] Add preview cards for discovered universes (show stats before linking)
- [ ] Improve name mismatch dialog with 3 clear options
- [ ] Add confirmation warnings before overwriting local data
- [ ] Create breadcrumb/context header in modals to show current flow
- [ ] Add "Import as New Universe" option to discovery results
- [ ] Document the "Managed Repositories" feature purpose
- [ ] Add tooltips/help text to clarify actions

---

## 🎨 Priority Order

1. **HIGH**: Fix "Load from Repo" to actually import new universes
2. **HIGH**: Add clear warning before overwriting local data
3. **MEDIUM**: Improve modal context (intent-based headers)
4. **MEDIUM**: Add preview before linking
5. **LOW**: Better name mismatch handling
6. **LOW**: Clarify managed repositories purpose

