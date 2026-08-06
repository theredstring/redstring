/**
 * Regression pins for the "chip stuck on Running… forever" family.
 *
 * A tool_call event draws a chip in the panel; only a tool_result with the same
 * id clears it. Every path that ended a run between announcing a call and
 * executing it left that chip spinning on a finished run — no result coming, and
 * no stop button, because the run was already over. The observed case: the
 * per-ask token budget trips right after an iteration's calls are yielded but
 * before any of them run (seen live with expandGraph at 597k/500k tokens).
 *
 * The invariant these pin: every announced tool call id gets exactly one
 * tool_result, on every exit path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runAgent } from './AgentLoop.js';
import { streamLLM } from './LLMClient.js';
import { executeTool } from './tools/index.js';
import fs from 'fs';

vi.mock('./LLMClient.js', () => ({ streamLLM: vi.fn() }));

vi.mock('./ContextBuilder.js', () => ({
  buildContext: vi.fn(() => 'Mock context'),
  buildPersistentContextHeader: vi.fn(() => 'Mock persistent context'),
  buildPlanContext: vi.fn(() => 'Mock plan context'),
  truncateContext: vi.fn((ctx) => ctx)
}));

vi.mock('./tools/index.js', () => ({
  executeTool: vi.fn(),
  getToolDefinitions: vi.fn(() => [{ name: 'expandGraph', description: 'Expand a graph' }])
}));

vi.mock('fs', () => ({ default: { readFileSync: vi.fn() } }));

const graphState = () => ({
  activeGraphId: 'graph-1',
  graphs: [{ id: 'graph-1', name: 'Test Graph', instances: [] }],
  nodePrototypes: []
});

const config = (extra = {}) => ({ provider: 'openrouter', apiKey: 'test-key', ...extra });

const collect = async (gen) => {
  const events = [];
  for await (const e of gen) events.push(e);
  return events;
};

/**
 * One tool call on the first iteration, then a text wrap-up — otherwise the mock
 * replays the same call every iteration and the run only ends on loop detection.
 */
const oneCallThenWrapUp = (id) => {
  let called = false;
  return async function* () {
    if (called) {
      yield { type: 'text', content: 'Done.' };
      return;
    }
    called = true;
    yield { type: 'tool_call_start', id, name: 'expandGraph' };
    yield { type: 'tool_call', id, name: 'expandGraph', args: {} };
  };
};

/** Ids announced to the UI that never received a tool_result — the stuck chips. */
const unsettledToolCallIds = (events) => {
  const announced = new Map();
  const resolved = new Set();
  for (const e of events) {
    if (e.type === 'tool_call_start' || e.type === 'tool_call') announced.set(e.id, e.name);
    if (e.type === 'tool_result') resolved.add(e.id);
  }
  return [...announced.keys()].filter(id => !resolved.has(id));
};

describe('tool call settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.readFileSync.mockReturnValue('# The Wizard\n\nYou are The Wizard.');
  });

  it('settles a call announced right before the per-ask token budget stops the run', async () => {
    // Exactly the observed shape: the model emits a tool call, then the usage
    // chunk for that iteration puts the ask over budget. The loop returns before
    // the execution block, so nothing else can ever answer this call.
    streamLLM.mockImplementation(async function* () {
      yield { type: 'tool_call_start', id: 'call-1', name: 'expandGraph' };
      yield { type: 'tool_call', id: 'call-1', name: 'expandGraph', args: { nodes: [] } };
      yield { type: 'usage', usage: { promptTokens: 600000, completionTokens: 1000, totalTokens: 601000 } };
    });

    const events = await collect(
      runAgent('build something', graphState(), config({ maxAskTokens: 500000 }), vi.fn())
    );

    expect(unsettledToolCallIds(events)).toEqual([]);
    const result = events.find(e => e.type === 'tool_result' && e.id === 'call-1');
    expect(result.result.cancelled).toBe(true);
    expect(result.result.reason).toBe('token budget reached');
    expect(result.name).toBe('expandGraph');
    // The chip has to settle before the run reports done, or the UI paints the
    // terminal state and then never revisits it.
    expect(events.indexOf(result)).toBeLessThan(events.findIndex(e => e.type === 'done'));
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('settles the calls left in the queue when a stop lands mid-list', async () => {
    const controller = new AbortController();
    streamLLM.mockImplementation(async function* () {
      for (const id of ['call-1', 'call-2', 'call-3']) {
        yield { type: 'tool_call_start', id, name: 'expandGraph' };
        yield { type: 'tool_call', id, name: 'expandGraph', args: {} };
      }
    });
    // The user hits Stop while the first tool is running.
    executeTool.mockImplementation(async () => {
      controller.abort();
      return { action: 'expandGraph', nodeCount: 1 };
    });

    const events = await collect(
      runAgent('build something', graphState(), config(), vi.fn(), controller.signal)
    );

    expect(unsettledToolCallIds(events)).toEqual([]);
    expect(executeTool).toHaveBeenCalledTimes(1);
    const cancelled = events.filter(e => e.type === 'tool_result' && e.result?.cancelled);
    expect(cancelled.map(e => e.id)).toEqual(['call-2', 'call-3']);
    expect(cancelled[0].result.reason).toBe('run stopped');
  });

  it('settles a call whose arguments never finished streaming', async () => {
    // tool_call_start drew the chip; the stream died before the final tool_call,
    // so the call never reaches the execution loop at all.
    streamLLM.mockImplementation(async function* () {
      yield { type: 'tool_call_start', id: 'call-1', name: 'expandGraph' };
      yield { type: 'text', content: 'Never mind, here is some prose instead.' };
    });

    const events = await collect(runAgent('hi', graphState(), config(), vi.fn()));

    expect(unsettledToolCallIds(events)).toEqual([]);
    expect(events.find(e => e.type === 'tool_result').result.cancelled).toBe(true);
  });

  it('settles pending calls when the iteration throws', async () => {
    streamLLM.mockImplementation(async function* () {
      yield { type: 'tool_call_start', id: 'call-1', name: 'expandGraph' };
      yield { type: 'tool_call', id: 'call-1', name: 'expandGraph', args: {} };
      throw new Error('provider exploded');
    });

    const events = await collect(runAgent('build', graphState(), config(), vi.fn()));

    expect(unsettledToolCallIds(events)).toEqual([]);
    expect(events.some(e => e.type === 'error')).toBe(true);
  });

  it('does not double-settle a call that executed normally', async () => {
    streamLLM.mockImplementation(oneCallThenWrapUp('call-1'));
    executeTool.mockResolvedValue({ action: 'expandGraph', nodeCount: 3 });

    const events = await collect(runAgent('build', graphState(), config(), vi.fn()));

    const results = events.filter(e => e.type === 'tool_result' && e.id === 'call-1');
    expect(results).toHaveLength(1);
    expect(results[0].result.cancelled).toBeUndefined();
    expect(results[0].result.nodeCount).toBe(3);
  });

  it('settles a failed tool once, as a failure rather than a cancellation', async () => {
    streamLLM.mockImplementation(oneCallThenWrapUp('call-1'));
    executeTool.mockRejectedValue(new Error('graph not found'));

    const events = await collect(runAgent('build', graphState(), config(), vi.fn()));

    const results = events.filter(e => e.type === 'tool_result' && e.id === 'call-1');
    expect(results).toHaveLength(1);
    expect(results[0].result.error).toBe('graph not found');
    expect(results[0].result.cancelled).toBeUndefined();
  });
});
