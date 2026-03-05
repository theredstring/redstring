/**
 * Tests for editAbstractionChain tool
 */
import { describe, it, expect } from 'vitest';
import { editAbstractionChain } from './editAbstractionChain.js';

describe('editAbstractionChain', () => {
    const baseState = {
        nodePrototypes: [
            { id: 'proto-dog', name: 'Dog', abstractionChains: {} },
            { id: 'proto-mammal', name: 'Mammal' },
            { id: 'proto-animal', name: 'Animal' }
        ]
    };

    it('adds a node above in a chain', async () => {
        const result = await editAbstractionChain({
            nodeName: 'Dog',
            dimension: 'Generalization Axis',
            editAction: 'add',
            targetNodeName: 'Mammal',
            direction: 'above'
        }, baseState);

        expect(result.action).toBe('editAbstractionChain');
        expect(result.operationType).toBe('addToAbstractionChain');
        expect(result.nodeId).toBe('proto-dog');
        expect(result.dimension).toBe('Generalization Axis');
        expect(result.direction).toBe('above');
        expect(result.newNodeId).toBe('proto-mammal');
    });

    it('removes a node from a chain', async () => {
        const result = await editAbstractionChain({
            nodeName: 'Dog',
            dimension: 'Generalization Axis',
            editAction: 'remove',
            targetNodeName: 'Mammal'
        }, baseState);

        expect(result.action).toBe('editAbstractionChain');
        expect(result.operationType).toBe('removeFromAbstractionChain');
        expect(result.nodeToRemove).toBe('proto-mammal');
    });

    it('supports relativeTo parameter', async () => {
        const result = await editAbstractionChain({
            nodeName: 'Dog',
            dimension: 'Generalization Axis',
            editAction: 'add',
            targetNodeName: 'Animal',
            direction: 'above',
            relativeTo: 'Mammal'
        }, baseState);

        expect(result.insertRelativeToNodeId).toBe('proto-mammal');
    });

    it('throws on missing required params', async () => {
        await expect(
            editAbstractionChain({}, baseState)
        ).rejects.toThrow('nodeName is required');

        await expect(
            editAbstractionChain({ nodeName: 'Dog' }, baseState)
        ).rejects.toThrow('dimension is required');

        await expect(
            editAbstractionChain({ nodeName: 'Dog', dimension: 'X' }, baseState)
        ).rejects.toThrow('editAction is required');
    });

    it('throws on unknown editAction', async () => {
        await expect(
            editAbstractionChain({
                nodeName: 'Dog',
                dimension: 'X',
                editAction: 'swap',
                targetNodeName: 'Mammal'
            }, baseState)
        ).rejects.toThrow('Unknown editAction');
    });

    it('throws on unknown node names', async () => {
        await expect(
            editAbstractionChain({
                nodeName: 'Fish',
                dimension: 'X',
                editAction: 'add',
                targetNodeName: 'Mammal'
            }, baseState)
        ).rejects.toThrow('not found');
    });
});
