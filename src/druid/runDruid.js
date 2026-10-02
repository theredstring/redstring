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
 *   4. COMPACT. If the reply carries a <working_memory> note — asked for or
 *      not — it becomes the new system prompt and the history is cleared: a new
 *      epoch. If the context passed its threshold, the next cycle asks for one.
 *
 * Dependencies are injected so the loop can run against a scripted model in a
 * test and against the headless store + a local server in scripts/druid.mjs.
 */

import { estimateTokens } from '../wizard/tokenEstimate.js';
import { buildMemoryIndex, recall, wander, tokenize } from './recall.js';
import {
  extractWorkingMemory,
  compactionDue,
  noteOverBudget,
  clipNote,
  fallbackWorkingMemory,
  DEFAULT_COMPACT_AT,
  DEFAULT_HISTORY_CAP
} from './workingMemory.js';
import {
  buildDruidSystemPrompt,
  composeCycleMessage,
  composeCompactionMessage,
  echoForHistory
} from './druidPrompt.js';

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
  let contextFill = 0;
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
          if (ok && !e.result.cancelled) applyToolResult(e.name, e.result, e.id);
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
    contextFill = contextWindow > 0 ? promptTokens / contextWindow : 0;

    // ── 3 & 4. Feed back, compact ──────────────────────────────────────────
    const { memory, thought, truncated } = extractWorkingMemory(text);
    let compaction = null;

    if (memory) {
      const reason = pending || 'chosen';
      let note = memory;
      let clipped = false;
      if (noteOverBudget(note, contextWindow)) {
        if (pending === 'oversized') { note = clipNote(note, contextWindow); clipped = true; }
      }
      workingMemory = note;
      history = [];
      epoch++;
      compaction = { reason, memory: note, truncated, clipped };
      if (!clipped && noteOverBudget(note, contextWindow)) {
        pending = 'oversized';
        attempts = 0;
      } else {
        pending = null;
        attempts = 0;
        if (clipped) notice = 'Your last note was clipped to fit its budget; the end of it was lost.';
      }
      contextFill = 0;
    } else if (pending) {
      attempts++;
      if (attempts >= 2) {
        workingMemory = fallbackWorkingMemory(workingMemory, history, thought, contextWindow);
        history = [];
        epoch++;
        compaction = { reason: pending, memory: workingMemory, fallback: true };
        pending = null;
        attempts = 0;
        contextFill = 0;
      }
    }

    if (!compaction && !pending) {
      history.push(
        { role: 'user', content: echoForHistory({ cycle, surfaced }) },
        { role: 'assistant', content: `${thought || '(acted without words)'}${ranDigest(toolCalls)}` }
      );
    }

    const repeating = thoughtSimilarity(thought, lastThought) > 0.8;
    const acted = toolCalls.some(t => t.ok);
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
      toolCalls: toolCalls.map(({ name, target, ok }) => ({ name, target, ok })),
      promptTokens,
      contextFill,
      endReason,
      error,
      compaction,
      compactionDue: pending,
      snapshot: { cycle, epoch, workingMemory, lastThought, history }
    };

    if (pauseMs > 0) await sleep(pauseMs);
  }

  yield { type: 'stopped', reason: 'max_cycles' };
}

export default runDruid;
