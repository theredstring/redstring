/**
 * Tests for createEdge tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEdge } from './createEdge.js';
import queueManager from '../../services/queue/Queue.js';

vi.mock('../../services/queue/Queue.js', () => ({
  default: {
    enqueue: vi.fn(() => 'mock-goal-id'),
    dequeue: vi.fn(),
    getQueue: vi.fn(() => ({ items: [], inflight: new Map(), byId: new Map() }))
  }
}));

describe('createEdge', () => {
  const mockEnsureSchedulerStarted = vi.fn();
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues create_edge task with correct args', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await createEdge(
      { sourceId: 'inst-1', targetId: 'inst-2', type: 'connects' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(queueManager.enqueue).toHaveBeenCalledWith('goalQueue', expect.objectContaining({
      goal: 'create_edge',
      dag: expect.objectContaining({
        tasks: [expect.objectContaining({
          toolName: 'create_edge',
          args: expect.objectContaining({
            source_instance_id: 'inst-1',
            target_instance_id: 'inst-2',
            graph_id: 'graph-1',
            name: 'connects',
            description: '',
            directionality: { arrowsToward: ['inst-2'] },
            definitionNode: {
              name: 'connects',
              color: '#708090',
              description: ''
            }
          })
        })]
      })
    }));

    expect(result).toEqual({
      edgeId: 'pending',
      source: 'inst-1',
      target: 'inst-2',
      goalId: 'mock-goal-id'
    });
  });

  it('handles missing type (empty string)', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await createEdge(
      { sourceId: 'inst-1', targetId: 'inst-2' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    const callArgs = queueManager.enqueue.mock.calls[0][1];
    expect(callArgs.dag.tasks[0].args.name).toBe('');
    expect(callArgs.dag.tasks[0].args.definitionNode).toBeNull();
  });

  it('throws error when sourceId or targetId is missing', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createEdge({ targetId: 'inst-2' }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('sourceId and targetId are required');

    await expect(
      createEdge({ sourceId: 'inst-1' }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('sourceId and targetId are required');
  });

  it('throws error when no active graph', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createEdge({ sourceId: 'inst-1', targetId: 'inst-2' }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('No active graph');
  });

  it('calls ensureSchedulerStarted callback', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await createEdge(
      { sourceId: 'inst-1', targetId: 'inst-2' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(mockEnsureSchedulerStarted).toHaveBeenCalledTimes(1);
  });
});

