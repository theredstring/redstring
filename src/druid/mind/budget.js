/**
 * The per-call token budget.
 *
 * Apple's on-device model has 4,096 tokens for input and output together, so
 * every call is assembled from sections that each have a cap, and when the
 * whole is still too large, the least essential sections give way first. The
 * order in which they give way is the order of what matters least:
 * surroundings before thoughts, thoughts before what is held in mind, and the
 * question and its options never.
 *
 * A prompt has two parts: the context (what it holds in mind, where it is,
 * what it was thinking), the same for every call of a moment, and the turn
 * (what was said, a notice, the question), different each time. Apple's model
 * reads the context once per moment and takes each turn as a follow-up
 * (afmClient.js): reading a prompt is nearly all of a call's time.
 */

import { estimateTokens } from '../../wizard/tokenEstimate.js';

export const WINDOW = 4096;

/** Section caps, in tokens. */
export const CAPS = {
  system: 500,
  view: 1200,
  wm: 400,
  loop: 600,
  dialogue: 300,
  notice: 200,
  // The question carries its options, or in command mode the forms and the
  // suggestions (about 450 tokens); the view gives way first.
  question: 700
};

/** Which sections give way first. */
const TRIM_ORDER = ['view', 'loop', 'notice', 'wm', 'dialogue'];
/** The context, shared by a moment's calls; then the turn. */
const CONTEXT = ['wm', 'view', 'loop'];
const TURN = ['dialogue', 'notice', 'question'];

/** Keep the first lines of a text that fit `tokens`. */
export function clipToTokens(text, tokens) {
  const s = String(text || '');
  if (estimateTokens(s) <= tokens) return s;
  const lines = s.split('\n');
  const out = [];
  let used = 0;
  for (const line of lines) {
    const cost = estimateTokens(line) + 1;
    if (used + cost > tokens) break;
    out.push(line);
    used += cost;
  }
  if (out.length === 0) return s.slice(0, Math.max(0, tokens * 4 - 1));
  return `${out.join('\n')}\n…`;
}

/**
 * Assemble a prompt from named sections within a budget.
 *
 * @param {Object} sections   { system, view, wm, loop, dialogue, notice, question } — strings, any may be empty
 * @param {number} reserveOut tokens kept for the reply
 * @param {number} [window]
 * @returns {{ system: string, user: string, context: string, turn: string, tokens: number, trimmed: string[] }}
 */
export function assemble(sections, reserveOut, window = WINDOW) {
  const capped = {};
  for (const [k, v] of Object.entries(sections)) {
    capped[k] = v ? clipToTokens(v, CAPS[k] ?? 400) : '';
  }
  const total = () => Object.values(capped).reduce((n, v) => n + estimateTokens(v), 0) + reserveOut + 40;
  const trimmed = [];
  for (const k of TRIM_ORDER) {
    if (total() <= window) break;
    if (!capped[k]) continue;
    const excess = total() - window;
    const keep = Math.max(0, estimateTokens(capped[k]) - excess);
    capped[k] = keep > 20 ? clipToTokens(capped[k], keep) : '';
    trimmed.push(k);
  }
  const join = (keys) => keys.map(k => capped[k]).filter(Boolean).join('\n\n');
  const context = join(CONTEXT);
  const turn = join(TURN);
  return { system: capped.system || '', user: [context, turn].filter(Boolean).join('\n\n'), context, turn, tokens: total(), trimmed };
}
