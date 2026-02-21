/**
 * Tests for AgentLoop
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runAgent } from './AgentLoop.js';
import { streamLLM } from './LLMClient.js';
import { buildContext } from './ContextBuilder.js';
import { executeTool, getToolDefinitions } from './tools/index.js';
import fs from 'fs';

// Mock dependencies
vi.mock('./LLMClient.js', () => ({
  streamLLM: vi.fn()
}));

vi.mock('./ContextBuilder.js', () => ({
  buildContext: vi.fn(() => 'Mock context')
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
        { type: 'done', iterations: 1 }
      ]);

      expect(executeTool).not.toHaveBeenCalled();
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
      // Mock LLM always calling tools (infinite loop scenario)
      streamLLM.mockImplementation(async function* () {
        yield {
          type: 'tool_call',
          name: 'createNode',
          args: { name: 'Test Node' },
          id: `call-${Date.now()}`
        };
      });

      executeTool.mockResolvedValue({ nodeId: 'node-1', goalId: 'goal-1' });

      const events = [];
      for await (const event of runAgent('Create nodes', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
        // Stop after reasonable number to avoid infinite test
        if (events.length > 50) break;
      }

      // Should eventually hit max iterations
      const maxIterationEvent = events.find(e =>
        e.type === 'response' && e.content.includes('maximum iterations')
      );
      expect(maxIterationEvent).toBeDefined();

      const doneEvent = events[events.length - 1];
      expect(doneEvent.type).toBe('done');
      expect(doneEvent.iterations).toBe(10);
    });
  });


  describe('context building', () => {
    it('includes context in system prompt', async () => {
      buildContext.mockReturnValue('Mock context string');

      streamLLM.mockImplementation(async function* () {
        yield { type: 'text', content: 'Hello' };
      });

      const events = [];
      for await (const event of runAgent('Hello', mockGraphState, mockConfig, mockEnsureSchedulerStarted)) {
        events.push(event);
      }

      expect(buildContext).toHaveBeenCalledWith(mockGraphState);
      expect(streamLLM).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('Mock context string')
          })
        ]),
        expect.any(Array),
        mockConfig
      );
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
        { type: 'done', iterations: 1 }
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
