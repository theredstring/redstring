/**
 * Tests for tool registry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeTool, getToolDefinitions } from './index.js';
import { createNode } from './createNode.js';
import { createGraph } from './createGraph.js';

vi.mock('./createNode.js', () => ({
  createNode: vi.fn()
}));

vi.mock('./createGraph.js', () => ({
  createGraph: vi.fn()
}));

describe('Tool Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getToolDefinitions', () => {
    it('returns array of tool definitions', () => {
      const tools = getToolDefinitions();
      
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('includes createNode tool definition', () => {
      const tools = getToolDefinitions();
      const createNodeTool = tools.find(t => t.name === 'createNode');
      
      expect(createNodeTool).toBeDefined();
      expect(createNodeTool.description).toBeDefined();
      expect(createNodeTool.parameters).toBeDefined();
    });

    it('includes all expected tools', () => {
      const tools = getToolDefinitions();
      const toolNames = tools.map(t => t.name);
      
      const expectedTools = [
        'createNode',
        'updateNode',
        'deleteNode',
        'createEdge',
        'deleteEdge',
        'searchNodes',
        'getNodeContext',
        'createGraph',
        'expandGraph',
        'createPopulatedGraph'
      ];
      
      for (const expected of expectedTools) {
        expect(toolNames).toContain(expected);
      }
    });
  });

  describe('executeTool', () => {
    it('calls the correct tool function', async () => {
      const mockGraphState = { graphs: [], nodePrototypes: [] };
      const mockCid = 'test-cid';
      const mockEnsureSchedulerStarted = vi.fn();

      createNode.mockResolvedValue({ nodeId: 'node-1', goalId: 'goal-1' });

      await executeTool(
        'createNode',
        { name: 'Test Node' },
        mockGraphState,
        mockCid,
        mockEnsureSchedulerStarted
      );

      expect(createNode).toHaveBeenCalledWith(
        { name: 'Test Node' },
        mockGraphState,
        mockCid,
        mockEnsureSchedulerStarted
      );
    });

    it('throws error for unknown tool', async () => {
      const mockGraphState = { graphs: [], nodePrototypes: [] };

      await expect(
        executeTool('unknownTool', {}, mockGraphState, 'cid', vi.fn())
      ).rejects.toThrow('Unknown tool: unknownTool');
    });

    it('passes all arguments correctly', async () => {
      const mockGraphState = { graphs: [], nodePrototypes: [] };
      const mockCid = 'test-cid-123';
      const mockEnsureSchedulerStarted = vi.fn();

      createGraph.mockResolvedValue({ graphId: 'graph-1', goalId: 'goal-1' });

      await executeTool(
        'createGraph',
        { name: 'Test Graph' },
        mockGraphState,
        mockCid,
        mockEnsureSchedulerStarted
      );

      expect(createGraph).toHaveBeenCalledWith(
        { name: 'Test Graph' },
        mockGraphState,
        mockCid,
        mockEnsureSchedulerStarted
      );
    });
  });
});
