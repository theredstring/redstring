/**
 * Helpers — small, contextless language judgments, made where content enters
 * the universe.
 *
 * The Druid's own calls carry its whole situation (view, held in mind, recent
 * thoughts) and decide what to do. A helper carries nothing but one task and
 * its input, at low temperature, with a fixed answer shape. A 3B model that
 * drifts over 4K tokens of context does a single narrow judgment well, and a
 * helper can be tested on its own like a function.
 *
 * The division:
 *   code      structure — counts, the graph, provenance, the math
 *   helpers   language judgments at the edges — is this a name? a short handle for it
 *   the mind  what to do next, in context
 *
 * Each helper falls back to code (names.js) when the model gives nothing usable,
 * so a helper can only improve on the deterministic answer, never block a write.
 */

import { wordsIn, readsAsName, SHORT_NAME_WORDS } from '../names.js';

const PLACEHOLDER = /^(name|thing|none|n\/a|null|untitled|unknown|\.\.\.|_+)$/i;

const parse = (content) => {
  try { return typeof content === 'string' ? JSON.parse(content) : content; } catch { return null; }
};

const ask = async (mind, name, task, input, keys) => {
  const r = await mind.helper({
    name, task, input,
    schema: { name, schema: { type: 'object', properties: { answer: { type: 'string', enum: keys } }, required: ['answer'], additionalProperties: false } },
    read: (content) => { const a = parse(content)?.answer; return keys.includes(a) ? a : null; },
    maxTokens: 16
  });
  return r.ok ? r.value : null;
};

/**
 * Is a long name a title or a statement passing as a name? Code decides what
 * it can (Title Case with no verb is a title: names.js); only the rest is
 * asked, and a statement gets a short name asked for separately. One question
 * per call: asked both at once, Apple's model got 2 of 6; asked apart, it got
 * every statement right (2026-10-04 probes).
 *
 * @returns {Function} async (text) → { kind: 'name' } | { kind: 'sentence', short } | null
 */
export function nameGate(mind) {
  const cache = new Map();
  return async (text) => {
    const key = String(text || '').trim();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    let value = null;
    if (readsAsName(key)) value = { kind: 'name' };
    else {
      const kind = await ask(mind, 'nameKind', 'Is the text below a STATEMENT (it says something about something, or tells someone to do something) or a TITLE (the name of a book, place, law, organization or other named thing)?', key, ['statement', 'title']);
      if (kind === 'title') value = { kind: 'name' };
      else if (kind === 'statement') {
        const r = await mind.helper({
          name: 'shortName',
          task: `Give a short name, at most ${SHORT_NAME_WORDS - 1} words, for the thing this is about. Just the name.`,
          input: key,
          schema: { name: 'shortName', schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } },
          read: (content) => {
            const short = String(parse(content)?.name || '').trim().replace(/^["']|["'.]$/g, '');
            const n = wordsIn(short).length;
            return !short || PLACEHOLDER.test(short) || n === 0 || n > SHORT_NAME_WORDS ? null : short.replace(/^\w/, c => c.toUpperCase());
          },
          maxTokens: 24
        });
        if (r.ok) value = { kind: 'sentence', short: r.value };
      }
    }
    cache.set(key, value);
    return value;
  };
}

/**
 * Does a plain statement make sense? "Footwear is a part of Floor", "Modern is
 * a kind of House". Asked before structure is written, so a Thing lands where
 * it belongs and a kind is really a kind.
 *
 * @returns {Function} async (statement) → true | false | null (no usable answer: allow)
 */
export function plausible(mind) {
  const cache = new Map();
  return async (statement) => {
    const key = String(statement || '').trim();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    const a = await ask(mind, 'plausible', 'Is the statement below sensible, the way a person would say it? Answer no if it is nonsense, garbled, or false.', key, ['yes', 'no']);
    const value = a === 'yes' ? true : a === 'no' ? false : null;
    cache.set(key, value);
    return value;
  };
}

/** Relations too general to stand in for another: everything "is" something. */
const GENERIC = new Set(['is', 'are', 'has', 'have', 'relates to', 'connected', 'connected to']);

/**
 * Does a relation mean the same as one already in use ("composed of" → "made
 * of")? Pick from the list, then confirm the pick with a yes/no. Picking alone
 * over-reached (it mapped "grows on" to "is"); confirming with "could replace
 * it in any sentence" refused everything; "roughly the same thing" got 10 of
 * 12 (2026-10-04 probes).
 *
 * @returns {Function} async (relation, known) → an existing relation | null
 */
export function sameRelation(mind) {
  const cache = new Map();
  return async (relation, known = []) => {
    const rel = String(relation || '').trim().toLowerCase();
    const options = [...new Set(known.map(k => String(k).toLowerCase()))].filter(k => k && k !== rel && !GENERIC.has(k)).slice(0, 12);
    if (!rel || !options.length) return null;
    const key = `${rel}|${options.join(',')}`;
    if (cache.has(key)) return cache.get(key);
    let value = null;
    const pick = await ask(mind, 'synonym', `Which relation in the list means the same thing as "${rel}"? If none of them clearly means the same, answer none.`, options.join(', '), [...options, 'none']);
    if (pick && pick !== 'none') {
      const ok = await ask(mind, 'sameMeaning', `Do "${rel}" and "${pick}" mean roughly the same thing?`, `"${rel}" and "${pick}"`, ['yes', 'no']);
      if (ok === 'yes') value = pick;
    }
    cache.set(key, value);
    return value;
  };
}
