/**
 * bridgeOutcome.js
 *
 * How the MCP server reports a change it queued for the app. A wizard tool's
 * result says what it meant to do (created: true, deleted: true); the app's
 * ack (bridgeApply.js, storeActions' applyMutations) says whether it happened.
 * This folds the two together so the model is never told a change landed
 * when it failed, was held for the person's OK, or was never confirmed.
 *
 * Pure, no imports: the MCP server imports it, and stdout there is the
 * protocol (no console.log).
 */

// Flags a tool sets when it means to have done something; false once the app says it didn't.
export const DONE_FLAGS = ['success', 'created', 'updated', 'deleted', 'merged', 'converted', 'combined', 'moved', 'added', 'removed', 'placed'];

const undone = (result) => {
  for (const key of DONE_FLAGS) if (key in result) result[key] = false;
  return result;
};

/** The id of the queued action itself: the server puts an openGraph ahead of a batch for each web it names. */
export const queuedActionId = (enqueueData) => {
  const ids = enqueueData?.actionIds;
  return Array.isArray(ids) && ids.length > 0 ? ids[ids.length - 1] : null;
};

/**
 * @param {object} result       the tool's own result
 * @param {object} enqueueData  the enqueue response ({ ok, actionIds })
 * @param {object|null} waitResult  waitForActionCompletion's ({ completed, timedOut, results })
 * @param {string|null} actionId    the queued action whose ack to read
 * @returns {{ result: object, isError: boolean }}
 */
export function settleBridgeResult(result, enqueueData, waitResult, actionId) {
  const base = result && typeof result === 'object' ? result : {};
  if (!enqueueData?.ok || !actionId) {
    const why = enqueueData?.error ? `: ${enqueueData.error}` : '';
    return { result: undone({ ...base, ok: false, status: 'failed', error: `Could not queue this change for Redstring${why}.` }), isError: true };
  }
  if (!waitResult || waitResult.timedOut || !waitResult.completed) {
    const error = 'Redstring did not confirm this change in time, so it may not have been applied. Check with a read tool before repeating it.';
    return { result: undone({ ...base, ok: false, status: 'timed_out', error }), isError: true };
  }
  const ack = waitResult.results?.[actionId];
  if (!ack || typeof ack !== 'object') return { result: base, isError: false };
  const merged = { ...base, ...ack };
  // Waiting on the person: not done, not an error either.
  if (ack.held) return { result: undone(merged), isError: false };
  if (ack.ok === false || ack.success === false) {
    const failedOps = Array.isArray(ack.results) ? ack.results.filter(r => r && r.ok === false) : [];
    merged.ok = false;
    merged.status = 'failed';
    merged.error = ack.error
      || (failedOps.length ? failedOps.map(r => `${r.type}: ${r.error || 'failed'}`).join('; ') : 'Redstring could not apply this change.');
    return { result: undone(merged), isError: true };
  }
  return { result: merged, isError: false };
}
