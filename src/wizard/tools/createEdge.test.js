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

const makeGraphState = () => ({
  activeGraphId: 'graph-1',
  graphs: [{
    id: 'graph-1',
    instances: [
      { id: 'inst-1', prototypeId: 'proto-1', name: 'Node A' },
      { id: 'inst-2', prototypeId: 'proto-2', name: 'Node B' }
    ]
  }],
  nodePrototypes: [
    { id: 'proto-1', name: 'Node A' },
    { id: 'proto-2', name: 'Node B' }
  ]
});

describe('createEdge', () => {
  const mockEnsureSchedulerStarted = vi.fn();
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns direct action payload when nodes exist', async () => {
    const result = await createEdge(
      { sourceId: 'Node A', targetId: 'Node B', type: 'connects' },
      makeGraphState(),
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result).toMatchObject({
      action: 'createEdge',
      graphId: 'graph-1',
      sourceName: 'Node A',
      targetName: 'Node B',
      sourceInstanceId: 'inst-1',
      targetInstanceId: 'inst-2',
      type: 'connects',
      created: true
    });
  });

  it('handles missing type (empty string)', async () => {
    const result = await createEdge(
      { sourceId: 'Node A', targetId: 'Node B' },
      makeGraphState(),
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.type).toBe('');
  });

  it('throws when source node not found in graph', async () => {
    await expect(
      createEdge({ sourceId: 'Nonexistent', targetId: 'Node B' }, makeGraphState(), mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('Source node "Nonexistent" not found in graph');
  });

  it('throws when target node not found in graph', async () => {
    await expect(
      createEdge({ sourceId: 'Node A', targetId: 'Nonexistent' }, makeGraphState(), mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('Target node "Nonexistent" not found in graph');
  });

  it('error message includes available node names', async () => {
    await expect(
      createEdge({ sourceId: 'Ghost', targetId: 'Node B' }, makeGraphState(), mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('Node A');
  });

  it('throws error when sourceId or targetId is missing', async () => {
    const graphState = { activeGraphId: 'graph-1', graphs: [], nodePrototypes: [] };

    await expect(
      createEdge({ targetId: 'inst-2' }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('sourceId and targetId are required');

    await expect(
      createEdge({ sourceId: 'inst-1' }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('sourceId and targetId are required');
  });

  it('throws error when no active graph', async () => {
    await expect(
      createEdge({ sourceId: 'inst-1', targetId: 'inst-2' }, { graphs: [], nodePrototypes: [] }, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('No target graph specified and no active graph available');
  });
});
