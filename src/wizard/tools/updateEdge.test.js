/**
 * Tests for updateEdge tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateEdge } from './updateEdge.js';

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

describe('updateEdge', () => {
    const mockEnsureSchedulerStarted = vi.fn();
    const mockCid = 'test-cid-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns direct action payload when nodes exist', async () => {
        const result = await updateEdge(
            { sourceName: 'Node A', targetName: 'Node B', type: 'connects', directionality: 'bidirectional' },
            makeGraphState(),
            mockCid,
            mockEnsureSchedulerStarted
        );

        expect(result).toMatchObject({
            action: 'updateEdge',
            graphId: 'graph-1',
            sourceName: 'Node A',
            targetName: 'Node B',
            sourceInstanceId: 'inst-1',
            targetInstanceId: 'inst-2',
            updates: {
                type: 'connects',
                directionality: 'bidirectional'
            },
            updated: true
        });
    });

    it('throws when source node not found in graph', async () => {
        await expect(
            updateEdge({ sourceName: 'Ghost', targetName: 'Node B' }, makeGraphState(), mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('Source node "Ghost" not found in graph');
    });

    it('throws when target node not found in graph', async () => {
        await expect(
            updateEdge({ sourceName: 'Node A', targetName: 'Ghost' }, makeGraphState(), mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('Target node "Ghost" not found in graph');
    });

    it('error message includes available node names', async () => {
        await expect(
            updateEdge({ sourceName: 'Ghost', targetName: 'Node B' }, makeGraphState(), mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('Node A');
    });

    it('throws error when sourceName or targetName is missing', async () => {
        const graphState = { activeGraphId: 'graph-1', graphs: [], nodePrototypes: [] };

        await expect(
            updateEdge({ sourceName: 'inst-1' }, graphState, mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('sourceName and targetName are required');

        await expect(
            updateEdge({ targetName: 'inst-2' }, graphState, mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('sourceName and targetName are required');
    });

    it('throws error when no active graph', async () => {
        await expect(
            updateEdge({ sourceName: 'inst-1', targetName: 'inst-2' }, { graphs: [], nodePrototypes: [] }, mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('No target graph specified and no active graph available');
    });
});
