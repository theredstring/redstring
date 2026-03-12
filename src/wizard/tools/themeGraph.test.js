import { describe, it, expect } from 'vitest';
import { themeGraph } from './themeGraph.js';

describe('themeGraph tool', () => {
    it('themes a graph by returning updates for all instances and definition nodes', async () => {
        const mockGraphState = {
            activeGraphId: 'graph-1',
            graphs: [
                {
                    id: 'graph-1',
                    name: 'Test Graph',
                    instances: [
                        { id: 'inst-1', prototypeId: 'proto-1' },
                        { id: 'inst-2', prototypeId: 'proto-2' }
                    ],
                    edgeIds: ['edge-1']
                }
            ],
            nodePrototypes: [
                { id: 'proto-1', name: 'Alpha' },
                { id: 'proto-2', name: 'Beta' },
                { id: 'proto-def-1', name: 'Relates To' }
            ],
            edges: [
                { id: 'edge-1', sourceId: 'inst-1', destinationId: 'inst-2', definitionNodeIds: ['proto-def-1'] }
            ]
        };

        const result = await themeGraph({ palette: 'retro' }, mockGraphState, 'cid-1', () => {});

        expect(result.action).toBe('themeGraph');
        expect(result.graphId).toBe('graph-1');
        expect(result.palette).toBe('retro');
        
        // Should update proto-1, proto-2, and proto-def-1
        expect(result.updates).toHaveLength(3);
        
        const updatedProtoIds = result.updates.map(u => u.prototypeId);
        expect(updatedProtoIds).toContain('proto-1');
        expect(updatedProtoIds).toContain('proto-2');
        expect(updatedProtoIds).toContain('proto-def-1');
        
        // Colors should be populated
        result.updates.forEach(update => {
            expect(update.color).toBeDefined();
            expect(update.color.startsWith('#')).toBe(true);
        });
    });

    it('defaults to active graph if targetGraphId is missing', async () => {
        const mockGraphState = {
            activeGraphId: 'graph-2',
            graphs: [
                { id: 'graph-1', instances: [] },
                { id: 'graph-2', instances: [{ id: 'i1', prototypeId: 'p1' }] }
            ],
            nodePrototypes: [{ id: 'p1', name: 'Test' }]
        };

        const result = await themeGraph({}, mockGraphState, 'cid', () => {});
        expect(result.graphId).toBe('graph-2');
        expect(result.updates).toHaveLength(1);
    });
});
