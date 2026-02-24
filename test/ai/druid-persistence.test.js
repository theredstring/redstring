import { describe, it, expect, vi, beforeEach } from 'vitest';
import DruidInstance from '../../src/services/DruidInstance.js';

// Mock uuid
vi.mock('uuid', () => ({
    v4: () => 'test-uuid'
}));

describe('DruidInstance Persistence', () => {
    let mockStore;
    let druid;

    beforeEach(() => {
        const mockState = {
            activeGraphId: 'graph-1',
            graphs: new Map([
                ['graph-1', { id: 'graph-1', name: 'Test Graph', instances: new Map() }],
                ['goals-graph', { id: 'goals-graph', name: 'Druid Goals', instances: new Map() }],
                ['plans-graph', { id: 'plans-graph', name: 'Druid Plans', instances: new Map() }],
                ['obs-graph', { id: 'obs-graph', name: 'Druid Observations', instances: new Map() }]
            ]),
            nodePrototypes: new Map([
                ['proto-1', { id: 'proto-1', name: 'Druid Workspace', definitionGraphIds: ['cog-state-graph'] }]
            ]),
            addNodePrototype: vi.fn(),
            addNodeInstance: vi.fn(),
            createAndAssignGraphDefinitionWithoutActivation: vi.fn()
        };

        mockStore = {
            getState: vi.fn(() => mockState)
        };
        druid = new DruidInstance(mockStore);
        druid.cognitiveGraphIds = {
            goals: 'goals-graph',
            plans: 'plans-graph',
            observations: 'obs-graph'
        };
    });

    it('should parse <druid_thought> and update cognitive graphs', async () => {
        const message = `
      Hello user! I've updated the graph.
      <druid_thought>
      Goals: Map the solar system correctly.
      Plans: 1. Add Jupiter, 2. Add Saturn.
      Observations: User is interested in gas giants.
      </druid_thought>
    `;

        const status = await druid.processMessage(message);

        expect(status.extracted).toBe(3);
        expect(status.created).toBe(3);

        // Check if addNodeInstance was called for each type
        expect(mockStore.getState().addNodeInstance).toHaveBeenCalledWith('goals-graph', expect.any(String), expect.objectContaining({ name: 'Map the solar system correctly.' }));
        expect(mockStore.getState().addNodeInstance).toHaveBeenCalledWith('plans-graph', expect.any(String), expect.objectContaining({ name: '1. Add Jupiter, 2. Add Saturn.' }));
        expect(mockStore.getState().addNodeInstance).toHaveBeenCalledWith('obs-graph', expect.any(String), expect.objectContaining({ name: 'User is interested in gas giants.' }));
    });

    it('should handle missing <druid_thought> tag gracefully', async () => {
        const message = "Hello, I am the Druid.";
        const status = await druid.processMessage(message);
        expect(status.extracted).toBe(0);
        expect(mockStore.getState().addNodeInstance).not.toHaveBeenCalled();
    });

    it('should return correct completion status', () => {
        druid.structuredConcepts.set('Earth', { isComplex: true, hasDefinitionGraph: false });
        expect(druid.isComplete()).toBe(false);

        druid.structuredConcepts.set('Earth', { isComplex: true, hasDefinitionGraph: true });
        expect(druid.isComplete()).toBe(true);
    });
});
