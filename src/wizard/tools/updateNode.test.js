/**
 * Tests for updateNode tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateNode } from './updateNode.js';
import queueManager from '../../services/queue/Queue.js';

vi.mock('../../services/queue/Queue.js', () => ({
  default: {
    enqueue: vi.fn(() => 'mock-goal-id'),
    dequeue: vi.fn(),
    getQueue: vi.fn(() => ({ items: [], inflight: new Map(), byId: new Map() }))
  }
}));

describe('updateNode', () => {
  const mockEnsureSchedulerStarted = vi.fn();
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues update_node_prototype task with correct args', async () => {
    const graphState = { graphs: [], nodePrototypes: [] };

    const result = await updateNode(
      { nodeId: 'proto-1', name: 'Updated Name', color: '#FF0000', description: 'Updated desc' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(queueManager.enqueue).toHaveBeenCalledWith('goalQueue', expect.objectContaining({
      goal: 'update_node',
      dag: expect.objectContaining({
        tasks: [expect.objectContaining({
          toolName: 'update_node_prototype',
          args: {
            prototype_id: 'proto-1',
            name: 'Updated Name',
            color: '#FF0000',
            description: 'Updated desc'
          }
        })]
      })
    }));

    expect(result).toEqual({
      nodeId: 'proto-1',
      updated: true,
      goalId: 'mock-goal-id'
    });
  });

  it('only includes provided fields in args', async () => {
    const graphState = { graphs: [], nodePrototypes: [] };

    await updateNode(
      { nodeId: 'proto-1', name: 'New Name' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    const callArgs = queueManager.enqueue.mock.calls[0][1];
    expect(callArgs.dag.tasks[0].args).toEqual({
      prototype_id: 'proto-1',
      name: 'New Name'
    });
  });

  it('handles description as empty string', async () => {
    const graphState = { graphs: [], nodePrototypes: [] };

    await updateNode(
      { nodeId: 'proto-1', description: '' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    const callArgs = queueManager.enqueue.mock.calls[0][1];
    expect(callArgs.dag.tasks[0].args.description).toBe('');
  });

  it('throws error when nodeId is missing', async () => {
    const graphState = { graphs: [], nodePrototypes: [] };

    await expect(
      updateNode({}, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('nodeId is required');
  });

  it('calls ensureSchedulerStarted callback', async () => {
    const graphState = { graphs: [], nodePrototypes: [] };

    await updateNode(
      { nodeId: 'proto-1', name: 'New Name' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(mockEnsureSchedulerStarted).toHaveBeenCalledTimes(1);
  });
});

