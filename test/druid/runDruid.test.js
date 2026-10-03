// @vitest-environment node
/**
 * The loop's contract, with a scripted turn in place of the model.
 *
 * `turn(fn)` builds a runTurn that answers each cycle with fn(call) — the text
 * it says and the events it emits — and records what the loop handed it.
 */
import { describe, it, expect } from 'vitest';
import { runDruid, thoughtSimilarity } from '../../src/druid/runDruid.js';

const emptyState = () => ({ graphs: new Map(), nodePrototypes: new Map(), edges: new Map() });

function turn(script) {
  const calls = [];
  const runTurn = async function* (args) {
    calls.push(args);
    const r = script(calls.length - 1, args) || {};
    for (const e of r.events || []) yield e;
    if (r.promptTokens) yield { type: 'usage', promptTokens: r.promptTokens };
    if (r.text) yield { type: 'response', content: r.text };
    if (r.throws) throw new Error(r.throws);
    yield { type: 'done', reason: 'model_done' };
  };
  return { runTurn, calls };
}

async function run(script, opts = {}, deps = {}) {
  const t = turn(script);
  const applied = [];
  const records = [];
  for await (const r of runDruid({
    runTurn: t.runTurn,
    getState: deps.getState || emptyState,
    applyToolResult: (name, result) => { applied.push({ name, result }); deps.applyToolResult?.(name, result); }
  }, { sleep: async () => {}, rng: () => 0, ...opts })) {
    records.push(r);
  }
  return { calls: t.calls, applied, records, cycles: records.filter(r => r.type === 'cycle') };
}

describe('runDruid — the feedback loop', () => {
  it('feeds each thought back as the next cycle\'s input, with no person in between', async () => {
    const { calls, cycles } = await run(i => ({ text: `thought number ${i + 1}`, promptTokens: 1000 }), { maxCycles: 3, seed: 'rivers' });
    expect(calls[0].message).toMatch(/You have just begun\. Your graph is empty/);
    expect(calls[0].message).toMatch(/You woke with this on your mind:\nrivers/);
    expect(calls[1].message).toMatch(/Your last thought:\nthought number 1/);
    expect(calls[2].message).toMatch(/Your last thought:\nthought number 2/);
    expect(cycles.map(c => c.thought)).toEqual(['thought number 1', 'thought number 2', 'thought number 3']);
  });

  /** A store with one web whose applier really adds Things — unless told to drop them. */
  const liveStore = ({ drop = false } = {}) => {
    const state = { graphs: new Map([['g', { id: 'g', name: 'Water', instances: new Map(), edgeIds: [] }]]), nodePrototypes: new Map(), edges: new Map() };
    return {
      getState: () => state,
      applyToolResult: (name, result) => {
        if (drop || name !== 'createNode') return;
        const id = `p-${result.name}`;
        state.nodePrototypes.set(id, { id, name: result.name });
        state.graphs.get(result.graphId).instances.set(`i-${result.name}`, { id: `i-${result.name}`, prototypeId: id });
      }
    };
  };
  const writeRiver = (i) => i === 0 ? {
    text: 'Wrote it down.',
    promptTokens: 1000,
    events: [
      { type: 'tool_call', id: 't1', name: 'createNode', args: { name: 'River' } },
      { type: 'tool_result', id: 't1', name: 'createNode', result: { action: 'createNode', graphId: 'g', name: 'River' } },
      { type: 'tool_call', id: 't2', name: 'search', args: { query: 'nothing' } },
      { type: 'tool_result', id: 't2', name: 'search', result: { error: 'no match' } }
    ]
  } : { text: 'next', promptTokens: 1000 };

  it('applies tool results to the store as they arrive, and remembers what it ran', async () => {
    const { applied, calls, cycles } = await run(writeRiver, { maxCycles: 2 }, liveStore());
    expect(applied).toEqual([{ name: 'createNode', result: { action: 'createNode', graphId: 'g', name: 'River' } }]);
    expect(calls[1].history.at(-1).content).toBe('Wrote it down.\n[ran: createNode(River), search(nothing) FAILED]');
    expect(cycles[0].toolCalls[0]).toEqual({ name: 'createNode', target: 'River', ok: true });
  });

  it('treats a write the store never received as a failure, and says so', async () => {
    const { calls, cycles } = await run(writeRiver, { maxCycles: 2 }, liveStore({ drop: true }));
    expect(cycles[0].toolCalls[0]).toEqual({ name: 'createNode', target: 'River', ok: false, unlanded: true });
    expect(calls[1].history.at(-1).content).toMatch(/createNode\(River\) FAILED/);
    expect(calls[1].message).toMatch(/createNode\(River\) reported success, but nothing changed in your graph: that write did not happen/);
  });

  it('carries the note in the system prompt and grows the history only at the end between rewrites', async () => {
    const { calls } = await run(() => ({ text: 'hm', promptTokens: 1000 }), { maxCycles: 3, resume: { workingMemory: 'Studying rivers.' } });
    for (const c of calls) expect(c.systemPrompt).toMatch(/## Your working memory\nStudying rivers\./);
    expect(calls[0].systemPrompt).toBe(calls[2].systemPrompt);
    expect(calls[1].history).toHaveLength(2);
    expect(calls[2].history.slice(0, 2)).toEqual(calls[1].history);
  });
});

describe('runDruid — self-authored compaction', () => {
  it('updates the note in place when the model volunteers one early', async () => {
    const { calls, cycles } = await run(i => i === 0
      ? { text: 'Noted.\n<working_memory>Rivers: started. Next, deltas.</working_memory>', promptTokens: 1000 }
      : { text: `t${i}`, promptTokens: 1000 }, { maxCycles: 2 });
    expect(cycles[0].compaction).toBeNull();
    expect(cycles[0].noteUpdated).toBe(true);
    expect(calls[1].systemPrompt).toMatch(/Rivers: started\. Next, deltas\./);
    expect(calls[1].history.at(-1).content).toBe('Noted.');
    expect(cycles[1].epoch).toBe(0);
  });

  it('clears the context when the model volunteers a note after a few cycles', async () => {
    const { calls, cycles } = await run(i => i === 2
      ? { text: 'Enough for now.\n<working_memory>Rivers: done. Next, deltas.</working_memory>', promptTokens: 1000 }
      : { text: `distinct thought ${'abcdef'[i]}`, promptTokens: 1000 }, { maxCycles: 4 });
    expect(cycles[2].compaction).toMatchObject({ reason: 'chosen', memory: 'Rivers: done. Next, deltas.' });
    expect(cycles[2].thought).toBe('Enough for now.');
    expect(calls[3].history).toEqual([]);
    expect(calls[3].systemPrompt).toMatch(/Rivers: done\. Next, deltas\./);
    expect(calls[3].message).toMatch(/\(context just cleared\)/);
    expect(cycles[3].epoch).toBe(1);
  });

  it('tells the Druid when its note names Things its graph does not hold', async () => {
    const p = (id, name) => [id, { id, name, description: '' }];
    const getState = () => ({
      nodePrototypes: new Map([p('a', 'Rock')]),
      graphs: new Map([['g', { id: 'g', name: 'Stones', instances: new Map([['ia', { id: 'ia', prototypeId: 'a' }]]), edgeIds: [] }]]),
      edges: new Map()
    });
    const { calls, cycles } = await run(i => i === 0
      ? { text: '<working_memory>The Rock is made of **Quartz** and **Feldspar**.</working_memory>', promptTokens: 1000 }
      : { text: 'next', promptTokens: 1000 }, { maxCycles: 2 }, { getState });
    expect(cycles[0].ungrounded).toEqual(['Quartz', 'Feldspar']);
    expect(calls[1].message).toMatch(/Your note names Quartz, Feldspar, but your graph holds no Thing by those names/);
  });

  it('reports a claim of having written something when nothing was written', async () => {
    const { calls, cycles } = await run(i => i === 0
      ? { text: 'I have successfully created the Time node and connected it.', promptTokens: 1000 }
      : { text: 'next', promptTokens: 1000 }, { maxCycles: 2 });
    expect(cycles[0].unbacked).toEqual(['Time']);
    expect(calls[1].message).toMatch(/You said you made or changed Time, but no tool ran last cycle/);
  });

  it('does not feed a recited tool list back as a thought', async () => {
    const { calls } = await run(i => i === 0
      ? { text: 'Start with rivers.\n<tools>\n{"type": "function", "function": {"name": "createNode"}}\n</tools>', promptTokens: 1000 }
      : { text: 'next', promptTokens: 1000 }, { maxCycles: 2 });
    expect(calls[1].message).toMatch(/Your last thought:\nStart with rivers\.\n\n/);
    expect(calls[1].message).not.toMatch(/"type": "function"/);
  });

  it('never takes a placeholder as a note', async () => {
    const { calls, cycles } = await run(i => i === 0
      ? { text: 'Hm.\n<working_memory>\n...\n</working_memory>', promptTokens: 1000 }
      : { text: 'next', promptTokens: 1000 }, { maxCycles: 2, resume: { workingMemory: 'The real note about rivers and deltas.' } });
    expect(cycles[0].placeholderNote).toBe(true);
    expect(cycles[0].noteUpdated).toBe(false);
    expect(calls[1].systemPrompt).toMatch(/The real note about rivers and deltas\./);
    expect(calls[1].message).toMatch(/placeholder, so your previous note was kept/);
  });

  it('keeps the context when the model rewrites its note without changing it', async () => {
    const note = 'The Mind holds Perception, Memory and Decision. Next: refine their descriptions.';
    const { calls, cycles } = await run(() => ({ text: `<working_memory>${note}</working_memory>`, promptTokens: 1000 }), { maxCycles: 3, resume: { workingMemory: note } });
    expect(cycles.every(c => !c.compaction && c.unchangedNote)).toBe(true);
    expect(cycles.at(-1).epoch).toBe(0);
    expect(calls[1].message).toMatch(/You rewrote your note without changing it/);
    expect(calls[2].history.map(m => m.content)).toContain('(rewrote the note, unchanged)');
    // A groove is idling: after enough of it, something drifts up.
    expect(cycles.every(c => c.compactionDue === null)).toBe(true);
  });

  it('asks for a note when the context crosses its threshold, and starts a new epoch from it', async () => {
    const { calls, cycles } = await run(i => {
      if (i === 0) return { text: 'filling up', promptTokens: 6000 };
      if (i === 1) return { text: '<working_memory>kept: the delta idea</working_memory>', promptTokens: 6100 };
      return { text: 'fresh start', promptTokens: 1500 };
    }, { maxCycles: 3, contextWindow: 8192, compactAt: 0.7 });
    expect(cycles[0].compactionDue).toBe('context');
    expect(calls[1].message).toMatch(/Your context is 73% full/);
    expect(calls[1].message).toMatch(/between the tags <working_memory> and <\/working_memory>/);
    expect(cycles[1].compaction).toMatchObject({ reason: 'context', memory: 'kept: the delta idea' });
    expect(calls[2].systemPrompt).toMatch(/kept: the delta idea/);
    expect(calls[2].history).toEqual([]);
    // The thought from before the rewrite still comes back: the note is what
    // survives the context, the last thought is what is on its mind.
    expect(calls[2].message).toMatch(/Your last thought:\nfilling up/);
  });

  it('asks once more, then writes a note for it, when the model never answers with one', async () => {
    const { calls, cycles } = await run(i => (i === 0
      ? { text: 'filling up', promptTokens: 7000 }
      : { text: 'I would rather not.', promptTokens: 7000 }), { maxCycles: 3, contextWindow: 8192, resume: { workingMemory: 'old note' } });
    expect(calls[2].message).toMatch(/last chance/);
    expect(cycles[2].compaction.fallback).toBe(true);
    expect(cycles[2].compaction.memory).toMatch(/^old note/);
    expect(cycles[2].compaction.memory).toMatch(/filling up/);
  });

  it('sends an oversized note back once, then clips it', async () => {
    const huge = 'river '.repeat(2000); // ~3000 tokens, over a quarter of 8192
    const { calls, cycles } = await run(() => ({ text: `<working_memory>${huge}</working_memory>`, promptTokens: 1000 }), { maxCycles: 3, contextWindow: 8192 });
    expect(cycles[0].compactionDue).toBe('oversized');
    expect(calls[1].message).toMatch(/too long to start from/);
    expect(cycles[1].compaction.clipped).toBe(true);
    expect(calls[2].message).toMatch(/clipped to fit its budget/);
  });

  it('compacts by history length before AgentLoop would drop turns on its own', async () => {
    const { cycles } = await run(i => ({ text: `distinct thought ${i} ${'abcdefghij'[i]}`, promptTokens: 500 }), { maxCycles: 3, historyCap: 4 });
    expect(cycles[1].compactionDue).toBe('history');
  });
});

describe('runDruid — recall and drift', () => {
  const state = () => {
    const p = (id, name, description) => [id, { id, name, description }];
    return {
      nodePrototypes: new Map([p('a', 'River', 'Moving water.'), p('b', 'Valley', 'Low land.'), p('c', 'Lighthouse', 'Warns ships.')]),
      graphs: new Map([['g', { id: 'g', name: 'Places', instances: new Map([['ia', { id: 'ia', prototypeId: 'a' }], ['ib', { id: 'ib', prototypeId: 'b' }], ['ic', { id: 'ic', prototypeId: 'c' }]]), edgeIds: ['e'] }]]),
      edges: new Map([['e', { id: 'e', sourceId: 'ia', destinationId: 'ib', name: 'carves' }]])
    };
  };

  it('surfaces memories associated with the last thought', async () => {
    const { calls } = await run(i => ({ text: i === 0 ? 'The River again.' : 'ok', promptTokens: 500 }), { maxCycles: 2 }, { getState: state });
    expect(calls[1].message).toMatch(/Surfacing from memory:\n- Valley — Low land\. \(carves — via River\)/);
  });

  it('lets one memory drift up at random after it has idled', async () => {
    const { cycles } = await run(() => ({ text: 'The River again.', promptTokens: 500 }), { maxCycles: 5, stagnationCycles: 2 }, { getState: state });
    expect(cycles.some(c => c.drifted && c.surfaced.some(m => m.via.startsWith('drifted up')))).toBe(true);
  });
});

describe('runDruid — failures', () => {
  it('retries a cycle the model never answered, and stops after repeated errors', async () => {
    const { records } = await run(() => ({ throws: 'connect ECONNREFUSED' }), { maxCycles: 10, maxConsecutiveErrors: 3 });
    expect(records.filter(r => r.failed)).toHaveLength(3);
    expect(records.at(-1)).toMatchObject({ type: 'stopped', reason: 'errors' });
  });

  it('stops cleanly on abort', async () => {
    const ac = new AbortController();
    ac.abort();
    const { records } = await run(() => ({ text: 'x' }), { signal: ac.signal });
    expect(records).toEqual([{ type: 'stopped', reason: 'aborted' }]);
  });
});

describe('thoughtSimilarity', () => {
  it('scores repeats high and new thoughts low', () => {
    expect(thoughtSimilarity('rivers carve valleys slowly', 'rivers carve valleys slowly')).toBe(1);
    expect(thoughtSimilarity('rivers carve valleys', 'lighthouses warn ships')).toBe(0);
  });
});
