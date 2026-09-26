/**
 * What the save indicator is allowed to claim.
 *
 * This exists because "Saved" used to be the final `else` of a chain — it
 * meant "none of the other conditions matched", not "a write succeeded". Those
 * are not the same statement, and before a universe has loaded they come apart
 * completely: nothing is saving, nothing is dirty, no commits are pending,
 * because the coordinator is DEFERRING every save until the load settles. The
 * chain fell through and announced "Saved" over an empty canvas, seconds
 * before 1,830 things loaded in. Nothing had been written; the repository was
 * never touched. The indicator simply said something it did not know.
 *
 * So the rule is now explicit: `Saved` requires that something was loaded this
 * session to have been saved. Everything before that reads as syncing.
 *
 * Pure, so the claim each state makes can be asserted in a test.
 *
 * Priority: no universe > no storage > needs auth > error > paused > loading >
 * writing > refused or stalled > waiting to write > git behind > never loaded >
 * saved.
 *
 * Local saves read like Git's: "Saving..." from the edit until the bytes land,
 * then "Saved". The wait before a write used to show nothing, which was
 * defensible while it lasted 3.5s and made one edit look like a long save;
 * with the pipeline at ~1.5s, saying nothing only hid whether a save was
 * coming. While the user is still dragging, nothing is shown, because nothing
 * is written until they let go.
 *
 * A refused or failed write says "Not saved" at once, as a call to action
 * that opens the Universes panel (where Save Now and reconnecting live), with
 * the reason as `detail`. It used to wait ten seconds and then say "Unsaved"
 * with no reason and nothing to click.
 *
 * `needsGitAuth`: the universe syncs to Git but the GitHub App isn't linked.
 * With nobody signed in, the sync summary calls that 'standby', same as
 * "engine not started yet", so it used to read as "Syncing..." — forever,
 * since nothing was going to start it. It is a thing the user can fix, so
 * it's a CTA (`gitAuthLabel`: 'Reconnect', or 'Link App' when OAuth is on).
 *
 * @returns {{text: string|null, isCTA: boolean}} `text: null` means show
 *   nothing — the honest report for the normal debounce window.
 */
export const resolveSaveStatus = ({
  hasUniverse = true,
  hasStorage = true,
  needsGitAuth = false,
  gitAuthLabel = 'Reconnect',
  isInErrorBackoff = false,
  isUnhealthy = false,
  isPaused = false,
  isLoadingFromRepo = false,
  isSaving = false,
  blockedReason = null,
  dirtyStalled = false,
  hasUnsavedChanges = false,
  isInteracting = false,
  gitBehind = false,
  universeReady = false
} = {}) => {
  if (!hasUniverse) return { text: 'No universe', isCTA: false };
  if (!hasStorage) return { text: 'Connect', isCTA: true };
  if (needsGitAuth) return { text: gitAuthLabel, isCTA: true, action: 'reconnect' };
  if (isInErrorBackoff || isUnhealthy) return { text: 'Error', isCTA: false };
  if (isPaused) return { text: 'Paused', isCTA: false };
  if (isLoadingFromRepo) return { text: 'Syncing...', isCTA: false };

  // A local write is genuinely in flight.
  if (isSaving) return { text: 'Saving...', isCTA: false };

  // A guard refused the write or it failed (`blockedReason`), or changes have
  // sat unwritten far past the debounce for a reason nobody reported.
  if (blockedReason || dirtyStalled) {
    return {
      text: 'Not saved',
      isCTA: true,
      action: 'universes',
      detail: blockedReason || 'These changes have not reached the file yet.'
    };
  }

  // Waiting out the debounce: the write is coming. Mid-drag nothing is written
  // until release, so say nothing rather than "Saving..." for the whole drag.
  if (hasUnsavedChanges) {
    return isInteracting ? { text: null, isCTA: false } : { text: 'Saving...', isCTA: false };
  }

  // Local bytes are durable; Git is still catching up. A different and much
  // less urgent state than "not yet saved".
  if (gitBehind) return { text: 'Syncing...', isCTA: false };

  /*
   * Nothing has arrived in the store yet, so there is nothing that could have
   * been saved. This is the branch that used to fall through to "Saved".
   *
   * `universeReady` must come from the STORE's own view of whether a universe
   * is in (`isUniverseLoaded`), not from SaveCoordinator's `hasLoadedFromFile`
   * alone. That flag only flips when a state change flows through the
   * coordinator, so a universe that loaded and then sat idle never set it —
   * and gating on it turned a false "Saved" into a false "Syncing..." that
   * never cleared. Both are the same mistake: reporting a guess as a fact.
   */
  if (!universeReady) return { text: 'Syncing...', isCTA: false };

  return { text: 'Saved', isCTA: false };
};

export default resolveSaveStatus;
