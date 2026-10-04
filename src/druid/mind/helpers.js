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

import { wordsIn, readsAsName, SHORT_NAME_WORDS, aboutTheMedium } from '../names.js';

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

/**
 * Is a part really a part? Asked as "Is Carbon dioxide made of Nitrogen, at
 * least in part?", Apple's model answered 18 of 18 pairs right; asked whether
 * "Nitrogen is a part of Carbon dioxide" is sensible, 12 of 18, refusing true
 * parts (bone of a foot, wheels of a car) and letting false ones through
 * (2026-10-04 probes).
 *
 * @returns {Function} async (part, whole) → true | false | null
 */
export function madeOf(mind) {
  const cache = new Map();
  return async (part, whole) => {
    const key = `${String(part).trim()}\u0000${String(whole).trim()}`;
    if (cache.has(key)) return cache.get(key);
    const a = await ask(mind, 'madeOf', 'Answer yes or no.', `Is ${String(whole).trim()} made of ${String(part).trim()}, at least in part?`, ['yes', 'no']);
    const value = a === 'yes' ? true : a === 'no' ? false : null;
    cache.set(key, value);
    return value;
  };
}

/**
 * Is a term about knowing in general rather than about the subject? Drift
 * inside a web ran this way: a Druid set to understand Space kept
 * Understanding, Confusion, Information, Raw data, Metadata. Yes/no questions
 * ("is it part of Space or closely tied to it?") said yes to all of those;
 * offered "Space / information and knowledge / neither", Apple's model picked
 * information and knowledge for the drift and Space or neither for the rest,
 * 20 of 23 (2026-10-04 probes). Only that pick refuses.
 *
 * @returns {Function} async (term, subject) → true (about knowing) | false | null
 */
export function aboutKnowing(mind) {
  const cache = new Map();
  return async (term, subject) => {
    const key = `${String(term).trim()}\u0000${String(subject).trim()}`;
    if (cache.has(key)) return cache.get(key);
    const a = await ask(mind, 'aboutKnowing', 'Pick the subject the term belongs to.', `Term: ${String(term).trim()}\nChoices:\nA: ${String(subject).trim()}\nB: information and knowledge\nC: neither`, ['A', 'B', 'C']);
    // Confirmed by a second question before it refuses: alone, it put
    // Hydrogen and Oxygen under "information and knowledge" in a web about the
    // ocean. Something physical is never refused (15 of 20 right; its misses
    // let drift through rather than block a part).
    let value = a === 'B' ? true : a ? false : null;
    if (value === true) {
      const physical = await ask(mind, 'physical', 'Answer yes or no.', `Is ${String(term).trim()} something in the physical or living world, such as a substance, an object, a living thing, a place, a force, or something that happens?`, ['yes', 'no']);
      if (physical !== 'no') value = false;
    }
    cache.set(key, value);
    return value;
  };
}

/**
 * Is a one-word name a quality rather than a thing? Asked of every word, Apple's
 * model called Gravity, Light and Feelings qualities (17 of 24 right), so it is
 * asked only of words that look like adjectives (names.js looksLikeQuality),
 * where it erred on two of twelve (2026-10-04 probes). A Druid asked what dark
 * matter is made of named Dark, Gravitational, Mysterious.
 *
 * @returns {Function} async (word) → true (a quality) | false | null
 */
export function isQuality(mind) {
  const cache = new Map();
  return async (word) => {
    const key = String(word || '').trim();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    const a = await ask(mind, 'isQuality', 'Is the word the name of a thing, or a word that describes a quality? Answer thing or quality.', `Word: ${key}`, ['thing', 'quality']);
    const value = a === 'quality' ? true : a === 'thing' ? false : null;
    cache.set(key, value);
    return value;
  };
}

/**
 * What sort of Thing a name is, which decides how it is understood: a thing
 * by its parts, a process by its stages in order, an idea by its kinds. Asked
 * of everything as "what is it made of?", events gave properties (Causes,
 * Magnitude, Location as the parts of Earthquakes) and ideas gave near-synonyms.
 * 31 of 36 on Apple's model (2026-10-05); most misses called a process or an
 * idea a thing, which is asked about as before.
 *
 * @returns {Function} async (name) → 'thing' | 'process' | 'idea' | null
 */
export function category(mind) {
  const cache = new Map();
  return async (name) => {
    const key = String(name || '').trim();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    const value = await ask(mind, 'category', 'Is the word below the name of a THING (an object or a substance you could point at), a PROCESS (something that happens over time, in steps), or an IDEA (something abstract you cannot point at)?', key, ['thing', 'process', 'idea']);
    cache.set(key, value);
    return value;
  };
}

/**
 * Is A a kind of B? The sense check alone only ever erred by refusing
 * (Electrons a kind of Particles, Iron of Elements: 20 of 24); a refusal is
 * asked again two ways, "is A a kind of B?" and "is every A a B?", and
 * accepted when both say yes: 21 of 24 (2026-10-04 probes).
 *
 * @returns {Function} async (a, b) → true | false | null
 */
export function kindOf(mind, sense = plausible(mind)) {
  const cache = new Map();
  return async (a, b) => {
    const key = `${String(a).trim()}\u0000${String(b).trim()}`;
    if (cache.has(key)) return cache.get(key);
    let value = await sense(`${a} is a kind of ${b}`);
    if (value === false) {
      const kind = await ask(mind, 'kindOf', 'Answer yes or no.', `Is ${a} a kind of ${b}?`, ['yes', 'no']);
      const every = kind === 'yes' ? await ask(mind, 'everyIs', 'Answer yes or no.', `Is every ${a} a ${b}?`, ['yes', 'no']) : null;
      if (kind === 'yes' && every === 'yes') value = true;
    }
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

/**
 * What a Druid with nothing on its mind wants to understand: asked with no
 * context at all, so nothing about this place is in view to answer with. In
 * context, a seedless Druid built "Home Web", "Navigation" and "Contents";
 * asked alone (warm, so each Druid differs) for something it could see, touch
 * or watch happen, Apple's model named the ocean, galaxies, Mars, Mount
 * Everest, a sunset, thunder (2026-10-04).
 *
 * @returns {(tries?: number) => Promise<string|null>}
 */
export function curiosity(mind) {
  return async (tries = 3) => {
    for (let i = 0; i < tries; i++) {
      const r = await mind.helper({
        name: 'curiosity',
        // Something to see, touch or watch happen: asked only for "one thing",
        // it also named mystery, the purpose of existence, why God is necessary,
        // and abstract subjects decomposed into synonyms of themselves.
        task: 'You are curious. Name one real thing in the world you want to understand: something you could see, touch, or watch happen. Answer with the thing only, in a few words.',
        input: '',
        schema: { name: 'subject', schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } },
        read: (content) => {
          const t = String(parse(content)?.subject || '').trim().replace(/[.?!]+$/, '');
          if (!t || PLACEHOLDER.test(t) || wordsIn(t).length > 6 || aboutTheMedium(t)) return null;
          return t.charAt(0).toUpperCase() + t.slice(1);
        },
        maxTokens: 24,
        temperature: 1
      }).catch(() => null);
      if (r?.ok && r.value) return r.value;
    }
    return null;
  };
}
