# Shared Universe Sync

Status: **future-intent**. Decided 2026-10-16; no merge or sync-loop code exists yet. The safety fixes in §1 are worth doing now regardless.

## The decision

Collaboration in Redstring is a **shared universe**: several people edit the same universe at different times, synced through its Git repository. Real-time cursors and presence are not important, and live sessions are out of scope.

Constraints this design keeps:

- **No Redstring-operated servers.** The Git host is the only meeting point.
- **Offline-friendly.** Edits made offline merge on reconnect.
- **Not tied to GitHub.** Everything goes through the `SemanticProvider` interface in `src/services/gitNativeProvider.js`; GitHub and Gitea (and so Forgejo and Codeberg) are peers.
- **One readable file.** A universe stays exactly one `.redstring` file, with no sidecars and no bookkeeping fields added for sync (see `documentation/data-format/UNIVERSE_FILE_SIZE.md`).

## How it works

Git is the transport, not the merge engine. Git merges lines of text, and a universe is one JSON file (written compact above 5000 Things + webs), so Git would see every concurrent edit as a whole-file conflict. Redstring does the merge itself, over its own entities:

- **base**: the file at the last sync. Its SHA is `GitSyncEngine.lastKnownRemoteSha`; the content is fetched from the host by that SHA, so nothing extra is stored on the device.
- **ours**: the live store.
- **theirs**: the file on the host now.

Entities are keyed by stable IDs, so most merges are mechanical. Adds from both sides are kept. A delete wins over an untouched entity. Positions and scale take the latest value silently. The real conflicts are the same text field changed on both sides, and a delete on one side against an edit on the other.

The host must support three operations, all through the provider interface:

1. Read the current file and its SHA.
2. Read the file at an older SHA (the base).
3. Write only if the file is still at the expected SHA (compare-and-swap).

"Who changed what" comes from commit authors plus the diff between base and theirs, not from new fields in the file.

### Relation to `mergeUniverses.js`

`src/formats/mergeUniverses.js` already merges two universes for imports and forks. It is a two-way union where the destination wins conflicts, so it cannot tell a deletion from something never added: used for sync, it would bring deleted things back. Sync needs a base-aware three-way merge. Reuse from the existing module: the prototype remap, the union of web contents, and the no-silent-loss rule (a value dropped in a conflict is kept in `_preserved.merge`).

## What's needed

### 1. Safety fixes (needed even without collaboration)

1. **Gitea write check.** `GiteaSemanticProvider.writeFileRaw(path, content)` ignores `expectedSha`. It reads the current SHA right before writing and uses that, so it never throws `REMOTE_DIVERGED` and silently overwrites a remote that moved. Two devices on one Gitea universe can already lose edits this way. Fix: send the expected SHA, and map Gitea's SHA-mismatch error to `REMOTE_DIVERGED` (confirm the exact error Gitea returns).
2. **Node-count floors.** A large drop in node count is treated as a possible wipe. Once others can delete things, a real deletion must get through: the floor is reset from the merged result. Wipe protection otherwise stays as it is.
3. **The local copy.** The desktop file and the browser's saved copy also get the merged result, without racing the load gate (`saveCoordinator.beginLoad()/endLoad()`).

### 2. Host support (GitHub, Gitea, later others)

4. **Read a file at an old version.** GitHub has `_readBlobVerified`; Gitea needs a blob read added.
5. **Cheap "has it changed?" check.** Read the SHA only, not the file. Do not depend on GitHub-only behaviour such as free 304 responses.
6. **Commit authors since the base.** `listFileHistory` exists on both providers; confirm it returns authors.

### 3. The merge

7. **Three-way merge** (base, ours, theirs), built from the reusable parts of `mergeUniverses.js`. A pure function with no store access.
8. **A rule for each part of the file:** Things (prototypes), webs (placements, groups, connections), connection types, abstraction chains, active-definition indices (`nodeDefinitionIndices`), saved sets. Viewport (pan/zoom) is excluded.
9. **Unknown fields carried through**, so a collaborator on an older build does not drop fields it does not understand (`_preserved`).
10. **Off the main thread for big universes.** A merge holds three copies in memory; the 50 MB Git cap still applies.
11. **Fast diffs.** The per-entry hashes kept by `src/formats/exportCache.js` can make comparisons cheap.

### 4. The sync loop

12. **Replace the pick-a-side handler** (`engine.onRemoteDivergence` in `src/services/universeBackend.js`) with: merge, write with the expected SHA, and if the remote moved again, merge again (bounded retries).
13. **Background check while idle**, so someone who is only reading still receives others' edits.
14. **Offline edits** merge once on reconnect; this works because the base is known.
15. **Keep the conflict dialog** for what the merge cannot handle: an unreadable remote, a file newer than the app, a file over the size cap.

### 5. Bringing merged changes onto the canvas

16. **Apply without a full reload.** Keep viewport, selection, open panels and pie state. Handle a selected Thing that someone else deleted.
17. **Undo.** Cmd+Z must not undo someone else's change. Decide how local history (`src/store/historyStore.js`) adjusts when remote changes arrive.
18. **Wait while the user is mid-drag or typing.** The SaveCoordinator already knows when a drag is in progress (`isDragging`, `phase`).

### 6. People and access

19. **Opening a universe someone shared with you.** Onboarding must handle a repo owned by someone else. Check whether the GitHub App setup gives a collaborator access to another owner's repo. On Gitea it is a token.
20. **App versions.** `validateFormatVersion` refuses files stamped newer than the app, so a collaborator on an older build is locked out after a newer one saves. Decide whether that is acceptable or needs a message.

### 7. Behaviour decisions (open)

21. Two people change the same text: latest wins with a note, or stop and ask?
22. Someone deletes a Thing another person just edited: keep it, or let the delete win?
23. How incoming changes show up: silent, a short notice ("Ana updated 6 Things"), or a brief highlight on the canvas?
24. What inviting someone and joining a shared universe look like.

A known risk: two people who reorganize the same web differently produce a merge that is clean but may pile both layouts on top of each other. The current leaning is a clear "merged Ana's changes here" note plus undo, not forking the web into carousel alternates.

### 8. Tests

25. **Merge rules:**
    - merging when only one side changed gives that side, untouched;
    - the result is the same whichever side is "ours";
    - no value disappears without being kept somewhere.
26. **Two simulated clients** syncing against a fake host that refuses stale writes, including the offline case.
27. **Real universes**, held byte-for-byte, the same bar the save cache meets.

## Not part of this

- **Duplicate Things** made separately by two people (two "Alice" nodes with different IDs). The existing things-merge UI handles these pairs; Wikidata links can suggest candidates, but the user confirms.
- **More hosts:** GitLab, Bitbucket, self-hosted. Each is a provider written like the Gitea one. Real Git over HTTP (isomorphic-git) would work with any host in the native apps, but needs a CORS proxy in a plain browser, which is a server.
- **Live sessions.** If ever wanted: host-authoritative, where the person with the file applies everyone's store actions in order, over WebRTC. Not CRDTs, which would mean rewriting the store and could not stay a readable single file. Signaling and relay servers would still be needed.

## Related

- `documentation/core-system/GIT_FEDERATION.md`: the current universe/Git storage model.
- `documentation/core-system/SAVE_COORDINATOR_README.md`: save coordination and the load gate.
- `docs/COLLABORATION_PLAN.md`: the "one Graph, many Webs" model that shared universes eventually sit on.
