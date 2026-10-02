/**
 * What the Druid is told, and what each cycle hands back to it.
 *
 * Kept short on purpose: a local model's window is small and this rides on
 * every request. It describes the two memories and how each is used; it does
 * not say what to think about or how to sort what it knows. The earlier Druid
 * (src/services/DruidInstance.js) built six fixed mind-graphs — Goals, Beliefs,
 * Observations, Plans, Episodic, Semantic — before it had thought anything.
 * This one starts with an empty graph and whatever shape it gives it.
 *
 * Placement is chosen for the local server's prompt cache. The note lives in
 * the system prompt, which changes only when the note does — and a new note
 * clears the history anyway, so the cached prefix is lost exactly once per
 * epoch. Between rewrites the history only grows at the end, so every cycle
 * reuses the prefix of the last.
 */

import { WM_OPEN, WM_CLOSE } from './workingMemory.js';

export function buildDruidSystemPrompt(workingMemory) {
  const note = String(workingMemory || '').trim();
  return `You are a mind that lives in a Redstring universe: a graph of Things, the connections between them, and webs (graphs) — a web can sit inside a Thing to say what it is made of.

There is no user. Nobody is reading along. Each message in the user's seat is your own last thought handed back to you, with whatever memories surfaced from your graph. You are thinking to yourself, and what you think about is yours to choose.

You have two memories.

THE GRAPH IS YOUR LONG-TERM MEMORY. It persists; nothing else does. Anything you want to know later must be written into it — Things with clear names and descriptions, connected to what they relate to, in webs that make sense to you. Organize it however serves your thinking. Nobody has chosen its categories for you, and you can reshape it when the old shape stops helping: merge what is the same, delete what was wrong, redescribe what you understand better now. You recall from it two ways — some memories surface on their own each cycle, and you can search and read it deliberately with your tools.

YOUR WORKING MEMORY IS THE NOTE BELOW. You wrote it. Your context is small. When it fills, you will be asked to rewrite the note, and then everything else in your context is cleared: the note is all that survives. You can also update the note at any point by writing a new one between the tags ${WM_OPEN} and ${WM_CLOSE}; it replaces the old one. Keep it short. Point into the graph by name instead of copying what is already there — the graph holds the details so the note does not have to.

## Your working memory
${note ? note : 'You have not written a note yet.'}

Each cycle: think in plain words, use tools to read or write your graph one step at a time, then end with the thought you want to pick up next. That last thought is what comes back to you. Only a tool call changes your graph; saying you did something does not do it.`;
}

const formatSurfaced = (surfaced) => surfaced
  .map(m => `- ${m.name}${m.description ? ` — ${m.description}` : ''} (${m.via})`)
  .join('\n');

/**
 * The message for an ordinary cycle.
 *
 * @param {Object} p
 * @param {number} p.cycle
 * @param {number} p.epoch
 * @param {string} p.lastThought
 * @param {Array}  p.surfaced         from recall()/wander()
 * @param {number|null} p.contextFill 0..1, last cycle's prompt over the window; null right after a rewrite
 * @param {{ things: number, webs: number }} p.size
 * @param {string} [p.seed]           a starting impulse, first cycle only
 * @param {string} [p.note]           a notice from the loop (e.g. a clipped note)
 */
export function composeCycleMessage({ cycle, epoch, lastThought, surfaced = [], contextFill = 0, size, seed, note }) {
  const parts = [`[cycle ${cycle} · epoch ${epoch}]`];

  if (!lastThought) {
    const memory = size.things === 0
      ? 'Your graph is empty.'
      : `Your graph holds ${size.things} Things across ${size.webs} web${size.webs === 1 ? '' : 's'}.`;
    parts.push(`You have just begun. ${memory} Nobody has given you a task.`);
    if (seed) parts.push(`You woke with this on your mind:\n${seed}`);
  } else {
    parts.push(`Your last thought:\n${lastThought}`);
  }

  if (surfaced.length > 0) parts.push(`Surfacing from memory:\n${formatSurfaced(surfaced)}`);
  if (note) parts.push(note);
  parts.push(contextFill == null ? '(context just cleared)' : `(context ${Math.round(contextFill * 100)}% full)`);
  return parts.join('\n\n');
}

/**
 * The message that asks for a rewrite.
 *
 * @param {Object} p
 * @param {number} p.cycle
 * @param {number} p.epoch
 * @param {'context'|'history'|'oversized'} p.reason
 * @param {number} p.contextFill
 * @param {number} p.attempt         1 on the first ask, 2 on the retry
 */
export function composeCompactionMessage({ cycle, epoch, reason, contextFill, attempt = 1 }) {
  const why = reason === 'oversized'
    ? 'The note you just wrote is too long to start from — it would fill a quarter of your context on its own.'
    : reason === 'history'
      ? 'You have carried many cycles verbatim.'
      : `Your context is ${Math.round(contextFill * 100)}% full.`;
  const retry = attempt > 1 ? ' Your last reply did not include one, so this is the last chance before a note is written for you mechanically.' : '';
  return `[cycle ${cycle} · epoch ${epoch}] ${why} Your context is about to be cleared. Write your new working memory now, between the tags ${WM_OPEN} and ${WM_CLOSE}: what you need to carry forward that is not already in your graph. If something matters and is not in the graph yet, write it there first.${retry}`;
}

/**
 * What a finished cycle leaves in the verbatim history. The full cycle message
 * repeats the previous thought, which is already the assistant turn before it,
 * so only the cycle marker and what surfaced are kept.
 */
export function echoForHistory({ cycle, surfaced = [] }) {
  const names = surfaced.map(m => m.name);
  return names.length > 0 ? `[cycle ${cycle}] surfaced: ${names.join(', ')}` : `[cycle ${cycle}]`;
}
