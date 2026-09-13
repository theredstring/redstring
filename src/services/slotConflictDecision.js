/**
 * Which slot wins, and when must the user decide?
 *
 * A universe can be linked to two storage slots at once (a local file and a
 * git repo). On load both are read, and this decides whether they agree,
 * whether one silently wins, or whether the user has to look.
 *
 * Extracted as a pure function because the version living inside
 * `detectSlotConflict` had a hole that cost a 6.9 MB universe on 2026-09-12:
 *
 *     if (localInfo.nodeCount === 0 || gitInfo.nodeCount === 0) return null;
 *
 * "Either side is empty" was treated as "no conflict, carry on". But the case
 * that matters most is precisely one side being empty — when it is the
 * PRIMARY. The `riskOverwriteEmptyPrimary` handling that existed for it sat
 * below that early return and could never run. An empty git primary was
 * therefore applied over a local file holding 1822 things without a prompt.
 *
 * Counts passed in must be USER prototype counts (see userDataCounts.js);
 * counting the seeded base Thing/Connection makes an emptied universe look
 * populated.
 */

/**
 * @param {Object} params
 * @param {{userNodeCount: number}} params.localInfo - Counts for the local slot.
 * @param {{userNodeCount: number}} params.gitInfo - Counts for the git slot.
 * @param {string} [params.sourceOfTruth] - 'local' | 'git' | undefined.
 * @param {boolean} [params.forcePrompt=false] - Ask even when the slots agree
 *   (used when no primary has been chosen yet).
 * @param {boolean|null} [params.isDifferent=null] - Result of the semantic
 *   comparison, or `null` when it has not been run. When both sides hold data
 *   the caller must supply it; the emptiness cases are decided without it, so
 *   the expensive hash can be skipped.
 * @returns {{conflict: boolean, reason: string, areIdentical?: boolean,
 *   riskOverwriteEmptyPrimary?: boolean, requiresPrimarySelection?: boolean,
 *   needsComparison?: boolean}}
 */
export function decideSlotConflict({
  localInfo,
  gitInfo,
  sourceOfTruth,
  forcePrompt = false,
  isDifferent = null
} = {}) {
  const localEmpty = (localInfo?.userNodeCount || 0) === 0;
  const gitEmpty = (gitInfo?.userNodeCount || 0) === 0;

  // Nothing anywhere. Nothing to lose, nothing to ask.
  if (localEmpty && gitEmpty) {
    return { conflict: false, reason: 'both-empty' };
  }

  if (localEmpty !== gitEmpty) {
    const primaryIsEmpty = sourceOfTruth === 'git' ? gitEmpty : localEmpty;

    // The populated slot is the primary: it wins, exactly as before. The empty
    // secondary gets overwritten by real data, which loses nothing.
    if (sourceOfTruth && !primaryIsEmpty) {
      return { conflict: false, reason: 'secondary-empty' };
    }

    // THE 2026-09-12 CASE. The slot we are about to treat as authoritative
    // holds nothing, and the other one holds the user's work. Applying the
    // primary here propagates emptiness to the other slot. Always ask.
    return {
      conflict: true,
      reason: 'primary-empty',
      areIdentical: false,
      riskOverwriteEmptyPrimary: !!sourceOfTruth,
      requiresPrimarySelection: !sourceOfTruth
    };
  }

  // Both slots hold data — only the semantic comparison can separate them.
  if (isDifferent === null) {
    return { conflict: false, reason: 'needs-comparison', needsComparison: true };
  }

  if (!isDifferent && !forcePrompt) {
    return { conflict: false, reason: 'equal', areIdentical: true };
  }

  return {
    conflict: true,
    reason: isDifferent ? 'diverged' : 'prompt',
    areIdentical: !isDifferent,
    riskOverwriteEmptyPrimary: false,
    requiresPrimarySelection: forcePrompt && !isDifferent
  };
}
