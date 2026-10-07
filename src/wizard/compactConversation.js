/**
 * Conversation compaction, and the history every ask sends.
 *
 * What an ask carries of the conversation is its prose: each message's text
 * (a user's attached files included), never the tool calls and results the
 * cards show. Those stay in the panel. So the history is what fills over a
 * long session, and what compaction shrinks.
 *
 * Compaction is not deletion. It writes a summary of the earlier conversation
 * into the transcript, at the point it was made, and leaves every message
 * where it was: the person keeps their whole conversation on screen, and the
 * Wizard's history starts from the newest summary (projectHistory). A summary
 * folds the one before it in, so there is only ever one to send.
 *
 * What it deliberately does NOT touch:
 *
 *   - The plan. Plans live in the Zustand store (`wizardPlansByConversation`),
 *     not in the message array, so compaction cannot lose one.
 *   - The last exchange, which carries the intent the model is still working
 *     from.
 *
 * Pure functions over messages, so they test without a store, a network call,
 * or a React tree.
 */

import { estimateTokens, estimateObjectTokens, MAX_TOOL_RESULT_CHARS, CHARS_PER_TOKEN } from './tokenEstimate.js';

/** How many trailing user/Wizard messages survive compaction as they are. */
export const KEEP_RECENT_MESSAGES = 2;

/** Fewer than this many messages to fold in and a summary saves nothing. */
export const MIN_MESSAGES_TO_SUMMARIZE = 2;

/** Messages after the newest summary that an ask carries. */
export const HISTORY_LIMIT = 10;

/**
 * Ceiling on a summary. It folds every earlier one in, so without one it would
 * grow for ever; past it, the oldest lines go first, and it says how many.
 */
export const SUMMARY_TOKEN_LIMIT = 1500;

/** What an image costs a vision model, roughly. */
const IMAGE_TOKENS = 1000;

const MAX_TOOL_RESULT_TOKENS = Math.ceil(MAX_TOOL_RESULT_CHARS / CHARS_PER_TOKEN);

export const isCompactionSummary = (msg) => msg?.metadata?.kind === 'compaction-summary';

// The panel's own notices ("Error: ...") are system messages; an ask never
// carries them (AgentLoop drops role:'system'), so neither does a summary.
const isConversational = (msg) => msg && (msg.sender === 'user' || msg.sender === 'ai');

const lastSummaryIndex = (list) => {
  for (let i = list.length - 1; i >= 0; i--) if (isCompactionSummary(list[i])) return i;
  return -1;
};

/**
 * The conversation as an ask sends it: the newest summary, as a user turn
 * (AgentLoop drops system ones), then the messages after it, newest
 * HISTORY_LIMIT of them. `pinned` marks the summary so the loop's size trim
 * keeps it.
 *
 * @returns {Array<{role:string, content:string|Array, pinned?:boolean}>}
 */
export function projectHistory(messages, { limit = HISTORY_LIMIT } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const s = lastSummaryIndex(list);
  const out = [];
  if (s >= 0) out.push({ role: 'user', content: list[s].content, pinned: true });
  const after = list.slice(s + 1).filter(m => !isCompactionSummary(m)).slice(-limit);
  for (const msg of after) {
    out.push({
      role: msg.sender === 'user' ? 'user' : msg.sender === 'ai' ? 'assistant' : 'system',
      content: msg.metadata?.contentBlocksForHistory || msg.content
    });
  }
  return out;
}

/** What a projected history costs, the way the panel's meter counts it. */
export function estimateHistoryTokens(history) {
  let total = 0;
  for (const entry of history || []) {
    if (entry.role === 'system') continue;
    const content = entry.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'image') total += IMAGE_TOKENS;
        else if (typeof block?.text === 'string') total += estimateTokens(block.text);
        else if (typeof block === 'string') total += estimateTokens(block);
      }
    } else {
      total += estimateTokens(content || '');
    }
  }
  return total;
}

/**
 * Estimate what a message costs as the panel holds it (capped tool results).
 * Not what an ask sends: that is estimateHistoryTokens(projectHistory(...)).
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
 * Summarize one message into a single line of the digest.
 *
 * Tool calls are reduced to name + outcome. History never carried them, so
 * the digest is the one place a later ask learns which tools ran.
 */
function summarizeMessage(msg) {
  if (!msg) return null;

  if (msg.sender === 'user') {
    const text = (msg.content || '').trim();
    const files = (msg.metadata?.attachments || []).map(a => a?.name).filter(Boolean);
    if (!text && files.length === 0) return null;
    const clipped = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    return `User asked: ${clipped}${files.length > 0 ? ` (attached: ${files.join(', ')})` : ''}`;
  }

  const parts = [];
  const toolCalls = (msg.contentBlocks || []).filter(b => b?.type === 'tool_call' && !b.isUndone);
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

/** Where the kept tail starts: the last `keepRecent` user/Wizard messages. */
function keepStart(list, from, keepRecent) {
  let kept = 0;
  let i = list.length;
  while (i > from && kept < keepRecent) {
    i--;
    if (isConversational(list[i])) kept++;
  }
  return i;
}

/** Whether compacting now would fold anything in. Cheap enough per render. */
export function canCompact(messages, { keepRecent = KEEP_RECENT_MESSAGES } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const from = lastSummaryIndex(list) + 1;
  const cut = keepStart(list, from, keepRecent);
  let n = 0;
  for (let i = from; i < cut; i++) if (isConversational(list[i])) n++;
  return n >= MIN_MESSAGES_TO_SUMMARIZE;
}

/**
 * Compact a message list: insert a summary of everything since the last one,
 * up to the kept tail. Nothing is removed.
 *
 * @param {Array} messages - The conversation, oldest first
 * @param {Object} [opts]
 * @param {number} [opts.keepRecent] - Trailing user/Wizard messages left out of the summary
 * @returns {{ messages: Array, compacted: boolean, tokensBefore: number, tokensAfter: number, summarizedCount: number }}
 *   tokens are what an ask's history costs before and after
 */
export function compactConversation(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const keepRecent = opts.keepRecent ?? KEEP_RECENT_MESSAGES;
  const tokensBefore = estimateHistoryTokens(projectHistory(list));
  const unchanged = { messages: list, compacted: false, tokensBefore, tokensAfter: tokensBefore, summarizedCount: 0 };

  if (!canCompact(list, { keepRecent })) return unchanged;

  const priorIdx = lastSummaryIndex(list);
  const from = priorIdx + 1;
  const cut = keepStart(list, from, keepRecent);
  const lines = list.slice(from, cut)
    .filter(isConversational)
    .map(summarizeMessage)
    .filter(Boolean);
  if (lines.length === 0) return unchanged;

  // Fold the previous summary in, so the newest one is the whole of it.
  const prior = priorIdx >= 0 ? list[priorIdx] : null;
  const priorBody = prior ? prior.content.replace(/^\[Earlier conversation[^\]]*\]\n/, '') : null;
  const priorCount = prior?.metadata?.summarizedCount || 0;
  const count = priorCount + lines.length;
  const allLines = [...(priorBody ? priorBody.split('\n') : []), ...lines]
    .filter(line => line && !/^\(\d+ earlier lines? left out\)$/.test(line));
  const priorOmitted = Number((/^\((\d+) earlier lines? left out\)$/m.exec(priorBody || '') || [])[1]) || 0;
  let spent = 0;
  let keepFrom = allLines.length;
  while (keepFrom > 0 && spent + estimateTokens(allLines[keepFrom - 1]) <= SUMMARY_TOKEN_LIMIT) {
    keepFrom--;
    spent += estimateTokens(allLines[keepFrom]);
  }
  const omitted = priorOmitted + keepFrom;
  const body = [
    omitted > 0 ? `(${omitted} earlier line${omitted !== 1 ? 's' : ''} left out)` : null,
    ...allLines.slice(keepFrom)
  ].filter(Boolean).join('\n');

  const summaryMessage = {
    id: `compaction-${list[from]?.id || 'x'}-${cut}`,
    sender: 'system',
    content: `[Earlier conversation, summarized to save context — ${count} messages]\n${body}`,
    timestamp: new Date().toISOString(),
    metadata: { kind: 'compaction-summary', summarizedCount: count },
    contentBlocks: [],
    isStreaming: false
  };

  const out = [...list.slice(0, cut), summaryMessage, ...list.slice(cut)];
  return {
    messages: out,
    compacted: true,
    tokensBefore,
    tokensAfter: estimateHistoryTokens(projectHistory(out)),
    summarizedCount: lines.length
  };
}
