/**
 * Tests for replaceEdges tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { replaceEdges } from './replaceEdges.js';

describe('replaceEdges', () => {
    const mockEnsureSchedulerStarted = vi.fn();
    const mockCid = 'test-cid-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns replacement specs for UI application', async () => {
        const graphState = {
            activeGraphId: 'graph-1',
            graphs: [],
            nodePrototypes: []
        };

        const result = await replaceEdges(
            {
                edges: [
                    { source: 'Node A', target: 'Node B', type: 'contains' },
                    { source: 'Node C', target: 'Node D', type: 'attached to' }
                ]
            },
            graphState,
            mockCid,
            mockEnsureSchedulerStarted
        );

        expect(result.action).toBe('replaceEdges');
        expect(result.graphId).toBe('graph-1');
        expect(result.edgeCount).toBe(2);
        expect(result.replacements).toHaveLength(2);

        // Title case applied
        expect(result.replacements[0].type).toBe('Contains');
        expect(result.replacements[0].source).toBe('Node A');
        expect(result.replacements[0].target).toBe('Node B');
        expect(result.replacements[0].definitionNode.name).toBe('Contains');

        expect(result.replacements[1].type).toBe('Attached To');
        expect(result.replacements[1].definitionNode.name).toBe('Attached To');
    });

    it('throws error when edges array is empty', async () => {
        const graphState = {
            activeGraphId: 'graph-1',
            graphs: [],
            nodePrototypes: []
        };

        await expect(
            replaceEdges({ edges: [] }, graphState, mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('At least one edge is required');
    });

    it('throws error when no edges provided', async () => {
        const graphState = {
            activeGraphId: 'graph-1',
            graphs: [],
            nodePrototypes: []
        };

        await expect(
            replaceEdges({}, graphState, mockCid, mockEnsureSchedulerStarted)
        ).rejects.toThrow('At least one edge is required');
    });

    it('throws error when no active graph', async () => {
        const graphState = {
            graphs: [],
            nodePrototypes: []
        };

        await expect(
            replaceEdges(
                { edges: [{ source: 'A', target: 'B', type: 'relates to' }] },
                graphState,
                mockCid,
                mockEnsureSchedulerStarted
            )
        ).rejects.toThrow('No active graph');
    });

    it('defaults directionality to unidirectional', async () => {
        const graphState = {
            activeGraphId: 'graph-1',
            graphs: [],
            nodePrototypes: []
        };

        const result = await replaceEdges(
            {
                edges: [{ source: 'A', target: 'B', type: 'contains' }]
            },
            graphState,
            mockCid,
            mockEnsureSchedulerStarted
        );

        expect(result.replacements[0].directionality).toBe('unidirectional');
    });

    it('preserves explicit directionality', async () => {
        const graphState = {
            activeGraphId: 'graph-1',
            graphs: [],
            nodePrototypes: []
        };

        const result = await replaceEdges(
            {
                edges: [{ source: 'A', target: 'B', type: 'loves', directionality: 'bidirectional' }]
            },
            graphState,
            mockCid,
            mockEnsureSchedulerStarted
        );

        expect(result.replacements[0].directionality).toBe('bidirectional');
        expect(result.replacements[0].type).toBe('Loves');
    });
});
