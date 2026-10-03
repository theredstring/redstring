/**
 * runDruid — the Druid's loop. No person in it.
 *
 * Each cycle:
 *
 *   1. RECALL. The graph is indexed and the working memory + last thought are
 *      used as a cue; what is associated with them surfaces (recall.js). If the
 *      Druid has been idle or repeating itself, one memory drifts up at random.
 *   2. THINK. One wizard turn runs (the real AgentLoop and tools) with the note
 *      as the system prompt, the epoch's earlier cycles as history, and the
 *      cycle message as the "user" turn. Tool results are applied to the store
 *      as they arrive, so writes land in long-term memory immediately.
 *   3. FEED BACK. The final text becomes the next cycle's input. That is the
 *      whole feedback loop: output is input, and the graph is the only thing
 *      that accumulates.
 *   4. COMPACT. A <working_memory> note in the reply becomes the new system
 *      prompt. If the loop asked for it, or the epoch has run a few cycles, the
 *      history is cleared too: a new epoch. If the context passed its
 *      threshold, the next cycle asks for one.
 *
 * Dependencies are injected so the loop can run against a scripted model in a
 * test and against the headless store + a local server in scripts/druid.mjs.
 */

import { estimateTokens } from '../wizard/tokenEstimate.js';
import { buildMemoryIndex, recall, wander, tokenize, ungroundedNames } from './recall.js';
import { writeLanded } from './verifyWrite.js';
import {
  extractWorkingMemory,
  isMeaningfulNote,
  cleanThought,
  compactionDue,
  noteOverBudget,
  clipNote,
  fallbackWorkingMemory,
  DEFAULT_COMPACT_AT,
  DEFAULT_HISTORY_CAP,
  MIN_EPOCH_CYCLES
} from './workingMemory.js';
import {
  buildDruidSystemPrompt,
  composeCycleMessage,
  composeCompactionMessage,
  echoForHistory
} from './druidPrompt.js';

/** Words with which a thought claims to have written to the graph. */
const CLAIM = /\b(created|added|made|built|established|connected|linked|wrote|recorded|stored|defined)\b/i;

/** Cycles a surfaced memory stays damped, so recall does not hand back the same few every time. */
const HABITUATION_CYCLES = 3;

/** Word overlap between two thoughts, 0..1. */
export function thoughtSimilarity(a, b) {
  const x = new Set(tokenize(a));
  const y = new Set(tokenize(b));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / Math.min(x.size, y.size);
}

const sizeOf = (index) => {
  const webs = new Set();
  for (const n of index.nodes.values()) for (const w of n.webs) webs.add(w);
  return { things: index.nodes.size, webs: webs.size };
};

const ranDigest = (toolCalls) => (toolCalls.length === 0 ? '' : `\n[ran: ${toolCalls
  .map(t => `${t.name}${t.target ? `(${t.target})` : ''}${t.ok ? '' : ' FAILED'}`)
  .join(', ')}]`);

const defaultSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {Object}   deps
 * @param {Function} deps.runTurn          async* ({ message, history, systemPrompt, signal }) → wizard events
 * @param {Function} deps.getState         () → graph store state
 * @param {Function} deps.applyToolResult  (name, result, id) → void
 * @param {Function} [deps.onEvent]        each wizard event, for live display
 * @param {Object}   [opts]
 * @param {Object}   [opts.resume]         { cycle, epoch, workingMemory, lastThought, history }
 * @param {string}   [opts.seed]           a starting impulse for a fresh mind
 * @param {number}   [opts.contextWindow]  the local server's window, in tokens
 * @param {number}   [opts.compactAt]
 * @param {number}   [opts.historyCap]
 * @param {number}   [opts.minEpochCycles] cycles before a voluntary note also clears the context
 * @param {number}   [opts.overheadTokens] tool schemas + graph header, for when the server reports no usage
 * @param {number}   [opts.maxCycles]
 * @param {number}   [opts.stagnationCycles]
 * @param {number}   [opts.recallK]
 * @param {number}   [opts.pauseMs]        between cycles
 * @param {number}   [opts.maxConsecutiveErrors]
 * @param {Function} [opts.rng]
 * @param {Function} [opts.sleep]
 * @param {AbortSignal} [opts.signal]
 *
 * @yields {Object} one `{ type: 'cycle', ... }` record per cycle, then `{ type: 'stopped', reason }`
 */
export async function* runDruid({ runTurn, getState, applyToolResult, onEvent }, {
  resume = {},
  seed = '',
  contextWindow = 8192,
  compactAt = DEFAULT_COMPACT_AT,
  historyCap = DEFAULT_HISTORY_CAP,
  minEpochCycles = MIN_EPOCH_CYCLES,
  overheadTokens = 3000,
  maxCycles = Infinity,
  stagnationCycles = 3,
  recallK = 6,
  pauseMs = 0,
  maxConsecutiveErrors = 5,
  rng = Math.random,
  sleep = defaultSleep,
  signal = null
} = {}) {
  let cycle = resume.cycle || 0;
  let epoch = resume.epoch || 0;
  let workingMemory = resume.workingMemory || '';
  let lastThought = resume.lastThought || '';
  let history = Array.isArray(resume.history) ? [...resume.history] : [];

  let pending = null;          // why a rewrite is due, if it is
  let attempts = 0;            // asks for the current rewrite
  let contextFill = history.length === 0 && workingMemory ? null : 0;
  let idle = 0;
  let errors = 0;
  let notice = '';
  const recent = [];           // ids surfaced, per cycle, newest last
  const startedAt = cycle;

  while (cycle - startedAt < maxCycles) {
    if (signal?.aborted) { yield { type: 'stopped', reason: 'aborted' }; return; }
    cycle++;

    // ── 1. Recall ──────────────────────────────────────────────────────────
    const index = buildMemoryIndex(getState());
    const habituated = new Set(recent.flat());
    let surfaced = [];
    let drifted = false;
    if (!pending) {
      surfaced = recall(index, `${workingMemory}\n${lastThought}\n${lastThought ? '' : seed}`, { k: recallK, habituated });
      if (idle >= stagnationCycles || (surfaced.length === 0 && lastThought)) {
        const w = wander(index, rng, new Set([...habituated, ...surfaced.map(m => m.id)]));
        if (w) { surfaced.push(w); drifted = true; }
        idle = 0;
      }
    }
    recent.push(surfaced.map(m => m.id));
    if (recent.length > HABITUATION_CYCLES) recent.shift();

    const message = pending
      ? composeCompactionMessage({ cycle, epoch, reason: pending, contextFill, attempt: attempts + 1 })
      : composeCycleMessage({ cycle, epoch, lastThought, surfaced, contextFill, size: sizeOf(index), seed: lastThought ? '' : seed, note: notice });
    notice = '';
    const systemPrompt = buildDruidSystemPrompt(workingMemory);

    // ── 2. Think ───────────────────────────────────────────────────────────
    let text = '';
    let promptTokens = 0;
    let endReason = null;
    let error = null;
    const toolCalls = [];
    try {
      for await (const e of runTurn({ message, history: [...history], systemPrompt, signal })) {
        onEvent?.(e);
        if (e.type === 'response') text += e.content || '';
        else if (e.type === 'usage') promptTokens = Math.max(promptTokens, e.promptTokens || 0);
        else if (e.type === 'tool_call') {
          const a = e.args || {};
          toolCalls.push({ id: e.id, name: e.name, target: a.name || a.query || a.graphName || a.nodeName || '', ok: false });
        } else if (e.type === 'tool_result') {
          const ok = !!e.result && !e.result.error && !e.result.locked;
          const call = toolCalls.find(t => t.id === e.id) || (toolCalls.push({ id: e.id, name: e.name, target: '', ok }), toolCalls[toolCalls.length - 1]);
          call.ok = ok;
          if (ok && !e.result.cancelled) {
            applyToolResult(e.name, e.result, e.id);
            // The store, not the tool's word, says whether it happened.
            if (writeLanded(e.name, e.result, getState()) === false) {
              call.ok = false;
              call.unlanded = true;
            }
          }
        } else if (e.type === 'error') error = e.message;
        else if (e.type === 'done' && e.reason) endReason = e.reason;
      }
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') { yield { type: 'stopped', reason: 'aborted' }; return; }
      error = err?.message || String(err);
    }

    if (error && !text.trim() && toolCalls.length === 0) {
      errors++;
      cycle--; // a cycle the model never answered is retried, not counted
      yield { type: 'cycle', cycle: cycle + 1, epoch, error, failed: true };
      if (errors >= maxConsecutiveErrors) { yield { type: 'stopped', reason: 'errors', error }; return; }
      await sleep(Math.min(60000, 2000 * 2 ** (errors - 1)));
      continue;
    }
    errors = 0;

    if (!promptTokens) {
      promptTokens = overheadTokens + estimateTokens(systemPrompt) + estimateTokens(message)
        + history.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    }
    const measuredFill = contextWindow > 0 ? promptTokens / contextWindow : 0;
    contextFill = measuredFill;

    // ── 3 & 4. Feed back, compact ──────────────────────────────────────────
    const { memory: written, thought: rawThought, truncated } = extractWorkingMemory(text);
    const thought = cleanThought(rawThought);

    // Three kinds of note are not taken as a new working memory:
    //   - a placeholder: a 4B model copied the prompt's "..." template and
    //     wiped its own memory with it;
    //   - an unchanged one: once it had compacted, a 4B model did nothing but
    //     re-emit the same note for three cycles, each one clearing the context
    //     it would have needed to get out of the groove;
    //   - (see below) an early one does replace the note, but does not clear
    //     the context.
    const placeholder = !!written && !isMeaningfulNote(written);
    const unchangedNote = !!written && !placeholder && !pending && !!workingMemory
      && thoughtSimilarity(written, workingMemory) >= 0.9;
    const memory = placeholder || unchangedNote ? null : written;
    if (placeholder) notice = 'Your last note was empty or a placeholder, so your previous note was kept.';
    else if (unchangedNote) notice = 'You rewrote your note without changing it. Update it when what you need to carry has changed.';

    let compaction = null;
    let noteUpdated = false;
    let ungrounded = [];

    if (memory) {
      // A note written early updates working memory in place; the context is
      // cleared only when the loop asked for the note or the epoch has run a
      // few cycles. A 4B model told it could rewrite "whenever it chose" wrote
      // a note every single cycle — nine epochs in ten cycles — so the context
      // never held more than one cycle and the history was never used.
      const clears = !!pending || history.length / 2 >= minEpochCycles;
      let note = memory;
      let clipped = false;
      if (pending === 'oversized' && noteOverBudget(note, contextWindow)) {
        note = clipNote(note, contextWindow);
        clipped = true;
      }
      workingMemory = note;
      if (clears) {
        compaction = { reason: pending || 'chosen', memory: note, truncated, clipped };
        history = [];
        epoch++;
        contextFill = null;
      } else {
        noteUpdated = true;
      }
      attempts = 0;
      if (!clipped && noteOverBudget(note, contextWindow)) {
        pending = 'oversized';
      } else {
        pending = null;
        if (clipped) notice = 'Your last note was clipped to fit its budget; the end of it was lost.';
      }
      const missing = ungroundedNames(buildMemoryIndex(getState()), note);
      if (missing.length > 0) {
        ungrounded = missing;
        notice = [notice, `Your note names ${missing.join(', ')}, but your graph holds no Thing by ${missing.length === 1 ? 'that name' : 'those names'}. If ${missing.length === 1 ? 'it matters' : 'they matter'}, write ${missing.length === 1 ? 'it' : 'them'} in; the note alone will not keep ${missing.length === 1 ? 'it' : 'them'}.`].filter(Boolean).join('\n');
      }
    } else if (pending) {
      attempts++;
      if (attempts >= 2) {
        workingMemory = fallbackWorkingMemory(workingMemory, history, thought, contextWindow);
        history = [];
        epoch++;
        compaction = { reason: pending, memory: workingMemory, fallback: true };
        pending = null;
        attempts = 0;
        contextFill = null;
      }
    }

    if (!compaction && !pending) {
      const said = thought
        || (noteUpdated ? '(updated the note)' : unchangedNote ? '(rewrote the note, unchanged)' : '(acted without words)');
      history.push(
        { role: 'user', content: echoForHistory({ cycle, surfaced }) },
        { role: 'assistant', content: `${said}${ranDigest(toolCalls)}` }
      );
    }

    const repeating = unchangedNote || thoughtSimilarity(thought, lastThought) > 0.8;
    const acted = toolCalls.some(t => t.ok);

    // Saying is not doing. On its third run a 4B model spent five cycles
    // reporting "I have successfully created the Time node", then Space, then
    // Matter, with no tool call in any of them; its graph held one Thing. A
    // claim of having written something, in a cycle where nothing was written,
    // is checked against the graph and the gap is reported back.
    const unlanded = toolCalls.filter(t => t.unlanded).map(t => `${t.name}${t.target ? `(${t.target})` : ''}`);
    if (unlanded.length > 0) {
      notice = [notice, `${unlanded.join(', ')} reported success, but nothing changed in your graph: ${unlanded.length === 1 ? 'that write' : 'those writes'} did not happen.`].filter(Boolean).join('\n');
    }

    let unbacked = [];
    if (!acted && CLAIM.test(thought)) {
      unbacked = ungroundedNames(buildMemoryIndex(getState()), thought);
      if (unbacked.length > 0) {
        notice = [notice, `You said you made or changed ${unbacked.join(', ')}, but no tool ran last cycle and your graph holds no Thing by ${unbacked.length === 1 ? 'that name' : 'those names'}. Only a tool call writes to your graph.`].filter(Boolean).join('\n');
      }
    }
    idle = (!acted || repeating) ? idle + 1 : 0;
    if (thought) lastThought = thought;

    if (!pending && !compaction) {
      pending = compactionDue({ promptTokens, contextWindow, compactAt, historyLength: history.length, historyCap });
    }

    yield {
      type: 'cycle',
      cycle,
      epoch,
      message,
      thought,
      surfaced,
      drifted,
      toolCalls: toolCalls.map(({ name, target, ok, unlanded: dropped }) => ({ name, target, ok, ...(dropped ? { unlanded: true } : {}) })),
      // What the store holds after this cycle — compared against the saved
      // file, it shows whether persistence kept up.
      memorySize: sizeOf(buildMemoryIndex(getState())),
      promptTokens,
      contextFill: measuredFill,
      endReason,
      error,
      compaction,
      noteUpdated,
      unchangedNote,
      placeholderNote: placeholder,
      ungrounded,
      unbacked,
      compactionDue: pending,
      snapshot: { cycle, epoch, workingMemory, lastThought, history }
    };

    if (pauseMs > 0) await sleep(pauseMs);
  }

  yield { type: 'stopped', reason: 'max_cycles' };
}

export default runDruid;
