/**
 * Working memory — the Druid's short-term store, written by the Druid itself.
 *
 * The wizard's compaction (src/wizard/compactConversation.js) is done TO the
 * conversation: code reduces old messages to a mechanical digest. The Druid's is
 * done BY the model: when its context fills, it writes the note that replaces
 * the context, and that note is the only thing it carries into the next stretch
 * of thought. What it chooses to keep is the point. Anything it wants to know
 * for longer than that belongs in the graph, which is its long-term memory.
 *
 * The note is delimited in the model's own output:
 *
 *     <working_memory>
 *     ...
 *     </working_memory>
 *
 * It may update the note whenever it likes, and is asked to rewrite it when
 * the context crosses the threshold; the rewrite clears everything else. A local model that
 * fails to answer gets one more try, then a mechanical fallback, so a run never
 * loses its memory to a malformed reply.
 *
 * Pure functions; no store, no network.
 */

import { estimateTokens } from '../wizard/tokenEstimate.js';
import { tokenize } from './recall.js';

export const WM_OPEN = '<working_memory>';
export const WM_CLOSE = '</working_memory>';

/** Fraction of the context window at which a rewrite is requested. */
export const DEFAULT_COMPACT_AT = 0.7;

/**
 * Cycles kept verbatim before a rewrite is requested whatever the token count.
 * AgentLoop keeps at most 20 history messages and drops the oldest silently;
 * compacting first means nothing leaves context without the Druid choosing
 * what to carry.
 */
export const DEFAULT_HISTORY_CAP = 16;

/**
 * Cycles an epoch runs before a note the Druid volunteers also clears the
 * context. Earlier than that the note is updated in place.
 */
export const MIN_EPOCH_CYCLES = 2;

/**
 * The note's share of the window. Past this it is asking the next epoch to
 * start already crowded, so it is sent back for a shorter one.
 */
export const MAX_NOTE_SHARE = 0.25;

/**
 * Pull the working-memory note out of a reply.
 *
 * The LAST note wins: a model that drafts one and then corrects itself meant
 * the correction. An unclosed note is kept — a local model that hits its
 * output limit mid-note has still said most of what it meant — and flagged.
 *
 * @param {string} text
 * @returns {{ memory: string|null, thought: string, truncated: boolean }}
 *   `thought` is the reply with the note removed.
 */
export function extractWorkingMemory(text) {
  const s = String(text || '');
  const open = s.lastIndexOf(WM_OPEN);
  if (open < 0) return { memory: null, thought: s.trim(), truncated: false };

  const after = s.slice(open + WM_OPEN.length);
  const close = after.indexOf(WM_CLOSE);
  const body = (close >= 0 ? after.slice(0, close) : after).trim();
  const tail = close >= 0 ? after.slice(close + WM_CLOSE.length) : '';
  const thought = `${s.slice(0, open)}${tail}`.trim();

  return { memory: body || null, thought, truncated: close < 0 };
}

/**
 * Whether a note says anything. A copied "..." template, or a line of filler,
 * is not a memory, and taking it as one erases the real note.
 */
export function isMeaningfulNote(memory) {
  return tokenize(memory).length >= 3;
}

/**
 * A thought fit to be fed back.
 *
 * Some chat templates (Qwen's among them) put the tool list in the system turn
 * inside <tools>…</tools>, and a small model at a warm temperature will
 * sometimes go on reciting it. Fed back as "your last thought", one such reply
 * poisons the next cycle, so recited schemas and unparsed tool-call markup are
 * removed before a thought is kept.
 */
export function cleanThought(text) {
  return String(text || '')
    .replace(/<tools>[\s\S]*?(<\/tools>|$)/g, '')
    .replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, '')
    .split('\n')
    .filter(line => !/^\s*\{\s*"type"\s*:\s*"function"/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Why a rewrite is due, or null.
 *
 * @param {Object} p
 * @param {number} p.promptTokens   largest prompt the last cycle sent
 * @param {number} p.contextWindow  the local server's configured window
 * @param {number} [p.compactAt]
 * @param {number} p.historyLength  messages carried verbatim
 * @param {number} [p.historyCap]
 * @returns {'context'|'history'|null}
 */
export function compactionDue({
  promptTokens,
  contextWindow,
  compactAt = DEFAULT_COMPACT_AT,
  historyLength,
  historyCap = DEFAULT_HISTORY_CAP
}) {
  if (contextWindow > 0 && promptTokens >= contextWindow * compactAt) return 'context';
  if (historyLength >= historyCap) return 'history';
  return null;
}

/** Whether a note is too large to start an epoch with. */
export function noteOverBudget(memory, contextWindow) {
  return contextWindow > 0 && estimateTokens(memory) > contextWindow * MAX_NOTE_SHARE;
}

/** Clip a note to its budget, keeping the start, which is where models put what matters most. */
export function clipNote(memory, contextWindow) {
  const maxChars = Math.floor(contextWindow * MAX_NOTE_SHARE * 4);
  const s = String(memory || '');
  return s.length <= maxChars ? s : `${s.slice(0, maxChars).trimEnd()}\n[…clipped: the note was over its budget]`;
}

/**
 * The note written for the Druid when it could not write its own.
 *
 * It keeps the previous note whole and adds the epoch's thoughts, newest
 * last, under a heading that says plainly they were not consolidated — so the
 * Druid can see this happened and reconsolidate on its next rewrite.
 *
 * @param {string} previous             the outgoing note
 * @param {Array<{role, content}>} history  the epoch's verbatim cycles
 * @param {string} [latest]             the reply that failed to carry a note
 * @param {number} [contextWindow]
 */
export function fallbackWorkingMemory(previous, history, latest = '', contextWindow = 8192) {
  const thoughts = [
    ...(history || []).filter(m => m.role === 'assistant').map(m => m.content),
    latest
  ]
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .slice(-4)
    .map(t => `- ${t.length > 280 ? `${t.slice(0, 280)}…` : t}`);

  const parts = [];
  if (previous && previous.trim()) parts.push(previous.trim());
  if (thoughts.length > 0) {
    parts.push(`Thoughts carried over without consolidation (you did not write a note when asked):\n${thoughts.join('\n')}`);
  }
  return clipNote(parts.join('\n\n'), contextWindow);
}
