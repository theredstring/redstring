/**
 * Talking with the Druid.
 *
 * Its answers used to be one more question at the end of a moment, asked over
 * that moment's prompt: the web it stood in, and its last three thoughts. A
 * small model answers in the voice of what is in front of it. Standing in
 * "No signal" after thoughts about silence, asked "can you talk to me", it
 * said: "I can't talk. There's no sound, no signal. Only stillness. You're not
 * here. I'm in Absence." (The Druid 9, 2026-10-05.)
 *
 * So talking is its own call, with its own prompt: who it is when it talks
 * (prompt space, "When you talk"), what it has been doing and is after, what
 * its universe holds about the Things the person names (their parts, kinds,
 * connections, and its beliefs about them), and the conversation so far. Its
 * memory is the universe; the answer is read from there, not from the view.
 * The same call answers while it lives and while it sleeps.
 */

import { tokenize } from './recall.js';
import { openGoals, isRole, claimOf } from './roles.js';
import { DEFAULT_PROMPT_SPACE } from './promptSpace.js';

/** Exchanges of the conversation shown with each answer. */
export const TALK_KEEP = 4;
/** Things a person's words name, at most, whose knowledge is shown. */
const NAMED = 4;

const clip = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

/** The Things a person's words name: a whole name before a part of one. */
export function namedIn(world, text, limit = NAMED) {
  const words = new Set(tokenize(text));
  if (!words.size) return [];
  const scored = [];
  for (const id of world.allThings()) {
    if (world.isOwnThinking?.(id) || isRole(world, id, 'belief')) continue;
    const toks = tokenize(world.nameOf(id));
    if (!toks.length) continue;
    const hit = toks.filter(w => words.has(w)).length;
    if (hit) scored.push({ id, score: hit / toks.length + (hit === toks.length ? 1 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.id);
}

/** What the universe holds about a Thing, in a few lines. */
export function knownAbout(world, id) {
  const name = world.nameOf(id);
  if (!name) return '';
  const webs = world.websOf(id).filter(w => !world.isSystemWeb?.(w)).map(w => world.graph(w)?.name).filter(Boolean);
  const description = world.proto(id)?.description;
  const lines = [`${name}${webs.length ? ` (in ${webs.slice(0, 2).join(', ')})` : ''}${description ? `: ${clip(description, 160)}` : ''}`];
  const inside = world.insideOf(id);
  const parts = inside ? world.thingsIn(inside).filter(x => x !== id).map(world.nameOf).filter(Boolean) : [];
  if (parts.length) lines.push(`  made up of: ${parts.slice(0, 8).join(', ')}${parts.length > 8 ? ', …' : ''}`);
  const kindOf = world.typeChain(id).map(world.nameOf).filter(n => n && n !== 'Thing');
  if (kindOf.length) lines.push(`  a kind of: ${kindOf.slice(0, 3).join(', then ')}`);
  const kinds = world.membersOf(id).map(world.nameOf).filter(Boolean);
  if (kinds.length) lines.push(`  kinds of it: ${kinds.slice(0, 6).join(', ')}`);
  const links = [];
  for (const w of world.websOf(id)) {
    for (const l of world.linksIn(w)) {
      if (l.a !== id && l.b !== id) continue;
      const line = `${world.nameOf(l.a)} ${String(l.relation).toLowerCase()} ${world.nameOf(l.b)}`;
      if (!links.includes(line)) links.push(line);
    }
  }
  if (links.length) lines.push(`  connections: ${links.slice(0, 5).join('; ')}`);
  const beliefs = world.allThings().filter(b => isRole(world, b, 'belief') && world.druidOf(b).about === id).map(b => claimOf(world, b));
  if (beliefs.length) lines.push(`  you believe: ${beliefs.slice(0, 3).join('; ')}`);
  return lines.join('\n');
}

/** The conversation as the prompt shows it: the last few exchanges. */
export function renderTalk(history = []) {
  const recent = history.slice(-TALK_KEEP * 2);
  if (!recent.length) return '';
  return `Your conversation so far:\n${recent.map(h => `${h.who === 'druid' ? 'You' : 'They'}: ${clip(h.text, 200)}`).join('\n')}`;
}

/**
 * Answer what a person said.
 *
 * @param {Object} world
 * @param {Object} mind          createMind
 * @param {Object} talk
 * @param {string} talk.text     what they said
 * @param {Array}  [talk.history] [{ who: 'person'|'druid', text }], oldest first, not including this
 * @param {string} [talk.throughLine]
 * @param {string} [talk.focus]  what it was looking at
 * @param {string} [talk.doing]  what it just did, when living
 * @param {string} [talk.system] its identity when it talks (prompt space)
 * @returns {Promise<{ ok, text, error?, about: string[] }>}
 */
export async function answer(world, mind, { text, history = [], throughLine = '', focus = null, doing = '', system = DEFAULT_PROMPT_SPACE.talk } = {}) {
  const named = namedIn(world, text);
  const about = named.length ? named : (focus && world.proto(focus) ? [focus] : []);
  const known = about.map(id => knownAbout(world, id)).filter(Boolean).join('\n');
  const goals = openGoals(world).map(g => world.nameOf(g)).filter(Boolean).slice(0, 3);
  const wm = [
    throughLine && `What you have been doing lately: ${throughLine}`,
    goals.length && `Your goals: ${goals.join('; ')}`,
    focus && world.nameOf(focus) && `You were looking at ${world.nameOf(focus)}.`,
    doing && `Just now you ${doing}.`
  ].filter(Boolean).join('\n');
  const view = known
    ? `What your universe holds about what they mention:\n${known}`
    : 'Your universe holds nothing yet about what they mention.';
  const r = await mind.fill({
    system,
    wm,
    view,
    loop: renderTalk(history),
    notice: '',
    question: `They say to you now: "${clip(text, 400)}"\nAnswer them as yourself, in two or three plain sentences. Speak from what your universe holds; if it holds nothing about it, say so, and say what you would look into.`,
    maxWords: 60
  });
  const blocked = /guardrailViolation/.test(r.error || '');
  return {
    ok: !!r.text,
    text: r.text || (blocked ? "(Apple's model would not answer that.)" : ''),
    ...(r.error ? { error: r.error } : {}),
    about: about.map(id => world.nameOf(id))
  };
}
