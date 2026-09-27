/**
 * graphStore: core actions and selectors.
 *
 * These tests were first written against a pre-release model where every node
 * lived in one global `nodes` pool, graphs listed `nodeIds`, nodes carried
 * their own `edgeIds`, and a `loadGraph(graphInstance)` action pulled data out
 * of core class instances. The store shipped on the prototype/instance model
 * instead: `nodePrototypes` holds what a Thing is, `graph.instances` holds where
 * it sits, and edges connect instance IDs. `addNode`/`updateNode`/`removeNode`
 * and `loadGraph` are deprecated no-ops; `getNodeDataById`/`getNodesForGraph`
 * became `getNodePrototypeById`/`getInstancesForGraph`/`getHydratedNodesForGraph`.
 * The intents are kept and asserted against the current actions.
 */
import { act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import useGraphStore, {
    getGraphDataById,
    getNodePrototypeById,
    getEdgeDataById,
    getActiveGraphData,
    getInstancesForGraph,
    getHydratedNodesForGraph,
    getEdgesForGraph,
    getGraphTitleById,
    getOpenGraphIds,
    getActiveGraphId
} from '../../src/store/graphStore.js';

// --- Helper Functions to create Plain Test Data ---

const createPrototypeData = (id, overrides = {}) => ({
    id,
    name: `Thing ${id}`,
    description: 'Prototype Description',
    color: '#800000',
    typeNodeId: 'base-thing-prototype',
    definitionGraphIds: [],
    ...overrides,
});

const createInstanceData = (id, prototypeId, overrides = {}) => ({
    id,
    prototypeId,
    x: 0,
    y: 0,
    scale: 1,
    ...overrides,
});

const createEdgeData = (id, sourceId, destinationId, overrides = {}) => ({
    id,
    sourceId,
    destinationId,
    name: `Edge ${id}`,
    description: 'Edge Description',
    typeNodeId: 'base-connection-prototype',
    ...overrides,
});

const createGraphData = (id, instances = [], edgeIds = [], overrides = {}) => ({
    id,
    name: `Graph ${id}`,
    description: 'Graph Description',
    color: '',
    directed: true,
    instances: new Map(instances.map((inst) => [inst.id, inst])),
    edgeIds: [...edgeIds],
    groups: new Map(),
    ...overrides,
});

// Two Things placed in g1 and connected by e1: the shape most tests start from.
const seedConnectedPair = () => {
    const base = useGraphStore.getState().nodePrototypes;
    const nodePrototypes = new Map(base);
    nodePrototypes.set('p1', createPrototypeData('p1'));
    nodePrototypes.set('p2', createPrototypeData('p2'));
    const i1 = createInstanceData('i1', 'p1');
    const i2 = createInstanceData('i2', 'p2', { x: 100 });
    const e1 = createEdgeData('e1', 'i1', 'i2');
    act(() => {
        useGraphStore.setState({
            nodePrototypes,
            graphs: new Map([['g1', createGraphData('g1', [i1, i2], ['e1'])]]),
            edges: new Map([['e1', e1]]),
        });
    });
    return { i1, i2, e1 };
};

// --- Tests ---

describe('useGraphStore', () => {
    // IMPORTANT: We get the initial state *before* defining mocks,
    // otherwise, the mocks might interfere if they have side effects on import.
    const initialState = useGraphStore.getState();

    beforeEach(() => {
        // Reset store state before each test using the captured initial state
        useGraphStore.setState(initialState, true);
        // Clear mock function calls between tests using vi.clearAllMocks()
        vi.clearAllMocks();
    });

    it('should have correct initial state', () => {
        const state = useGraphStore.getState();
        expect(state.graphs).toEqual(new Map());
        // Only the seeded base types; there is no global node pool any more.
        expect(Array.from(state.nodePrototypes.keys()).sort())
            .toEqual(['base-connection-prototype', 'base-thing-prototype']);
        expect(state.nodes).toBeUndefined();
        expect(state.edges).toEqual(new Map()); // Check initial edges map
        expect(state.openGraphIds).toEqual([]);
        expect(state.activeGraphId).toBeNull();
    });

    // --- Action Tests ---

    describe('actions', () => {
        it('loadUniverseFromFile: should load graph, prototype, instance and edge data', () => {
            const p1 = createPrototypeData('p1');
            const p2 = createPrototypeData('p2');
            const i1 = createInstanceData('i1', 'p1');
            const i2 = createInstanceData('i2', 'p2');
            const e1 = createEdgeData('e1', 'i1', 'i2');
            const g1 = createGraphData('g1', [i1, i2], ['e1']);

            let loaded;
            act(() => {
                loaded = useGraphStore.getState().loadUniverseFromFile({
                    graphs: new Map([['g1', g1]]),
                    nodePrototypes: new Map([['p1', p1], ['p2', p2]]),
                    edges: new Map([['e1', e1]]),
                    openGraphIds: ['g1'],
                    activeGraphId: 'g1',
                });
            });
            expect(loaded).toBe(true);

            const state = useGraphStore.getState();

            // Graph with its placed instances
            expect(state.graphs.size).toBe(1);
            const graph = state.graphs.get('g1');
            expect(graph.name).toBe('Graph g1');
            expect(Array.from(graph.instances.keys())).toEqual(['i1', 'i2']);
            expect(graph.instances.get('i1').prototypeId).toBe('p1');
            expect(graph.edgeIds).toEqual(['e1']);

            // Prototypes
            expect(state.nodePrototypes.get('p1').name).toBe('Thing p1');
            expect(state.nodePrototypes.get('p2').name).toBe('Thing p2');

            // Edges connect instance IDs
            expect(state.edges.size).toBe(1);
            expect(state.edges.get('e1')).toMatchObject({ sourceId: 'i1', destinationId: 'i2' });

            // Tab state
            expect(state.openGraphIds).toEqual(['g1']);
            expect(state.activeGraphId).toBe('g1');
            expect(state.isUniverseLoaded).toBe(true);
            expect(state.universeLoadingError).toBeNull();
        });

        it('addNodePrototype + addNodeInstance: should add a Thing and place it in a graph', () => {
            act(() => { useGraphStore.setState({ graphs: new Map([['g1', createGraphData('g1')]]) }); });

            act(() => {
                useGraphStore.getState().addNodePrototype(createPrototypeData('p-new'));
                useGraphStore.getState().addNodeInstance('g1', 'p-new', { x: 10, y: 20 }, 'i-new');
            });

            const state = useGraphStore.getState();
            expect(state.nodePrototypes.get('p-new')).toMatchObject({ id: 'p-new', name: 'Thing p-new' });

            const instances = state.graphs.get('g1').instances;
            expect(instances.size).toBe(1);
            expect(instances.get('i-new')).toEqual({ id: 'i-new', prototypeId: 'p-new', x: 10, y: 20, scale: 1 });
        });

        it('addNodeInstance: should refuse a prototype that does not exist', () => {
            act(() => { useGraphStore.setState({ graphs: new Map([['g1', createGraphData('g1')]]) }); });
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            act(() => { useGraphStore.getState().addNodeInstance('g1', 'p-missing', { x: 0, y: 0 }, 'i-x'); });

            expect(useGraphStore.getState().graphs.get('g1').instances.size).toBe(0);
            errorSpy.mockRestore();
        });

        it('updateNodePrototype / updateNodeInstance: should update existing node data', () => {
            seedConnectedPair();

            act(() => {
                useGraphStore.getState().updateNodePrototype('p1', (proto) => {
                    proto.name = 'Updated Name';
                    proto.description = 'updated';
                });
                useGraphStore.getState().updateNodeInstance('g1', 'i1', (inst) => {
                    inst.x = 42;
                });
            });

            const state = useGraphStore.getState();
            expect(state.nodePrototypes.get('p1').name).toBe('Updated Name');
            expect(state.nodePrototypes.get('p1').description).toBe('updated');
            expect(state.graphs.get('g1').instances.get('i1').x).toBe(42);
            // The other Thing is untouched
            expect(state.nodePrototypes.get('p2').name).toBe('Thing p2');
        });

        it('addEdge: should add new edge data to the edge pool and the graph', () => {
            seedConnectedPair();
            act(() => { useGraphStore.getState().removeEdge('e1'); });

            const newEdgeData = createEdgeData('e2', 'i1', 'i2');
            act(() => {
                useGraphStore.getState().addEdge('g1', newEdgeData);
            });

            const state = useGraphStore.getState();
            expect(state.edges.size).toBe(1);
            expect(state.edges.get('e2')).toMatchObject({ id: 'e2', sourceId: 'i1', destinationId: 'i2' });
            expect(state.graphs.get('g1').edgeIds).toEqual(['e2']);
        });

        it('addEdge: should refuse an edge whose ends are not in the graph', () => {
            seedConnectedPair();
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            act(() => {
                useGraphStore.getState().addEdge('g1', createEdgeData('e-bad', 'i1', 'i-missing'));
            });

            const state = useGraphStore.getState();
            expect(state.edges.has('e-bad')).toBe(false);
            expect(state.graphs.get('g1').edgeIds).toEqual(['e1']);
            errorSpy.mockRestore();
        });

        it('removeNodeInstance: should remove the instance and its connected edges', () => {
            seedConnectedPair();
            // A third Thing connected to i2 only: its edge must survive.
            act(() => {
                useGraphStore.getState().addNodeInstance('g1', 'p2', { x: 200, y: 0 }, 'i3');
                useGraphStore.getState().addEdge('g1', createEdgeData('e2', 'i2', 'i3'));
            });

            act(() => {
                useGraphStore.getState().removeNodeInstance('g1', 'i1');
            });

            const state = useGraphStore.getState();
            const graph = state.graphs.get('g1');

            // Instance removed, others kept
            expect(graph.instances.has('i1')).toBe(false);
            expect(Array.from(graph.instances.keys())).toEqual(['i2', 'i3']);

            // Connected edge removed from the pool and the graph; unrelated edge kept
            expect(state.edges.has('e1')).toBe(false);
            expect(state.edges.has('e2')).toBe(true);
            expect(graph.edgeIds).toEqual(['e2']);

            // Removing a placement does not delete the Thing itself
            expect(state.nodePrototypes.has('p1')).toBe(true);
        });

        it('removeEdge: should remove edge data and its reference from the graph', () => {
            seedConnectedPair();

            act(() => {
                useGraphStore.getState().removeEdge('e1');
            });

            const state = useGraphStore.getState();

            // Check edge removed
            expect(state.edges.has('e1')).toBe(false);
            expect(state.edges.size).toBe(0);

            // Check graph updated; the Things it connected stay placed
            const updatedGraph = state.graphs.get('g1');
            expect(updatedGraph.edgeIds).toEqual([]);
            expect(Array.from(updatedGraph.instances.keys())).toEqual(['i1', 'i2']);
        });

        // --- Tab Management Tests (should still pass if logic unchanged) ---
        it('openGraphTab: should add graph id to openGraphIds if valid and not already open', () => {
            const graphData1 = createGraphData('g1');
             act(() => { useGraphStore.setState({ graphs: new Map([['g1', graphData1]]) }); });
            // Manually set active/open state for test setup
            act(() => { useGraphStore.setState({ openGraphIds: ['g1'], activeGraphId: 'g1' }) }); 
            act(() => { useGraphStore.setState({ openGraphIds: [] }); }); // Manually close

            act(() => {
                useGraphStore.getState().openGraphTab('g1');
            });
            expect(useGraphStore.getState().openGraphIds).toEqual(['g1']);

            act(() => { useGraphStore.getState().openGraphTab('g1'); }); // Try opening again
            expect(useGraphStore.getState().openGraphIds).toEqual(['g1']);

            act(() => { useGraphStore.getState().openGraphTab('g-nonexistent'); }); // Try non-existent
            expect(useGraphStore.getState().openGraphIds).toEqual(['g1']);
        });

        it('closeGraphTab: should remove graph id from openGraphIds and update active graph', () => {
            const graphData1 = createGraphData('g1');
            const graphData2 = createGraphData('g2');
            act(() => {
                useGraphStore.setState({ 
                    graphs: new Map([['g1', graphData1], ['g2', graphData2]]), 
                    openGraphIds: ['g1', 'g2'], 
                    activeGraphId: 'g2' 
                }); 
            });

            // Close inactive tab g1
            act(() => { useGraphStore.getState().closeGraphTab('g1'); });
            expect(useGraphStore.getState().openGraphIds).toEqual(['g2']);
            expect(useGraphStore.getState().activeGraphId).toBe('g2');

            // Close active tab g2
            act(() => { useGraphStore.getState().closeGraphTab('g2'); });
            expect(useGraphStore.getState().openGraphIds).toEqual([]);
            expect(useGraphStore.getState().activeGraphId).toBeNull();
        });

        it('setActiveGraphTab: should set the active graph id if it is open', () => {
            const graphData1 = createGraphData('g1');
            const graphData2 = createGraphData('g2');
            act(() => {
                useGraphStore.setState({ 
                    graphs: new Map([['g1', graphData1], ['g2', graphData2]]), 
                    openGraphIds: ['g1', 'g2'], 
                    activeGraphId: 'g1' 
                }); 
            });

            act(() => { useGraphStore.getState().setActiveGraphTab('g2'); });
            expect(useGraphStore.getState().activeGraphId).toBe('g2');

            // Try setting non-open but existing graph
            act(() => {
                useGraphStore.setState(state => ({
                    graphs: new Map([...state.graphs, ['g3', createGraphData('g3')]])
                }));
            });
            expect(useGraphStore.getState().openGraphIds).not.toContain('g3');

            act(() => { useGraphStore.getState().setActiveGraphTab('g3'); });
            expect(useGraphStore.getState().activeGraphId).toBe('g2'); // Should not change

            // Set active to null
            act(() => { useGraphStore.getState().setActiveGraphTab(null); });
            expect(useGraphStore.getState().activeGraphId).toBeNull();
        });
    });

    // --- Selector Tests --- (Using plain data with injected state)

    describe('selectors', () => {
        let protoA, protoB, instA, instB, instC, edgeDataX, graphDataX, graphDataY, testState;

        // Inject test state for selectors
        beforeEach(() => {
            protoA = createPrototypeData('pA', { name: 'Thing A' });
            protoB = createPrototypeData('pB', { name: 'Thing B' });
            instA = createInstanceData('iA', 'pA', { x: 1 });
            instB = createInstanceData('iB', 'pB', { x: 2 });
            instC = createInstanceData('iC', 'pA', { x: 3 }); // a second placement of Thing A
            edgeDataX = createEdgeData('eX', 'iA', 'iB');
            graphDataX = createGraphData('gX', [instA, instB], ['eX'], { name: 'Graph X' });
            graphDataY = createGraphData('gY', [instC], [], { name: 'Graph Y' });

            testState = {
                graphs: new Map([['gX', graphDataX], ['gY', graphDataY]]),
                nodePrototypes: new Map([['pA', protoA], ['pB', protoB]]),
                edges: new Map([['eX', edgeDataX]]),
                openGraphIds: ['gX', 'gY'],
                activeGraphId: 'gX',
            };
            useGraphStore.setState(testState, true);
        });

        it('getGraphDataById: should return the correct graph data', () => {
            expect(getGraphDataById('gY')(useGraphStore.getState())).toEqual(graphDataY);
            const selectorNonExistent = getGraphDataById('gZ');
            expect(selectorNonExistent(testState)).toBeUndefined();
        });

        it('getNodePrototypeById: should return the correct prototype data', () => {
            expect(getNodePrototypeById('pB')(useGraphStore.getState())).toEqual(protoB);
            const selectorNonExistent = getNodePrototypeById('pD');
            expect(selectorNonExistent(testState)).toBeUndefined();
        });

        it('getEdgeDataById: should return the correct edge data', () => {
            expect(getEdgeDataById('eX')(useGraphStore.getState())).toEqual(edgeDataX);
            expect(getEdgeDataById('eY')(useGraphStore.getState())).toBeUndefined();
        });

        it('getActiveGraphData: should return the active graph data', () => {
            expect(getActiveGraphData(useGraphStore.getState())).toEqual(graphDataX);
            act(() => { useGraphStore.setState({ activeGraphId: null }); });
            expect(getActiveGraphData(useGraphStore.getState())).toBeUndefined();
        });

        it('getInstancesForGraph: should return the instances placed in the graph', () => {
            expect(getInstancesForGraph('gX')(useGraphStore.getState())).toEqual([instA, instB]);
            expect(getInstancesForGraph('gY')(useGraphStore.getState())).toEqual([instC]);
            expect(getInstancesForGraph('gZ')(useGraphStore.getState())).toEqual([]);
        });

        it('getHydratedNodesForGraph: should combine each instance with its prototype', () => {
            const nodesX = getHydratedNodesForGraph('gX')(useGraphStore.getState());
            expect(nodesX).toEqual([
                { ...protoA, ...instA },
                { ...protoB, ...instB },
            ]);
            // The instance id wins over the prototype id; the name comes from the prototype
            expect(nodesX[0].id).toBe('iA');
            expect(nodesX[0].name).toBe('Thing A');

            const nodesY = getHydratedNodesForGraph('gY')(useGraphStore.getState());
            expect(nodesY).toEqual([{ ...protoA, ...instC }]);
            expect(getHydratedNodesForGraph('gZ')(useGraphStore.getState())).toEqual([]);
        });

        it('getEdgesForGraph: should return correct edge data for the graph', () => {
            const edgesX = getEdgesForGraph('gX')(useGraphStore.getState());
            expect(edgesX).toEqual([edgeDataX]);
            const edgesY = getEdgesForGraph('gY')(useGraphStore.getState());
            expect(edgesY).toEqual([]);
        });

        it('getGraphTitleById: should return the graph name', () => {
            expect(getGraphTitleById('gX')(useGraphStore.getState())).toBe('Graph X');
            expect(getGraphTitleById('gY')(useGraphStore.getState())).toBe('Graph Y');
            const selectorNonExistent = getGraphTitleById('gNon');
            expect(selectorNonExistent(testState)).toBeNull();
        });

        it('getOpenGraphIds: should return the array of open graph IDs', () => {
            expect(getOpenGraphIds(testState)).toEqual(['gX', 'gY']);
        });

        it('getActiveGraphId: should return the ID of the active graph', () => {
            expect(getActiveGraphId(testState)).toBe('gX');
        });
    });
});
