/**
 * Shared token estimation.
 *
 * Three places used to carry their own copy of the ~chars/4 heuristic — the
 * result size cap in AgentLoop, truncateContext in ContextBuilder, and the
 * context-usage meter in the panel — and they drifted. The context header now
 * has to fit a token budget that the meter reports on, so the two have to agree
 * or the bar lies about the very thing the budget is enforcing.
 *
 * This is deliberately an estimate, not a tokenizer. Every provider tokenizes
 * differently and pulling in a real BPE tokenizer would cost more (bundle size,
 * per-provider vocab) than the accuracy is worth for a budget with this much
 * headroom. Treat the numbers as ±20%.
 */

/** Average characters per token across English prose + JSON. */
export const CHARS_PER_TOKEN = 4;

/**
 * Hard ceiling on how much any single tool result may contribute to the
 * conversation. Tool results are pushed into `messages` and RE-UPLOADED on every
 * subsequent iteration, so one oversized result silently taxes the whole rest of
 * the turn.
 *
 * Lives here rather than in AgentLoop because the panel's context meter has to
 * agree with it: the meter used to measure the raw, uncapped result object even
 * though the model only ever received the capped version, so a single
 * inspectWorkspace call could report half the context window consumed by data
 * that was never sent.
 */
export const MAX_TOOL_RESULT_CHARS = 24000;

/**
 * Estimate the token cost of a string.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / CHARS_PER_TOKEN);
}

/**
 * Estimate the token cost of an arbitrary value as the model would see it —
 * i.e. after JSON serialization, which is how tool args and results reach the
 * conversation.
 *
 * Returns 0 for values that cannot be serialized (circular refs); a budget is
 * not worth throwing over.
 * @param {unknown} value
 * @returns {number}
 */
export function estimateObjectTokens(value) {
  if (value == null) return 0;
  if (typeof value !== 'object') return estimateTokens(String(value));
  try {
    return estimateTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

/**
 * Convert a token budget into the character budget the string builders use.
 * @param {number} tokens
 * @returns {number}
 */
export function tokensToChars(tokens) {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN));
}
