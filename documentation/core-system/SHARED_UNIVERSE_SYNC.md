# Shared Universe Sync

Status: **current on branch `feat/shared-universe-sync`** (built 2026-10-16, awaiting a smoke test before it reaches `main`). Decided 2026-10-16.

## The decision

Collaboration in Redstring is a **shared universe**: several people edit the same universe at different times, synced through its Git repository. Real-time cursors and presence are not important, and live sessions are out of scope.

Constraints this design keeps:

- **No Redstring-operated servers.** The Git host is the only meeting point.
- **Offline-friendly.** Edits made offline merge on reconnect, and survive a restart first.
- **Not tied to GitHub.** Everything goes through the `SemanticProvider` interface in `src/services/gitNativeProvider.js`. GitHub and Gitea (and so Forgejo and Codeberg) are peers.
- **One readable file.** A universe stays exactly one `.redstring` file, with no sidecars and no bookkeeping fields added for sync (see `documentation/data-format/UNIVERSE_FILE_SIZE.md`).

Sharing is the host's job: the owner adds collaborators to the repository in GitHub or Gitea, and each person opens that repository in Redstring.

## How it works

Git is the transport, not the merge engine. Git merges lines of text, and a universe is one JSON file (written compact above 5000 Things + webs), so Git would see every concurrent edit as a whole-file conflict. Redstring merges its own entities:

- **base**: the file at the version this device's copy grew from (`GitSyncEngine.syncBaseSha`), read from the host by its blob SHA. Nothing extra is stored but the SHA.
- **ours**: this device's commit.
- **theirs**: the file on the host now.

All three go through the same import (`importFromRedstring`), so a difference between them is an edit, not a reading artefact.

### The merge: `src/formats/syncMerge.js`

A pure function, no store access, no I/O. For every entity id (Things, webs, placements, groups, connections, connection types):

| base | ours | theirs | result |
|---|---|---|---|
| A | A | B | B |
| A | B | A | B |
| — | A | — | A (added) |
| A | A | — | deleted |
| A | B | — | **B** (an edit beats a delete) |
| A | B | C | field by field |

Field by field, the same rules apply one level down. A field changed to two different values keeps **the repository's value** (`conflictWinner: 'theirs'`): it is already shared, and the person merging is the one present to see the notice. The losing value is kept in the entity's `_preserved.merge` (the bag `mergeUniverses` already banks into; positions are not banked). Set-like id lists (`edgeIds`, `definitionGraphIds`, `memberInstanceIds`, …) and Sets merge as sets. A field that is `null` reads the same as a missing one, and `lastModified`-style stamps are not edits.

**Personal state** keeps this device's: open webs, the active web, panel tabs, expanded webs, the connection-names toggle, each web's camera. It is pruned of anything the merge removed.

**References** are checked after merging. A deleted target comes back only when the side that kept it actively made or changed the reference since base. A placement the merge restores brings its Thing back too.

**Images** are one unit: an inline picture (store, local file) and the same picture held as a content ref (Git) are the same picture (`imageKey`; `remoteMerge.primeImageRefs` learns each inline picture's ref first). Otherwise every Thing with a picture read as edited, undoing collaborators' deletes. **Lists of objects** (`equivalentClasses`) merge by `@id` or content, not by reference.

**Safety**: the merge refuses, and the caller falls back to the conflict dialog, when either side removed more than 30% of the Things and webs (and more than 20), removed all of them, or collapsed the way a failed load does (5 or more Things down to 10% or fewer, or every web gone, the same rule as `SaveCoordinator._isCatastrophicShrinkage`). A mass deletion arriving through a merge is what a wipe looks like.

`mergeUniverses.js` (imports and forks) is a two-way union and stays as it is: without a base it cannot tell a deletion from something never added.

### The engine: `src/services/gitSyncEngine.js`

- **Saving onto a moved remote** (`REMOTE_DIVERGED`): `_mergeWithRemote` reads the base by SHA, asks `onMergeRemote` (universeBackend → `planMerge`) for the merged file, writes it with compare-and-swap, merges again on top if someone saved during the merge (up to 3 rounds), then brings it onto the canvas.
- **First write of a session** (`_firstContactCheck`): if the remote has data and this device knows its base, it merges the same way. This is how edits made before a restart reach a universe others kept editing. With no base it still reads, compares and asks, as before.
- **Others saved, this device has nothing to push** (`checkRemote`): one cheap request for the file's SHA (`getRemoteFileSha`); only if it moved, read it and apply it through `onRemoteUpdate` (→ `bringInRemote`). universeBackend calls this every 30 s while the window is visible, and on focus, visibility and reconnect (`_startRemoteWatch`). It never runs mid-drag, mid-load, or while this device has commits on the way out (those merge as they go).
- **The merge base** (`syncBaseSha`) lives in memory and moves only when the store is known to hold that version: this device wrote it, a read of it was applied (`markRemoteObserved`), a merge or pull was applied, or the store was loaded from a device copy whose record names it (`adoptBase`). Anything else (a fresh universe, a fallback copy, a discarded load) leaves it unknown, and then a first save asks, as before. A base the store does not descend from would make a merge read everything the store lacks as deleted; that was the most serious finding of the review.
- **Each device copy records what it grew from.** The browser copy keeps `syncBase` inside its own IndexedDB record, so the two cannot disagree. A local file can't hold it (one file, no sidecars), so a device-local record (`redstring-gitengine-base:<slug>:file`) keeps the base and the file's byte length; a load that finds a different length (the file was written by something else) trusts no base. `_baseForSavedState` decides what a copy records: a loaded state's own lineage, else the SaveCoordinator stamp of the state, else the engine's base for the live state.
- **States are stamped.** SaveCoordinator stamps every store state it sees (`stampState`) with the base it grew from and how many remote applies have happened. A state stamped before an apply is never committed (`_isStale`): it lacks what the apply brought in, and committing it would revert that in the repository. The canvas kept its edits, so the apply's own save carries them.
- **Writes assert the base**, not just the last version seen: a read that was never applied (a discarded load) used to leave a token that let the next commit overwrite that version. Now that version is merged.
- **No echo commits.** After remote changes land, the engine records what the store now holds as committed, unless the canvas had edits of its own on the way. Otherwise two devices would push the same change back and forth forever.
- **A conflict dialog forgets the SHA** (`_armConflict`). Dismissing the dialog used to leave the remote's SHA in place, so the next autosave overwrote the version the dialog was about. The next write now re-reads; a resolution save asserts the version the dialog showed and merges anything newer on top.

### universeBackend and the store

- `_planRemoteMerge`, `_applyMergedState`, `_applyRemoteUpdate` wire the engine to `src/services/remoteMerge.js` (pure, shared with the tests).
- The store applies a merge with `applyRemoteDocument` (`src/store/graphStore.js`): not a load. Undo history stays (the arriving changes are not on the stack, so Cmd+Z undoes only this person's edits), each web's camera stays, and the change saves locally like an edit.
- **At load** (`_mergeLocalCopyOnLoad`): when this device's saved copy (local file, or browser copy for a Git-only universe) and the repository differ and a base is known, they are merged, the result goes to both copies, and the merge is pushed (`_flushPendingPush`). This used to silently mirror the repository over the local copy, dropping edits made offline or not pushed before the app closed.
- **Git-only universes autosave to their own browser copy** (`universe_<slug>`), the copy a load reads back. Autosave used to write a legacy single-slot store no load reads. Both local copies go through the same empty-overwrite guards (`_localSaveBlocked`). If a Git-only universe's browser copy differs from the repository and can't be merged at load, it is kept as a backup (History panel) before the repository version replaces it.
- An auth event no longer reloads an open, synced universe wholesale; it checks for others' changes.
- **The notice.** When others' changes arrive, the save status in the corner reads "Ana updated 4 Things." for 6 s (`redstring:remote-changes`, `SaveStatusDisplay.jsx`). It gives way to anything the person has to act on. Who comes from the repository's latest commit.
- Switch-off per device: `localStorage['redstring:sync-merge'] = 'off'` restores the old ask-every-time behaviour.

### The host: `src/services/gitNativeProvider.js`

Three things every provider supports:

1. `writeFileRaw(path, content, { expectedSha })`: write only if the file is still at that SHA (`null` = must not exist); a moved remote throws `REMOTE_DIVERGED` and is never retried blindly. Gitea used to ignore `expectedSha` and overwrite whatever was there; it now PUTs with the SHA and POSTs to create. Checked against Gitea 1.22: a stale SHA and a create over an existing file both answer 422 ("sha does not match", "repository file already exists").
2. `readFileAtSha(path, blobSha)`: the merge base, from the Git blob API.
3. `getRemoteFileSha(path)`: the current SHA from a folder listing, without downloading the file.

`listFileHistory` also returns each revision's `author`.

## Trying it: the two-port harness

```
npm run harness:shared            # keeps the repositories from last time
npm run harness:shared -- --fresh # starts from an empty host
```

This starts `scripts/fake-forge.mjs`, a Git host on this machine speaking the Gitea API over real bare Git repositories (`git log` in one shows every save and who made it), plus two dev servers, Ana on 5181 and Ben on 5182. Each port is its own origin with its own storage, so each behaves as a separate device. The script prints one link per person. `src/dev/devForge.js` (dev builds only) makes that port the person, skips onboarding, and opens or creates the shared universe. `http://localhost:4510/` shows the history and has a switch per person that drops their connection, for trying offline. Each harness port has its own Vite cache (`.vite-harness/`), so it never touches the one a normal `npm run dev` uses. `?devForge=off` turns a port back into a normal session.

## Tests

- `test/formats/syncMerge.test.js`: the rules; properties over 200 random edit pairs (no dangling references; same result whichever side is "ours" with the winner flipped; an unchanged side returns the other exactly; non-colliding edits all land); the safety refusals; never mutates inputs; round trip through the file format.
- `test/formats/syncMergeReal.test.js`: every real universe in a folder (`REDSTRING_REAL_UNIVERSES=~/Documents`): a written file reads back unchanged, and two people's random edits merge without new broken references. 76 files on 2026-10-16, all under 0.5 s.
- `test/services/providerSharedSync.test.js`: the three host operations on GitHub and Gitea.
- `test/services/sharedUniverseTwoClients.test.js`: two (and three) real engines against an in-memory compare-and-swap host: merges, no echo, offline, restart, edits made mid-merge, a save racing the merge, collapsed stores, dismissed and resolved dialogs.
- `test/services/loadMergesLocalCopy.test.js`: merging at load, for file + Git and Git-only universes, including the double load on open and the backup of an unmergeable copy.
- `test/services/remoteMergeImages.test.js`: an inline picture and its content ref read as the same picture.
- `test/services/sharedUniverseFakeForge.test.js`: the same over HTTP against the fake host.
- `test/services/sharedUniverseRealGitea.test.js`: the same against a real Gitea or Forgejo with two accounts (`REDSTRING_GITEA_URL`, `REDSTRING_GITEA_REPO`, `REDSTRING_GITEA_TOKENS`). Passed against Gitea 1.22.6 on 2026-10-16.
- The harness was driven in two real browser pages: create, join, simultaneous edits, a same-name clash, offline and reconnect, 45 s with no echo commits; and offline edits surviving a closed page (Ben offline adds a Thing, closes the page, Ana saves, Ben reconnects and reopens with both, and his Thing reaches the repository).
- Two independent data-safety reviews of the branch; every finding fixed has a regression test (see the commit "fix: address the data-safety review").

## Behaviour decisions

Made as defaults on 2026-10-16, each easy to change:

| Question | Default |
|---|---|
| Two people change the same text | The repository's value wins; the other is kept in `_preserved.merge` and the notice says so |
| Someone deletes a Thing another person edited | The edit wins: the Thing comes back |
| How incoming changes show up | A short notice in the corner ("Ana updated 4 Things.") for 6 s |
| Inviting and joining | The host's own collaborator settings; joining is opening that repository |

## Not done yet

- **GitHub with two real accounts.** Everything above runs on Gitea's API and on GitHub's in unit tests; the two-person flow hasn't been run against github.com. The GitHub App is installed per owner, so a collaborator may land on the OAuth fallback (already wired) unless the owner installs the App on that repository.
- **Gitea in the app's UI.** The provider works, but universeBackend only builds GitHub providers outside the dev harness: no way yet to link a Gitea/Forgejo/Codeberg repository or store its token.
- **The universe card's "Status / Last saved"** reads GitHub-era fields that autosave doesn't update.
- **The batch commit path** (`GitAutosavePolicy` → `forceCommit`) still skips SaveCoordinator's shrinkage guard for ordinary (non-merge) writes. Merges have their own guard; plain writes rely on the engine's zero-floor.
- **Two people reorganising the same web** merge cleanly but can pile both layouts together. The notice and undo are the current answer.
- **Two tabs of one origin on one universe** share the browser copy and its record. There is no tab lock anywhere in the app; the merge doesn't make this worse in the browser copy (record and content are written together), but two tabs editing the same local file can still pair one tab's file with the other's record in a narrow window.
- **The connection-names toggle, saved sets and connection types** aren't in the engine's change fingerprint (`generateStateHash`), so a change to only those doesn't trigger a commit on its own (older behaviour, unchanged).

## Not part of this

- **Duplicate Things** made separately by two people (two "Alice" nodes with different ids). The existing things-merge UI handles these pairs; Wikidata links can suggest candidates, but the user confirms.
- **More hosts:** GitLab, Bitbucket, self-hosted. Each is a provider written like the Gitea one.
- **Live sessions.** If ever wanted: host-authoritative (the person with the file applies everyone's store actions in order) over WebRTC, not CRDTs, which would mean rewriting the store and could not stay a readable single file. Signaling and relay servers would still be needed.

## Related

- `documentation/core-system/GIT_FEDERATION.md`: the universe/Git storage model.
- `documentation/core-system/SAVE_COORDINATOR_README.md`: save coordination and the load gate.
- `docs/COLLABORATION_PLAN.md`: the "one Graph, many Webs" model shared universes eventually sit on.
