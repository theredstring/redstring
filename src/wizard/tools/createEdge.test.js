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

  it('returns direct action payload with correct args', async () => {
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

    expect(result).toEqual({
      action: 'createEdge',
      graphId: 'graph-1',
      sourceName: 'inst-1',
      targetName: 'inst-2',
      sourceInstanceId: null,
      targetInstanceId: null,
      type: 'connects',
      created: true
    });
  });

  it('handles missing type (empty string)', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await createEdge(
      { sourceId: 'inst-1', targetId: 'inst-2' },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.type).toBe('');
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

  // Removed ensureSchedulerStarted test as direct UI tools no longer call it
});

