/**
 * Tests for createNode tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createNode } from './createNode.js';
import queueManager from '../../services/queue/Queue.js';

vi.mock('../../services/queue/Queue.js', () => ({
  default: {
    enqueue: vi.fn(() => 'mock-goal-id'),
    dequeue: vi.fn(),
    getQueue: vi.fn(() => ({ items: [], inflight: new Map(), byId: new Map() }))
  }
}));

describe('createNode', () => {
  const mockEnsureSchedulerStarted = vi.fn();
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues create_node task with correct args', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [{ id: 'graph-1', name: 'Test Graph' }],
      nodePrototypes: []
    };

    const result = await createNode(
      { name: 'Test Node', color: '#FF0000', description: 'A test node' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(queueManager.enqueue).toHaveBeenCalledWith('goalQueue', expect.objectContaining({
      type: 'goal',
      goal: 'create_node',
      threadId: mockCid,
      partitionKey: mockCid,
      dag: expect.objectContaining({
        tasks: [expect.objectContaining({
          toolName: 'create_node',
          threadId: mockCid,
          args: {
            name: 'Test Node',
            graph_id: 'graph-1',
            color: '#FF0000',
            description: 'A test node'
          }
        })]
      })
    }));

    expect(result).toEqual({
      nodeId: 'pending',
      name: 'Test Node',
      goalId: 'mock-goal-id'
    });
  });

  it('uses default color when not provided', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await createNode(
      { name: 'Test Node' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(queueManager.enqueue).toHaveBeenCalledWith('goalQueue', expect.objectContaining({
      dag: expect.objectContaining({
        tasks: [expect.objectContaining({
          args: expect.objectContaining({
            color: '#5B6CFF'
          })
        })]
      })
    }));
  });

  it('uses empty description when not provided', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await createNode(
      { name: 'Test Node' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(queueManager.enqueue).toHaveBeenCalledWith('goalQueue', expect.objectContaining({
      dag: expect.objectContaining({
        tasks: [expect.objectContaining({
          args: expect.objectContaining({
            description: ''
          })
        })]
      })
    }));
  });

  it('throws error when name is missing', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createNode({}, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('name is required');
  });

  it('throws error when no active graph', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createNode({ name: 'Test Node' }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('No active graph');
  });

  it('calls ensureSchedulerStarted callback', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await createNode(
      { name: 'Test Node' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(mockEnsureSchedulerStarted).toHaveBeenCalledTimes(1);
  });

  it('handles missing ensureSchedulerStarted gracefully', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createNode({ name: 'Test Node' }, graphState, mockCid, null)
    ).resolves.toBeDefined();
  });

  it('handles empty graphs array', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await createNode(
      { name: 'Test Node' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result).toBeDefined();
    expect(result.goalId).toBe('mock-goal-id');
  });
});

