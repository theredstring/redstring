/**
 * Tests for AgentLoop Loop Detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runAgent } from './AgentLoop.js';
import { streamLLM } from './LLMClient.js';
import { executeTool } from './tools/index.js';
import fs from 'fs';

// Mock dependencies
vi.mock('./LLMClient.js', () => ({
  streamLLM: vi.fn(),
  callLLM: vi.fn(),
}));

vi.mock('./ContextBuilder.js', () => ({
  buildContext: vi.fn(() => 'Mock context'),
  buildPersistentContextHeader: vi.fn(() => 'Mock context'),
  buildPlanContext: vi.fn(() => ''),
}));

vi.mock('./tools/index.js', () => ({
  executeTool: vi.fn(),
  getToolDefinitions: vi.fn(() => [
    { name: 'createNode', description: 'Create a node' }
  ])
}));

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(() => 'Mock System Prompt')
  }
}));

describe('AgentLoop Loop Detection', () => {
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
  });

  it('does NOT trigger loop detection for the same tool with different arguments after 2 iterations', async () => {
    let iteration = 0;
    streamLLM.mockImplementation(async function* () {
      if (iteration === 0) {
        yield { type: 'tool_call', name: 'createNode', args: { name: 'Node A' }, id: 'call-1' };
      } else if (iteration === 1) {
          // Same tool, different arg
        yield { type: 'tool_call', name: 'createNode', args: { name: 'Node B' }, id: 'call-2' };
      } else {
        yield { type: 'text', content: 'Finished' };
      }
      iteration++;
    });

    executeTool.mockResolvedValue({ action: 'createNode', name: 'Success' });

    const events = [];
    for await (const event of runAgent('Create nodes', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
      events.push(event);
    }

    // Verify it didn't stop with loop_detected
    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent.reason).not.toBe('loop_detected');
    expect(events.filter(e => e.type === 'tool_call').length).toBe(2);
  });

  it('triggers loop detection if the EXACT same tool AND args repeat 3 times', async () => {
    let iteration = 0;
    streamLLM.mockImplementation(async function* () {
      // Return the exact same tool call every time
      yield { type: 'tool_call', name: 'createNode', args: { name: 'Same Node' }, id: `call-${iteration}` };
      iteration++;
    });

    executeTool.mockResolvedValue({ action: 'createNode', name: 'Success' });

    const events = [];
    for await (const event of runAgent('Repeat same', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
      events.push(event);
      if (events.length > 50) break; // Safety
    }

    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent.reason).toBe('loop_detected');
    expect(doneEvent.iterations).toBe(3); // Stopped at iteration 3 (loop detected after 3 iterations)
    
    const responseEvent = events.find(e => e.content?.includes('repeating the exact same actions'));
    expect(responseEvent).toBeDefined();
  });

  it('does NOT trigger loop detection if same tool AND args repeat only twice', async () => {
    let iteration = 0;
    streamLLM.mockImplementation(async function* () {
      if (iteration < 2) {
        yield { type: 'tool_call', name: 'createNode', args: { name: 'Two Times' }, id: `call-${iteration}` };
      } else {
        yield { type: 'text', content: 'Stop now' };
      }
      iteration++;
    });

    executeTool.mockResolvedValue({ action: 'createNode', name: 'Success' });

    const events = [];
    for await (const event of runAgent('Repeat twice', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
      events.push(event);
    }

    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent.reason).not.toBe('loop_detected');
    expect(events.filter(e => e.type === 'tool_call').length).toBe(2);
  });
});

describe('AgentLoop Plan-Churn Detection & Cap', () => {
  const mockGraphState = {
    activeGraphId: 'graph-1',
    graphs: [{ id: 'graph-1', name: 'Test Graph' }],
    nodePrototypes: []
  };
  const mockConfig = { provider: 'openrouter', apiKey: 'test-key', maxIterations: 6 };
  const mockEnsureSchedulerStarted = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('locks planTask after 2 consecutive planTask-only iterations (churn)', async () => {
    let iteration = 0;
    streamLLM.mockImplementation(async function* () {
      // Always re-plan, never build. Vary args so exact-repeat detection can't catch it —
      // this is exactly the churn pattern the exact-repeat detector is blind to.
      yield { type: 'tool_call', name: 'planTask', args: { steps: [{ description: `step ${iteration}`, status: 'pending' }] }, id: `call-${iteration}` };
      iteration++;
    });
    executeTool.mockImplementation(async (name, args) => {
      if (name === 'planTask') return { action: 'planTask', steps: args.steps };
      return { action: name };
    });

    const events = [];
    for await (const event of runAgent('map GTA locations', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
      events.push(event);
      if (events.length > 100) break;
    }

    // Once locked, planTask returns a locked result WITHOUT modifying the plan.
    const lockedResults = events.filter(e => e.type === 'tool_result' && e.result?.locked === true);
    expect(lockedResults.length).toBeGreaterThan(0);
  });

  it('caps planTask at 3 executed calls per turn (hard cap, no churn)', async () => {
    let iteration = 0;
    streamLLM.mockImplementation(async function* () {
      // planTask PLUS a real mutation each iteration → churn never triggers
      // (a mutating tool ran), but the hard cap still fires on the 4th planTask.
      yield { type: 'tool_call', name: 'planTask', args: { steps: [{ description: `s${iteration}`, status: 'pending' }] }, id: `plan-${iteration}` };
      yield { type: 'tool_call', name: 'createNode', args: { name: `Node ${iteration}` }, id: `node-${iteration}` };
      iteration++;
    });
    executeTool.mockImplementation(async (name, args) => {
      if (name === 'planTask') return { action: 'planTask', steps: args.steps };
      return { action: name, name: args?.name };
    });

    const events = [];
    for await (const event of runAgent('build it', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
      events.push(event);
      if (events.length > 200) break;
    }

    const planResults = events.filter(e => e.type === 'tool_result' && e.name === 'planTask');
    const executed = planResults.filter(e => e.result?.action === 'planTask');
    const locked = planResults.filter(e => e.result?.locked === true);
    expect(executed.length).toBe(3);
    expect(locked.length).toBeGreaterThan(0);
    // createNode keeps running — the cap only affects planTask
    const nodeResults = events.filter(e => e.type === 'tool_result' && e.name === 'createNode');
    expect(nodeResults.length).toBeGreaterThan(3);
  });
});
