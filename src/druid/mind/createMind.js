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
import { clipWords, readsAsName } from '../names.js';

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
  // A label before the answer ("Relation: Attach") is not part of it.
  s = s.replace(/^(relation|answer|name|description|thought|the relation is)\s*:\s*/i, '');
  if (!s || PLACEHOLDER.test(s) || GENERIC.test(s) || /_{3,}/.test(s)) return null;
  const words = s.split(' ');
  return words.length > maxWords && !readsAsName(s) ? clipWords(words, maxWords) : s;
}

const plainWords = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Whether an answer only says the question back (all of it, or a sentence of it). */
export function echoes(answer, question) {
  const a = plainWords(answer);
  // Five words at least: a short answer found in the question is usually one
  // of the options it offered ("made of", from "relations you already use"),
  // and rejecting those starved a Druid of connections.
  return a.split(' ').length >= 5 && plainWords(question).includes(a);
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

/** A form's capitals copied into a command ("make NAME"), not filled in. */
const TEMPLATE = /\b(NAME|THING|RELATION|CLAIM|PART|BELIEF|WHAT IT IS|WHAT YOU WANT|FIRST STEP|NEXT STEP|A THOUGHT)\b/;

const HELPER_SYSTEM = 'You do one small language task at a time. Answer exactly what is asked, in plain English.';

/**
 * @param {Object} opts
 * @param {Object} opts.backend
 * @param {number} [opts.window]       the model's window (4096 for Apple's)
 * @param {number} [opts.temperature]
 * @param {Function} [opts.onCall]     receives each call's record
 */
export function createMind({ backend, window = 4096, temperature = 0.6, onCall } = {}) {
  const stats = { calls: 0, invalid: 0, promptTokens: 0, completionTokens: 0, ms: 0, byKind: {} };

  async function call(kind, sections, schema, maxTokens, read, temp = temperature) {
    const prompt = assemble(sections, maxTokens, window);
    const started = Date.now();
    let content = null;
    let usage = null;
    let error = null;
    try {
      ({ content, usage } = await backend.complete({ system: prompt.system, user: prompt.user, context: prompt.context, turn: prompt.turn, schema, maxTokens, temperature: temp }));
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

  /**
   * One command, in plain words: a verb from the list (enforced) and the
   * words after it. A command that copies the form's capitals ("make NAME")
   * is no command; it is asked once more, saying so.
   * @returns {Promise<{ ok, verb, rest, ... }>}
   */
  async function command({ system, view, wm, loop, dialogue, notice, question, verbs }) {
    const schema = {
      name: 'command',
      schema: {
        type: 'object',
        properties: { verb: { type: 'string', enum: verbs }, rest: { type: 'string' } },
        required: ['verb', 'rest'],
        additionalProperties: false
      }
    };
    const read = (c) => {
      const o = parseJson(c);
      if (!o || !verbs.includes(o.verb)) return null;
      const rest = String(o.rest ?? '').replace(/\s+/g, ' ').trim();
      if (TEMPLATE.test(rest) || /_{3,}/.test(rest)) return null;
      return { verb: o.verb, rest };
    };
    const sections = { system, view, wm, loop, dialogue, notice, question };
    let r = await call('command', sections, schema, 80, read);
    if (!r.ok && !r.error && TEMPLATE.test(String(parseJson(r.content)?.rest || ''))) {
      r = await call('command', { ...sections, question: `${question}\nWrite real names where the form has capitals: not "NAME", but the name itself.` }, schema, 80, read);
    }
    return { ...r, verb: r.value?.verb ?? null, rest: r.value?.rest ?? '' };
  }

  /** @returns {Promise<{ ok, index, ... }>} */
  async function choose({ system, view, wm, loop, dialogue, notice, question, options }) {
    const list = options.map((o, i) => `${i + 1}. ${o}`).join('\n');
    const r = await call('choose', { system, view, wm, loop, dialogue, notice, question: `${question}\n${list}\nAnswer with the number of one option.` },
      schemaFor.choose(options.length), 16, (c) => readChoice(c, options.length));
    return { ...r, index: r.value };
  }

  /** @returns {Promise<{ ok, text, ... }>} */
  async function fill({ system, view, wm, loop, dialogue, notice, question, maxWords = 6 }) {
    const sections = { system, view, wm, loop, dialogue, notice, question: `${question}\n(Answer in at most ${maxWords} words.)` };
    const isName = maxWords <= 5;
    // A name asked for and a sentence given: clipped, it becomes a fragment
    // ("Moment when a"). Ask once more, firmly; a second sentence is no name.
    // ...unless it is a long name: "The Hitchhiker's Guide to the Galaxy".
    const readName = (c) => (wordCount(c) > maxWords && !readsAsName(readText(c, 64) || '') ? null : readText(c, maxWords));
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
  async function judge({ system, view, wm, loop, dialogue, notice, question, scale }) {
    const keys = scale.map(s => s.key);
    const list = scale.map(s => `- ${s.key}: ${s.label}`).join('\n');
    const r = await call('judge', { system, view, wm, loop, dialogue, notice, question: `${question}\n${list}\nAnswer with one of: ${keys.join(', ')}.` },
      schemaFor.judge(keys), 16, (c) => readKey(c, keys));
    return { ...r, key: r.value };
  }

  /**
   * A helper call: one small language task with no context at all — none of
   * the Druid's view, memory or loop, only the task and its input. A tiny
   * model reasons badly over a full window and well over a single question,
   * so judgments about language (is this a title or a sentence?) are asked
   * this way, where content enters the universe. See mind/helpers.js.
   *
   * @param {Object} h
   * @param {string} h.name         the helper's name, for stats
   * @param {string} h.task         what to do, in a sentence or two
   * @param {string} h.input
   * @param {Object} h.schema       { name, schema } — the answer's shape
   * @param {Function} h.read       (content) → value | null
   * @param {number} [h.maxTokens]
   * @param {number} [h.temperature]  low by default: a judgment should not vary
   */
  async function helper({ name, task, input, schema, read, maxTokens = 48, temperature: temp = 0.1 }) {
    const r = await call(`helper:${name}`, { system: HELPER_SYSTEM, question: input ? `${task}\n\n${input}` : task }, schema, maxTokens, read, temp);
    return r;
  }

  return { choose, fill, judge, command, helper, stats };
}
