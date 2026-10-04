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

import { wordsIn, SHORT_NAME_WORDS } from '../names.js';

const PLACEHOLDER = /^(name|thing|none|n\/a|null|untitled|unknown|\.\.\.|_+)$/i;

const parse = (content) => {
  try { return typeof content === 'string' ? JSON.parse(content) : content; } catch { return null; }
};

/**
 * Is a long name a name (a title, a proper name) or a sentence passing as
 * one? A sentence comes back with a short handle for it.
 *
 * @param {Object} mind   a mind with `helper`
 * @returns {Function} async (text) → { kind: 'name' } | { kind: 'sentence', short } | null
 */
export function nameGate(mind) {
  const cache = new Map();
  return async (text) => {
    const key = String(text || '').trim();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    const r = await mind.helper({
      name: 'nameGate',
      task: [
        'Below is what someone wants to call a Thing in their notes.',
        'Is it a NAME (a title or proper name, like "The Hitchhiker\'s Guide to the Galaxy" or "Second Law of Thermodynamics") or a SENTENCE (a statement or instruction, like "Yeast makes the dough rise")?',
        `If it is a sentence, also give a short name for what it is about, at most ${SHORT_NAME_WORDS - 1} words.`
      ].join(' '),
      input: key,
      schema: {
        name: 'nameGate',
        schema: {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['name', 'sentence'] }, short: { type: 'string' } },
          required: ['kind', 'short'],
          additionalProperties: false
        }
      },
      read: (content) => {
        const o = parse(content);
        if (!o || (o.kind !== 'name' && o.kind !== 'sentence')) return null;
        if (o.kind === 'name') return { kind: 'name' };
        const short = String(o.short || '').trim().replace(/^["']|["'.]$/g, '');
        const n = wordsIn(short).length;
        if (!short || PLACEHOLDER.test(short) || n === 0 || n > SHORT_NAME_WORDS) return null;
        return { kind: 'sentence', short: short.replace(/^\w/, c => c.toUpperCase()) };
      }
    });
    const value = r.ok ? r.value : null;
    cache.set(key, value);
    return value;
  };
}

const yesNo = { type: 'string', enum: ['yes', 'no'] };

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
    const r = await mind.helper({
      name: 'plausible',
      task: 'Is the statement below true, or at least sensible, in ordinary plain English? Answer no if it is nonsense or plainly false.',
      input: key,
      schema: { name: 'plausible', schema: { type: 'object', properties: { answer: yesNo }, required: ['answer'], additionalProperties: false } },
      read: (content) => { const o = parse(content); return o?.answer === 'yes' ? true : o?.answer === 'no' ? false : null; },
      maxTokens: 16
    });
    const value = r.ok ? r.value : null;
    cache.set(key, value);
    return value;
  };
}

/**
 * A connection about to be written: does "Floor sits on Footwear" make sense,
 * and does its relation mean the same as one already in use ("composed of" →
 * "made of")? One call for both. Relations are compared by meaning here; by
 * spelling, the world already does it (names.js).
 *
 * @returns {Function} async ({ a, relation, b, known }) → { sensible, same } | null
 */
export function relationGate(mind) {
  return async ({ a, relation, b, known = [] }) => {
    const options = [...new Set(known.map(k => String(k).toLowerCase()))].filter(k => k !== String(relation).toLowerCase()).slice(0, 12);
    const r = await mind.helper({
      name: 'relationGate',
      task: [
        'Below is a connection someone wants to record: a Thing, a relation, another Thing.',
        'First: does it make sense as a plain statement?',
        options.length ? `Second: does its relation mean the same as one of these: ${options.join(', ')}? Answer "none" if not.` : 'Second: answer "none".'
      ].join(' '),
      input: `${a} — ${relation} — ${b}`,
      schema: {
        name: 'relationGate',
        schema: {
          type: 'object',
          properties: { sensible: yesNo, same: { type: 'string', enum: [...options, 'none'] } },
          required: ['sensible', 'same'],
          additionalProperties: false
        }
      },
      read: (content) => {
        const o = parse(content);
        if (!o || (o.sensible !== 'yes' && o.sensible !== 'no')) return null;
        const same = options.includes(o.same) ? o.same : null;
        return { sensible: o.sensible === 'yes', same };
      },
      maxTokens: 32
    });
    return r.ok ? r.value : null;
  };
}
