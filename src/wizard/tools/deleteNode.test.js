/**
 * Tests for deleteNode tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deleteNode } from './deleteNode.js';
import queueManager from '../../services/queue/Queue.js';

vi.mock('../../services/queue/Queue.js', () => ({
  default: {
    enqueue: vi.fn(() => 'mock-goal-id'),
    dequeue: vi.fn(),
    getQueue: vi.fn(() => ({ items: [], inflight: new Map(), byId: new Map() }))
  }
}));

describe('deleteNode', () => {
  const mockEnsureSchedulerStarted = vi.fn();
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues delete_node_instance task with correct args', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await deleteNode(
      { nodeId: 'inst-1' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(queueManager.enqueue).toHaveBeenCalledWith('goalQueue', expect.objectContaining({
      goal: 'delete_node',
      dag: expect.objectContaining({
        tasks: [expect.objectContaining({
          toolName: 'delete_node_instance',
          args: {
            instance_id: 'inst-1',
            graph_id: 'graph-1'
          }
        })]
      })
    }));

    expect(result).toEqual({
      deleted: true,
      goalId: 'mock-goal-id'
    });
  });

  it('throws error when nodeId is missing', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      deleteNode({}, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('nodeId is required');
  });

  it('throws error when no active graph', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      deleteNode({ nodeId: 'inst-1' }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('No active graph');
  });

  it('calls ensureSchedulerStarted callback', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await deleteNode(
      { nodeId: 'inst-1' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(mockEnsureSchedulerStarted).toHaveBeenCalledTimes(1);
  });
});

