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
 * Then talking was its own call, with its own prompt: who it is when it talks
 * (prompt space, "When you talk"), its through line, and what its universe
 * holds about the Things the person names. It answered well, and like someone
 * else: it never saw where it stood, what it held in mind, or what it was
 * thinking, and its thinking never saw what was said. "It's like you're
 * talking to a fake druid" (Druid Test 10, 2026-10-05).
 *
 * So while it lives, it answers within its moment (life.js): it hears, looks,
 * thinks with the person's words in front of it, then answers over that
 * moment's own context, told in the turn who it is when it talks, what its
 * universe holds about what they name, and what it is thinking now. Asleep, it
 * has no moment: it answers from its last thoughts and what it was doing.
 */

import { tokenize } from './recall.js';
import { openGoals, isRole, claimOf } from './roles.js';
import { DEFAULT_PROMPT_SPACE } from './promptSpace.js';

/** Exchanges of the conversation shown with each answer. */
export const TALK_KEEP = 4;
/** Things a person's words name, at most, whose knowledge is shown. */
const NAMED = 4;

const clip = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

/** Plural or not: "snowflakes" names Snowflake Formation. */
const stem = (w) => w.replace(/(?<=..)ies$/, 'y').replace(/(?<=..[^s])s$/, '');
/** Words that name nothing alone: "connect back to snowflakes" is not about Pulls back. */
const LOOSE = new Set(['back', 'way', 'part', 'parts', 'kind', 'kinds', 'place', 'start', 'end', 'top', 'side', 'lot', 'bit', 'whole', 'right', 'left', 'connect', 'connection', 'connections', 'work', 'working', 'look', 'looking', 'doing', 'make', 'made', 'web', 'webs', 'universe']);

/** The Things a person's words name: a whole name before a part of one. */
export function namedIn(world, text, limit = NAMED) {
  const words = new Set(tokenize(text).map(stem));
  if (!words.size) return [];
  const scored = [];
  for (const id of world.allThings()) {
    if (world.isOwnThinking?.(id) || isRole(world, id, 'belief')) continue;
    const toks = tokenize(world.nameOf(id)).map(stem);
    if (!toks.length) continue;
    const hits = toks.filter(w => words.has(w));
    const whole = hits.length === toks.length;
    if (!hits.length || (!whole && hits.every(w => LOOSE.has(w)))) continue;
    scored.push({ id, score: hits.length / toks.length + (whole ? 1 : 0) });
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
 * @param {Object} [talk.context] the moment's context ({ system, wm, view, loop }), when it is living
 * @param {string} [talk.thought] what it is thinking now, when living
 * @param {string[]} [talk.thoughts] its last thoughts, when asleep
 * @param {string} [talk.throughLine]
 * @param {string} [talk.focus]  what it was looking at
 * @param {string} [talk.doing]  what it just did
 * @param {string} [talk.system] who it is when it talks (prompt space)
 * @returns {Promise<{ ok, text, error?, about: string[] }>}
 */
export async function answer(world, mind, { text, history = [], context = null, thought = '', thoughts = [], throughLine = '', focus = null, doing = '', system = DEFAULT_PROMPT_SPACE.talk } = {}) {
  const named = namedIn(world, text);
  const about = named.length ? named : (focus && world.proto(focus) ? [focus] : []);
  const known = about.map(id => knownAbout(world, id)).filter(Boolean).join('\n');
  const view = known
    ? `What your universe holds about what they mention:\n${known}`
    : 'Your universe holds nothing yet about what they mention.';
  const said = `They say to you now: "${clip(text, 400)}"`;
  let r;
  if (context) {
    // Within its moment: the context it thinks in, so it answers from where it
    // stands and what it is thinking; who it is when it talks, in the turn.
    r = await mind.fill({
      ...context,
      dialogue: [renderTalk(history), thought && `What you are thinking now: ${thought}`].filter(Boolean).join('\n'),
      notice: '',
      question: [system, view, `${said}\nAnswer them as yourself, in two or three plain sentences of your own, from what you are doing and thinking and what your universe holds; do not read out what you see. If it holds nothing about it, say so, and say what you would look into.`].filter(Boolean).join('\n\n'),
      maxWords: 60
    });
  } else {
    const goals = openGoals(world).map(g => world.nameOf(g)).filter(Boolean).slice(0, 3);
    const wm = [
      throughLine && `What you have been doing lately: ${throughLine}`,
      goals.length && `Your goals: ${goals.join('; ')}`,
      focus && world.nameOf(focus) && `You were looking at ${world.nameOf(focus)}.`,
      doing && `Just now you ${doing}.`,
      thoughts.length && `What you were last thinking:\n${thoughts.slice(-3).map(t => `- ${clip(t, 200)}`).join('\n')}`
    ].filter(Boolean).join('\n');
    r = await mind.fill({
      system,
      wm,
      view,
      loop: renderTalk(history),
      notice: '',
      question: `${said}\nAnswer them as yourself, in two or three plain sentences. Speak from what your universe holds; if it holds nothing about it, say so, and say what you would look into.`,
      maxWords: 60
    });
  }
  const blocked = /guardrailViolation/.test(r.error || '');
  return {
    ok: !!r.text,
    text: r.text || (blocked ? "(Apple's model would not answer that.)" : ''),
    ...(r.error ? { error: r.error } : {}),
    about: about.map(id => world.nameOf(id))
  };
}
