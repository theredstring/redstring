// @vitest-environment node
/**
 * The Druid end to end, without a model running.
 *
 * Everything but the model is real: runDruid → runWizardInProcess → AgentLoop →
 * LLMClient's OpenAI-compatible stream parser (the wire a local server speaks)
 * → the Druid's tool policy → tools → toolResultApplier → the headless store.
 * The scripted model answers at the network boundary and checks what it was
 * sent, so this proves the three things the design rests on: a write lands in
 * long-term memory, a thought comes back as the next input, and a note the
 * model writes replaces its context.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';
import { installFakeProvider, transcriptProblems } from '../wizard/fakeProvider.js';

let useGraphStore;
let applyToolResultToStore;
let runWizardInProcess;
let runDruid;
let graphStateFromStore;
let provider;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  ({ applyToolResultToStore } = await import('../../src/services/toolResultApplier.js'));
  ({ runWizardInProcess } = await import('../../src/wizard/runWizardInProcess.js'));
  ({ runDruid } = await import('../../src/druid/runDruid.js'));
  ({ graphStateFromStore } = await import('../../src/druid/graphStateFromStore.js'));
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) vi.spyOn(console, k).mockImplementation(() => {});
});

afterEach(() => provider?.restore());

const apiConfig = {
  provider: 'local',
  endpoint: 'http://localhost:11434/v1/chat/completions',
  model: 'scripted',
  modelTier: 'small',
  settings: { maxIterationsLocal: 8 }
};

const textOf = (c) => (Array.isArray(c) ? c.map(b => b.text || '').join('') : String(c || ''));
/** The cycle message — not the graph snapshot AgentLoop appends after it. */
const lastUserText = (body) => textOf(body.messages.filter(m => m.role === 'user' && /\[cycle \d+/.test(textOf(m.content))).at(-1)?.content);
const systemText = (body) => body.messages.filter(m => m.role === 'system').map(m => (Array.isArray(m.content) ? m.content.map(b => b.text || '').join('') : m.content)).join('\n');

describe('the Druid over a local OpenAI-compatible server', () => {
  it('writes to its graph, hears its own thought back, and replaces its context with its own note', async () => {
    const seen = [];
    provider = installFakeProvider('openai', (i, body) => {
      seen.push(body);
      // Cycle 1: make a web, put two Things in it, connect them, then think.
      if (i === 0) return { tools: [{ id: 'c1', name: 'createGraph', args: { name: 'Rivers', description: 'Water that moves.' } }] };
      if (i === 1) return { tools: [
        { id: 'n1', name: 'createNode', args: { name: 'River', description: 'Moving water in a channel.' } },
        { id: 'n2', name: 'createNode', args: { name: 'Valley', description: 'Low land a river cuts.' } }
      ] };
      if (i === 2) return { tools: [{ id: 'e1', name: 'createEdge', args: { sourceId: 'River', targetId: 'Valley', type: 'carves' } }] };
      if (i === 3) return { text: 'Rivers carve valleys. I wonder what else moving water shapes.' };
      // Cycle 2: decide to clear its own head.
      if (i === 4) return { text: 'Clearing my head.\n<working_memory>\nThinking about the River. Next: deltas.\n</working_memory>' };
      // Cycle 3: a fresh epoch.
      return { text: 'Deltas, then.' };
    });

    const records = [];
    for await (const r of runDruid({
      runTurn: ({ message, history, systemPrompt, signal }) => runWizardInProcess({
        message,
        graphState: graphStateFromStore(useGraphStore.getState()),
        conversationHistory: history,
        apiKey: 'local',
        apiConfig,
        cid: 'druid',
        systemPrompt,
        toolPolicy: 'druid',
        signal
      }),
      getState: () => useGraphStore.getState(),
      applyToolResult: (name, result, id) => applyToolResultToStore(name, result, id, 'druid', { confirmed: true })
    }, { maxCycles: 3, contextWindow: 32768, seed: 'water', sleep: async () => {} })) {
      records.push(r);
    }

    const cycles = records.filter(r => r.type === 'cycle');
    expect(cycles).toHaveLength(3);
    expect(records.at(-1)).toEqual({ type: 'stopped', reason: 'max_cycles' });

    // Every request is a transcript a real server would accept.
    expect(seen.flatMap((b, i) => transcriptProblems('openai', b).map(p => `request ${i}: ${p}`))).toEqual([]);

    // The Druid's toolset, and nothing that waits on a person.
    const offered = seen[0].tools.map(t => t.function?.name || t.name);
    expect(offered).toEqual(expect.arrayContaining(['search', 'createNode', 'createEdge', 'mergeNodes']));
    expect(offered).not.toContain('askMultipleChoice');
    expect(offered).not.toContain('planTask');

    // Long-term memory: the writes are in the store.
    const st = useGraphStore.getState();
    const web = [...st.graphs.values()].find(g => g.name === 'Rivers');
    expect(web).toBeTruthy();
    const names = [...web.instances.values()].map(inst => st.nodePrototypes.get(inst.prototypeId)?.name);
    expect(names).toEqual(expect.arrayContaining(['River', 'Valley']));
    expect(web.edgeIds.length).toBe(1);

    // Feedback: cycle 2's input is cycle 1's thought.
    expect(lastUserText(seen[4])).toMatch(/Your last thought:\nRivers carve valleys/);
    expect(cycles[0].toolCalls.map(t => `${t.name}:${t.ok}`)).toEqual(['createGraph:true', 'createNode:true', 'createNode:true', 'createEdge:true']);

    // Compaction: the note it wrote is the system prompt of the next epoch,
    // and the conversation behind it is gone.
    expect(cycles[1].compaction).toMatchObject({ reason: 'chosen', memory: 'Thinking about the River. Next: deltas.' });
    expect(systemText(seen[5])).toMatch(/## Working memory\nThinking about the River\. Next: deltas\./);
    expect(seen[5].messages.filter(m => m.role === 'assistant' && /Rivers carve valleys/.test(String(m.content)))).toHaveLength(0);

    // Recall: the note names the River, so what is connected to it surfaces.
    expect(lastUserText(seen[5])).toMatch(/Surfacing from memory:\n- Valley — Low land a river cuts\. \(carves — via River\)/i);
    expect(lastUserText(seen[5])).toMatch(/\(context just cleared\)/);
  });
});
