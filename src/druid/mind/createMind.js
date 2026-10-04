/**
 * The mind — the only place the Druid calls a model.
 *
 * Three kinds of call, each with a locked answer shape:
 *
 *   choose(options)  pick one numbered option          → index
 *   fill(blank)      finish a sentence, a few words    → text
 *   judge(scale)     place something on a fixed scale  → key
 *
 * The model never writes structure, ids or JSON of its own design. Code lists
 * the options, the model picks; code poses the blank, the model fills it.
 * Answers are requested as a schema-constrained JSON object (string enums —
 * LM Studio does not reliably enforce integer enums) and parsed leniently when
 * a server ignores the schema, so an invalid answer is counted, never acted on.
 *
 * A backend is `complete({ system, user, schema, maxTokens, temperature })` →
 * `{ content, usage: { prompt, completion } }`.
 */

import { assemble } from './budget.js';

const PLACEHOLDER = /^(\.{2,}|_{2,}|…|\[.*\]|<.*>|n\/a|none|null|undefined)$/i;

/**
 * Names that name nothing. Apple's on-device model, asked to name a new Thing,
 * twice answered "new thing" — a placeholder by other means.
 */
const GENERIC = /^(a |an |the )?(new |some |another |unnamed |untitled )?(thing|something|item|object|stuff|node|concept|entity|name|untitled)s?$/i;

function parseJson(content) {
  if (content && typeof content === 'object') return content;
  const s = String(content || '').trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  return null;
}

/** A choice from a reply: the schema field, else the first number in range. */
export function readChoice(content, n) {
  const obj = parseJson(content);
  const raw = obj?.choice ?? obj?.option ?? obj?.answer;
  const fromField = raw != null ? parseInt(String(raw), 10) : NaN;
  if (fromField >= 1 && fromField <= n) return fromField - 1;
  const m = String(content || '').match(/\b(\d{1,2})\b/);
  const k = m ? parseInt(m[1], 10) : NaN;
  return k >= 1 && k <= n ? k - 1 : null;
}

/** Text from a reply, clipped to `maxWords`; null for empty or placeholder answers. */
export function readText(content, maxWords) {
  const obj = parseJson(content);
  let s = obj && typeof obj === 'object' ? (obj.text ?? obj.answer ?? obj.name ?? '') : String(content || '');
  s = String(s).replace(/\s+/g, ' ').replace(/^["'\s]+|["'\s]+$/g, '').trim();
  if (!s || PLACEHOLDER.test(s) || GENERIC.test(s) || /_{3,}/.test(s)) return null;
  const words = s.split(' ');
  return words.length > maxWords ? clipWords(words, maxWords) : s;
}

const plainWords = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Whether an answer only says the question back (all of it, or a sentence of it). */
export function echoes(answer, question) {
  const a = plainWords(answer);
  return a.split(' ').length >= 3 && plainWords(question).includes(a);
}

const TRAILING = /^(the|a|an|of|to|and|or|but|with|by|for|in|on|at|from|that|which|causing|making|so|as)$/i;

/**
 * An over-long answer, cut to `max` words where a phrase ends: at the last
 * clause break inside the limit, else without dangling little words. A plan
 * step written as "Yeast ferments sugars to produce carbon dioxide gas,
 * causing the" keeps "Yeast ferments sugars to produce carbon dioxide gas".
 */
function clipWords(words, max) {
  let kept = words.slice(0, max);
  const lastBreak = kept.findLastIndex((w, i) => i < kept.length - 1 && /[,;:.]$/.test(w));
  if (lastBreak >= 2) kept = kept.slice(0, lastBreak + 1);
  while (kept.length > 1 && TRAILING.test(kept.at(-1).replace(/[,;:.]$/, ''))) kept.pop();
  return kept.join(' ').replace(/[,;:.]$/, '');
}

/** Words in a reply's text field (or the reply itself). */
function wordCount(content) {
  const obj = parseJson(content);
  const s = obj && typeof obj === 'object' ? (obj.text ?? obj.answer ?? '') : String(content || '');
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

/** A scale key from a reply. */
export function readKey(content, keys) {
  const obj = parseJson(content);
  const raw = String(obj?.answer ?? obj?.choice ?? content ?? '').toLowerCase();
  return keys.find(k => raw === k) || keys.find(k => raw.includes(k)) || null;
}

const schemaFor = {
  choose: (n) => ({
    name: 'choice',
    schema: {
      type: 'object',
      properties: { choice: { type: 'string', enum: Array.from({ length: n }, (_, i) => String(i + 1)) } },
      required: ['choice'],
      additionalProperties: false
    }
  }),
  fill: (maxWords) => ({
    name: 'fill',
    schema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: Math.max(12, maxWords * 9) } },
      required: ['text'],
      additionalProperties: false
    }
  }),
  judge: (keys) => ({
    name: 'judgment',
    schema: {
      type: 'object',
      properties: { answer: { type: 'string', enum: keys } },
      required: ['answer'],
      additionalProperties: false
    }
  })
};

/**
 * @param {Object} opts
 * @param {Object} opts.backend
 * @param {number} [opts.window]       the model's window (4096 for Apple's)
 * @param {number} [opts.temperature]
 * @param {Function} [opts.onCall]     receives each call's record
 */
export function createMind({ backend, window = 4096, temperature = 0.6, onCall } = {}) {
  const stats = { calls: 0, invalid: 0, promptTokens: 0, completionTokens: 0, ms: 0, byKind: {} };

  async function call(kind, sections, schema, maxTokens, read) {
    const prompt = assemble(sections, maxTokens, window);
    const started = Date.now();
    let content = null;
    let usage = null;
    let error = null;
    try {
      ({ content, usage } = await backend.complete({ system: prompt.system, user: prompt.user, schema, maxTokens, temperature }));
    } catch (err) {
      error = err?.message || String(err);
    }
    const value = error ? null : read(content);
    const ms = Date.now() - started;
    const k = (stats.byKind[kind] ||= { calls: 0, invalid: 0 });
    stats.calls++; k.calls++;
    stats.ms += ms;
    stats.promptTokens += usage?.prompt || prompt.tokens;
    stats.completionTokens += usage?.completion || 0;
    if (value == null) { stats.invalid++; k.invalid++; }
    const record = { kind, ok: value != null, value, content, error, ms, promptTokens: usage?.prompt ?? prompt.tokens, trimmed: prompt.trimmed, user: prompt.user };
    onCall?.(record);
    return record;
  }

  /** @returns {Promise<{ ok, index, ... }>} */
  async function choose({ system, view, wm, loop, notice, question, options }) {
    const list = options.map((o, i) => `${i + 1}. ${o}`).join('\n');
    const r = await call('choose', { system, view, wm, loop, notice, question: `${question}\n${list}\nAnswer with the number of one option.` },
      schemaFor.choose(options.length), 16, (c) => readChoice(c, options.length));
    return { ...r, index: r.value };
  }

  /** @returns {Promise<{ ok, text, ... }>} */
  async function fill({ system, view, wm, loop, notice, question, maxWords = 6 }) {
    const sections = { system, view, wm, loop, notice, question: `${question}\n(Answer in at most ${maxWords} words.)` };
    const isName = maxWords <= 5;
    // A name asked for and a sentence given: clipped, it becomes a fragment
    // ("Moment when a"). Ask once more, firmly; a second sentence is no name.
    const readName = (c) => (wordCount(c) > maxWords ? null : readText(c, maxWords));
    // The question said back is no answer: Apple's model answered "what are
    // you thinking now?" with "What are you thinking now? Name the Things you
    // mean." in half the cycles of one run.
    const notEcho = (read) => (c) => { const v = read(c); return v && echoes(v, question) ? null : v; };
    const reader = notEcho(isName ? readName : (c) => readText(c, maxWords));
    let r = await call('fill', sections, schemaFor.fill(maxWords), Math.min(300, maxWords * 3 + 24), reader);
    if (isName && !r.ok && !r.error && wordCount(r.content) > maxWords) {
      r = await call('fill', { ...sections, question: `${question}\nAt most ${maxWords} words: a name, not a sentence.` },
        schemaFor.fill(maxWords), Math.min(300, maxWords * 3 + 24), notEcho(readName));
    } else if (!r.ok && !r.error && echoes(readText(r.content, 200) || '', question)) {
      r = await call('fill', { ...sections, question: `${question}\nDo not repeat the question. Answer it, in at most ${maxWords} words.` },
        schemaFor.fill(maxWords), Math.min(300, maxWords * 3 + 24), reader);
    }
    return { ...r, text: r.value };
  }

  /**
   * @param {Array<{ key: string, label: string }>} scale
   * @returns {Promise<{ ok, key, ... }>}
   */
  async function judge({ system, view, wm, loop, notice, question, scale }) {
    const keys = scale.map(s => s.key);
    const list = scale.map(s => `- ${s.key}: ${s.label}`).join('\n');
    const r = await call('judge', { system, view, wm, loop, notice, question: `${question}\n${list}\nAnswer with one of: ${keys.join(', ')}.` },
      schemaFor.judge(keys), 16, (c) => readKey(c, keys));
    return { ...r, key: r.value };
  }

  return { choose, fill, judge, stats };
}
