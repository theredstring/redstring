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
 * A person talking with it (conversation.js) comes first in a moment, and
 * what they say cuts into the moment it is in: between its calls, if someone
 * has spoken, it stops what it was thinking and choosing (never a write
 * halfway) and listens. It hears, thinks with their words in front of it,
 * chooses (turning to them is one of its choices), acts, and only then
 * speaks, about what it did.
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
import { answer, withoutRepeats, namedIn, TALK_KEEP } from './talk.js';
import { understand, engaged, placeOf, promisedIn, renderConversation, REPORTS_PER_TURN } from './conversation.js';
import { extendTrail, renderTrail } from './recency.js';
import { takeUp, onTask, stillHeld, renderTask, TASK_LAPSE } from './task.js';
import { openGoals, isBookkeeping } from './roles.js';

const CLAIM = /\b(created|added|made|built|established|connected|linked|wrote|recorded|defined)\b/i;
const LOOP_SIZE = 3;
const RECENT_SIZE = 6;
const LEFT_SIZE = 4;
/** Moments a past exchange stays in the conversation an answer is given in. */
const TALK_FRESH = 60;
/** Moments what a person turned it away from is kept from coming straight back. */
const ENGAGED_LET_GO = 12;

/**
 * @param {Object} deps
 * @param {Object} deps.world
 * @param {Object} deps.mind
 * @param {Object} [deps.promptSpace]
 * @param {Object} [opts]
 * @param {Object} [opts.resume]        persisted state from a previous run
 * @param {Array}  [opts.moves]         defaults to BASIC_MOVES
 * @param {Function} [opts.sources]     (world, tick, { talking }) → extra activation sources (e.g. open goals)
 * @param {Function} [opts.isOpenGoal]  (id) → whether a held Thing survives waking
 * @param {Function} [opts.sleep]       async (ctx) → sleep record, run every `sleepEvery` cycles
 * @param {number}   [opts.sleepEvery]
 * @param {Function} [opts.episodeType] (world) → Episode role type id, if any
 * @param {Object|Function} [opts.extendCtx]  extra fields every move sees in ctx, or (world, tick) → them, per cycle
 * @param {Function} [opts.extras]      (world, locus, { talking }) → extra lines for the held-in-mind section
 * @param {number}   [opts.maxCycles]
 * @param {string}   [opts.seed]
 * @param {AbortSignal} [opts.signal]
 * @param {'menu'|'commands'} [opts.speak]  choose from a menu of moves, or write a plain command (commands/commands.js)
 * @param {Function} [opts.hear]      () → [{ text }]: what a person has said since the last moment (dialogue.js)
 * @param {Function} [opts.waiting]   () → whether a person has said something not yet heard: the moment stops to listen
 * @param {Function} [opts.onHeard]   async (world, text, tick, understood) → a line for the notice, if what was said changed something (e.g. became a goal)
 * @param {Function} [opts.onReply]   (text, tick) → void: its answer, once it has acted on what they said, or what it tells them unasked (conversation.js)
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
  waiting = () => false,
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
    // The conversation it is in, if any (conversation.js).
    conversation: resume.conversation && typeof resume.conversation === 'object' ? { ...resume.conversation } : null,
    lastDid: resume.lastDid || '',
    // Where the conversation an answer is given in begins (a redirect starts it again).
    talkFrom: resume.talkFrom || 0,
    lastWrote: !!resume.lastWrote,
    trail: Array.isArray(resume.trail) ? [...resume.trail] : [],
    // What a person said that a moment stopped for before it could answer: answered in the next.
    unanswered: Array.isArray(resume.unanswered) ? [...resume.unanswered] : [],
    // A sleep put off to listen.
    sleepOwed: !!resume.sleepOwed,
    // What it is working on: a goal it took up (task.js).
    task: resume.task && typeof resume.task === 'object' ? { ...resume.task } : null,
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
    // A voice addressed to it: what kind of thing was said, what it turns
    // toward and away from, and what they want (conversation.js). The Things
    // they name are held in mind; what they want is held as a goal; what they
    // turn it from is let go of for a while. Where it goes is its choice.
    // Each { text, answered }: answered while it slept (talk.js), it is heard but not answered again.
    const heardItems = (hear() || []).map(h => ({ text: String(h?.text ?? h).trim(), answered: !!h?.answered })).filter(h => h.text);
    const heard = heardItems.map(h => h.text);
    // What they asked it to do, this moment, for its answer.
    let asked = null;
    for (const text of heard) {
      st.said = [...st.said, { text, tick }].slice(-6);
      const understood = await understand(world, mind, text).catch(() => ({ kind: 'telling', toward: [], away: [], ask: null }));
      const was = engaged(st.conversation, tick) ? st.conversation : null;
      // What "it" is, after a quiet spell: what they were last talking about.
      const lately = st.conversation && tick - st.conversation.last < TALK_FRESH ? st.conversation : null;
      st.conversation = {
        since: was?.since ?? tick,
        last: tick,
        kind: understood.kind,
        topic: understood.toward.length ? understood.toward.slice(0, 3) : (lately?.topic || []),
        away: understood.away,
        ask: understood.ask || (understood.kind === 'question' || understood.kind === 'telling' ? lately?.ask || null : null),
        // Something they named that its universe does not hold: it may start a web for it (conversation.js heed).
        newSubject: understood.newSubject || (understood.kind === 'question' || understood.kind === 'telling' ? was?.newSubject || null : null),
        promised: [],
        reports: 0
      };
      for (const id of understood.away) letGo(world, id, tick, ENGAGED_LET_GO);
      // What they name lights up: held, as a word heard calls its meaning to mind.
      for (const id of understood.toward.slice(0, 3)) hold(world, id, tick);
      // What hearing it changed (druid.js onHeard): a line for the notice, and what they want, held as a goal.
      const changed = onHeard ? await onHeard(world, text, tick, understood).catch(() => null) : null;
      const note = typeof changed === 'string' ? changed : changed?.notice;
      if (note) st.notice = [st.notice, note].filter(Boolean).join('\n');
      // What it took on, as its goal says it.
      if (changed?.ask) st.conversation.ask = changed.ask;
      if (understood.kind === 'direction' || understood.kind === 'correction') asked = { ask: st.conversation.ask };
    }
    const talking = engaged(st.conversation, tick);
    // Someone spoke while this moment was going: it stops what it was doing
    // and listens, in the next moment. Checked between calls; a write already
    // begun is finished, never left halfway.
    let cut = false;
    const listen = () => cut || (cut = !!waiting());

    // ── ATTEND ────────────────────────────────────────────────────────────
    if (st.task && !stillHeld(world, st.task)) st.task = null;
    const heldNow = held(world);
    const baseSources = [
      // What it is working on pulls hardest of its own aims.
      ...(st.task ? [st.task.anchor && { id: st.task.anchor, weight: 1.2 }, { id: st.task.goal, weight: 0.9 }].filter(x => x && world.proto(x.id)) : []),
      ...(st.locus.focus ? [{ id: st.locus.focus, weight: 1 }] : []),
      ...heldNow.map(h => ({ id: h.id, weight: h.a })),
      ...sources(world, tick, { talking }),
      // In a conversation, what it is about pulls hardest; what it told them it would look at, harder.
      ...(talking
        ? [...(st.conversation.topic || []).map(id => ({ id, weight: 1.2 })), ...(st.conversation.promised || []).map(id => ({ id, weight: 1.4 }))]
        : saidSources(world, st.said, tick))
    ];
    let { activation, index } = computeActivation(world, { tick, sources: baseSources });
    st.locus = settleLocus(world, st.locus, activation);
    world.focusWeb(st.locus.web);
    const view = buildView(world, st.locus, activation, { tick });

    const extra = extras(world, st.locus, { talking });
    // The moment's context, fixed as it begins: every call of the moment shares
    // it, so Apple's model reads it once (mind/budget.js, afmClient.js). What
    // changes within the moment (what was said, its thought, a notice, the
    // question) is each call's turn.
    const context = {
      system: promptSpace.system,
      wm: [renderTask(world, st.task, tick), renderTrail(st.trail, tick), renderHeld(world), extra].filter(Boolean).join('\n'),
      view: renderView(view, { world, tick, writes: st.writes, trail: st.trail }),
      loop: st.loop.length ? `What you were just thinking:\n${st.loop.map(t => `- ${t}`).join('\n')}` : (seed && tick === 1 ? `On your mind as you wake: ${seed}` : '')
    };
    let thought = null;
    const sections = () => ({
      ...context,
      dialogue: [renderConversation(world, st.conversation, tick), renderDialogue(st, tick), thought && `What you are thinking now: ${thought}`].filter(Boolean).join('\n'),
      notice: st.notice
    });

    // ── THINK ─────────────────────────────────────────────────────────────
    // First, about what it sees now and what it just did; then it chooses.
    // (Asked last in a moment, over a view of its own, it was a whole reading
    // of the prompt more each moment.) Not shown the through line: shown it,
    // the through line became the thought, ten moments running.
    // What a person said is in front of it as it thinks (not the through line).
    const thoughtCall = await mind.fill({
      ...context,
      dialogue: [renderConversation(world, st.conversation, tick), renderDialogue({ said: st.said }, tick)].filter(Boolean).join('\n'),
      notice: st.lastDid ? `You just ${st.lastDid}.` : '',
      question: promptSpace.questions.thought,
      maxWords: 30
    });
    // A thought that says the question back is no thought: "What are you
    // thinking now? Name the Things you mean." was kept as a Thing, "I am
    // thinking now", and thought about for sixty moments.
    // Nor one that ends by asking the question back: "...What are you thinking now?" went on into what it told a person.
    const thoughtText = String(thoughtCall.text || '').replace(/\s*what are you thinking(?: about)?(?: now)?\?\s*$/i, '').trim();
    thought = thoughtText && thoughtSimilarity(thoughtText, promptSpace.questions.thought) < 0.5 ? thoughtText : null;
    // A thought that repeats the last one is not rehearsed again: fed back
    // verbatim, a repeated thought becomes an attractor. On its first v2 run a
    // 4B model spent ten cycles restating one image of "breath stitching
    // silence", each version seeding the next.
    const repeating = thought && [...st.loop, st.throughLine].filter(Boolean).some(prev => thoughtSimilarity(thought, prev) > 0.6);
    // A thought about nothing in its universe is not carried on: "the trees in
    // the forest, a living tapestry", "the river and its flowing water", fed
    // back as what it was just thinking, seeded more of the same while it
    // built a web about Venus (The Druid 12, 2026-10-06).
    // With nothing yet to name, a thought is an intention ("a web for rivers"), and kept.
    const nothingYet = !world.allThings().some(id => !world.isOwnThinking?.(id));
    const grounded = !!thought && (nothingYet || namedIn(world, thought, 1).length > 0);
    if (thought && grounded && !repeating) st.loop = [...st.loop, thought].slice(-LOOP_SIZE);
    if (thought && !grounded) st.notice = [st.notice, 'That thought named nothing in your universe. Think about what is in front of you, by name.'].filter(Boolean).join('\n');
    st.stuck = repeating ? (st.stuck || 0) + 1 : 0;
    if (repeating) st.notice = [st.notice, 'You keep coming back to the same thought. Look at something else, or do something with it.'].filter(Boolean).join('\n');
    // Stuck: the loop is let go, so the thought it keeps seeding is no longer
    // shown. Kept, one sentence held a Druid for sixty moments.
    if (st.stuck >= 2) { st.loop = []; st.stuck = 0; }

    // A thought that claims a write the last moment did not make is said so.
    let unbacked = [];
    if (thought && !st.lastWrote && CLAIM.test(thought)) {
      unbacked = ungroundedNames(buildMemoryIndex(world.state()), thought);
      if (unbacked.length) {
        st.notice = [st.notice, `You thought you had made ${unbacked.join(', ')}, but nothing was written and your universe has no Thing by ${unbacked.length === 1 ? 'that name' : 'those names'}.`].filter(Boolean).join('\n');
      }
    }

    listen();

    // ── KEEP THE THROUGH LINE ─────────────────────────────────────────────
    if (!cut && throughLineDue(st, tick)) {
      const r = await mind.fill({
        ...sections(),
        question: `${renderTrail(st.trail, tick) || 'You have not done much yet.'}\nFrom that, in one plain sentence: what have you been doing lately, and what are you after? Name the Things you mean.`,
        maxWords: 30
      });
      const kept = keepThroughLine(world, st.throughLine, r.text);
      if (kept) st.throughLine = kept;
      st.throughLineAt = tick;
    }

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
      conversation: talking ? st.conversation : null,
      task: st.task,
      ...(typeof extendCtx === 'function' ? await extendCtx(world, tick) : extendCtx)
    };

    // ── CHOOSE ────────────────────────────────────────────────────────────
    const menu = buildMenu(moves, ctx, { recent: st.recent, shown: st.shown, refused: st.refused, tick, left: st.left });
    let item = null;
    let text = null;
    let result = null;
    let otherText = null;
    let commandLine = null;

    if (listen()) {
      // stopped to listen
    } else if (speak === 'commands') {
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
    if (item?.blank) listen();
    if (cut) {
      result = { ok: true, summary: 'stopped what you were doing to listen', touched: [], wrote: false };
      item = null;
    } else if (result) {
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
    // Having turned to what they asked, it puts the old work down, as a person
    // switching tasks does: its last thoughts, what it was doing lately and
    // what it held were all the old work. Kept, a Druid asked to start on a
    // submarine sandwich thought about quantum algorithms for the sandwich's
    // preparation. Its own choice to turn, not code turning it.
    if (result.ok && result.turned) {
      st.loop = [];
      st.trail = [];
      st.throughLine = '';
      st.throughLineAt = tick;
      // And the conversation it answers from starts here: its last answer,
      // about the old work, was given again word for word.
      st.talkFrom = tick;
      for (const h of held(world)) if (!h.scratch) letGo(world, h.id, tick);
      if (st.conversation && item?.move.id === 'heed' && result.touched?.length) st.conversation.topic = result.touched.slice(0, 3);
    }

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

    // ── TASK ──────────────────────────────────────────────────────────────
    // What it chose to take up is held until it reaches it, gives it up, sets
    // it aside, or drifts away from it too long (task.js).
    if (result.ok && result.setAside) st.task = null;
    else {
      const personGoal = () => openGoals(world).filter(g => world.druidOf(g).fromPerson).sort((a, b) => (world.druidOf(b).statusAt ?? 0) - (world.druidOf(a).statusAt ?? 0))[0] || null;
      const taken = !result.ok || cut ? null
        : result.takeUp || (item?.move.id === 'heed' && st.conversation?.ask ? personGoal() : null) || (item?.move.id === 'pursueGoal' ? item.data?.goal : null);
      if (taken && st.task?.goal !== taken) {
        const anchor = touched.find(id => !isBookkeeping(world, id)) || world.ownerOf(st.locus.web) || null;
        st.task = takeUp(taken, anchor && !isBookkeeping(world, anchor) ? anchor : null, st.locus.web, tick);
      } else if (st.task && stillHeld(world, st.task)) {
        if (onTask(world, st.task, st.locus)) st.task.lastOn = tick;
        else if (tick - st.task.lastOn >= TASK_LAPSE) {
          st.notice = [st.notice, `You drifted away from "${world.nameOf(st.task.goal)}"; it is no longer what you are working on.`].filter(Boolean).join('\n');
          st.task = null;
        }
      } else st.task = null;
    }

    // In a conversation: did this moment do something about what they asked?
    let worthTelling = false;
    let onIt = null;
    if (talking && st.conversation && !cut) {
      const conv = st.conversation;
      const about = new Set([...(conv.topic || []), ...(conv.promised || [])]);
      // Working inside what they talk about is about it: Cheese, in the Ham sandwich.
      for (const id of conv.topic || []) { const inside = world.insideOf(id); if (inside) for (const x of world.thingsIn(inside)) about.add(x); }
      // Only about something they asked or pointed at, not after a hello; and
      // having done what it told them it would.
      const kept = (conv.promised || []).includes(st.locus.focus);
      onIt = result.ok && (kept || item?.move.id === 'heed' || touched.some(id => about.has(id)));
      worthTelling = onIt || !!(result.ok && conv.ask && result.wrote);

      // A promise is kept by being there.
      conv.promised = (conv.promised || []).filter(id => id !== st.locus.focus && id !== before.focus);
    }

    // What it did, for the thought that opens the next moment, and for what it says now.
    st.lastDid = result.ok ? result.summary : `tried, but ${result.summary}`;
    st.lastWrote = !!(result.ok && result.wrote);

    // ── SPEAK ─────────────────────────────────────────────────────────────
    // After it has acted, about what it did: the one who speaks is the one who
    // chose and acted, over the moment's own context. Answered before it acted,
    // it said yes to anything and made up what it was doing. What it says it
    // will look at, it is held to (conversation.js heed).
    let reply = null;
    const unanswered = [...st.unanswered, ...heardItems.filter(h => !h.answered).map(h => h.text)];
    // Where it stands now, if it moved, and with what it has in mind now, if it
    // turned: it speaks from there. Answered over the moment's opening context,
    // having turned to a ham sandwich it spoke of its Superposition, and its
    // words kept the quantum work in the conversation for moments after.
    const moved = st.locus.web !== before.web || st.locus.focus !== before.focus;
    const here = !moved ? context : {
      ...context,
      view: renderView(buildView(world, st.locus, activation, { tick }), { world, tick, writes: st.writes, trail: st.trail }),
      ...(result.turned ? { wm: [renderTask(world, st.task, tick), renderTrail(st.trail, tick), renderHeld(world), extras(world, st.locus, { talking })].filter(Boolean).join('\n'), loop: '' } : {})
    };
    if (cut) {
      // Stopped to listen: what it heard this moment is answered with what comes next.
      st.unanswered = unanswered;
    } else if (unanswered.length) {
      st.unanswered = [];
      const said = unanswered[unanswered.length - 1];
      const ask = (history, ctx = here) => answer(world, mind, {
        text: said,
        // Only the conversation of late: asked "what have you found so far?",
        // it repeated its answer to "what have you learned so far?" from four
        // thousand moments before.
        history,
        context: ctx,
        // Having turned, what it was thinking was the old work: a ham sandwich and Quantum bits.
        thought: result.turned ? '' : thought || '',
        focus: st.locus.focus,
        // What "it" is, when they name nothing: what they are talking about.
        topic: st.conversation?.topic || [],
        doing: st.lastDid,
        // Whether what it just did was about what they said, for what it says.
        onIt,
        request: asked,
        manner: promptSpace.talk
      });
      let r = await ask([...st.talk.filter(x => tick - (x.tick ?? tick) <= TALK_FRESH && (x.tick ?? tick) >= (st.talkFrom || 0)), ...unanswered.slice(0, -1).map(t => ({ who: 'person', text: t }))]);
      // Not what it has already told them: asked what was in the sandwich so
      // far, it gave its first answer again. All of it said before, it is
      // asked again without its past words to copy, from what it holds now.
      const toldBefore = st.talk.filter(x => x.who === 'druid').slice(-3).map(x => x.text);
      reply = withoutRepeats(r.text, toldBefore);
      if (!reply && r.text) {
        // In a context of its own: within one context, Apple's model sees the
        // turns before (afmClient.js), and gave the same words again.
        r = await ask(unanswered.slice(0, -1).map(t => ({ who: 'person', text: t })), { ...here, wm: [here.wm, `You already told them: "${toldBefore.at(-1)}" Say something new, from what your universe holds now.`].filter(Boolean).join('\n') });
        reply = withoutRepeats(r.text, toldBefore) || r.text;
      }
      reply = reply || null;
      st.talk = [...st.talk, ...unanswered.map(t => ({ who: 'person', text: t, tick })), ...(reply ? [{ who: 'druid', text: reply, tick }] : [])].slice(-TALK_KEEP * 2);
      if (reply) {
        st.said = st.said.map(x => (x.tick === tick && x.text === said ? { ...x, answer: reply } : x));
        if (st.conversation) st.conversation.promised = promisedIn(world, reply).filter(id => id !== st.locus.focus && placeOf(world, id));
        if (onReply) onReply(reply, tick);
      }
    } else if (worthTelling && st.conversation.reports < REPORTS_PER_TURN) {
      // Having done something about what they asked, it tells them, unasked,
      // as a person comes back with what they found.
      const r = await mind.fill({
        ...here,
        dialogue: [renderConversation(world, st.conversation, tick), renderDialogue(st, tick)].filter(Boolean).join('\n'),
        notice: `You just ${st.lastDid}.`,
        question: `${promptSpace.talk}\n\nTell the person, in one or two plain sentences of your own, what you just did or found about what they asked, from what you see now; do not read out what you see. If you found nothing yet, say what you will look at next.`,
        maxWords: 45
      });
      // Not what it last told them, again.
      const last = [...st.talk].reverse().find(x => x.who === 'druid')?.text || '';
      const told = withoutRepeats(r.text, st.talk.filter(x => x.who === 'druid').slice(-3).map(x => x.text));
      if (told && !(last && thoughtSimilarity(told, last) >= 0.9)) {
        reply = told;
        st.conversation.reports++;
        // Telling them keeps the conversation going.
        st.conversation.last = tick;
        st.talk = [...st.talk, { who: 'druid', text: reply, tick }].slice(-TALK_KEEP * 2);
        st.said = [...st.said, { text: '', tick, answer: reply }].slice(-6);
        if (onReply) onReply(reply, tick);
      }
    }

    // ── SLEEP ─────────────────────────────────────────────────────────────
    let slept = null;
    // Not while someone is waiting to be heard: put off to a later moment.
    const sleepDue = sleep && sleepEvery > 0 && (tick % sleepEvery === 0 || st.sleepOwed);
    if (sleepDue && waiting()) st.sleepOwed = true;
    else if (sleepDue) {
      st.sleepOwed = false;
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
      listened: cut,
      thought,
      grounded,
      task: st.task ? { goal: world.nameOf(st.task.goal), at: st.task.anchor ? world.nameOf(st.task.anchor) : null, since: st.task.since } : null,
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
    talk: st.talk, talkFrom: st.talkFrom, lastDid: st.lastDid, lastWrote: st.lastWrote, conversation: st.conversation,
    unanswered: st.unanswered, sleepOwed: st.sleepOwed, task: st.task
  };
}

/** Failures that are a check saying no, as opposed to a slip. */
const UNFILLED = /: left the blank empty$|safety filter would not answer$/;
const REFUSAL = /does not make sense|is not a kind of|not a part of|has a name of its own|cannot be a part of itself|cannot go inside itself|already exists|already here|about this place itself|about knowing in general|describes a quality|not that they differ|already both kinds of|already a kind of|too general to be a kind|an aspect of something|too long for a relation|does not say how|only repeats a name|could not tell from|not inside it|something you do|only puts names together|no subject of its own|already your goal|names something missing|already make up/i;
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
