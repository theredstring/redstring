/**
 * Tests for deleteEdge tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deleteEdge } from './deleteEdge.js';
import queueManager from '../../services/queue/Queue.js';

vi.mock('../../services/queue/Queue.js', () => ({
  default: {
    enqueue: vi.fn(() => 'mock-goal-id'),
    dequeue: vi.fn(),
    getQueue: vi.fn(() => ({ items: [], inflight: new Map(), byId: new Map() }))
  }
}));

describe('deleteEdge', () => {
  const mockEnsureSchedulerStarted = vi.fn();
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues delete_edge task with correct args', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await deleteEdge(
      { edgeId: 'edge-1' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(queueManager.enqueue).toHaveBeenCalledWith('goalQueue', expect.objectContaining({
      goal: 'delete_edge',
      dag: expect.objectContaining({
        tasks: [expect.objectContaining({
          toolName: 'delete_edge',
          args: {
            edge_id: 'edge-1',
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

  it('throws error when edgeId is missing', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      deleteEdge({}, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('edgeId is required');
  });

  it('throws error when no active graph', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      deleteEdge({ edgeId: 'edge-1' }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('No active graph');
  });

  it('calls ensureSchedulerStarted callback', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await deleteEdge(
      { edgeId: 'edge-1' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(mockEnsureSchedulerStarted).toHaveBeenCalledTimes(1);
  });
});

