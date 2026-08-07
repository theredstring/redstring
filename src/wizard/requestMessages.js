/**
 * requestMessages - Assemble the message array actually sent to the provider.
 *
 * The graph context header and plan directive used to live at the end of the
 * system prompt, rebuilt into `messages[0]` on every iteration. That placement
 * quietly made prompt caching impossible for everything downstream of it:
 * providers cache a request PREFIX, in the fixed order tools → system →
 * messages, so a system block that changes every iteration means the entire
 * conversation history behind it can never be cached. History is the part that
 * grows — a few thousand tokens per tool-heavy iteration — so it was also the
 * part most worth caching, and it was the part structurally prevented from it.
 *
 * Moving the volatile block to the very END of the request inverts that: tools,
 * system prompt and history are all byte-stable and cacheable, and only the
 * small block describing "what the graph looks like right now" is re-read at
 * full price.
 *
 * The other half of the trick is that the block must never be *stored* in the
 * conversation. If each iteration pushed its context into `messages`, the
 * history bytes would shift every iteration and stay uncacheable anyway — and
 * the model would accumulate a pile of stale, contradictory snapshots of a
 * graph that has since changed. So the block is injected into a throwaway copy
 * at send time and the canonical `messages` array never sees it.
 */

/**
 * Heading on the injected block. Named so the model reads it as live state
 * rather than as something the user said.
 */
export const ENVIRONMENT_BLOCK_HEADER = '## Current Environment (refreshed every step)';

/**
 * Marker on the injected message. LLMClient uses it to keep cache breakpoints
 * off the one message guaranteed to differ on the next request.
 */
export const VOLATILE_CONTEXT_FLAG = '_volatileContext';

/**
 * Return a copy of `messages` with the volatile context appended as its own
 * trailing message. `messages` is never mutated.
 *
 * It is always a separate message, never folded into a preceding user turn, and
 * that matters more than it looks. Folding would rewrite the bytes of an existing
 * message — so on iteration 0 the user's turn would read "make a web for X" plus
 * the snapshot, and on iteration 1, once a tool result had arrived and the block
 * moved to its own message, that same user turn would read "make a web for X"
 * alone. A message near the front of the conversation changing content between
 * requests invalidates the cached prefix covering everything after it, which is
 * the entire history. Keeping the block in a message of its own leaves every
 * earlier message byte-stable for the whole ask.
 *
 * @param {Array} messages - Canonical conversation (system first)
 * @param {string} contextText - Rendered graph context + plan directive
 * @returns {Array} A new array; the input is untouched
 */
export function buildRequestMessages(messages, contextText) {
  const list = Array.isArray(messages) ? messages : [];
  if (!contextText || !String(contextText).trim()) return list.slice();

  const block = `${ENVIRONMENT_BLOCK_HEADER}\n${contextText}`;
  return [...list, { role: 'user', content: block, [VOLATILE_CONTEXT_FLAG]: true }];
}

/**
 * True when this message carries the volatile block and therefore must not be
 * used as a cache breakpoint.
 */
export function isVolatileContextMessage(msg) {
  return !!(msg && msg[VOLATILE_CONTEXT_FLAG]);
}
