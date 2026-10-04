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
import { buildMenu, matchOther } from './moves/menu.js';
import { BASIC_MOVES } from './moves/basic.js';
import { writeEpisode } from './episodes.js';
import { ungroundedNames, buildMemoryIndex } from './recall.js';
import { DEFAULT_PROMPT_SPACE } from './promptSpace.js';
import { thoughtSimilarity } from './runDruid.js';
import { VERBS, renderCommands, asCommand, runCommand, commandByVerb } from './commands/commands.js';

const CLAIM = /\b(created|added|made|built|established|connected|linked|wrote|recorded|defined)\b/i;
const LOOP_SIZE = 3;
const RECENT_SIZE = 6;

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
  speak = 'menu'
} = {}) {
  const st = {
    tick: resume.tick || 0,
    locus: resume.locus || emptyLocus(),
    loop: Array.isArray(resume.loop) ? [...resume.loop] : [],
    recent: Array.isArray(resume.recent) ? [...resume.recent] : [],
    missing: Array.isArray(resume.missing) ? [...resume.missing] : [],
    shown: resume.shown && typeof resume.shown === 'object' ? { ...resume.shown } : {},
    writes: Array.isArray(resume.writes) ? [...resume.writes] : [],
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

    // ── ATTEND ────────────────────────────────────────────────────────────
    const heldNow = held(world);
    const baseSources = [
      ...(st.locus.focus ? [{ id: st.locus.focus, weight: 1 }] : []),
      ...heldNow.map(h => ({ id: h.id, weight: h.a })),
      ...sources(world, tick)
    ];
    let { activation, index } = computeActivation(world, { tick, sources: baseSources });
    st.locus = settleLocus(world, st.locus, activation);
    world.focusWeb(st.locus.web);
    const view = buildView(world, st.locus, activation, { tick });

    const extra = extras(world, st.locus);
    const sections = () => ({
      system: promptSpace.system,
      wm: [renderHeld(world), extra].filter(Boolean).join('\n'),
      view: renderView(view),
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
      writes: st.writes,
      release: (id) => letGo(world, id, tick, 6),
      scratch: (text) => scratchThought(world, text, tick),
      promote: (id, web) => promote(world, id, web),
      ...(typeof extendCtx === 'function' ? await extendCtx(world, tick) : extendCtx)
    };

    // ── CHOOSE ────────────────────────────────────────────────────────────
    const menu = buildMenu(moves, ctx, { recent: st.recent, shown: st.shown, tick });
    st.notice = '';
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
          result = { ok: false, summary: `${item.move.id}: left the blank empty`, touched: [], wrote: false };
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
    if (result.locus) st.locus = { ...st.locus, ...result.locus };

    // ── REMEMBER ──────────────────────────────────────────────────────────
    const touched = (result.touched || []).filter(id => world.proto(id));
    for (const id of touched) { recordUse(world, id, tick); hold(world, id, tick); }
    if (st.locus.focus && world.proto(st.locus.focus)) { recordUse(world, st.locus.focus, tick); hold(world, st.locus.focus, tick); }
    associate(world, [...touched, ...held(world).slice(0, 3).map(h => h.id)], tick);
    let episode = null;
    if (result.ok && result.wrote) {
      st.writes = [...st.writes, { tick, move: commandLine ? commandLine.split(' ')[0] : (item?.move.id || null), touched }].slice(-RECENT_SIZE);
      episode = await writeEpisode(world, { tick, summary: result.summary, touched, episodeTypeId: episodeType(world) });
    }

    // ── THINK ─────────────────────────────────────────────────────────────
    ({ activation } = computeActivation(world, { tick, sources: baseSources }));
    const thinkView = buildView(world, settleLocus(world, st.locus, activation), activation, { tick });
    const thoughtCall = await mind.fill({
      ...sections(),
      view: renderView(thinkView),
      notice: `You just ${result.ok ? result.summary : `tried, but ${result.summary}`}.`,
      question: promptSpace.questions.thought,
      maxWords: 30
    });
    const thought = thoughtCall.text;
    // A thought that repeats the last one is not rehearsed again: fed back
    // verbatim, a repeated thought becomes an attractor. On its first v2 run a
    // 4B model spent ten cycles restating one image of "breath stitching
    // silence", each version seeding the next.
    const repeating = thought && st.loop.some(prev => thoughtSimilarity(thought, prev) > 0.6);
    if (thought && !repeating) st.loop = [...st.loop, thought].slice(-LOOP_SIZE);
    if (repeating) st.notice = [st.notice, 'You keep coming back to the same thought. Look at something else, or do something with it.'].filter(Boolean).join('\n');

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
  return { tick: st.tick, locus: st.locus, loop: st.loop, recent: st.recent, missing: st.missing, shown: st.shown, writes: st.writes };
}

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
