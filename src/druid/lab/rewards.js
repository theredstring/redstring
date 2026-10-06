/**
 * Rewards for training a small model on what the Druid asks (scripts/druid-reward.mjs).
 *
 * A recorded call (scripts/druid-bench.mjs --record) and a candidate answer
 * to it go in; a reward in [-1, 1] comes out, with the reasons. The checks are
 * the Druid's own guardrails, so a change to a guardrail changes the reward.
 *
 * How the reward is shaped, against a model learning to game it:
 *
 *   gates, not sums  the answer must parse, keep its word limit, and not say
 *                    the question back, or it scores -1, whatever else is in it
 *   validity         each name must pass the checks the Druid would put it
 *                    through (no positions, qualities, aspects, sentences,
 *                    things about this place); a list scores by its valid,
 *                    new names, so one safe name or "none" earns little
 *   no copying       a name already standing where it is asked, or in the
 *                    question, earns nothing: it adds nothing
 *   meaning, apart   whether an answer is true (are these the parts of a
 *                    crust?) code cannot tell; that is the judge's, given as
 *                    `judge` (a question for a strong model) and multiplied
 *                    in by the trainer, never added
 *   held-out runs    the benchmark (lab/bench.js) on subjects never trained
 *                    on decides whether a trained model is used, not this
 *
 * Calls whose best answer only a judge can know (which option to choose, a
 * yes or no) get a format reward here and `judge` for the rest.
 */

import { namesIn } from '../moves/basic.js';
import { relationFromSentence } from '../relations.js';
import { isAspect, isPlainlyQuality, hasVerb, wordsIn, aboutTheMedium, normalizeName, isDoing } from '../names.js';
import { thoughtSimilarity } from '../runDruid.js';
import { DAYDREAM } from './bench.js';

const clamp = (x) => Math.max(-1, Math.min(1, x));
const parse = (content) => { try { return typeof content === 'string' ? JSON.parse(content) : content; } catch { return null; } };

/** What kind of call this is, from what asked it and how. */
export function classify(rec) {
  const phase = rec.meta?.phase || (String(rec.kind).startsWith('helper:') ? 'helper' : rec.kind);
  const q = String(rec.meta?.question || rec.user || '');
  if (phase === 'helper') return { type: 'helper', helper: rec.meta?.helper || String(rec.kind).slice(7) };
  if (rec.kind === 'choose') return { type: 'choose' };
  if (rec.kind === 'judge') return { type: 'scale' };
  if (phase === 'thought') return { type: 'thought' };
  if (phase === 'throughLine') return { type: 'throughLine' };
  if (phase === 'answer' || phase === 'report') return { type: 'speech', phase };
  if (/separated by commas|Separate them with commas/i.test(q)) return { type: 'list' };
  if (/^How do (.+?) and (.+?) relate\?/m.test(q)) {
    const [, a, b] = /^How do (.+?) and (.+?) relate\?/m.exec(q);
    return { type: 'relationSentence', a, b };
  }
  if (/^Give the words that make "(.+?) ___ (.+?)"/m.test(q)) {
    const [, a, b] = /^Give the words that make "(.+?) ___ (.+?)"/m.exec(q);
    return { type: 'relationWords', a, b };
  }
  if (/^Describe |as you understand it|^What makes .+ a particular kind/m.test(q)) return { type: 'sentence' };
  if ((rec.meta?.maxWords ?? 6) <= 5) return { type: 'name' };
  return { type: 'sentence' };
}

/** Names the prompt already holds: where it stands, and the question. */
function present(rec) {
  const names = new Set((rec.where?.things || []).map(normalizeName));
  for (const m of String(rec.meta?.question || '').matchAll(/\b([A-Z][\w'-]*(?:\s+[a-zA-Z][\w'-]*){0,3})\b/g)) names.add(normalizeName(m[1]));
  if (rec.where?.web) names.add(normalizeName(rec.where.web));
  return names;
}

/** Why a name would not be let in, or null. The Druid's own checks, as text. */
export function badName(name) {
  const n = String(name || '').trim();
  if (!n) return 'empty';
  if (wordsIn(n).length > 5) return 'too long';
  if (isAspect(n)) return 'a position or aspect, not a thing';
  if (isPlainlyQuality(n)) return 'a quality, not a thing';
  if (isDoing(n)) return 'a doing, not a thing';
  if (wordsIn(n).length >= 3 && hasVerb(n)) return 'a sentence, not a name';
  if (aboutTheMedium(n)) return 'about this place, not the world';
  if (/^(none|nothing|n\/a|unknown|various|etc\.?)$/i.test(n)) return 'no name';
  return null;
}

/**
 * The reward for one candidate answer to a recorded call.
 *
 * @param {Object} rec        a line of --record
 * @param {string} content    the candidate's raw answer (JSON, as the schema asks)
 * @returns {{ reward: number, type: string, reasons: string[], judge?: Object }}
 */
export function rewardFor(rec, content) {
  const kind = classify(rec);
  const reasons = [];
  const out = (reward, extra = {}) => ({ reward: clamp(reward), type: kind.type, reasons, ...extra });
  const o = parse(content);
  if (!o || typeof o !== 'object') { reasons.push('not JSON'); return out(-1); }

  // ── a choice, a key, a yes or no: the format here, the rest for the judge ──
  if (kind.type === 'choose') {
    const n = (rec.meta?.options || []).length;
    const c = Number(o.choice);
    if (!Number.isInteger(c) || c < 1 || (n && c > n)) { reasons.push('no such option'); return out(-1); }
    return out(0, { judge: { kind: 'choose', options: rec.meta?.options || [], picked: c } });
  }
  if (kind.type === 'scale' || kind.type === 'helper') {
    const keys = rec.schema?.schema?.properties?.answer?.enum || rec.meta?.keys || null;
    const a = o.answer ?? o.wants ?? o.value;
    if (keys && !keys.includes(a)) { reasons.push('not one of the answers'); return out(-1); }
    if (a == null || a === '') { reasons.push('no answer'); return out(-1); }
    return out(0, { judge: { kind: kind.type, answer: a } });
  }

  const text = String(o.text ?? '').trim();
  const max = rec.meta?.maxWords ?? 30;
  if (!text) { reasons.push('empty'); return out(-1); }
  if (wordsIn(text).length > max) { reasons.push(`over ${max} words`); return out(-1); }
  const q = String(rec.meta?.question || '');
  if (q && thoughtSimilarity(text, q) > 0.7) { reasons.push('says the question back'); return out(-1); }

  if (kind.type === 'list') {
    const names = [...new Set(namesIn(text).map(n => n.trim()))];
    const here = present(rec);
    let good = 0;
    for (const n of names) {
      const bad = badName(n) || (here.has(normalizeName(n)) ? 'already here' : null);
      if (bad) reasons.push(`${n}: ${bad}`); else good++;
    }
    if (!names.length) { reasons.push('no names'); return out(-0.5); }
    // Valid and new, up to five; a share of bad names takes away.
    const coverage = Math.min(good, 5) / 4;
    const share = good / names.length;
    return out(good === 0 ? -0.5 : Math.min(1, coverage) * share, { judge: { kind: 'list', names: names.filter(n => !badName(n)) } });
  }

  if (kind.type === 'name') {
    const n = namesIn(text)[0] || text;
    const bad = badName(n) || (present(rec).has(normalizeName(n)) ? 'already here' : null);
    if (bad) { reasons.push(`${n}: ${bad}`); return out(-0.5); }
    return out(0.5, { judge: { kind: 'name', name: n } });
  }

  if (kind.type === 'relationSentence') {
    const rel = relationFromSentence(text, kind.a, kind.b) || relationFromSentence(text, kind.b, kind.a);
    if (rel) return out(0.6, { judge: { kind: 'relation', sentence: text } });
    const names = [kind.a, kind.b].filter(x => normalizeName(text).includes(normalizeName(x))).length;
    reasons.push(names === 2 ? 'names both, but not how they relate' : 'does not name both');
    return out(names === 2 ? 0 : -0.5);
  }

  if (kind.type === 'relationWords') {
    if (/^none$/i.test(text)) return out(0.2, { judge: { kind: 'relation', sentence: 'none' } });
    const bare = text.replace(new RegExp(`\\b(${[kind.a, kind.b].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})s?\\b`, 'gi'), ' ').replace(/\s+/g, ' ').trim();
    if (!bare) { reasons.push('only the names'); return out(-0.5); }
    if (wordsIn(bare).length > 4) { reasons.push('too long for a relation'); return out(-0.5); }
    if (/^(relates? to|is related to|connects? (to|with)|is connected to|and|with|has to do with)$/i.test(bare)) { reasons.push('says nothing about how'); return out(-0.3); }
    return out(0.6, { judge: { kind: 'relation', sentence: `${kind.a} ${bare} ${kind.b}` } });
  }

  if (kind.type === 'thought' || kind.type === 'throughLine') {
    const here = [...present(rec)].filter(n => n.length > 2);
    const named = here.filter(n => normalizeName(text).includes(n)).length;
    let r = named ? 0.6 : -0.4;
    if (!named) reasons.push('names nothing here');
    if (DAYDREAM.test(text)) { r -= 0.6; reasons.push('daydream vocabulary'); }
    if (/\?\s*$/.test(text) && kind.type === 'throughLine') { r -= 0.5; reasons.push('a question, not what it has been doing'); }
    return out(r, { judge: { kind: kind.type, text } });
  }

  if (kind.type === 'speech') {
    let r = 0.5;
    if (DAYDREAM.test(text)) { r -= 0.5; reasons.push('daydream vocabulary'); }
    // Honest about what it did: told it did nothing about what they asked, it does not say it did.
    if (rec.meta?.onIt === false && /\b(i(?:'ve| have)? (?:just )?(?:started|made|built|found|opened|added|created))\b/i.test(text)) { r -= 0.8; reasons.push('claims work it did not do'); }
    // Not what it said before (the prompt holds the conversation so far).
    const before = [...String(rec.user || '').matchAll(/^You: (.+)$/gm)].map(m => m[1]);
    if (before.some(b => thoughtSimilarity(text, b) >= 0.8)) { r -= 0.6; reasons.push('says again what it said'); }
    return out(r, { judge: { kind: 'speech', text } });
  }

  // A sentence: one, plain, about what it is asked about.
  let r = 0.5;
  if (DAYDREAM.test(text)) { r -= 0.6; reasons.push('daydream vocabulary'); }
  if ((text.match(/[.!?](\s|$)/g) || []).length > 2) { r -= 0.3; reasons.push('more than one sentence'); }
  return out(r, { judge: { kind: 'sentence', text } });
}

// ── with a teacher's labels ────────────────────────────────────────────────

/** Calls whose answer can be checked against a label, so RL can train them. Free text is taught by example only. */
export const CHECKABLE = new Set(['list', 'name', 'relationWords', 'relationSentence', 'choose', 'helper', 'scale']);

/** Same name, near enough: case, articles, plural, and a head noun with words before it ("Haze layer" ~ "Upper haze layer"). */
export function sameName(a, b, { exact = false } = {}) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // A stage named as a verb or as a doing: "Mix" is "Mixing", "Rise" is "Rising".
  const stem = (s) => s.split(' ').map(w => w.replace(/ing$/, '').replace(/e$/, '')).join(' ');
  if (stem(x) === stem(y)) return true;
  if (exact) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.split(' ').length >= 1 && long.endsWith(` ${short}`) && short.split(' ').length >= long.split(' ').length - 1;
}

const verdict = (name, label) => {
  const any = (xs, opts) => [].concat(xs ?? []).some(x => sameName(name, x, opts));
  // Wrong only as named: "Loaf" is no kind of bread, but "White loaf" is.
  if (any(label.wrong, { exact: true })) return 'wrong';
  if (any(label.best) || any(label.acceptable)) return 'right';
  return 'unknown';
};

/**
 * The reward for a candidate, given a teacher's label for the call
 * (lab/teacher.js): what the code checks gates it; the label says whether it
 * is true. A name the label does not know earns a little (it may be right),
 * never as much as one it knows to be right, so inventing names never beats
 * naming the right ones.
 *
 * @param {Object} rec
 * @param {string} content
 * @param {Object} label   { best, acceptable, wrong } | { answer } | { best: [option numbers], acceptable, bad }
 * @returns {{ reward, type, reasons, rl: boolean }}
 */
export function rewardWithLabel(rec, content, label) {
  const base = rewardFor(rec, content);
  const rl = CHECKABLE.has(base.type);
  if (!label || !rl || (base.reward <= 0 && base.type !== 'choose' && base.type !== 'helper' && base.type !== 'scale') || base.reward === -1) return { ...base, rl };
  const done = (reward) => ({ ...base, reward: clamp(reward), rl });

  if (base.type === 'choose') {
    const c = base.judge.picked;
    if ((label.best || []).includes(c)) return done(1);
    if ((label.acceptable || []).includes(c)) return done(0.4);
    if ((label.bad || []).includes(c)) { base.reasons.push('a choice the teacher marked bad'); return done(-0.6); }
    return done(0);
  }
  if (base.type === 'helper' || base.type === 'scale') {
    if (label.answer == null) return { ...base, rl };
    const right = String(base.judge.answer).toLowerCase() === String(label.answer).toLowerCase();
    if (!right) base.reasons.push(`teacher says ${label.answer}`);
    return done(right ? 1 : -1);
  }
  if (base.type === 'list') {
    const names = base.judge.names;
    let right = 0;
    let unknown = 0;
    let wrong = 0;
    for (const n of names) {
      const v = verdict(n, label);
      if (v === 'right') right++; else if (v === 'unknown') unknown++; else { wrong++; base.reasons.push(`${n}: the teacher marks it wrong`); }
    }
    const credited = right + 0.25 * unknown;
    const precision = names.length ? credited / names.length : 0;
    const coverage = Math.min(credited, 4) / 4;
    return done(wrong && !right ? -0.5 : coverage * precision);
  }
  if (base.type === 'name') {
    const v = verdict(base.judge.name, label);
    if (v === 'wrong') base.reasons.push('the teacher marks it wrong');
    return done(v === 'right' ? 1 : v === 'unknown' ? 0.25 : -0.5);
  }
  // A relation: the words that say how, against the teacher's.
  const words = String(base.judge.sentence || '').toLowerCase();
  const verbs = [...(label.best ? [].concat(label.best) : []), ...(label.acceptable || [])].map(x => String(x).toLowerCase().trim()).filter(Boolean);
  const hit = verbs.some(v => words.includes(v) || v.split(/\s+/).every(w => words.includes(w.replace(/s$/, ''))));
  const miss = (label.wrong || []).some(v => words.includes(String(v).toLowerCase()));
  if (miss) base.reasons.push('a relation the teacher marks wrong');
  return done(miss ? -0.5 : hit ? 1 : 0.3);
}
