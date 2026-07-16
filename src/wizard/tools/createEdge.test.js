/**
 * Tests for createEdge tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEdge } from './createEdge.js';
import queueManager from '../../services/queue/Queue.js';
import { suggestRelationKind, suggestArrowDirection } from './utils/suggestionCalls.js';

vi.mock('../../services/queue/Queue.js', () => ({
  default: {
    enqueue: vi.fn(() => 'mock-goal-id'),
    dequeue: vi.fn(),
    getQueue: vi.fn(() => ({ items: [], inflight: new Map(), byId: new Map() }))
  }
}));

// C3/C4 helpers mocked so no model is hit; default (undefined) → plain edge.
vi.mock('./utils/suggestionCalls.js', () => ({
  suggestRelationKind: vi.fn(),
  suggestArrowDirection: vi.fn()
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

  describe('C3/C4 suggestions', () => {
    it('defaults to a plain unidirectional edge with no model', async () => {
      const result = await createEdge(
        { sourceId: 'Node A', targetId: 'Node B', type: 'connects' },
        makeGraphState(), mockCid, mockEnsureSchedulerStarted
      );
      expect(result.directionality).toBe('unidirectional');
      expect(result.arrowSuggested).toBe(false);
      expect(result.abstractionSuggestion).toBeNull();
      expect(result.created).toBe(true);
    });

    it('surfaces an abstraction suggestion for a kind-of relation, still creating the edge', async () => {
      suggestRelationKind.mockResolvedValue({ kind: 'kind-of', callId: 'r' });
      const result = await createEdge(
        { sourceId: 'Node A', targetId: 'Node B', type: 'is a' },
        makeGraphState(), mockCid, mockEnsureSchedulerStarted
      );
      expect(result.abstractionSuggestion).toMatchObject({ sourceName: 'Node A', targetName: 'Node B' });
      expect(result.abstractionSuggestion.note).toMatch(/KIND of/);
      expect(result.created).toBe(true); // edge is NOT silently dropped/converted
      expect(result.type).toBe('is a');
    });

    it('reverses the arrow when the label points at the source', async () => {
      suggestArrowDirection.mockResolvedValue({ arrowsToward: 'source', callId: 'a' });
      const result = await createEdge(
        { sourceId: 'Node A', targetId: 'Node B', type: 'made by' },
        makeGraphState(), mockCid, mockEnsureSchedulerStarted
      );
      expect(result.directionality).toBe('reverse');
      expect(result.arrowSuggested).toBe(true);
    });

    it('keeps unidirectional when the label points at the target', async () => {
      suggestArrowDirection.mockResolvedValue({ arrowsToward: 'target', callId: 'a' });
      const result = await createEdge(
        { sourceId: 'Node A', targetId: 'Node B', type: 'directed' },
        makeGraphState(), mockCid, mockEnsureSchedulerStarted
      );
      expect(result.directionality).toBe('unidirectional');
      expect(result.arrowSuggested).toBe(true);
    });

    it('does not call arrow direction when there is no label', async () => {
      await createEdge(
        { sourceId: 'Node A', targetId: 'Node B' },
        makeGraphState(), mockCid, mockEnsureSchedulerStarted
      );
      expect(suggestArrowDirection).not.toHaveBeenCalled();
    });
  });
});
