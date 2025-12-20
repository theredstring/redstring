/**
 * Tests for createGraph tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGraph } from './createGraph.js';
import queueManager from '../../services/queue/Queue.js';

vi.mock('../../services/queue/Queue.js', () => ({
  default: {
    enqueue: vi.fn(() => 'mock-goal-id'),
    dequeue: vi.fn(),
    getQueue: vi.fn(() => ({ items: [], inflight: new Map(), byId: new Map() }))
  }
}));

describe('createGraph', () => {
  const mockEnsureSchedulerStarted = vi.fn();
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues create_graph task with correct args', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createGraph(
      { name: 'Test Graph' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(queueManager.enqueue).toHaveBeenCalledWith('goalQueue', expect.objectContaining({
      type: 'goal',
      goal: 'create_graph',
      threadId: mockCid,
      partitionKey: mockCid,
      dag: expect.objectContaining({
        tasks: [expect.objectContaining({
          toolName: 'create_graph',
          threadId: mockCid,
          args: {
            name: 'Test Graph'
          }
        })]
      })
    }));

    expect(result).toEqual({
      graphId: 'pending',
      name: 'Test Graph',
      goalId: 'mock-goal-id'
    });
  });

  it('throws error when name is missing', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createGraph({}, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('name is required');
  });

  it('calls ensureSchedulerStarted callback', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await createGraph(
      { name: 'Test Graph' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(mockEnsureSchedulerStarted).toHaveBeenCalledTimes(1);
  });

  it('handles missing ensureSchedulerStarted gracefully', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createGraph({ name: 'Test Graph' }, graphState, mockCid, null)
    ).resolves.toBeDefined();
  });
});

