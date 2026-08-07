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
 * Return a copy of `messages` with the volatile context block appended at the
 * end. `messages` is never mutated.
 *
 * When the conversation already ends with a plain-text user turn the block is
 * folded into it, which keeps the request one message shorter and avoids two
 * consecutive user turns. After a tool result — the common case mid-loop — it
 * has to be a message of its own, since a tool-result turn carries structured
 * blocks that text cannot simply be concatenated onto.
 *
 * @param {Array} messages - Canonical conversation (system first)
 * @param {string} contextText - Rendered graph context + plan directive
 * @returns {Array} A new array; the input is untouched
 */
export function buildRequestMessages(messages, contextText) {
  const list = Array.isArray(messages) ? messages : [];
  if (!contextText || !String(contextText).trim()) return list.slice();

  const block = `${ENVIRONMENT_BLOCK_HEADER}\n${contextText}`;
  const out = list.slice();
  const last = out[out.length - 1];

  if (last && last.role === 'user' && typeof last.content === 'string') {
    out[out.length - 1] = {
      ...last,
      content: `${last.content}\n\n${block}`,
      [VOLATILE_CONTEXT_FLAG]: true
    };
    return out;
  }

  out.push({ role: 'user', content: block, [VOLATILE_CONTEXT_FLAG]: true });
  return out;
}

/**
 * True when this message carries the volatile block and therefore must not be
 * used as a cache breakpoint.
 */
export function isVolatileContextMessage(msg) {
  return !!(msg && msg[VOLATILE_CONTEXT_FLAG]);
}
