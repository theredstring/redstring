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
 * Priority: no universe > no storage > error > paused > loading > writing >
 * stalled > debouncing > git behind > never loaded > saved.
 *
 * @returns {{text: string|null, isCTA: boolean}} `text: null` means show
 *   nothing — the honest report for the normal debounce window.
 */
export const resolveSaveStatus = ({
  hasUniverse = true,
  hasStorage = true,
  isInErrorBackoff = false,
  isUnhealthy = false,
  isPaused = false,
  isLoadingFromRepo = false,
  isSaving = false,
  dirtyStalled = false,
  hasUnsavedChanges = false,
  gitBehind = false,
  universeReady = false
} = {}) => {
  if (!hasUniverse) return { text: 'No universe', isCTA: false };
  if (!hasStorage) return { text: 'Connect', isCTA: true };
  if (isInErrorBackoff || isUnhealthy) return { text: 'Error', isCTA: false };
  if (isPaused) return { text: 'Paused', isCTA: false };
  if (isLoadingFromRepo) return { text: 'Syncing...', isCTA: false };

  // A local write is genuinely in flight.
  if (isSaving) return { text: 'Saving...', isCTA: false };

  // Past the debounce by a wide margin — the write failed and is in retry
  // backoff, or a guard refused it. Say so rather than sitting silently on a
  // stale-looking "Saved".
  if (dirtyStalled) return { text: 'Unsaved', isCTA: false };

  // Normal debounce window. Nothing useful to report yet, so report nothing —
  // labelling these few seconds "Saving..." made one edit look like a
  // ten-second save.
  if (hasUnsavedChanges) return { text: null, isCTA: false };

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
