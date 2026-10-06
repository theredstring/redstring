/**
 * Dialogue — the through line, and talking with a person.
 *
 * The phonological loop (life.js) keeps the last three thoughts verbatim and
 * lets the rest go. That is right for thinking, but it leaves no sense of what
 * the last half hour was about. So the loop also keeps:
 *
 *   the through line   one sentence: what it has been doing lately and what it
 *                      is after. Rewritten by the Druid every few moments, not
 *                      every one, and only kept when it says something new and
 *                      names what the universe holds — a sentence of narrative,
 *                      never a growing transcript.
 *   what was said      the last few things a person said to it, each for a
 *                      while. What they say steers: it is shown with every
 *                      choice, the Things it names pull attention, and a
 *                      request becomes its goal. It answers in a sentence.
 *
 * Both are held by the loop, not the model: the model only ever writes one
 * sentence at a time, and the loop decides what is kept.
 */

import { thoughtSimilarity } from './runDruid.js';
import { tokenize } from './recall.js';

/** Moments between rewrites of the through line. */
export const THROUGH_LINE_EVERY = 6;
/** Moments a thing someone said stays in mind. */
export const SAID_FOR = 12;
/** How many things said are kept at once. */
export const SAID_KEEP = 3;

/**
 * Whether the through line is due: every THROUGH_LINE_EVERY moments, or
 * sooner when there is none yet and something has been written.
 */
export function throughLineDue(st, tick) {
  if (!st.throughLine) return st.writes?.length > 0 || tick >= 3;
  return tick - (st.throughLineAt || 0) >= THROUGH_LINE_EVERY;
}

/**
 * A new through line, if it is worth keeping: says something new (not the
 * old one again), and names at least one Thing the universe holds.
 */
export function keepThroughLine(world, previous, candidate) {
  const text = String(candidate || '').trim();
  if (!text) return null;
  // Only a near-copy is refused: at 0.75 a through line once stayed "the wood
  // to build the floor" for 22 moments while the Druid worked on screwdrivers.
  if (previous && thoughtSimilarity(text, previous) > 0.9) return null;
  const words = new Set(tokenize(text));
  const grounded = world.allThings().some(id => tokenize(world.nameOf(id)).some(w => words.has(w)));
  return grounded ? text : null;
}

/** What was said that is still in mind, oldest first. */
export function stillSaid(said, tick) {
  return (said || []).filter(s => tick - s.tick < SAID_FOR).slice(-SAID_KEEP);
}

/**
 * Moments the words themselves are shown, and what it said back. After that
 * the gist is (conversation.js): shown for twelve moments with every choice,
 * its own answer became its thought, four moments running.
 */
export const WORDS_FOR = 3;
export const ANSWER_FOR = 2;

/** Rendered for the prompt: the through line, and what was said. */
export function renderDialogue({ throughLine, said }, tick) {
  const lines = [];
  if (throughLine) lines.push(`Lately: ${throughLine}`);
  for (const s of stillSaid(said, tick)) {
    const ago = tick - s.tick;
    const when = ago > 0 ? ` (${ago} moment${ago === 1 ? '' : 's'} ago)` : '';
    const answered = s.answer && ago < ANSWER_FOR ? s.answer : '';
    // What it told them unasked has no words of theirs.
    if (!s.text) { if (answered) lines.push(`You told them${when}: "${answered}"`); continue; }
    if (ago >= WORDS_FOR) continue;
    lines.push(`A person said to you${when}: "${s.text}"${answered ? ` You answered: "${answered}"` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Things a person's words point at, as attention sources: what they name pulls
 * the Druid toward it while it is still in mind.
 */
export function saidSources(world, said, tick) {
  const out = [];
  for (const s of stillSaid(said, tick)) {
    if (!s.text) continue;
    const words = new Set(tokenize(s.text));
    const weight = 0.9 * (1 - (tick - s.tick) / SAID_FOR);
    for (const id of world.allThings()) {
      if (world.isOwnThinking?.(id)) continue;
      if (tokenize(world.nameOf(id)).some(w => words.has(w))) out.push({ id, weight });
    }
  }
  return out;
}

/** A person's words as a goal, when they ask for something: short, and not a question about it. */
export function asRequest(text) {
  const t = String(text || '').trim().replace(/[.!]+$/, '');
  if (!t || t.length > 120) return null;
  if (/\?$/.test(t)) return null;
  const m = /^(?:please\s+)?(?:(?:can|could|would) you\s+|try to\s+|i want you to\s+|let'?s\s+)?(think about|look into|explore|work on|learn about|figure out|understand|build|map|make|study|focus on|tidy|clean up|organi[sz]e)\b\s*(.*)$/i.exec(t);
  if (!m) return null;
  const goal = `${m[1]} ${m[2]}`.trim();
  return goal.charAt(0).toUpperCase() + goal.slice(1);
}
