/**
 * Tests for readAbstractionChain tool
 */
import { describe, it, expect } from 'vitest';
import { readAbstractionChain } from './readAbstractionChain.js';

describe('readAbstractionChain', () => {
    const baseState = {
        nodePrototypes: [
            {
                id: 'proto-dog', name: 'Dog',
                abstractionChains: {
                    'Generalization Axis': ['proto-dog', 'proto-mammal', 'proto-animal']
                }
            },
            { id: 'proto-mammal', name: 'Mammal' },
            { id: 'proto-animal', name: 'Animal' },
            { id: 'proto-cat', name: 'Cat', abstractionChains: {} }
        ]
    };

    it('reads chains for a node with chains', async () => {
        const result = await readAbstractionChain({ nodeName: 'Dog' }, baseState);
        expect(result.chainCount).toBe(1);
        expect(result.dimensions).toHaveLength(1);
        expect(result.dimensions[0].dimension).toBe('Generalization Axis');
        expect(result.dimensions[0].nodeCount).toBe(3);
        expect(result.dimensions[0].chain[0].name).toBe('Dog');
        expect(result.dimensions[0].chain[0].isOwner).toBe(true);
        expect(result.dimensions[0].chain[1].name).toBe('Mammal');
        expect(result.dimensions[0].chain[2].name).toBe('Animal');
    });

    it('returns empty for a node without chains', async () => {
        const result = await readAbstractionChain({ nodeName: 'Cat' }, baseState);
        expect(result.chainCount).toBe(0);
        expect(result.dimensions).toHaveLength(0);
    });

    it('throws on missing nodeName', async () => {
        await expect(
            readAbstractionChain({}, baseState)
        ).rejects.toThrow('nodeName is required');
    });

    it('throws on unknown node', async () => {
        await expect(
            readAbstractionChain({ nodeName: 'Fish' }, baseState)
        ).rejects.toThrow('not found');
    });
});
