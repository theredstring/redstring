/**
 * Conversation compaction.
 *
 * A long wizard session accumulates tool results that are individually capped
 * but collectively enormous — every one of them is re-uploaded on every
 * iteration of every later ask. Compaction collapses the old part of the
 * transcript into a single summary message and keeps the recent part verbatim,
 * so a session can continue past the point where context would otherwise fill.
 *
 * What it deliberately does NOT touch:
 *
 *   - The plan. Plans live in the Zustand store (`wizardPlansByConversation`),
 *     not in the message array, so compaction cannot lose one. That separation
 *     is what lets a compacted conversation still know what it was building —
 *     and it is asserted in the tests rather than assumed.
 *   - The user's own messages in the recent window, which carry the intent the
 *     model is still working from.
 *
 * This is a pure function over messages so it can be tested without a store, a
 * network call, or a React tree.
 */

import { estimateTokens, estimateObjectTokens, MAX_TOOL_RESULT_CHARS, CHARS_PER_TOKEN } from './tokenEstimate.js';

/** How many trailing messages survive compaction untouched. */
export const KEEP_RECENT_MESSAGES = 6;

/** Below this many messages there is nothing worth compacting. */
export const MIN_MESSAGES_TO_COMPACT = 8;

const MAX_TOOL_RESULT_TOKENS = Math.ceil(MAX_TOOL_RESULT_CHARS / CHARS_PER_TOKEN);

/**
 * Estimate what a message costs in the conversation, mirroring how the panel's
 * context meter measures it (capped tool results, not raw ones).
 */
export function estimateMessageTokens(msg) {
  if (!msg) return 0;
  let total = estimateTokens(msg.content || '');
  if (Array.isArray(msg.contentBlocks)) {
    for (const block of msg.contentBlocks) {
      if (block?.type === 'tool_call') {
        total += estimateTokens(block.name || '');
        total += estimateObjectTokens(block.args);
        total += Math.min(estimateObjectTokens(block.result), MAX_TOOL_RESULT_TOKENS);
      } else if (block?.content) {
        total += estimateTokens(block.content);
      }
    }
  }
  return total;
}

/**
 * Summarize one message into a single line of the compaction digest.
 *
 * Tool calls are reduced to name + outcome. Which tools ran, in what order, and
 * whether they succeeded is the part that carries forward; the payloads are
 * exactly what compaction exists to shed.
 */
function summarizeMessage(msg) {
  if (!msg) return null;

  if (msg.sender === 'user') {
    const text = (msg.content || '').trim();
    if (!text) return null;
    const clipped = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    return `User asked: ${clipped}`;
  }

  if (msg.sender === 'system') {
    const text = (msg.content || '').trim();
    if (!text) return null;
    return `System: ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`;
  }

  const parts = [];
  const toolCalls = (msg.contentBlocks || []).filter(b => b?.type === 'tool_call');
  if (toolCalls.length > 0) {
    const rendered = toolCalls.map(tc => {
      const name = tc.name || 'tool';
      const failed = tc.result?.error || tc.status === 'failed';
      const target = tc.args?.name || tc.args?.graphName || tc.args?.nodeName || tc.args?.targetGraphId;
      const label = target ? `${name}(${target})` : name;
      return failed ? `${label} FAILED` : label;
    });
    parts.push(`Ran: ${rendered.join(', ')}`);
  }

  const text = (msg.contentBlocks || [])
    .filter(b => b?.type === 'text' && b.content)
    .map(b => b.content)
    .join(' ')
    .trim() || (msg.content || '').trim();
  if (text) {
    parts.push(text.length > 200 ? `${text.slice(0, 200)}…` : text);
  }

  return parts.length > 0 ? `Wizard: ${parts.join(' — ')}` : null;
}

/**
 * Compact a message list.
 *
 * @param {Array} messages - The conversation, oldest first
 * @param {Object} [opts]
 * @param {number} [opts.keepRecent] - Trailing messages to preserve verbatim
 * @returns {{ messages: Array, compacted: boolean, tokensBefore: number, tokensAfter: number, summarizedCount: number }}
 */
export function compactConversation(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const keepRecent = opts.keepRecent ?? KEEP_RECENT_MESSAGES;
  const tokensBefore = list.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

  if (list.length < MIN_MESSAGES_TO_COMPACT || list.length <= keepRecent) {
    return { messages: list, compacted: false, tokensBefore, tokensAfter: tokensBefore, summarizedCount: 0 };
  }

  const cutoff = list.length - keepRecent;
  const older = list.slice(0, cutoff);
  const recent = list.slice(cutoff);

  // Don't re-summarize an existing digest — fold its text in as the first line
  // so repeated compactions stay a single summary rather than nesting.
  const priorDigest = older.find(m => m?.metadata?.kind === 'compaction-summary');
  const lines = older
    .filter(m => m?.metadata?.kind !== 'compaction-summary')
    .map(summarizeMessage)
    .filter(Boolean);

  if (lines.length === 0) {
    return { messages: list, compacted: false, tokensBefore, tokensAfter: tokensBefore, summarizedCount: 0 };
  }

  const body = [
    priorDigest ? priorDigest.content.replace(/^\[Earlier conversation[^\]]*\]\n/, '') : null,
    ...lines
  ].filter(Boolean).join('\n');

  const summaryMessage = {
    id: `compaction-${list[0]?.id || 'x'}-${cutoff}`,
    sender: 'system',
    content: `[Earlier conversation, summarized to save context — ${lines.length} messages]\n${body}`,
    timestamp: new Date().toISOString(),
    metadata: { kind: 'compaction-summary', summarizedCount: lines.length },
    contentBlocks: [],
    isStreaming: false
  };

  const out = [summaryMessage, ...recent];
  const tokensAfter = out.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

  return {
    messages: out,
    compacted: true,
    tokensBefore,
    tokensAfter,
    summarizedCount: lines.length
  };
}
