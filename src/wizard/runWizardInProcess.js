/**
 * runWizardInProcess — run the agent loop in the app instead of on a server.
 *
 * This replaces the POST /api/wizard SSE round-trip. wizard-server wrote the
 * generator's events to the wire verbatim (`data: ${JSON.stringify(event)}`)
 * and the client JSON.parsed them back, so the event contract on both sides is
 * already identical — only the transport disappears. Callers keep their event
 * switch exactly as it was.
 *
 * Two things the server did for the caller, now done here:
 *   - staple `tabularData` onto `graphState._tabularData`, where tools read it
 *   - emit a final synthetic `{ type: 'done' }` after the generator finishes
 *
 * Browser-safe: no Node builtins, directly or transitively.
 */

import { runAgent } from './AgentLoop.js';
import { buildLlmConfig } from './buildLlmConfig.js';

/**
 * `ensureSchedulerStarted` is threaded through every tool but no tool calls it
 * — the only call site is commented out. redstring-mcp-server.js passes a no-op
 * for the same reason. Kept as a parameter so the signature stays honest.
 */
const NOOP_SCHEDULER = () => {};

/**
 * @param {Object}   params
 * @param {string|Array} params.message          user message (string, or multimodal blocks)
 * @param {Object}   params.graphState
 * @param {Array}    [params.conversationHistory]
 * @param {Array}    [params.tabularData]        uploaded CSV/TSV files
 * @param {string}   params.apiKey
 * @param {Object}   params.apiConfig            provider/model/settings/modelTier
 * @param {string}   [params.cid]
 * @param {string}   [params.systemPrompt]
 * @param {Array}    [params.contextItems]
 * @param {AbortSignal} [params.signal]          same signal the stop button already uses
 * @param {Function} [params.ensureSchedulerStarted]
 *
 * @yields {Object} the agent's event objects, then a final `{ type: 'done' }`
 */
export async function* runWizardInProcess({
  message,
  graphState,
  conversationHistory = [],
  tabularData = null,
  apiKey,
  apiConfig = {},
  cid,
  systemPrompt,
  contextItems = [],
  signal = null,
  ensureSchedulerStarted = NOOP_SCHEDULER
} = {}) {
  if (!message) {
    throw new Error('Message is required');
  }
  if (!apiKey) {
    throw new Error('API key required');
  }

  const state = graphState || {};

  // Tools reach uploaded files through graphState._tabularData; nothing else
  // passes them down.
  if (Array.isArray(tabularData) && tabularData.length > 0) {
    state._tabularData = tabularData;
  }

  const llmConfig = buildLlmConfig({
    apiKey,
    apiConfig,
    cid,
    systemPrompt,
    contextItems,
    conversationHistory
  });

  // Errors propagate to the caller rather than being converted to events. An
  // abort in particular must stay an exception: the caller's abort branch is
  // what removes an empty pre-created bubble on stop, and swallowing it into a
  // `done` event would leave that bubble behind.
  for await (const event of runAgent(
    message,
    state,
    llmConfig,
    ensureSchedulerStarted,
    signal
  )) {
    yield event;
  }

  // wizard-server sent this after the generator finished; the reducer clears
  // `isStreaming` and settles tool chips on it.
  yield { type: 'done' };
}

/**
 * Whether an error is a deliberate stop rather than a failure.
 *
 * The loop aborts through more than one path — a fetch rejection carrying
 * `name: 'AbortError'`, or the loop's own check throwing a plain Error whose
 * message mentions "aborted" — so matching on the name alone misses half of
 * them and renders a stop as a red error bubble. wizard-server used exactly
 * this pair of checks.
 */
export function isAbortError(error) {
  return error?.name === 'AbortError'
    || String(error?.message || '').toLowerCase().includes('aborted');
}

export default runWizardInProcess;
