// @vitest-environment node
/**
 * The wizard's benchmark and its recorder (src/wizard/lab/), with a scripted
 * model: a build is recorded call by call as the wizard made it, and measured
 * from the store after it.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';
import { installFakeProvider } from './fakeProvider.js';
import { assembleStream, recordCalls } from '../../src/wizard/lab/recorder.js';
import { snapshotOf, measureWizard, summarizeWizard } from '../../src/wizard/lab/bench.js';

let useGraphStore;
let applyToolResultToStore;
let runWizardInProcess;
let graphStateFromStore;
let provider;
let recorder;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  ({ applyToolResultToStore } = await import('../../src/services/toolResultApplier.js'));
  ({ runWizardInProcess } = await import('../../src/wizard/runWizardInProcess.js'));
  ({ graphStateFromStore } = await import('../../src/druid/graphStateFromStore.js'));
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) vi.spyOn(console, k).mockImplementation(() => {});
});

afterEach(() => { recorder?.restore(); provider?.restore(); });

const ENDPOINT = 'http://localhost:11434/v1/chat/completions'; // the local server the fake provider answers for

describe('recording the wizard\'s calls', () => {
  it('puts a streamed reply back together: text and tool calls', () => {
    const sse = [
      { choices: [{ index: 0, delta: { content: 'Build' } }] },
      { choices: [{ index: 0, delta: { content: 'ing.' } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'createGraph', arguments: '' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"name":' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Clock"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 900, completion_tokens: 20 } }
    ].map(j => `data: ${JSON.stringify(j)}\n\n`).join('') + 'data: [DONE]\n\n';
    const r = assembleStream(sse);
    expect(r.message).toEqual({ role: 'assistant', content: 'Building.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'createGraph', arguments: '{"name":"Clock"}' } }] });
    expect(r.finish).toBe('tool_calls');
    expect(r.usage.prompt_tokens).toBe(900);
  });

  it('records a build as the wizard made it, and measures what it left in the store', async () => {
    provider = installFakeProvider('openai', [
      { text: 'Building.', tools: [{ id: 'b1', name: 'createPopulatedGraph', args: {
        name: 'Clock',
        description: 'A machine that keeps time.',
        nodes: [{ name: 'Face', description: 'Where the time shows.' }, { name: 'Hands', description: 'They point to the time.' }, { name: 'Middle', description: 'The middle.' }],
        edges: [{ source: 'Hands', target: 'Face', type: 'Points to' }]
      } }] },
      { text: 'Built Clock: a face, hands that point to it.' }
    ]);
    const calls = [];
    recorder = recordCalls({ endpoint: ENDPOINT, onCall: (c) => calls.push(c) });

    useGraphStore.getState().clearUniverse();
    const before = snapshotOf(useGraphStore.getState());
    const events = [];
    for await (const e of runWizardInProcess({
      message: 'Make a web of Clock: its main parts, and how they connect.',
      graphState: graphStateFromStore(useGraphStore.getState()),
      conversationHistory: [],
      apiKey: 'local',
      apiConfig: { provider: 'local', endpoint: ENDPOINT, model: 'scripted', modelTier: 'large', settings: { maxIterationsLocal: 4 } },
      cid: 'bench-test'
    })) {
      events.push(e);
      if (e.type === 'tool_result' && e.result && !e.result.error) applyToolResultToStore(e.name, e.result, e.id, 'bench-test', { confirmed: true });
    }
    await new Promise(r => setTimeout(r, 20));

    // Recorded: what was sent, and the reply as the assistant message it was.
    expect(calls).toHaveLength(2);
    expect(calls[0].request.messages.some(m => m.role === 'system')).toBe(true);
    expect(calls[0].request.tools.length).toBeGreaterThan(0);
    expect(calls[0].message.tool_calls[0].function.name).toBe('createPopulatedGraph');
    expect(JSON.parse(calls[0].message.tool_calls[0].function.arguments).name).toBe('Clock');
    expect(calls[1].message.content).toContain('Built Clock');

    // Measured from the store: three Things, one of them a position the guardrails refuse.
    const m = measureWizard(useGraphStore.getState(), before, { subject: 'Clock', events, calls: calls.length });
    expect(m).toMatchObject({ things: 3, webs: 1, edges: 1, subjectWeb: true, dupes: 0, answered: true, error: null, calls: 2 });
    expect(m.connectedPct).toBe(67);
    expect(m.refused).toEqual(['Middle: a position or aspect, not a thing']);
    expect(summarizeWizard([{ metrics: m }])).toMatchObject({ requests: 1, thingsPerRun: 3, subjectWebPct: 100, refusedPerRun: 1, answeredPct: 100 });
  });
});
