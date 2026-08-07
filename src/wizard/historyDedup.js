/**
 * historyDedup - Collapse superseded read-only tool results in the conversation.
 *
 * The dominant source of history growth in a long agentic run is the model
 * reading the same thing over and over. It calls `readGraph` on the active graph,
 * builds something, calls `readGraph` again to check its work, builds more, reads
 * again — and every one of those full snapshots stays in the conversation forever,
 * re-uploaded on every subsequent iteration. Only the newest is true; the earlier
 * ones describe a graph that no longer exists, so they are simultaneously the
 * bulk of the cost and a source of stale, contradictory state.
 *
 * So: when several results describe the same read of the same target, keep the
 * newest verbatim and replace the rest with a one-line marker. The marker matters
 * — silently deleting a tool result would leave an assistant `tool_use` with no
 * matching `tool_result`, which providers reject outright, and would also hide
 * from the model that it already looked.
 *
 * Only read-only tools are eligible. A mutating tool's result is the record of
 * what actually happened, and two `expandGraph` calls with identical arguments
 * are two real, separate mutations — collapsing them would rewrite history.
 */

import { estimateTokens } from './tokenEstimate.js';

/**
 * Read-only tools whose results may be superseded.
 *
 * Deliberately narrower than AgentLoop's NON_MUTATING_TOOLS:
 *   - `planTask` is excluded because the plan is live state the loop reads back
 *     out of the conversation, not a snapshot of something else.
 *   - `askMultipleChoice` is excluded because it is a question put to the user,
 *     not a read — the answer does not become stale.
 */
export const SUPERSEDABLE_TOOLS = new Set([
  'readGraph', 'inspectWorkspace', 'inspectPrototype', 'getNodeContext',
  'search', 'searchNodes', 'searchConnections', 'listGroups',
  'listDefinitionGraphs', 'getGraphInstances', 'getInstancesOfPrototype',
  'getPrototype', 'listTools', 'sketchGraph', 'readAbstractionChain',
  'findDuplicates'
]);

/**
 * Identity of a read: two results sharing a key describe the same thing, so only
 * the newest is worth keeping.
 *
 * The result is consulted before the arguments because it is more reliable — a
 * model may reach the same graph as `readGraph({})`, `readGraph({targetGraphId:
 * "Cell"})` and `readGraph({targetGraphId: "graph-17"})`, and only the resolved
 * `graphId` coming back reveals those as one target. Arguments are the fallback
 * for tools whose results carry no identifier.
 *
 * @param {string} toolName
 * @param {Object} args - Arguments the model passed
 * @param {Object} result - The tool's return value
 * @returns {string|null} A stable key, or null when this call is not superedable
 */
export function dedupKeyFor(toolName, args, result) {
  if (!SUPERSEDABLE_TOOLS.has(toolName)) return null;

  const parts = [toolName];

  if (result && typeof result === 'object') {
    if (result.graphId) parts.push(`g:${result.graphId}`);
    else if (result.prototypeId) parts.push(`p:${result.prototypeId}`);
  }

  // No identifier in the result — fall back to the arguments. Distinct arguments
  // then mean distinct reads, which is conservative: it dedups less, never more.
  if (parts.length === 1) {
    let argKey = '';
    try {
      argKey = JSON.stringify(args ?? {});
    } catch {
      return null; // circular args — can't key it, so leave it alone
    }
    parts.push(`a:${argKey}`);
  }

  // A mode-scoped tool returns genuinely different shapes per mode; a census and
  // a full read of the same graph are not substitutes for one another.
  if (args && typeof args === 'object' && args.mode) parts.push(`m:${args.mode}`);

  return parts.join('|');
}

/** Marker left in place of a superseded result. */
function supersededStub(toolName) {
  return JSON.stringify({
    superseded: true,
    note: `Result omitted — a later ${toolName} call covers the same target, and its result is the current one. Read that instead of re-calling this.`
  });
}

/**
 * Replace superseded read-only tool results with stubs.
 *
 * Returns a new array; the input is not mutated. Messages carry a `_dedupKey`
 * set by the caller at push time (that is where the arguments and the untruncated
 * result are both in hand).
 *
 * @param {Array} messages - Conversation, system message first
 * @returns {{messages: Array, reclaimedTokens: number, byTool: Object, supersededCount: number}}
 */
export function dedupeHistory(messages) {
  const list = Array.isArray(messages) ? messages : [];

  // Newest occurrence of each key wins, so find those first.
  const newestIndexByKey = new Map();
  for (let i = 0; i < list.length; i++) {
    const key = list[i]?._dedupKey;
    if (key) newestIndexByKey.set(key, i);
  }

  const byTool = {};
  let reclaimedTokens = 0;
  let supersededCount = 0;

  const out = list.map((msg, i) => {
    const key = msg?._dedupKey;
    if (!key || newestIndexByKey.get(key) === i) return msg;
    if (msg._superseded) return msg; // already collapsed on an earlier pass

    const toolName = msg._toolName || 'tool';
    const stub = supersededStub(toolName);
    const saved = Math.max(0, estimateTokens(msg.content) - estimateTokens(stub));
    reclaimedTokens += saved;
    byTool[toolName] = (byTool[toolName] || 0) + saved;
    supersededCount++;

    return { ...msg, content: stub, _superseded: true };
  });

  return { messages: out, reclaimedTokens, byTool, supersededCount };
}
