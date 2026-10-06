/**
 * Being in a conversation.
 *
 * Talking with it used to be a side channel: what a person said was kept word
 * for word for twelve moments, pulled a little at the Things whose names
 * shared a word with it, and was answered from wherever it stood. Told "stop
 * thinking about nature and ecosystems, go back to the snowflake", it looked
 * up Nature's cycle and Ecosystem; told "go look at Branch tip", it said it
 * would and went back to Mindfulness; its answer, shown with every choice,
 * became its thought four moments running (Druid Test 10, 2026-10-06).
 *
 * People do it otherwise. A voice addressed to you interrupts what you were
 * doing; you take in what kind of thing was said (a question, a direction, a
 * correction) and what it points at; you look where they point, and answer
 * from what you see; what they want becomes your intention, ahead of your
 * own; "stop X" is done by turning to something else, not by thinking about
 * X; what you said you would do binds what you do next; and what you keep is
 * the gist, not the words. When the talk goes quiet, you go back to your own
 * pursuits, carrying what came up.
 *
 * So while a person is talking with it (ENGAGED_FOR moments after the last
 * thing they said), the conversation is the foreground:
 *
 *   understand  what kind of thing was said, what it turns toward and away
 *               from (in code), and what they want, in a few words (a fill)
 *   orient      its locus moves to what they point at, before it thinks
 *   intend      a direction or correction is its goal, ahead of its own;
 *               what they turned it away from is let go of
 *   heed        the menu's first item is what they asked, or what it told
 *               them it would do (moves: heed)
 *   report      having done something about it, it tells them, unasked
 *   gist        the prompt carries what they want and what it said, once
 *               the words themselves have had their moment
 */

import { namedIn } from './talk.js';
import { isOwnPlace } from './attention.js';
import { isBookkeeping } from './roles.js';
import { asksForWork } from './mind/helpers.js';

/** Moments after the last thing said that it stays in the conversation. */
export const ENGAGED_FOR = 6;
/** Things it tells a person unasked, at most, per thing they said. */
export const REPORTS_PER_TURN = 2;

const clip = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

const DIRECT = /^(?:please\s+|now\s+|ok(?:ay)?,?\s+|so\s+|then\s+)?(?:go|look|stop|think|tell|explain|find|show|make|focus|work|try|open|connect|describe|name|keep|forget|drop|leave|come|get|start|read|build|map|study|explore|figure|learn|take|turn|move|add|write|check|see|consider|zoom|return|do|switch|begin)\b|^(?:can|could|would|will) you\b|^(?:i want you to|i'd like you to|let'?s|how about (?:we|you)|why not)\b/i;
/** Saying again what they meant: "I'm saying submarine sandwich", "I meant the brain". */
const MEANT = /\b(?:i'?m saying|i said|i mean|i meant|i'?m talking about|i was talking about)\s+(?:the\s+|a\s+|an\s+)?([^.,;:!?]+)/i;
const CORRECT = /\b(?:you'?re|you are)\s+(?:drifting|wandering|off|lost|rambling|stuck)|\bthat'?s (?:not|wrong)|\bno[,.]|\bnot (?:that|what i)|\bwrong\b|\bstop\b|\bdon'?t\b|\benough\b|\bget back\b|\bgo back\b/i;
/**
 * Asking it to do some work, however politely, is a request, question mark or
 * not: "can you start working on a submarine sandwich?" was taken as a
 * question, answered from the quantum computing it was in, and changed
 * nothing (The Druid 11, 2026-10-06). Asking it to say something ("can you
 * tell me", "could you explain") stays a question.
 */
const ASK_TO_DO = /^(?:please\s+|so\s+|ok(?:ay)?,?\s+)?(?:can|could|would|will) you\s+(?:please\s+)?(?:go|look|start|work|think|find|make|focus|build|map|study|explore|figure|learn|research|open|try|dig|read|keep|stop|move|turn|switch|begin|get|leave|drop)\b/i;
/** The subject a request names: "start working on a submarine sandwich" → Submarine sandwich. */
const SUBJECT = /\b(?:start(?:ing)?\s+(?:working\s+on|on|thinking\s+about|looking\s+into|to\s+(?:understand|learn\s+about|explore)|with)|work(?:ing)?\s+on|think(?:ing)?\s+about|look(?:ing)?\s+(?:into|at)|explor(?:e|ing)|learn(?:ing)?\s+about|understand(?:ing)?|build(?:ing)?\s+(?:an?\s+)?(?:understanding|picture|map|web)\s+of|(?:make|making|create|creating|start|starting|draw|drawing)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:web|map|picture|graph)\s+(?:of|for|about|on)|figure\s+out|study(?:ing)?|focus(?:ing)?\s+on|research(?:ing)?|go\s+(?:back\s+)?to|switch\s+to|turn\s+to|move\s+on\s+to|tell\s+me\s+about)\s+(?:the\s+|a\s+|an\s+|some\s+)?([^.,;:!?]+)/i;
/** Asking it to say something, not to do something: a question, however it is put. */
const SAY_TO = /^(?:please\s+)?(?:(?:can|could|would|will) you\s+(?:please\s+)?)?(?:tell|explain|show|remind)\b/i;
/** A question without its question mark: "what do you believe". */
const ASKING = /^(?:so\s+|and\s+|ok(?:ay)?,?\s+)?(?:what|how|why|who|where|when|which|do you|did you|are you|have you|is it|is there)\b/i;
const VAGUE = /^(that|this|it|them|something|anything|stuff|things?|more|everything|what\b.*)$/i;
/**
 * How people open what they say, before the part that matters: "hey make a
 * web of a ham sandwich" is "make a web of a ham sandwich". Every pattern
 * here reads from the start of a clause, so a greeting in front hid the
 * request, and it went on with quantum computing (2026-10-05).
 */
const LEAD = /^(?:(?:hey|hi|hello|yo|ok(?:ay)?|alright|all right|well|um+|uh+|so|now|then|and|druid)\b[,!.]?\s+)+/i;
const unlead = (c) => c.replace(LEAD, '');

/** The subject a request or question names, in a few words, if it names one plainly. */
export function subjectOf(text) {
  const m = MEANT.exec(String(text || '')) || SUBJECT.exec(String(text || ''));
  if (!m) return null;
  // Where it is kept is not part of it: "the sub sandwich web" is a sub sandwich.
  const s = m[1].split(/\s+(?:and|so|because|then|but|instead|now|please|for me|like|again|how|what|why|where|when|which|who)\b/i)[0].trim()
    .replace(/\s+(?:web|webs|universe|topic|thing|stuff)$/i, '').trim();
  const words = s.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5 || VAGUE.test(s)) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const AWAY = /\b(?:stop (?:thinking|talking|working|looking)?\s*(?:about|on|at)?|don'?t (?:think|talk|work|look)\s+(?:about|on|at)|no more|enough (?:about|of)|forget about|leave|drop|away from|instead of|(?<!why )not)\s+([^.;:!?]+)/gi;

/**
 * What kind of thing was said, and what it turns toward and away from, in
 * plain code: the clauses that say "stop X" or "not X" are what to leave; the
 * rest is what to turn to. A request or correction comes first in the
 * clauses that hold one ("Go look at Branch tip" over "What does Time have to
 * do with a snowflake?").
 *
 * @returns {{ kind: 'question'|'direction'|'correction'|'telling', toward: string, away: string, subject: string|null, meant: boolean }}
 */
export function parseSaid(text) {
  const t = unlead(String(text || '').trim());
  const clauses = t.split(/(?<=[.!?;])\s+|:\s+/).map(c => unlead(c.trim())).filter(Boolean);
  const away = [];
  for (const m of t.matchAll(AWAY)) away.push(m[1].trim());
  const awayText = away.join(', ');
  // What is turned toward: the clauses with an imperative first, without what they turn away from.
  const strip = (c) => c.replace(AWAY, ' ').replace(/\s+/g, ' ').trim();
  const directed = clauses.filter(c => DIRECT.test(c) || /\?$/.test(c));
  const ordered = [...clauses.filter(c => DIRECT.test(c)), ...clauses.filter(c => !DIRECT.test(c))];
  const toward = ordered.map(strip).filter(c => /[a-z]/i.test(c) && !/^(stop|don'?t|no|not)\b/i.test(c)).join(' ');
  const kind = CORRECT.test(t) || MEANT.test(t) ? 'correction'
    : clauses.some(c => !SAY_TO.test(c) && ((DIRECT.test(c) && !/\?$/.test(c)) || ASK_TO_DO.test(c))) ? 'direction'
      : /\?\s*$/.test(t) || directed.some(c => /\?$/.test(c)) || clauses.some(c => SAY_TO.test(c) || ASKING.test(c)) ? 'question'
        : 'telling';
  return { kind, toward, away: awayText, subject: subjectOf(toward || t), meant: MEANT.test(t) };
}

/**
 * Understand what was said: its kind, the Things it turns toward and away
 * from, and (for a direction or a correction) what they want, in a few words,
 * which becomes its goal.
 *
 * @param {Object} world
 * @param {Object} mind
 * @param {string} text
 * @returns {Promise<{ kind, toward: string[], away: string[], ask: string|null, awayText: string, subject: string|null, newSubject: string|null }>}
 */
export async function understand(world, mind, text) {
  const said = parseSaid(text);
  // What code took for a remark may be a request put some way it does not read: the model says.
  if (said.kind === 'telling' && mind?.helper && String(text).trim().split(/\s+/).length >= 3 && await asksForWork(mind)(text).catch(() => null)) said.kind = 'direction';
  const away = said.away ? namedIn(world, said.away) : [];
  // The subject it names, when there is one, before the rest of its words.
  const bySubject = said.subject ? namedIn(world, said.subject, 1) : [];
  let ask = null;
  if ((said.kind === 'direction' || said.kind === 'correction') && mind?.helper) {
    // Not a fill: what they want often says their words back, and a fill that does is thrown out.
    const r = await mind.helper({
      name: 'wants',
      task: 'A person said this to a small mind that lives in a universe of Things. What do they want it to do or find out? Answer in a few plain words, starting with a verb, like "look at how bread rises".',
      input: `They said: "${clip(text, 300)}"`,
      schema: { name: 'wants', schema: { type: 'object', properties: { wants: { type: 'string' } }, required: ['wants'], additionalProperties: false } },
      read: (c) => { try { return (typeof c === 'string' ? JSON.parse(c) : c)?.wants ?? null; } catch { return null; } },
      maxTokens: 32
    }).catch(() => null);
    const a = String(r?.value || '').trim().replace(/^["']|["'.]+$/g, '');
    if (a && a.split(/\s+/).length <= 12) ask = a.charAt(0).toUpperCase() + a.slice(1);
  }
  // No subject in their words, but one in what they want ("look into tide pools"): that one.
  if (!said.subject && ask) {
    said.subject = subjectOf(ask);
    if (said.subject) bySubject.push(...namedIn(world, said.subject, 1));
  }
  const toward = [...new Set([...bySubject, ...(said.toward ? namedIn(world, said.toward) : [])])].filter(id => !away.includes(id));
  // A subject the universe does not hold yet: for a request, a web is started for it (druid.js onHeard).
  // "I'm saying submarine sandwich" of a Thing named Sub sandwich: that Thing, by the name they meant.
  const renamed = said.meant && said.subject && bySubject.length && world.nameOf(bySubject[0]).toLowerCase() !== said.subject.toLowerCase() ? bySubject[0] : null;
  return { kind: said.kind, toward, away, ask, awayText: said.away, subject: said.subject, newSubject: said.subject && !bySubject.length ? said.subject : null, renamed };
}

/** Whether it is in a conversation now. */
export function engaged(conv, tick) {
  return !!conv && tick - conv.last < ENGAGED_FOR;
}

/** Where to stand to look at a Thing: a web of real content it is in. */
export function placeOf(world, id) {
  if (!world.proto(id) || isBookkeeping(world, id)) return null;
  const web = world.websOf(id).find(w => !isOwnPlace(world, w));
  return web ? { web, focus: id, path: [] } : null;
}

/**
 * The Things in its own reply that it said it would turn to: "I will look at
 * Branch tip" binds it to Branch tip.
 */
export function promisedIn(world, reply) {
  const m = /\b(?:i(?:'ll| will| am going to|'m going to)|let me|next,? i)\b([^.!?]*)/i.exec(String(reply || ''));
  return m ? namedIn(world, m[1], 1) : [];
}

/**
 * The conversation, for the prompt: what they want, what it said, and what it
 * is talking about. The words themselves are shown only while fresh
 * (dialogue.js); after that, this.
 */
export function renderConversation(world, conv, tick) {
  if (!engaged(conv, tick)) return '';
  const lines = ['You are in a conversation with a person. What they ask comes before your own goals.'];
  if (conv.ask) lines.push(`They asked you to ${conv.ask.charAt(0).toLowerCase()}${conv.ask.slice(1)}.`);
  const topic = (conv.topic || []).map(id => world.nameOf(id)).filter(Boolean);
  if (topic.length) lines.push(`You are talking about ${topic.join(', ')}.`);
  const away = (conv.away || []).map(id => world.nameOf(id)).filter(Boolean);
  if (away.length) lines.push(`They asked you to leave ${away.join(', ')} alone.`);
  const promised = (conv.promised || []).map(id => world.nameOf(id)).filter(Boolean);
  if (promised.length) lines.push(`You told them you would look at ${promised.join(', ')}.`);
  return lines.join('\n');
}

/**
 * Heed: go to what they are talking about, or to what it told them it would
 * look at. First on the menu while it is in the conversation and not there.
 */
export const heed = {
  id: 'heed',
  prior: 1.6,
  offer(ctx) {
    const conv = ctx.conversation;
    if (!engaged(conv, ctx.tick)) return [];
    const { world, locus } = ctx;
    const seen = new Set();
    const items = [];
    for (const [ids, label, prior] of [[conv.promised || [], (n) => `do what you told them: look at ${n}`, 2.2], [conv.topic || [], (n) => `go to ${n}, which they are asking about`, 1.6]]) {
      for (const id of ids) {
        if (seen.has(id) || id === locus.focus || !placeOf(world, id)) continue;
        seen.add(id);
        items.push({ label: label(world.nameOf(id)), data: { id }, target: id, prior });
      }
    }
    return items.slice(0, 2);
  },
  async run(ctx, data) {
    const at = placeOf(ctx.world, data.id);
    if (!at) return { ok: false, summary: `could not find ${ctx.world.nameOf(data.id)}`, touched: [], wrote: false };
    ctx.world.focusWeb(at.web);
    return { ok: true, summary: `went to ${ctx.world.nameOf(data.id)}, as they asked`, touched: [data.id], locus: at, wrote: false };
  }
};
