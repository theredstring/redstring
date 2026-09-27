/**
 * Tests for replaceEdges tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { replaceEdges } from './replaceEdges.js';

// replaceEdges resolves every endpoint against the target graph's instances
// (9c185e4b), so the fixture has to hold the nodes the edges name.
const makeGraphState = (names) => ({
    activeGraphId: 'graph-1',
    graphs: [{
        id: 'graph-1',
        instances: names.map((name, i) => ({ id: `inst-${i + 1}`, prototypeId: `proto-${i + 1}` }))
    }],
    nodePrototypes: names.map((name, i) => ({ id: `proto-${i + 1}`, name }))
});

describe('replaceEdges', () => {
    const mockEnsureSchedulerStarted = vi.fn();
    const mockCid = 'test-cid-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns replacement specs for UI application', async () => {
        const graphState = makeGraphState(['Node A', 'Node B', 'Node C', 'Node D']);

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
        ).rejects.toThrow('No target graph specified and no active graph available');
    });

    it('defaults directionality to unidirectional', async () => {
        const graphState = makeGraphState(['A', 'B']);

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
        const graphState = makeGraphState(['A', 'B']);

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

    it('throws with the available nodes when an endpoint is not in the graph', async () => {
        const graphState = makeGraphState(['A', 'B']);

        await expect(
            replaceEdges(
                { edges: [{ source: 'A', target: 'Missing', type: 'contains' }] },
                graphState,
                mockCid,
                mockEnsureSchedulerStarted
            )
        ).rejects.toThrow('Could not resolve nodes: "Missing" (target). Available nodes: A, B.');
    });
});
