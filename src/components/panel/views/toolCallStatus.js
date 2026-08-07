/**
 * Terminal-state repair for wizard tool-call chips.
 *
 * A chip is drawn by the tool_call/tool_call_start SSE event and only leaves
 * "Running…" when a tool_result carrying the same id arrives. Anything that ends
 * a run in between — the agent loop's early exits, a dropped stream, a server
 * restart, the user hitting Stop — left the chip spinning forever on a finished
 * run, with no stop button rendered because isProcessing was already false.
 *
 * AgentLoop now settles its own unfinished calls (settleUnresolvedToolCalls
 * there), which is the real fix. These are the client-side backstop for what it
 * cannot reach — the connection dying mid-stream — and for chips already
 * persisted in a running state by an earlier session.
 */

const NON_TERMINAL_TOOL_STATUSES = new Set(['running', 'queued', 'pending']);

const isUnsettled = (block) =>
  block?.type === 'tool_call' && (!block.status || NON_TERMINAL_TOOL_STATUSES.has(block.status));

/**
 * Returns a settled copy of `blocks`, or the same reference when nothing needed
 * changing — callers rely on identity to skip React state updates.
 */
export function settleToolCallBlocks(blocks, reason) {
  if (!Array.isArray(blocks)) return blocks;
  let changed = false;
  const settled = blocks.map(b => {
    if (!isUnsettled(b)) return b;
    changed = true;
    return { ...b, status: 'cancelled', error: b.error || reason };
  });
  return changed ? settled : blocks;
}

/** In-place variant for the SSE updater, which builds one `blocks` array it then assigns. */
export function settleToolCallBlocksInPlace(blocks, reason) {
  if (!Array.isArray(blocks)) return;
  for (let i = 0; i < blocks.length; i++) {
    if (!isUnsettled(blocks[i])) continue;
    blocks[i] = { ...blocks[i], status: 'cancelled', error: blocks[i].error || reason };
  }
}

/**
 * Settle a finished run's messages: cancel any tool chip still marked running AND
 * clear `isStreaming`.
 *
 * Clearing the flag belongs here rather than at each call site. This function is
 * the shared "this run is over, repair its messages" routine, and every caller
 * that used it was left with a message still claiming to stream — so the bubble
 * kept its animated ellipsis forever, and the persisted copy carried the stale
 * flag into the next session. Settling the chips but not the bubble is never the
 * intent.
 */
export function settleToolCallsInMessages(messages, reason) {
  if (!Array.isArray(messages)) return messages;
  let changed = false;
  const settled = messages.map(m => {
    const blocks = settleToolCallBlocks(m?.contentBlocks, reason);
    const blocksChanged = blocks !== m?.contentBlocks;
    const streamingChanged = m?.isStreaming === true;
    if (!blocksChanged && !streamingChanged) return m;
    changed = true;
    return {
      ...m,
      ...(blocksChanged ? { contentBlocks: blocks } : {}),
      ...(streamingChanged ? { isStreaming: false } : {})
    };
  });
  return changed ? settled : messages;
}

/**
 * Repair messages read back out of a conversation array: settle stale chips and
 * strip `isStreaming`.
 *
 * The flag is only cleared by an explicit done/error event, so a stream that died
 * without one persisted `isStreaming: true` — and the inline thinking-dots are
 * gated on that flag alone, not on isProcessing. The result was a conversation
 * that showed dots forever with the send (not stop) button rendered, looking
 * exactly like a stall.
 *
 * `exemptId` is the message a run is streaming into RIGHT NOW. The premise that
 * "nothing in here can still be streaming" is false for the conversations array,
 * which is written live during a run — so switching tabs mid-run ran this sweep
 * over the live bubble and stripped the flag off the message that was still
 * filling, freezing it for the rest of the run.
 */
export function clearStuckStreamingFlags(messages, exemptId = null) {
  if (!Array.isArray(messages)) return [];
  const settled = settleToolCallsInMessages(messages, 'The run ended before this tool returned a result.');
  if (settled === messages || !exemptId) return settled;
  // Order and length are preserved above, so index alignment holds.
  return settled.map((m, i) => (messages[i]?.id === exemptId ? messages[i] : m));
}
