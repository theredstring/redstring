/**
 * Tests for setNodeType tool
 */
import { describe, it, expect } from 'vitest';
import { setNodeType } from './setNodeType.js';

describe('setNodeType', () => {
    const baseState = {
        nodePrototypes: [
            { id: 'proto-dog', name: 'Dog', typeNodeId: null },
            { id: 'proto-mammal', name: 'Mammal', typeNodeId: null },
            { id: 'proto-animal', name: 'Animal', typeNodeId: null },
            { id: 'proto-outer-membrane', name: 'Outer Membrane', typeNodeId: null }
        ],
        activeGraphId: 'graph-1'
    };

    it('sets a type by name when type node exists', async () => {
        const result = await setNodeType(
            { nodeName: 'Dog', typeName: 'Mammal' },
            baseState
        );
        expect(result.action).toBe('setNodeType');
        expect(result.nodeId).toBe('proto-dog');
        expect(result.typeNodeId).toBe('proto-mammal');
        expect(result.autoCreate).toBeUndefined();
    });

    it('clears a type', async () => {
        const result = await setNodeType(
            { nodeName: 'Dog', clearType: true },
            baseState
        );
        expect(result.action).toBe('setNodeType');
        expect(result.nodeId).toBe('proto-dog');
        expect(result.typeNodeId).toBe(null);
    });

    it('throws on missing nodeName', async () => {
        await expect(
            setNodeType({}, baseState)
        ).rejects.toThrow('nodeName is required');
    });

    it('throws on unknown target node', async () => {
        await expect(
            setNodeType({ nodeName: 'Fish', typeName: 'Animal' }, baseState)
        ).rejects.toThrow('not found');
    });

    it('prevents self-typing', async () => {
        await expect(
            setNodeType({ nodeName: 'Dog', typeName: 'Dog' }, baseState)
        ).rejects.toThrow('own type');
    });

    it('fuzzy matches node names (case-insensitive)', async () => {
        const result = await setNodeType(
            { nodeName: 'dog', typeName: 'mammal' },
            baseState
        );
        expect(result.nodeId).toBe('proto-dog');
        expect(result.typeNodeId).toBe('proto-mammal');
    });

    it('does NOT match "Membrane" to "Outer Membrane" (strict type matching)', async () => {
        // "Membrane" should trigger auto-create, NOT match "Outer Membrane"
        const result = await setNodeType(
            { nodeName: 'Outer Membrane', typeName: 'Membrane', typeDescription: 'A lipid bilayer' },
            baseState
        );
        // Should auto-create since no exact "Membrane" node exists
        expect(result.autoCreate).toBeDefined();
        expect(result.autoCreate.name).toBe('Membrane');
        expect(result.autoCreate.description).toBe('A lipid bilayer');
    });

    it('auto-creates type node when it does not exist', async () => {
        const result = await setNodeType(
            { nodeName: 'Dog', typeName: 'Canine', typeColor: '#B0B0B0', typeDescription: 'The canine family' },
            baseState
        );
        expect(result.action).toBe('setNodeType');
        expect(result.nodeId).toBe('proto-dog');
        expect(result.typeNodeId).toBe(null); // Filled in by BridgeClient
        expect(result.autoCreate).toBeDefined();
        expect(result.autoCreate.name).toBe('Canine');
        expect(result.autoCreate.color).toBe('#B0B0B0');
        expect(result.autoCreate.description).toBe('The canine family');
        expect(result.autoCreate.graphId).toBe('graph-1');
    });

    it('uses existing type node when exact match exists', async () => {
        const stateWithMembrane = {
            ...baseState,
            nodePrototypes: [
                ...baseState.nodePrototypes,
                { id: 'proto-membrane', name: 'Membrane', typeNodeId: null }
            ]
        };
        const result = await setNodeType(
            { nodeName: 'Outer Membrane', typeName: 'Membrane' },
            stateWithMembrane
        );
        expect(result.typeNodeId).toBe('proto-membrane');
        expect(result.autoCreate).toBeUndefined();
    });
});
