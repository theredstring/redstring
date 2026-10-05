/**
 * runLife — the Druid's loop, v2.
 *
 * v1 (runDruid.js) gave a model a free-form agent turn with tools. This gives
 * it a menu. Each cycle:
 *
 *   1. FADE      working memory fades a step (heldInMind.js)
 *   2. ATTEND    activation from what is in mind; the locus settles; the
 *                bounded view is built (activation.js, attention.js)
 *   3. CHOOSE    the moves offer what they can from here; the model picks one
 *                (moves/, mind/)
 *   4. ACT       the move runs as deterministic steps, asking the model for a
 *                blank only where a name or relation is needed
 *   5. REMEMBER  what was touched is used (activation), held (rehearsal) and
 *                associated (Hebbian); a write becomes an episode
 *   6. THINK     one sentence of thought — the phonological loop, which is all
 *                that is kept verbatim (the last three)
 *   7. CHECK     a thought that claims a write that did not happen is reported
 *                back; every write has already been checked against the store
 *   8. SLEEP     every few cycles, consolidation runs (sleep.js), if provided
 *
 * Everything but the three kinds of model call is deterministic, and the
 * model is given only what fits a 4K window.
 */

import { computeActivation } from './activation.js';
import { recordUse, associate } from './activation.js';
import { settleLocus, buildView, renderView, emptyLocus } from './attention.js';
import { hold, held, fade, letGo, scratch as scratchThought, promote, renderHeld, wake } from './heldInMind.js';
import { buildMenu, matchOther, REFUSED_FOR } from './moves/menu.js';
import { BASIC_MOVES } from './moves/basic.js';
import { writeEpisode } from './episodes.js';
import { ungroundedNames, buildMemoryIndex } from './recall.js';
import { DEFAULT_PROMPT_SPACE } from './promptSpace.js';
import { thoughtSimilarity } from './runDruid.js';
import { VERBS, renderCommands, asCommand, runCommand, commandByVerb } from './commands/commands.js';
import { throughLineDue, keepThroughLine, stillSaid, renderDialogue, saidSources } from './dialogue.js';
import { answer, TALK_KEEP } from './talk.js';
import { extendTrail, renderTrail } from './recency.js';

const CLAIM = /\b(created|added|made|built|established|connected|linked|wrote|recorded|defined)\b/i;
const LOOP_SIZE = 3;
const RECENT_SIZE = 6;
const LEFT_SIZE = 4;

/**
 * @param {Object} deps
 * @param {Object} deps.world
 * @param {Object} deps.mind
 * @param {Object} [deps.promptSpace]
 * @param {Object} [opts]
 * @param {Object} [opts.resume]        persisted state from a previous run
 * @param {Array}  [opts.moves]         defaults to BASIC_MOVES
 * @param {Function} [opts.sources]     (world, tick) → extra activation sources (e.g. open goals)
 * @param {Function} [opts.isOpenGoal]  (id) → whether a held Thing survives waking
 * @param {Function} [opts.sleep]       async (ctx) → sleep record, run every `sleepEvery` cycles
 * @param {number}   [opts.sleepEvery]
 * @param {Function} [opts.episodeType] (world) → Episode role type id, if any
 * @param {Object|Function} [opts.extendCtx]  extra fields every move sees in ctx, or (world, tick) → them, per cycle
 * @param {Function} [opts.extras]      (world, locus) → extra lines for the held-in-mind section
 * @param {number}   [opts.maxCycles]
 * @param {string}   [opts.seed]
 * @param {AbortSignal} [opts.signal]
 * @param {'menu'|'commands'} [opts.speak]  choose from a menu of moves, or write a plain command (commands/commands.js)
 * @param {Function} [opts.hear]      () → [{ text }]: what a person has said since the last moment (dialogue.js)
 * @param {Function} [opts.onHeard]   async (world, text, tick) → a line for the notice, if what was said changed something (e.g. became a goal)
 * @param {Function} [opts.onReply]   (text, tick) → void: its answer, as soon as it has one (before it acts)
 */
export async function* runLife({ world, mind, promptSpace = DEFAULT_PROMPT_SPACE }, {
  resume = {},
  moves = BASIC_MOVES,
  sources = () => [],
  isOpenGoal = () => false,
  sleep = null,
  sleepEvery = 12,
  episodeType = () => null,
  extendCtx = {},
  extras = () => '',
  maxCycles = Infinity,
  seed = '',
  signal = null,
  speak = 'menu',
  hear = () => [],
  onHeard = null,
  onReply = null
} = {}) {
  const st = {
    tick: resume.tick || 0,
    locus: resume.locus || emptyLocus(),
    loop: Array.isArray(resume.loop) ? [...resume.loop] : [],
    recent: Array.isArray(resume.recent) ? [...resume.recent] : [],
    left: Array.isArray(resume.left) ? [...resume.left] : [],
    missing: Array.isArray(resume.missing) ? [...resume.missing] : [],
    shown: resume.shown && typeof resume.shown === 'object' ? { ...resume.shown } : {},
    writes: Array.isArray(resume.writes) ? [...resume.writes] : [],
    refused: resume.refused && typeof resume.refused === 'object' ? { ...resume.refused } : {},
    idle: resume.idle || 0,
    throughLine: resume.throughLine || '',
    throughLineAt: resume.throughLineAt || 0,
    said: Array.isArray(resume.said) ? [...resume.said] : [],
    // The conversation with a person, both sides (talk.js), kept across sleeps.
    talk: Array.isArray(resume.talk) ? [...resume.talk] : [],
    lastDid: resume.lastDid || '',
    trail: Array.isArray(resume.trail) ? [...resume.trail] : [],
    notice: ''
  };
  if (st.tick > 0) wake(world, isOpenGoal);
  world.actor = 'druid';

  const startedAt = st.tick;
  while (st.tick - startedAt < maxCycles) {
    if (signal?.aborted) { yield { type: 'stopped', reason: 'aborted', state: snapshot(st) }; return; }
    st.tick++;
    const tick = st.tick;
    if (tick > 1) fade(world);

    // ── HEAR ──────────────────────────────────────────────────────────────
    // What a person said since the last moment: kept for a while, shown with
    // every choice, and steering attention (dialogue.js).
    // Each { text, answered }: answered while it slept (talk.js), it is heard but not answered again.
    const heardItems = (hear() || []).map(h => ({ text: String(h?.text ?? h).trim(), answered: !!h?.answered })).filter(h => h.text);
    const heard = heardItems.map(h => h.text);
    for (const text of heard) {
      st.said = [...st.said, { text, tick }].slice(-6);
      const changed = onHeard ? await onHeard(world, text, tick).catch(() => null) : null;
      if (changed) st.notice = [st.notice, changed].filter(Boolean).join('\n');
    }

    // ── ANSWER ────────────────────────────────────────────────────────────
    // At once, as itself, from what the universe holds (talk.js): asked over
    // the moment's own prompt, it answered in the voice of the web it stood in.
    let reply = null;
    const unanswered = heardItems.filter(h => !h.answered).map(h => h.text);
    if (unanswered.length) {
      const said = unanswered[unanswered.length - 1];
      const r = await answer(world, mind, {
        text: said,
        history: [...st.talk, ...unanswered.slice(0, -1).map(t => ({ who: 'person', text: t }))],
        throughLine: st.throughLine,
        focus: st.locus.focus,
        doing: st.lastDid,
        system: promptSpace.talk
      });
      reply = r.text || null;
      st.talk = [...st.talk, ...unanswered.map(t => ({ who: 'person', text: t, tick })), ...(reply ? [{ who: 'druid', text: reply, tick }] : [])].slice(-TALK_KEEP * 2);
      if (reply) {
        st.said = st.said.map(x => (x.tick === tick && x.text === said ? { ...x, answer: reply } : x));
        if (onReply) onReply(reply, tick);
      }
    }

    // ── ATTEND ────────────────────────────────────────────────────────────
    const heldNow = held(world);
    const baseSources = [
      ...(st.locus.focus ? [{ id: st.locus.focus, weight: 1 }] : []),
      ...heldNow.map(h => ({ id: h.id, weight: h.a })),
      ...sources(world, tick),
      ...saidSources(world, st.said, tick)
    ];
    let { activation, index } = computeActivation(world, { tick, sources: baseSources });
    st.locus = settleLocus(world, st.locus, activation);
    world.focusWeb(st.locus.web);
    const view = buildView(world, st.locus, activation, { tick });

    const extra = extras(world, st.locus);
    const sections = () => ({
      system: promptSpace.system,
      wm: [renderDialogue(st, tick), renderTrail(st.trail, tick), renderHeld(world), extra].filter(Boolean).join('\n'),
      view: renderView(view, { world, tick, writes: st.writes, trail: st.trail }),
      loop: st.loop.length ? `What you were just thinking:\n${st.loop.map(t => `- ${t}`).join('\n')}` : (seed && tick === 1 ? `On your mind as you wake: ${seed}` : ''),
      notice: st.notice
    });

    const calls = [];
    const ask = async (question, maxWords) => {
      const r = await mind.fill({ ...sections(), question, maxWords });
      calls.push({ kind: 'fill', question, ok: r.ok, text: r.text, ...(r.error ? { error: r.error } : {}) });
      return r.text;
    };
    const pick = async (question, options) => {
      const r = await mind.choose({ ...sections(), question, options });
      calls.push({ kind: 'choose', question, ok: r.ok, index: r.index, ...(r.error ? { error: r.error } : {}) });
      return r.index;
    };
    const judge = async (question, scale) => {
      const r = await mind.judge({ ...sections(), question, scale });
      calls.push({ kind: 'judge', question, ok: r.ok, key: r.key, ...(r.error ? { error: r.error } : {}) });
      return r.key;
    };

    const ctx = {
      world, tick, locus: st.locus, view, activation, index, held: heldNow, ask, pick, judge,
      lastThought: st.loop[st.loop.length - 1] || '',
      left: st.left,
      writes: st.writes,
      release: (id) => letGo(world, id, tick, 6),
      scratch: (text) => scratchThought(world, text, tick),
      promote: (id, web) => promote(world, id, web),
      ...(typeof extendCtx === 'function' ? await extendCtx(world, tick) : extendCtx)
    };

    // ── CHOOSE ────────────────────────────────────────────────────────────
    const menu = buildMenu(moves, ctx, { recent: st.recent, shown: st.shown, refused: st.refused, tick, left: st.left });
    let item = null;
    let text = null;
    let result = null;
    let otherText = null;
    let commandLine = null;

    if (speak === 'commands') {
      // ── SAY AND DO: one plain command, carried out by the executor ──────
      const suggestions = [...new Set(menu.map(m => asCommand(m, ctx)).filter(Boolean))].slice(0, 6);
      const question = [
        promptSpace.questions.command || 'What do you do next? Write one command: a verb, then plain words.',
        suggestions.length ? `Suggested from here:\n${suggestions.map(x => `- ${x}`).join('\n')}` : '',
        `All commands (capitals are for you to fill in):\n${renderCommands()}`
      ].filter(Boolean).join('\n');
      const said = await mind.command({ ...sections(), question, verbs: VERBS });
      // The notice has been seen with the choice; what the act reports is new.
      st.notice = '';
      calls.unshift({ kind: 'command', question: 'command', ok: said.ok, verb: said.verb, rest: said.rest, ...(said.error ? { error: said.error } : {}), ...(!said.ok && !said.error ? { raw: String(said.content).slice(0, 200) } : {}) });
      if (!said.ok) {
        result = { ok: false, summary: 'did not say a command', touched: [], wrote: false };
      } else {
        const rewrite = mind.helper ? (line) => rewriteCommand(mind, line) : null;
        result = await runCommand(ctx, said.verb, said.rest, { rewrite });
        commandLine = result.command;
        st.recent = [...st.recent, `cmd:${commandByVerb(said.verb)?.verb || said.verb}`].slice(-RECENT_SIZE);
      }
    } else {
      const choice = await mind.choose({ ...sections(), question: promptSpace.questions.choose, options: menu.map(m => m.label) });
      st.notice = '';
      calls.unshift({ kind: 'choose', question: 'menu', ok: choice.ok, index: choice.index, ...(choice.error ? { error: choice.error } : {}), ...(!choice.ok && !choice.error ? { raw: String(choice.content).slice(0, 200) } : {}) });
      item = choice.ok ? menu[choice.index] : null;
    }

    // ── ACT ───────────────────────────────────────────────────────────────
    if (result) {
      // already done, by a command
      if (result.as) text = result.as.text ?? null;
    } else if (!item) {
      result = { ok: false, summary: 'did not choose', touched: [], wrote: false };
    } else {
      if (item.blank) text = await ask(item.blank.question, item.blank.maxWords);
      if (item.move.id === 'other') {
        otherText = text;
        // A plain command, carried out by the executor (commands/commands.js):
        // the menu for choosing, plain words for what it does not offer.
        const said = saidAsCommand(text);
        const mapped = said ? null : matchOther(text, menu);
        if (said) {
          result = await runCommand(ctx, said.verb, said.rest, {});
          commandLine = result.command;
        } else if (mapped && mapped.move.id !== 'other') {
          item = mapped;
          text = mapped.blank ? await ask(mapped.blank.question, mapped.blank.maxWords) : null;
        } else {
          if (text) st.missing = [...st.missing, { tick, text }].slice(-50);
          result = { ok: false, summary: text ? `wanted to: ${text} (no move for that yet)` : 'wanted something else', touched: [], wrote: false };
        }
      }
      if (!result) {
        if (item.blank && !text) {
          // Apple's model blocks some plain questions outright ("What makes up Death?"), and blocks them again each time.
          const blocked = calls.some(c => c.kind === 'fill' && /guardrailViolation/.test(c.error || ''));
          result = { ok: false, summary: `${item.move.id}: ${blocked ? "the model's safety filter would not answer" : 'left the blank empty'}`, touched: [], wrote: false };
        } else {
          try {
            result = await item.move.run(ctx, item.data, text);
          } catch (err) {
            result = { ok: false, summary: `${item.move.id} failed: ${err?.message || err}`, error: err?.message || String(err), touched: [], wrote: false };
          }
        }
      }
      st.recent = [...st.recent, item.key].slice(-RECENT_SIZE);
    }
    if (!result.ok && result.error) st.notice = `Your last move did not work: ${result.error}`;
    // A check's refusal, or a blank it could not fill, is remembered against
    // the item, so it is not offered again soon: chosen first every time, an
    // unanswerable one was the whole of a run.
    if (item && !result.ok && (REFUSAL.test(result.error || result.summary || '') || UNFILLED.test(result.summary || ''))) {
      st.refused = Object.fromEntries([...Object.entries(st.refused).filter(([, t]) => tick - t < REFUSED_FOR), [item.key, tick]]);
    }
    // Moving about without doing anything, cycle after cycle, is said out loud.
    st.idle = result.ok && !result.wrote && NAVIGATION.has(result.as?.move || item?.move.id) ? st.idle + 1 : 0;
    if (st.idle >= 2) st.notice = [st.notice, 'You have been moving around without doing anything. Do something where you are: make, connect, describe or tidy.'].filter(Boolean).join('\n');
    const before = st.locus;
    if (result.locus) st.locus = { ...st.locus, ...result.locus };
    // Where it just was, so going straight back ranks lower: one Druid went
    // Causes, Magnitude, Causes, Magnitude for nine moments.
    if (before.focus && st.locus.focus !== before.focus) st.left = [...st.left.filter(id => id !== before.focus), before.focus].slice(-LEFT_SIZE);

    // ── REMEMBER ──────────────────────────────────────────────────────────
    const touched = (result.touched || []).filter(id => world.proto(id));
    for (const id of touched) { recordUse(world, id, tick); hold(world, id, tick); }
    if (st.locus.focus && world.proto(st.locus.focus)) { recordUse(world, st.locus.focus, tick); hold(world, st.locus.focus, tick); }
    associate(world, [...touched, ...held(world).slice(0, 3).map(h => h.id)], tick);
    // The recency trail: where it went and what it did, built from what happened.
    st.trail = extendTrail(st.trail, {
      tick, before, after: st.locus, webName: world.graph(st.locus.web)?.name, focusName: world.nameOf(st.locus.focus),
      wrote: result.ok && result.wrote, summary: result.summary
    });
    let episode = null;
    if (result.ok && result.wrote) {
      st.writes = [...st.writes, { tick, move: commandLine ? commandLine.split(' ')[0] : (item?.move.id || null), touched }].slice(-RECENT_SIZE);
      episode = await writeEpisode(world, { tick, summary: result.summary, touched, episodeTypeId: episodeType(world) });
    }

    // ── THINK ─────────────────────────────────────────────────────────────
    ({ activation } = computeActivation(world, { tick, sources: baseSources }));
    const thinkView = buildView(world, settleLocus(world, st.locus, activation), activation, { tick });
    // The through line is shown when choosing, not when thinking: shown here,
    // it became the thought, ten moments running.
    const thoughtCall = await mind.fill({
      ...sections(),
      wm: [renderTrail(st.trail, tick), renderHeld(world), extra].filter(Boolean).join('\n'),
      view: renderView(thinkView, { world, tick, writes: st.writes, trail: st.trail }),
      notice: `You just ${result.ok ? result.summary : `tried, but ${result.summary}`}.`,
      question: promptSpace.questions.thought,
      maxWords: 30
    });
    // A thought that says the question back is no thought: "What are you
    // thinking now? Name the Things you mean." was kept as a Thing, "I am
    // thinking now", and thought about for sixty moments.
    const thought = thoughtCall.text && thoughtSimilarity(thoughtCall.text, promptSpace.questions.thought) < 0.5 ? thoughtCall.text : null;
    // A thought that repeats the last one is not rehearsed again: fed back
    // verbatim, a repeated thought becomes an attractor. On its first v2 run a
    // 4B model spent ten cycles restating one image of "breath stitching
    // silence", each version seeding the next.
    const repeating = thought && [...st.loop, st.throughLine].filter(Boolean).some(prev => thoughtSimilarity(thought, prev) > 0.6);
    if (thought && !repeating) st.loop = [...st.loop, thought].slice(-LOOP_SIZE);
    st.stuck = repeating ? (st.stuck || 0) + 1 : 0;
    if (repeating) st.notice = [st.notice, 'You keep coming back to the same thought. Look at something else, or do something with it.'].filter(Boolean).join('\n');
    // Stuck: the loop is let go, so the thought it keeps seeding is no longer
    // shown. Kept, one sentence held a Druid for sixty moments.
    if (st.stuck >= 2) { st.loop = []; st.stuck = 0; }

    // ── KEEP THE THROUGH LINE ─────────────────────────────────────────────
    st.lastDid = result.ok ? result.summary : `tried, but ${result.summary}`;
    if (throughLineDue(st, tick)) {
      const r = await mind.fill({
        ...sections(),
        question: `${renderTrail(st.trail, tick) || 'You have not done much yet.'}\nFrom that, in one plain sentence: what have you been doing lately, and what are you after? Name the Things you mean.`,
        maxWords: 30
      });
      const kept = keepThroughLine(world, st.throughLine, r.text);
      if (kept) st.throughLine = kept;
      st.throughLineAt = tick;
    }

    // ── CHECK ─────────────────────────────────────────────────────────────
    let unbacked = [];
    if (thought && !result.wrote && CLAIM.test(thought)) {
      unbacked = ungroundedNames(buildMemoryIndex(world.state()), thought);
      if (unbacked.length) {
        st.notice = [st.notice, `You thought you had made ${unbacked.join(', ')}, but nothing was written and your universe has no Thing by ${unbacked.length === 1 ? 'that name' : 'those names'}.`].filter(Boolean).join('\n');
      }
    }

    // ── SLEEP ─────────────────────────────────────────────────────────────
    let slept = null;
    if (sleep && sleepEvery > 0 && tick % sleepEvery === 0) {
      try { slept = await sleep({ ...ctx, tick }); } catch (err) { slept = { error: err?.message || String(err) }; }
    }

    yield {
      type: 'cycle',
      tick,
      locus: { ...st.locus, webName: world.graph(st.locus.web)?.name || null, focusName: world.nameOf(st.locus.focus) || null },
      menu: menu.map(m => m.label),
      offerErrors: ctx.offerErrors || [],
      heard,
      reply,
      throughLine: st.throughLine,
      chose: commandLine || (item ? item.label : null),
      move: commandLine ? (result.as?.move || `cmd:${commandLine.split(' ')[0]}`) : (item?.move.id || null),
      text,
      otherText,
      result: { ok: result.ok, summary: result.summary, wrote: !!result.wrote, error: result.error || null },
      thought,
      repeating: !!repeating,
      unbacked,
      episode,
      held: held(world).map(h => world.nameOf(h.id)),
      calls,
      slept,
      size: { things: world.allThings().length, webs: [...world.state().graphs.keys()].filter(id => !world.isSystemWeb(id)).length },
      state: snapshot(st)
    };
  }
  yield { type: 'stopped', reason: 'max_cycles', state: snapshot(st) };
}

function snapshot(st) {
  return {
    tick: st.tick, locus: st.locus, loop: st.loop, recent: st.recent, left: st.left, missing: st.missing, shown: st.shown, writes: st.writes, refused: st.refused, idle: st.idle,
    throughLine: st.throughLine, throughLineAt: st.throughLineAt, said: stillSaid(st.said, st.tick), trail: st.trail,
    talk: st.talk, lastDid: st.lastDid
  };
}

/** Failures that are a check saying no, as opposed to a slip. */
const UNFILLED = /: left the blank empty$|safety filter would not answer$/;
const REFUSAL = /does not make sense|is not a kind of|not a part of|has a name of its own|cannot be a part of itself|cannot go inside itself|already exists|already here|about this place itself|about knowing in general|describes a quality|not that they differ|already both kinds of|already a kind of|too general to be a kind|an aspect of something|too long for a relation|does not say how|only repeats a name|could not tell from|not inside it|something you do|only puts names together|no subject of its own|already your goal|names something missing/i;
/** Moves that go somewhere rather than do something. */
const NAVIGATION = new Set(['look', 'follow', 'goWeb', 'open', 'close', 'pursueGoal', 'pursueStep', 'wonder']);

export default runLife;

/**
 * A command code could not read, put once to a contextless helper call:
 * "rewrite this as one of these forms".
 */
async function rewriteCommand(mind, line) {
  const r = await mind.helper({
    name: 'rewriteCommand',
    task: `Rewrite the instruction below as exactly one command in one of these forms (capitals are placeholders to fill with real words):\n${renderCommands()}`,
    input: line,
    schema: { name: 'command', schema: { type: 'object', properties: { verb: { type: 'string', enum: VERBS }, rest: { type: 'string' } }, required: ['verb', 'rest'], additionalProperties: false } },
    read: (content) => { try { const o = JSON.parse(content); return VERBS.includes(o.verb) ? { verb: o.verb, rest: String(o.rest || '') } : null; } catch { return null; } },
    maxTokens: 60
  });
  return r.ok ? r.value : null;
}

const VAGUE = /^(another|a|an|some|the|new|one more)?\s*(thing|one|something|it|stuff)s?$/i;

/** Something-else text as a command, when its first word is one of the verbs. */
function saidAsCommand(text) {
  const t = String(text || '').trim().replace(/^["']|["']$/g, '');
  if (!t) return null;
  const [first, ...rest] = t.split(/\s+/);
  // "make another thing" names nothing: a hint for the menu, not a command.
  if (VAGUE.test(rest.join(' '))) return null;
  const cmd = commandByVerb(first);
  if (cmd && cmd.parse(rest.join(' '))) return { verb: cmd.verb, rest: rest.join(' ') };
  // Not rewritten: something it has no command for ("compose a song about
  // it") is a want to record, not a command to force.
  return null;
}
