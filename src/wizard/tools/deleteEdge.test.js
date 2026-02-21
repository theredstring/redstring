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

  it('returns direct action payload with correct args', async () => {
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

    expect(result).toEqual({
      action: 'deleteEdge',
      graphId: 'graph-1',
      edgeId: 'edge-1',
      sourceName: null,
      targetName: null,
      deleted: true
    });
  });

  it('throws error when edgeId and sourceName are missing', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      deleteEdge({}, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('edgeId or sourceName/targetName is required');
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

  // Removed ensureSchedulerStarted test as direct UI tools no longer call it
});

