/**
 * Tests for updateEdge tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateEdge } from './updateEdge.js';

describe('updateEdge', () => {
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

        const result = await updateEdge(
            { sourceName: 'inst-1', targetName: 'inst-2', type: 'connects', directionality: 'bidirectional' },
            graphState,
            mockCid,
            mockEnsureSchedulerStarted
        );

        expect(result).toEqual({
            action: 'updateEdge',
            graphId: 'graph-1',
            sourceName: 'inst-1',
            targetName: 'inst-2',
            sourceInstanceId: null,
            targetInstanceId: null,
            updates: {
                type: 'connects',
                directionality: 'bidirectional'
            },
            updated: true
        });
    });

    it('throws error when sourceName or targetName is missing', async () => {
        const graphState = {
            activeGraphId: 'graph-1',
            graphs: [],
            nodePrototypes: []
        };

        await expect(
            updateEdge({ sourceName: 'inst-1' }, graphState, mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('sourceName and targetName are required');

        await expect(
            updateEdge({ targetName: 'inst-2' }, graphState, mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('sourceName and targetName are required');
    });

    it('throws error when no active graph', async () => {
        const graphState = {
            graphs: [],
            nodePrototypes: []
        };

        await expect(
            updateEdge({ sourceName: 'inst-1', targetName: 'inst-2' }, graphState, mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('No active graph');
    });
});
