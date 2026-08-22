import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/wizard/AgentLoop.js', () => ({ runAgent: vi.fn() }));

import { runAgent } from '../../src/wizard/AgentLoop.js';
import { runWizardInProcess, isAbortError } from '../../src/wizard/runWizardInProcess.js';

/**
 * The runner replaces an SSE round-trip. wizard-server wrote generator events to
 * the wire verbatim and added two things of its own — the `_tabularData` splice
 * and a trailing `done` — so those two are the whole contract worth pinning.
 */

const drain = async (gen) => {
  const out = [];
  for await (const e of gen) out.push(e);
  return out;
};

const yields = (...events) => async function* () { for (const e of events) yield e; };

const baseArgs = { message: 'hi', graphState: {}, apiKey: 'k' };

beforeEach(() => { vi.clearAllMocks(); });

describe('runWizardInProcess', () => {
  it('passes agent events through untouched and appends a final done', async () => {
    runAgent.mockImplementation(yields(
      { type: 'response', content: 'hello' },
      { type: 'tool_call', name: 'readGraph' }
    ));

    const events = await drain(runWizardInProcess(baseArgs));
    expect(events).toEqual([
      { type: 'response', content: 'hello' },
      { type: 'tool_call', name: 'readGraph' },
      { type: 'done' }
    ]);
  });

  it('emits done even when the agent yields nothing', async () => {
    runAgent.mockImplementation(yields());
    expect(await drain(runWizardInProcess(baseArgs))).toEqual([{ type: 'done' }]);
  });

  it('staples tabularData onto graphState, where tools read it', async () => {
    runAgent.mockImplementation(yields());
    const graphState = { activeGraphId: 'g1' };
    const tabularData = [{ filename: 'a.csv', rows: [] }];

    await drain(runWizardInProcess({ ...baseArgs, graphState, tabularData }));

    expect(runAgent).toHaveBeenCalled();
    expect(runAgent.mock.calls[0][1]._tabularData).toBe(tabularData);
  });

  it('leaves graphState alone when there is no tabular data', async () => {
    runAgent.mockImplementation(yields());
    await drain(runWizardInProcess({ ...baseArgs, tabularData: [] }));
    expect(runAgent.mock.calls[0][1]._tabularData).toBeUndefined();
  });

  it('builds the clamped config and forwards the abort signal', async () => {
    runAgent.mockImplementation(yields());
    const controller = new AbortController();

    await drain(runWizardInProcess({
      ...baseArgs,
      apiConfig: { provider: 'anthropic', model: 'claude-x', modelTier: 'large' },
      cid: 'cid-1',
      signal: controller.signal
    }));

    const [, , config, , signal] = runAgent.mock.calls[0];
    expect(config).toMatchObject({
      apiKey: 'k',
      provider: 'anthropic',
      model: 'claude-x',
      cid: 'cid-1',
      maxIterations: 77,
      maxAskTokens: 500000
    });
    expect(signal).toBe(controller.signal);
  });

  it('tolerates a null apiConfig — the shape when no provider is set up', async () => {
    runAgent.mockImplementation(yields());
    await drain(runWizardInProcess({ ...baseArgs, apiConfig: null }));
    expect(runAgent.mock.calls[0][2].provider).toBe('openrouter');
  });

  it('rejects without an api key or a message, before reaching the agent', async () => {
    await expect(drain(runWizardInProcess({ message: 'hi' }))).rejects.toThrow(/API key/);
    await expect(drain(runWizardInProcess({ apiKey: 'k' }))).rejects.toThrow(/Message/);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('lets errors propagate rather than converting them to events', async () => {
    // The caller's abort branch is what removes an empty bubble on stop;
    // swallowing the throw into a `done` event would strand it.
    runAgent.mockImplementation(async function* () {
      yield { type: 'response', content: 'partial' };
      throw new Error('Request aborted');
    });

    const gen = runWizardInProcess(baseArgs);
    expect(await gen.next()).toMatchObject({ value: { type: 'response' } });
    await expect(gen.next()).rejects.toThrow('Request aborted');
  });
});

describe('isAbortError', () => {
  it('recognises both shapes the loop aborts with', () => {
    const named = new Error('whatever');
    named.name = 'AbortError';
    expect(isAbortError(named)).toBe(true);
    expect(isAbortError(new Error('Request aborted by user'))).toBe(true);
    expect(isAbortError(new Error('Aborted'))).toBe(true);
  });

  it('does not swallow real failures', () => {
    expect(isAbortError(new Error('401 Unauthorized'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
