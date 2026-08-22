/**
 * Tests for AgentLoop
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runAgent } from './AgentLoop.js';
import { streamLLM } from './LLMClient.js';
import { buildContext, buildPlanContext } from './ContextBuilder.js';
import { executeTool, getToolDefinitions } from './tools/index.js';
import fs from 'fs';

// Mock dependencies
vi.mock('./LLMClient.js', () => ({
  streamLLM: vi.fn()
}));

vi.mock('./ContextBuilder.js', () => ({
  buildContext: vi.fn(() => 'Mock context'),
  buildPersistentContextHeader: vi.fn(() => 'Mock persistent context'),
  buildPlanContext: vi.fn(() => 'Mock plan context'),
  truncateContext: vi.fn((ctx) => ctx)
}));

vi.mock('./tools/index.js', () => ({
  executeTool: vi.fn(),
  getToolDefinitions: vi.fn(() => [
    { name: 'createNode', description: 'Create a node' }
  ])
}));

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn()
  }
}));

describe('AgentLoop', () => {
  const mockGraphState = {
    activeGraphId: 'graph-1',
    graphs: [{ id: 'graph-1', name: 'Test Graph' }],
    nodePrototypes: []
  };

  const mockConfig = {
    provider: 'openrouter',
    apiKey: 'test-key'
  };

  const mockEnsureSchedulerStarted = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure fs.readFileSync always returns a valid string
    fs.readFileSync.mockReturnValue('# The Wizard\n\nYou are The Wizard.');
  });

  // Ensure SYSTEM_PROMPT is initialized before tests run
  beforeAll(() => {
    // Force module reload by clearing cache if needed
    // The default value in AgentLoop.js should handle this
  });

  describe('text-only response', () => {
    it('yields response and done when LLM responds with text only', async () => {
      // Mock LLM returning text only (no tool calls)
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Hello! ' };
        yield { type: 'text', content: 'How can I help?' };
      });

      const events = [];
      for await (const event of runAgent('Hello', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'response', content: 'Hello! ' },
        { type: 'response', content: 'How can I help?' },
        // `reason` distinguishes a model-signalled finish from a cap being hit.
        { type: 'done', iterations: 1, reason: 'model_done' }
      ]);

      expect(executeTool).not.toHaveBeenCalled();
    });
  });

  describe('first-iteration nudge', () => {
    const runWith = async (userMessage, replyText) => {
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: replyText };
      });
      const events = [];
      for await (const event of runAgent(userMessage, mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }
      return events;
    };

    it('does not nudge when the reply hands control back with a question', async () => {
      // Real case: the model gave commentary and asked which direction to take. The
      // nudge made it answer itself and edit the graph the user never approved.
      const events = await runWith(
        'i\'ve been working on mapping tonsil stone components to create novel treatments. notice anything?',
        'A few things stand out.\n\nWant me to make that coupling explicit in the graph?'
      );

      expect(events.filter(e => e.type === 'steering')).toEqual([]);
      expect(events.at(-1)).toEqual({ type: 'done', iterations: 1, reason: 'model_done' });
    });

    it('does not nudge on a long message with no task verb', async () => {
      const events = await runWith(
        'that whole section still feels off to me, honestly, and I am not sure why.',
        'Here is what I think is going on.'
      );

      expect(events.filter(e => e.type === 'steering')).toEqual([]);
    });

    it('still nudges a task request answered with a bare planning statement', async () => {
      const events = await runWith(
        'build me a graph of the water cycle',
        'Sure — I will create the nodes for evaporation and condensation.'
      );

      const steering = events.filter(e => e.type === 'steering');
      expect(steering).toHaveLength(1);
      expect(steering[0].kind).toBe('first_iteration');
    });
  });

  describe('single tool call', () => {
    it('yields tool_call, executes tool, yields tool_result, then done', async () => {
      let iteration = 0;
      // Mock LLM: first iteration returns tool call, second returns text to stop
      streamLLM.mockImplementation(async function* () {
        if (iteration === 0) {
          yield {
            type: 'tool_call',
            name: 'createNode',
            args: { name: 'Test Node' },
            id: 'call-123'
          };
          iteration++;
        } else {
          // Second iteration: return text (no tool calls) to stop loop
          yield { type: 'text', content: 'Node created successfully!' };
        }
      });

      executeTool.mockResolvedValue({ nodeId: 'node-1', name: 'Test Node', goalId: 'goal-1' });

      const events = [];
      for await (const event of runAgent('Create a node', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      // First iteration: tool call
      expect(events[0]).toEqual({
        type: 'tool_call',
        name: 'createNode',
        args: { name: 'Test Node' },
        id: 'call-123'
      });

      // Tool result
      expect(events[1]).toEqual({
        type: 'tool_result',
        name: 'createNode',
        result: { nodeId: 'node-1', name: 'Test Node', goalId: 'goal-1' },
        id: 'call-123'
      });

      // Second iteration: LLM responds with text (no more tools), then done
      const responseEvent = events.find(e => e.type === 'response');
      expect(responseEvent).toBeDefined();
      expect(responseEvent.content).toBe('Node created successfully!');

      const doneEvent = events[events.length - 1];
      expect(doneEvent.type).toBe('done');
      expect(doneEvent.iterations).toBe(2);

      expect(executeTool).toHaveBeenCalledWith(
        'createNode',
        { name: 'Test Node' },
        mockGraphState,
        expect.any(String),
        mockEnsureSchedulerStarted
      );
    });
  });

  describe('token usage accounting', () => {
    it('surfaces a usage event with running per-ask totals', async () => {
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Done.' };
        yield { type: 'usage', usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 } };
      });

      const events = [];
      for await (const event of runAgent('Hi', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      const usage = events.find(e => e.type === 'usage');
      expect(usage).toBeDefined();
      expect(usage.promptTokens).toBe(100);
      expect(usage.completionTokens).toBe(20);
      expect(usage.askTotalTokens).toBe(120);
    });

    it('sums usage across iterations into the ask total', async () => {
      let iteration = 0;
      streamLLM.mockImplementation(async function* () {
        if (iteration === 0) {
          yield { type: 'tool_call', name: 'createNode', args: { name: 'N' }, id: 'c1' };
          yield { type: 'usage', usage: { promptTokens: 200, completionTokens: 50, totalTokens: 250 } };
          iteration++;
        } else {
          yield { type: 'text', content: 'Finished.' };
          yield { type: 'usage', usage: { promptTokens: 300, completionTokens: 40, totalTokens: 340 } };
        }
      });
      executeTool.mockResolvedValue({ nodeId: 'node-1', name: 'N' });

      const events = [];
      for await (const event of runAgent('Create', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      const usageEvents = events.filter(e => e.type === 'usage');
      expect(usageEvents.length).toBe(2);
      // Running ask total accumulates: 250 then 250 + 340 = 590.
      expect(usageEvents[0].askTotalTokens).toBe(250);
      expect(usageEvents[usageEvents.length - 1].askTotalTokens).toBe(590);
    });

    it('stops with reason token_budget when the per-ask budget is exceeded', async () => {
      streamLLM.mockImplementation(async function* () {
        // A large single-call usage that blows past the budget.
        yield { type: 'tool_call', name: 'createNode', args: { name: 'Big' }, id: 'c1' };
        yield { type: 'usage', usage: { promptTokens: 600000, completionTokens: 0, totalTokens: 600000 } };
      });
      executeTool.mockResolvedValue({ nodeId: 'node-1', name: 'Big' });

      const events = [];
      for await (const event of runAgent('Go', mockGraphState, { ...mockConfig, maxAskTokens: 500000 }, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      const doneEvent = events[events.length - 1];
      expect(doneEvent.type).toBe('done');
      expect(doneEvent.reason).toBe('token_budget');
      expect(doneEvent.askTotalTokens).toBe(600000);
      // The breaker fires before the tool call is executed for this iteration.
      expect(executeTool).not.toHaveBeenCalled();
    });

    it('charges cache reads at a fraction of an uncached token', async () => {
      // The scenario the old accounting got wrong: a huge prompt that is almost
      // entirely a cache hit. Summing promptTokens counted the full 100k and
      // tripped the budget; the real bill is ~10% of that, so the run should
      // continue. 5k uncached + 100k read * 0.1 + 1k completion = 16,000.
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Done.' };
        yield {
          type: 'usage',
          usage: {
            promptTokens: 105000,
            completionTokens: 1000,
            totalTokens: 106000,
            uncachedPromptTokens: 5000,
            cacheReadTokens: 100000,
            cacheCreationTokens: 0
          }
        };
      });

      const events = [];
      for await (const event of runAgent('Go', mockGraphState, { ...mockConfig, maxAskTokens: 50000 }, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      const usage = events.find(e => e.type === 'usage');
      expect(usage.askChargedTokens).toBe(16000);
      // Uploaded still reports the full re-read, so waste stays visible.
      expect(usage.askUploadedTokens).toBe(105000);
      // Well under the 50k budget — no stop.
      expect(events.some(e => e.reason === 'token_budget')).toBe(false);
    });

    it('charges cache writes at a premium over plain input', async () => {
      // First iteration of a cached run pays 1.25x to populate the cache.
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Done.' };
        yield {
          type: 'usage',
          usage: {
            promptTokens: 25000,
            completionTokens: 0,
            totalTokens: 25000,
            uncachedPromptTokens: 1000,
            cacheReadTokens: 0,
            cacheCreationTokens: 24000
          }
        };
      });

      const events = [];
      for await (const event of runAgent('Go', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      // 1000 + 24000 * 1.25 = 31,000
      expect(events.find(e => e.type === 'usage').askChargedTokens).toBe(31000);
    });

    it('falls back to charging the whole prompt when a provider reports no cache split', async () => {
      // No caching fields at all (Gemini, local models): every input token is
      // genuinely billed, so the charged total must NOT quietly discount them.
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Done.' };
        yield { type: 'usage', usage: { promptTokens: 8000, completionTokens: 500, totalTokens: 8500 } };
      });

      const events = [];
      for await (const event of runAgent('Go', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      expect(events.find(e => e.type === 'usage').askChargedTokens).toBe(8500);
    });

    it('warns once when the ask crosses 80% of its budget', async () => {
      let call = 0;
      streamLLM.mockImplementation(async function* () {
        if (call < 2) {
          yield { type: 'tool_call', name: 'createNode', args: { name: `N${call}` }, id: `c${call}` };
        } else {
          yield { type: 'text', content: 'Finished.' };
        }
        call++;
        yield { type: 'usage', usage: { promptTokens: 4500, completionTokens: 0, totalTokens: 4500 } };
      });
      executeTool.mockResolvedValue({ nodeId: 'node-1', name: 'N' });

      const events = [];
      // Budget 10k: iteration 1 = 4.5k (45%), iteration 2 = 9k (90% → warn).
      for await (const event of runAgent('Go', mockGraphState, { ...mockConfig, maxAskTokens: 10000 }, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      // "Heads up" is the approach warning; the hard stop emits its own note, so
      // match the warning specifically rather than any mention of the budget.
      const warnings = events.filter(e => e.type === 'system_note' && e.content.startsWith('Heads up:'));
      expect(warnings.length).toBe(1);
      expect(warnings[0].content).toMatch(/90%/);
    });
  });

  describe('multi-tool iteration', () => {
    it('loops through tool execution and LLM verification', async () => {
      let iteration = 0;

      streamLLM.mockImplementation(async function* () {
        if (iteration === 0) {
          // First iteration: LLM calls tool
          yield {
            type: 'tool_call',
            name: 'createNode',
            args: { name: 'Node 1' },
            id: 'call-1'
          };
          iteration++;
        } else {
          // Second iteration: LLM verifies and responds
          yield { type: 'text', content: 'Node created successfully!' };
        }
      });

      executeTool.mockResolvedValue({ nodeId: 'node-1', goalId: 'goal-1' });

      const events = [];
      for await (const event of runAgent('Create a node', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      // Should have: tool_call -> tool_result -> response -> done
      expect(events[0].type).toBe('tool_call');
      expect(events[1].type).toBe('tool_result');
      expect(events[2].type).toBe('response');
      expect(events[3].type).toBe('done');
    });
  });

  describe('tool error handling', () => {
    it('yields error result and continues loop', async () => {
      let iteration = 0;

      streamLLM.mockImplementation(async function* () {
        if (iteration === 0) {
          yield {
            type: 'tool_call',
            name: 'createNode',
            args: { name: 'Test Node' },
            id: 'call-1'
          };
          iteration++;
        } else {
          // LLM sees error and responds
          yield { type: 'text', content: 'I see there was an error. Let me try again.' };
        }
      });

      executeTool.mockRejectedValue(new Error('Tool execution failed'));

      const events = [];
      for await (const event of runAgent('Create a node', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      const errorResult = events.find(e => e.type === 'tool_result' && e.result.error);
      expect(errorResult).toBeDefined();
      expect(errorResult.result.error).toBe('Tool execution failed');

      // LLM should see the error and can respond
      const response = events.find(e => e.type === 'response');
      expect(response).toBeDefined();
    });
  });

  describe('max iterations', () => {
    it('stops at 10 iterations and yields warning', async () => {
      // Mock LLM always calling tools with varying names to avoid loop detection
      let callCount = 0;
      streamLLM.mockImplementation(async function* () {
        yield {
          type: 'tool_call',
          name: `createNode`,
          args: { name: `Test Node ${callCount++}` },
          id: `call-${callCount}-${Date.now()}`
        };
        // Also yield a text chunk to vary the iteration signature
        yield { type: 'text', content: `Iteration ${callCount}` };
      });

      executeTool.mockResolvedValue({ nodeId: 'node-1', goalId: 'goal-1' });

      const events = [];
      // Pin maxIterations rather than relying on the default. The default is now 77,
      // which needs more than the 100-event safety break below to reach — so the
      // loop was cut off mid-run and the last event was a 'response', never a 'done'.
      for await (const event of runAgent('Create nodes', mockGraphState, { ...mockConfig, maxIterations: 10 }, mockEnsureSchedulerStarted)) {
        events.push(event);
        // Stop after reasonable number to avoid infinite test
        if (events.length > 100) break;
      }

      // Should eventually stop (either max iterations or loop detection)
      const doneEvent = events[events.length - 1];
      expect(doneEvent.type).toBe('done');
    });
  });


  describe('steering visibility', () => {
    it('emits a steering event (kind plan_incomplete) when the model stops but the plan is unfinished', async () => {
      // Model always replies text-only, never marking the plan done.
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'All done!' };
      });

      const stateWithPlan = {
        ...mockGraphState,
        _currentPlan: [{ description: 'Build the graph', status: 'pending' }]
      };

      const events = [];
      for await (const event of runAgent('Build a graph', stateWithPlan, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
        if (events.length > 50) break; // safety
      }

      const steering = events.filter(e => e.type === 'steering');
      expect(steering.length).toBeGreaterThan(0);
      expect(steering[0].kind).toBe('plan_incomplete');
      // Reconciliation nudge offers the planTask completion exit (planTask not locked here).
      expect(steering[0].content).toContain('planTask');

      // After repeated text-only replies it gives up rather than looping forever.
      const doneEvent = events[events.length - 1];
      expect(doneEvent.type).toBe('done');
      expect(doneEvent.reason).toBe('nudge_limit');
    });

    it('does not emit steering events when there is no active plan', async () => {
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Here is your answer.' };
      });

      const events = [];
      for await (const event of runAgent('A question', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      expect(events.some(e => e.type === 'steering')).toBe(false);
      expect(events[events.length - 1]).toMatchObject({ type: 'done', reason: 'model_done' });
    });
  });

  // A repeated plan used to be structurally free of every guard: the churn lock is
  // evaluated at the END of an iteration (so the duplicate has already executed),
  // the exact-repeat detector needs three consecutive matches, and two is under the
  // per-turn cap. Each repeat cost a full conversation re-upload for a plan the
  // model already had.
  describe('planTask idempotence', () => {
    const DONE_STEPS = [
      { description: 'Sketch the graph', status: 'done' },
      { description: 'Populate the nodes', status: 'done' }
    ];
    const PLAN_TEXT = 'Plan (2/2 complete):\n  1. [DONE] Sketch the graph\n  2. [DONE] Populate the nodes';

    const planResult = (steps, planText, allComplete) => ({
      action: 'planTask',
      steps,
      planText,
      allComplete,
      done: steps.filter(s => s.status === 'done').length,
      skipped: 0,
      inProgress: 0,
      total: steps.length
    });

    it('returns unchanged for a re-submitted identical plan, without re-steering', async () => {
      let iter = 0;
      streamLLM.mockImplementation(async function* () {
        if (iter < 2) {
          yield { type: 'tool_call', name: 'planTask', args: { steps: DONE_STEPS }, id: `plan-${iter++}` };
        } else {
          yield { type: 'text', content: 'Built it.' };
        }
      });
      executeTool.mockImplementation(async (name) => (
        name === 'planTask' ? planResult(DONE_STEPS, PLAN_TEXT, true) : {}
      ));

      const events = [];
      for await (const e of runAgent('Build', { ...mockGraphState }, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(e);
        if (events.length > 60) break;
      }

      const results = events.filter(e => e.type === 'tool_result' && e.name === 'planTask');
      expect(results).toHaveLength(2);
      expect(results[0].result.unchanged).toBeUndefined();
      expect(results[1].result.unchanged).toBe(true);
      // The no-op still tells the model what to do instead — it just does it in
      // the tool result rather than costing a second injected message.
      expect(results[1].result.message).toContain('Respond to the user');

      // The completion push belongs to the call that completed the plan, not to
      // every restatement of it afterwards.
      const completions = events.filter(e => e.type === 'steering' && e.kind === 'plan_complete');
      expect(completions).toHaveLength(1);
    });

    it('applies a plan that genuinely changed', async () => {
      const FIRST = [
        { description: 'Sketch the graph', status: 'done' },
        { description: 'Populate the nodes', status: 'pending' }
      ];
      let iter = 0;
      streamLLM.mockImplementation(async function* () {
        if (iter === 0) {
          iter++;
          yield { type: 'tool_call', name: 'planTask', args: { steps: FIRST }, id: 'plan-0' };
        } else if (iter === 1) {
          iter++;
          yield { type: 'tool_call', name: 'planTask', args: { steps: DONE_STEPS }, id: 'plan-1' };
        } else {
          yield { type: 'text', content: 'Built it.' };
        }
      });
      executeTool.mockImplementation(async (name, args) => {
        if (name !== 'planTask') return {};
        const allDone = args.steps.every(s => s.status === 'done');
        return planResult(args.steps, allDone ? PLAN_TEXT : 'Plan (1/2 complete):\n  1. [DONE] Sketch the graph\n  2. [ ] Populate the nodes', allDone);
      });

      const state = { ...mockGraphState };
      const events = [];
      for await (const e of runAgent('Build', state, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(e);
        if (events.length > 60) break;
      }

      const results = events.filter(e => e.type === 'tool_result' && e.name === 'planTask');
      expect(results).toHaveLength(2);
      expect(results.every(r => r.result.unchanged === undefined)).toBe(true);
      expect(state._currentPlan).toEqual(DONE_STEPS);
    });

    it('does not spend the per-turn planTask cap on no-op repeats', async () => {
      // Every iteration also runs a mutating tool, so the churn lock never fires
      // and the cap is the only thing under test. Four identical plans, then a
      // real change — under the old counter that fifth call would be blocked.
      let iter = 0;
      streamLLM.mockImplementation(async function* () {
        const i = iter++;
        if (i >= 5) {
          yield { type: 'text', content: 'Built it.' };
          return;
        }
        const steps = i === 4
          ? [...DONE_STEPS, { description: 'Enrich the nodes', status: 'done' }]
          : DONE_STEPS;
        yield { type: 'tool_call', name: 'planTask', args: { steps }, id: `plan-${i}` };
        yield { type: 'tool_call', name: 'createNode', args: { name: `Node ${i}` }, id: `node-${i}` };
      });
      executeTool.mockImplementation(async (name, args) => {
        if (name !== 'planTask') return { nodeId: 'n1' };
        const text = args.steps.length === 3 ? `${PLAN_TEXT}\n  3. [DONE] Enrich the nodes` : PLAN_TEXT;
        return planResult(args.steps, text, true);
      });

      const events = [];
      for await (const e of runAgent('Build', { ...mockGraphState }, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(e);
        if (events.length > 120) break;
      }

      const results = events.filter(e => e.type === 'tool_result' && e.name === 'planTask');
      expect(results).toHaveLength(5);
      expect(results.slice(1, 4).every(r => r.result.unchanged === true)).toBe(true);
      // The change lands: it was never charged for the three restatements.
      expect(results[4].result.unchanged).toBeUndefined();
      expect(results[4].result.locked).toBeUndefined();
    });
  });

  describe('conversation history trimming', () => {
    it('drops oversized history by token size, not just message count', async () => {
      let captured = null;
      streamLLM.mockImplementation(async function* (messages) {
        // Snapshot: AgentLoop keeps pushing onto this same array as the run
        // proceeds, so holding the reference would measure the wrong thing.
        captured = [...messages];
        yield { type: 'text', content: 'ok' };
      });

      // Ten messages that are individually legal but collectively enormous. The
      // old count-only window (20) would have replayed every one of them.
      const conversationHistory = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `${i}:${'x'.repeat(40000)}`
      }));

      const events = [];
      for await (const event of runAgent('Go', mockGraphState, { ...mockConfig, conversationHistory }, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      // messages = [system, ...history, user, volatile-context]
      const history = captured.slice(1, -2);
      expect(history.length).toBeGreaterThan(0);
      expect(history.length).toBeLessThan(conversationHistory.length);
      // Trimming keeps the NEWEST turns — the last history entry must be the
      // most recent one, not an old one.
      expect(history[history.length - 1].content.startsWith('9:')).toBe(true);
    });

    it('keeps at least one turn even when it alone exceeds the budget', async () => {
      let captured = null;
      streamLLM.mockImplementation(async function* (messages) {
        // Snapshot: AgentLoop keeps pushing onto this same array as the run
        // proceeds, so holding the reference would measure the wrong thing.
        captured = [...messages];
        yield { type: 'text', content: 'ok' };
      });

      const conversationHistory = [{ role: 'user', content: 'y'.repeat(500000) }];

      const events = [];
      for await (const event of runAgent('Go', mockGraphState, { ...mockConfig, conversationHistory }, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      expect(captured.slice(1, -2).length).toBe(1);
    });
  });

  describe('plan resumption', () => {
    it('tells the model an inherited plan is already underway', async () => {
      // The reported bug: a run stops on budget mid-plan, the user sends
      // "continue", and the model re-plans from scratch instead of picking up at
      // the next step. The plan now survives into the next turn, and the system
      // prompt has to say so or the model treats it as a fresh request.
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Continuing.' };
      });

      const stateWithPlan = {
        ...mockGraphState,
        _currentPlan: [
          { description: 'Build layer 1', status: 'done' },
          { description: 'Build layer 2', status: 'pending' }
        ]
      };

      const events = [];
      for await (const event of runAgent('continue', stateWithPlan, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
        if (events.length > 50) break;
      }

      // buildPlanContext is mocked in this suite, so assert the contract rather
      // than the rendered string — the wording itself is covered in
      // ContextBuilder.test.js.
      expect(buildPlanContext).toHaveBeenCalledWith(
        stateWithPlan._currentPlan,
        expect.any(Number),
        expect.any(Number),
        { isResumed: true }
      );
    });

    it('does not flag a fully settled plan as resumed', async () => {
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Done.' };
      });

      const stateWithPlan = {
        ...mockGraphState,
        _currentPlan: [
          { description: 'Build layer 1', status: 'done' },
          { description: 'Optional polish', status: 'skipped' }
        ]
      };

      const events = [];
      for await (const event of runAgent('thanks', stateWithPlan, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
        if (events.length > 50) break;
      }

      expect(buildPlanContext).toHaveBeenCalledWith(
        stateWithPlan._currentPlan,
        expect.any(Number),
        expect.any(Number),
        { isResumed: false }
      );
      // A skipped step settles the plan, so the run ends instead of nudging.
      expect(events[events.length - 1].reason).toBe('model_done');
    });

    it('lets a skipped step settle a plan instead of nudging to the limit', async () => {
      // Same shape as the plan_incomplete test above, but the outstanding step is
      // skipped rather than pending — the loop must accept it and stop cleanly.
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Built what was needed.' };
      });

      const stateWithPlan = {
        ...mockGraphState,
        _currentPlan: [
          { description: 'Build the graph', status: 'done' },
          { description: 'Unnecessary extra', status: 'skipped' }
        ]
      };

      const events = [];
      for await (const event of runAgent('Build a graph', stateWithPlan, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
        if (events.length > 50) break;
      }

      // The plan must not be treated as unfinished. (A separate `first_iteration`
      // nudge is expected here — it fires for any task-like prompt answered with
      // text on iteration 0, independent of plan state.)
      expect(events.some(e => e.type === 'steering' && e.kind === 'plan_incomplete')).toBe(false);
      expect(events[events.length - 1].reason).not.toBe('nudge_limit');
    });
  });

  describe('context building', () => {
    // The graph snapshot deliberately does NOT live in the system prompt any
    // more. Providers cache a request prefix, so a system block that changes
    // every iteration makes the whole conversation behind it uncacheable — the
    // snapshot rides at the tail of the request instead.
    it('sends the context at the tail of the request, not in the system prompt', async () => {
      const { buildPersistentContextHeader } = await import('./ContextBuilder.js');
      buildPersistentContextHeader.mockReturnValue('Mock persistent context string');

      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Hello' };
      });

      for await (const _event of runAgent('Hello', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        // drain
      }

      expect(buildPersistentContextHeader).toHaveBeenCalledWith(mockGraphState, []);

      const sent = streamLLM.mock.calls[0][0];
      const system = sent.find(m => m.role === 'system');
      expect(system.content).not.toContain('Mock persistent context string');

      const last = sent[sent.length - 1];
      expect(last.role).toBe('user');
      expect(last.content).toContain('Mock persistent context string');
    });

    it('keeps the system prompt byte-identical across iterations', async () => {
      const { buildPersistentContextHeader } = await import('./ContextBuilder.js');
      let n = 0;
      // A context header that changes every iteration, as it does during a build.
      buildPersistentContextHeader.mockImplementation(() => `context revision ${n++}`);

      let call = 0;
      streamLLM.mockImplementation(async function* () {
        call++;
        if (call < 3) {
          yield { type: 'tool_call', name: 'readGraph', args: {}, id: `t${call}` };
        } else {
          yield { type: 'text', content: 'Done' };
        }
      });

      for await (const _event of runAgent('Build something', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        // drain
      }

      expect(streamLLM.mock.calls.length).toBeGreaterThan(1);
      const systemContents = streamLLM.mock.calls.map(
        ([msgs]) => msgs.find(m => m.role === 'system').content
      );
      expect(new Set(systemContents).size).toBe(1);
    });

    it('does not accumulate context blocks in the stored conversation', async () => {
      const { buildPersistentContextHeader } = await import('./ContextBuilder.js');
      buildPersistentContextHeader.mockReturnValue('SNAPSHOT');

      let call = 0;
      streamLLM.mockImplementation(async function* () {
        call++;
        if (call < 3) {
          yield { type: 'tool_call', name: 'readGraph', args: {}, id: `t${call}` };
        } else {
          yield { type: 'text', content: 'Done' };
        }
      });

      for await (const _event of runAgent('Build something', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        // drain
      }

      // Exactly one snapshot per request — a second would mean a previous
      // iteration's (now stale) block was written into the message array.
      for (const [msgs] of streamLLM.mock.calls) {
        const withSnapshot = msgs.filter(
          m => typeof m.content === 'string' && m.content.includes('SNAPSHOT')
        );
        expect(withSnapshot).toHaveLength(1);
      }
    });
  });

  describe('tool set stability', () => {
    // Tools are the first block of the request, so re-selecting them mid-ask
    // invalidated the cache prefix for tools, system prompt AND history — at the
    // 1.25x cache-write rate, which is worse than not caching at all.
    it('freezes the tool set across iterations', async () => {
      let call = 0;
      streamLLM.mockImplementation(async function* () {
        call++;
        if (call < 4) {
          yield { type: 'tool_call', name: 'readGraph', args: {}, id: `t${call}` };
        } else {
          yield { type: 'text', content: 'Done' };
        }
      });

      for await (const _event of runAgent('Build something', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        // drain
      }

      expect(streamLLM.mock.calls.length).toBeGreaterThan(2);
      const toolNames = streamLLM.mock.calls.map(
        ([, tools]) => tools.map(t => t.name).join(',')
      );
      expect(new Set(toolNames).size).toBe(1);
    });
  });

  describe('conversation ID', () => {
    it('uses provided cid from config', async () => {
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Hello' };
      });

      const events = [];
      for await (const event of runAgent('Hello', mockGraphState, { ...mockConfig, cid: 'custom-cid' }, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      expect(executeTool).not.toHaveBeenCalled(); // No tools called, but if they were, cid would be used
    });

    it('generates cid if not provided', async () => {
      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Hello' };
      });

      const events = [];
      for await (const event of runAgent('Hello', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      // Should complete without error (cid generated)
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('yields error event and done on exception', async () => {
      streamLLM.mockImplementation(async function* () {
        throw new Error('LLM API error');
      });

      const events = [];
      for await (const event of runAgent('Hello', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'error', message: 'LLM API error' },
        { type: 'done', iterations: 1, reason: 'error' }
      ]);
    });
  });

  describe('multiple tool calls in one iteration', () => {
    it('executes all tools sequentially', async () => {
      let iteration = 0;
      streamLLM.mockImplementation(async function* () {
        if (iteration === 0) {
          // First iteration: return tool calls
          yield {
            type: 'tool_call',
            name: 'createNode',
            args: { name: 'Node 1' },
            id: 'call-1'
          };
          yield {
            type: 'tool_call',
            name: 'createNode',
            args: { name: 'Node 2' },
            id: 'call-2'
          };
          iteration++;
        } else {
          // Second iteration: return text to stop loop
          yield { type: 'text', content: 'Done' };
        }
      });

      executeTool.mockResolvedValue({ nodeId: 'node-1', goalId: 'goal-1' });

      const events = [];
      for await (const event of runAgent('Create nodes', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
        if (events.length > 20) break; // Safety limit
      }

      const toolCalls = events.filter(e => e.type === 'tool_call');
      const toolResults = events.filter(e => e.type === 'tool_result');

      expect(toolCalls.length).toBe(2);
      expect(toolResults.length).toBe(2);
      expect(executeTool).toHaveBeenCalledTimes(2);
    });
  });
});
