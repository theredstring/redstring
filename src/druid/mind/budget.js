/**
 * The per-call token budget.
 *
 * Apple's on-device model has 4,096 tokens for input and output together, so
 * every call is assembled from sections that each have a cap, and when the
 * whole is still too large, the least essential sections give way first. The
 * order in which they give way is the order of what matters least:
 * surroundings before thoughts, thoughts before what is held in mind, and the
 * question and its options never.
 */

import { estimateTokens } from '../../wizard/tokenEstimate.js';

export const WINDOW = 4096;

/** Section caps, in tokens. */
export const CAPS = {
  system: 500,
  view: 1200,
  wm: 400,
  loop: 600,
  notice: 200,
  question: 400
};

/** Which sections give way first. */
const TRIM_ORDER = ['view', 'loop', 'notice', 'wm'];

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
 * @param {Object} sections   { system, view, wm, loop, notice, question } — strings, any may be empty
 * @param {number} reserveOut tokens kept for the reply
 * @param {number} [window]
 * @returns {{ system: string, user: string, tokens: number, trimmed: string[] }}
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
  const user = ['wm', 'view', 'loop', 'notice', 'question']
    .map(k => capped[k])
    .filter(Boolean)
    .join('\n\n');
  return { system: capped.system || '', user, tokens: total(), trimmed };
}
