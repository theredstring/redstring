/**
 * The teacher: a strong model that labels what the Druid was asked, so a
 * small model can be trained on it (scripts/druid-label.mjs).
 *
 * For each recorded call (scripts/druid-bench.mjs --record) it sees exactly
 * what the small model saw, and gives:
 *
 *   a target   the answer to train on, in the call's own format; kept only
 *              when the Druid's own checks pass it (lab/rewards.js), so the
 *              teacher is held to the same guardrails as the student
 *   a label    what any other answer is scored against, so RL needs no
 *              teacher in the loop: the right names and the wrong ones a small
 *              model gives (positions, qualities, materials, off-subject);
 *              the best and the bad menu options; the right yes or no
 *
 * What it is asked to judge is structure and truth, never obedience: a
 * choice is good for what it builds, and taking up what a person asked is
 * good, as finishing a step nearly done can be (the Druid's temperament is not
 * trained in; see documentation/druid/TRAINING.md).
 */

import { classify, rewardFor } from './rewards.js';

const SYSTEM = [
  'You label training data for a small language model. The small model is the mind of "the Druid", which builds a knowledge graph of Things, the connections between them, and webs (a web is the inside of a Thing: what it is made of).',
  'You see exactly what the small model was shown, and the task it was given. Answer as a careful expert would, keeping to the task\'s format and limits exactly. Be concrete and literal: no metaphors, no poetry.',
  'Respond with one JSON object and nothing else.'
].join('\n\n');

const shown = (rec) => `=== WHAT THE SMALL MODEL WAS SHOWN ===\n[system]\n${rec.system || ''}\n\n[prompt]\n${rec.user || ''}\n=== END ===`;

const TASKS = {
  list: (rec) => `The prompt asks for a list (at most ${rec.meta?.maxWords ?? 16} words in all). Give:
{"best": [3 to 6 short names: the correct answer, at the scale the question asks for, true of the thing in the context the question gives],
 "acceptable": [up to 12 other names that would also be correct, with common synonyms and singular or plural forms],
 "wrong": [up to 8 plausible wrong answers a small model gives here: positions (Middle, Upper, Layers), qualities (Smooth), materials when parts were asked, parts of something else, things off the subject]}`,
  name: (rec) => `The prompt asks for one name (at most ${rec.meta?.maxWords ?? 4} words). Give:
{"best": "the name", "acceptable": [up to 10 other correct names], "wrong": [up to 6 plausible wrong answers a small model gives here]}`,
  relationSentence: (rec, k) => `The prompt asks how ${k.a} and ${k.b} relate. Give:
{"sentence": "one short plain sentence that names both and says what one does to or has of the other", "best": "the relation words alone (1 to 3 words, e.g. covers, is part of)", "acceptable": [up to 8 other relation words that are also true], "wrong": [up to 5 that are false or say nothing, like relates to]}`,
  relationWords: (rec, k) => `The prompt asks for the words between ${k.a} and ${k.b}. Give:
{"best": "the relation words (1 to 3 words), or none if neither does anything to the other", "acceptable": [up to 8 other true relation words], "wrong": [up to 5 that are false or say nothing]}`,
  choose: () => `The prompt ends with a numbered menu. Judge the options by what they would build: progress on what the mind is working on, a correct and coherent web, no drift to unrelated subjects, no idle wandering. Taking up what a person asked is good; finishing a step that is nearly done first can be good too. Give:
{"best": [the 1 or 2 best option numbers], "acceptable": [other reasonable option numbers], "bad": [option numbers that would drift, repeat, or build something wrong], "why": "one sentence"}`,
  helper: (rec) => {
    const keys = rec.schema?.schema?.properties?.answer?.enum;
    if (keys) return `The prompt is a small classification task. Give the correct answer: {"answer": one of ${JSON.stringify(keys)}}`;
    const field = Object.keys(rec.schema?.schema?.properties || { text: 1 })[0];
    return `The prompt is a small language task. Give the correct answer in its format: {"${field}": "..."}`;
  },
  scale: (rec) => `The prompt asks for a judgment on a scale. Give the correct one: {"answer": one of ${JSON.stringify(rec.meta?.keys || rec.schema?.schema?.properties?.answer?.enum || [])}}`,
  thought: (rec) => `The prompt asks what the mind is thinking now. Give the thought it should have: {"best": "one plain sentence, at most ${rec.meta?.maxWords ?? 30} words, about what is in front of it and what it is working on, naming those Things by name"}`,
  throughLine: (rec) => `The prompt asks what the mind has been doing lately and what it is after. Give: {"best": "one plain sentence, at most ${rec.meta?.maxWords ?? 30} words, in the first person, naming the Things it has worked on"}`,
  sentence: (rec) => `Give the answer the prompt asks for: {"best": "one plain, true sentence, at most ${rec.meta?.maxWords ?? 20} words, about the thing in the context the question gives"}`,
  speech: (rec) => `The prompt asks the mind to speak to a person. Give what it should say: {"best": "at most ${rec.meta?.maxWords ?? 60} words, plain and warm; claim only what the prompt shows it did or what its universe holds; answer what the person said; do not repeat what it said before"}`
};

/** The teacher's prompt for a recorded call. */
export function teaching(rec) {
  const k = classify(rec);
  const task = TASKS[k.type] || TASKS.sentence;
  return { type: k.type, system: SYSTEM, user: `${shown(rec)}\n\n=== YOUR TASK ===\n${task(rec, k)}` };
}

/** The first JSON object in a reply. */
export function readJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

/**
 * The answer to train on, in the call's own format, from the teacher's label;
 * and whether the Druid's own checks pass it.
 */
export function targetFrom(rec, type, label) {
  if (!label) return null;
  let o = null;
  if (type === 'choose') o = label.best?.length ? { choice: String(label.best[0]) } : null;
  else if (type === 'helper' || type === 'scale') {
    const field = Object.keys(rec.schema?.schema?.properties || { answer: 1 })[0];
    const v = label[field] ?? label.answer;
    o = v == null ? null : { [field]: v };
  } else if (type === 'list') o = Array.isArray(label.best) && label.best.length ? { text: label.best.join(', ') } : null;
  else if (type === 'relationSentence') o = label.sentence ? { text: label.sentence } : null;
  else o = label.best ? { text: String(label.best) } : null;
  if (!o) return null;
  const content = JSON.stringify(o);
  const check = rewardFor(rec, content);
  // Checkable formats must parse and keep their limits; text must not be refused outright.
  const ok = check.reward > (type === 'choose' || type === 'helper' || type === 'scale' ? -1 : 0);
  return { content, ok, reasons: check.reasons };
}

/**
 * A teacher model behind a small interface: complete({ system, user }) → text.
 * Anthropic's Messages API (ANTHROPIC_API_KEY), or any OpenAI-compatible
 * endpoint (a local model, another provider).
 */
export function teacherBackend({ provider = 'anthropic', model, apiKey, endpoint, fetchImpl = globalThis.fetch, maxTokens = 600 } = {}) {
  if (provider === 'anthropic') {
    const key = apiKey || globalThis.process?.env?.ANTHROPIC_API_KEY;
    if (!key) throw new Error('No teacher: set ANTHROPIC_API_KEY, or pass --provider openai with an endpoint.');
    return {
      id: `anthropic:${model}`,
      async complete({ system, user }) {
        const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] })
        });
        if (!res.ok) throw new Error(`teacher ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const j = await res.json();
        return { text: (j.content || []).map(c => c.text || '').join(''), usage: { input: j.usage?.input_tokens || 0, output: j.usage?.output_tokens || 0 } };
      }
    };
  }
  return {
    id: `openai:${model}`,
    async complete({ system, user }) {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
      });
      if (!res.ok) throw new Error(`teacher ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = await res.json();
      return { text: j.choices?.[0]?.message?.content || '', usage: { input: j.usage?.prompt_tokens || 0, output: j.usage?.completion_tokens || 0 } };
    }
  };
}

/** Label one recorded call: the teacher's label, and the target to train on. */
export async function label(teacher, rec) {
  const t = teaching(rec);
  const r = await teacher.complete({ system: t.system, user: t.user });
  const parsed = readJson(r.text);
  return { type: t.type, label: parsed, target: targetFrom(rec, t.type, parsed), usage: r.usage, raw: parsed ? undefined : String(r.text).slice(0, 300) };
}
