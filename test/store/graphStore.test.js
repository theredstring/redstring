import { act } from '@testing-library/react';
// Import Vitest functions
import { describe, it, expect, beforeEach, vi } from 'vitest';
// Adjust import path for the store
import useGraphStore, {
    // Import selectors using new names (Data suffix)
    getGraphDataById,
    getNodeDataById,
    getEdgeDataById, // New selector
    getActiveGraphData,
    getNodesForGraph,
    getEdgesForGraph, // New selector
    getNodesByParent,
    getGraphTitleById,
    getOpenGraphIds,
    getActiveGraphId
} from '../../src/store/graphStore.jsx'; // Corrected path: from test/store go up two levels, then src/store
// No longer need class imports
// import Node from '../../src/core/Node';
// import Edge from '../../src/core/Edge';
import { v4 as uuidv4 } from 'uuid'; // For generating IDs in mocks

// --- Helper Functions to create Plain Test Data ---

const createNodeData = (id = uuidv4(), overrides = {}) => ({
    id,
    name: `Node ${id}`,
    description: 'Node Description',
    picture: '',
    color: '',
    data: { value: `Data for ${id}` },
    x: 0,
    y: 0,
    scale: 1,
    imageSrc: null,
    thumbnailSrc: null,
    imageAspectRatio: null,
    parentDefinitionNodeId: null,
    edgeIds: [], // Initialize with empty edge IDs
    definitionGraphIds: [],
    ...overrides, // Allow overriding defaults
});

const createEdgeData = (id = uuidv4(), sourceId, destinationId, overrides = {}) => ({
    id,
    sourceId,
    destinationId,
    definitionNodeId: null,
    name: `Edge ${id}`,
    description: 'Edge Description',
    picture: '',
    color: '',
    data: { value: `Data for ${id}` },
    directed: true,
    ...overrides,
});

const createGraphData = (id = uuidv4(), nodeIds = [], edgeIds = [], overrides = {}) => ({
    id,
    name: `Graph ${id}`,
    description: 'Graph Description',
    picture: '',
    color: '',
    directed: true,
    nodeIds: [...nodeIds],
    edgeIds: [...edgeIds],
    ...overrides,
});

// Mock Graph Instance (only for loadGraph action test)
// This mimics the *input* to loadGraph, not the stored state.
const mockGraphInstance = (id = uuidv4(), nodes = [], edges = []) => ({
    getId: vi.fn(() => id),
    getName: vi.fn(() => `Graph ${id}`),
    getDescription: vi.fn(() => 'Graph Description'),
    getPicture: vi.fn(() => ''),
    getColor: vi.fn(() => ''),
    isDirected: vi.fn(() => true),
    getNodes: vi.fn(() => nodes), // Returns array of mock Node instances
    getEdges: vi.fn(() => edges), // Returns array of mock Edge instances
});

// Mock Node Instance (only for loadGraph action test)
const mockNodeInstance = (id = uuidv4(), edgeIds = [], definitionGraphIds = []) => ({
    getId: vi.fn(() => id),
    getName: vi.fn(() => `Node ${id}`),
    getDescription: vi.fn(() => 'Node Description'),
    getPicture: vi.fn(() => ''),
    getColor: vi.fn(() => ''),
    getData: vi.fn(() => ({ value: `Data for ${id}` })),
    getX: vi.fn(() => 0),
    getY: vi.fn(() => 0),
    getScale: vi.fn(() => 1),
    getImageSrc: vi.fn(() => null),
    getThumbnailSrc: vi.fn(() => null),
    getImageAspectRatio: vi.fn(() => null),
    getParentDefinitionNodeId: vi.fn(() => null),
    getEdgeIds: vi.fn(() => edgeIds),
    getDefinitionGraphIds: vi.fn(() => definitionGraphIds),
});

// Mock Edge Instance (only for loadGraph action test)
const mockEdgeInstance = (id = uuidv4(), sourceId, destinationId) => ({
     getId: vi.fn(() => id),
    getSourceId: vi.fn(() => sourceId),
    getDestinationId: vi.fn(() => destinationId),
    getDefinitionNodeId: vi.fn(() => null),
    getName: vi.fn(() => `Edge ${id}`),
    getDescription: vi.fn(() => 'Edge Description'),
    getPicture: vi.fn(() => ''),
    getColor: vi.fn(() => ''),
    getData: vi.fn(() => ({ value: `Data for ${id}` })),
    isDirected: vi.fn(() => true),
});

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
        expect(state.nodes).toEqual(new Map());
        expect(state.edges).toEqual(new Map()); // Check initial edges map
        expect(state.openGraphIds).toEqual([]);
        expect(state.activeGraphId).toBeNull();
    });

    // --- Action Tests ---

    describe('actions', () => {
        it('loadGraph: should load graph, node, and edge data from instances', () => {
            // Create mock instances for input
            const nodeInst1 = mockNodeInstance('n1');
            const nodeInst2 = mockNodeInstance('n2', ['e1']);
            const edgeInst1 = mockEdgeInstance('e1', 'n1', 'n2');
            nodeInst1.getEdgeIds.mockReturnValue(['e1']); // Ensure node mocks return edgeId
            const graphInst1 = mockGraphInstance('g1', [nodeInst1, nodeInst2], [edgeInst1]);

            act(() => {
                useGraphStore.getState().loadGraph(graphInst1);
            });

            const state = useGraphStore.getState();

            // Check graphs map
            expect(state.graphs.size).toBe(1);
            const expectedGraphData = {
                id: 'g1', name: 'Graph g1', description: 'Graph Description', picture: '', color: '',
                directed: true, nodeIds: ['n1', 'n2'], edgeIds: ['e1']
            };
            expect(state.graphs.get('g1')).toEqual(expectedGraphData);

            // Check nodes map
            expect(state.nodes.size).toBe(2);
            const expectedNode1Data = createNodeData('n1', { edgeIds: ['e1'] });
            const expectedNode2Data = createNodeData('n2', { edgeIds: ['e1'] });
            expect(state.nodes.get('n1')).toEqual(expectedNode1Data);
            expect(state.nodes.get('n2')).toEqual(expectedNode2Data);

            // Check edges map
            expect(state.edges.size).toBe(1);
            const expectedEdge1Data = createEdgeData('e1', 'n1', 'n2');
            expect(state.edges.get('e1')).toEqual(expectedEdge1Data);

            // Check tab state
            expect(state.openGraphIds).toEqual(['g1']);
            expect(state.activeGraphId).toBe('g1');
        });

        it('loadGraph: should not reload data for an existing graph', () => {
            const graphInst1 = mockGraphInstance('g1');
            act(() => { useGraphStore.getState().loadGraph(graphInst1); });
            const state1 = useGraphStore.getState();
            act(() => { useGraphStore.getState().loadGraph(graphInst1); }); // Try loading again
            const state2 = useGraphStore.getState();

            expect(state2.graphs.size).toBe(1);
            expect(state2.nodes.size).toBe(0);
            expect(state2.edges.size).toBe(0);
            expect(state2).toEqual(state1); // Whole state should be unchanged
        });

        it('addNode: should add new node data to global pool and graph', () => {
            const graphData1 = createGraphData('g1');
            act(() => { useGraphStore.setState({ graphs: new Map([['g1', graphData1]]) }); }); // Setup initial graph

            const newNodeData = createNodeData('n-new');

            act(() => {
                useGraphStore.getState().addNode('g1', newNodeData);
            });

            const state = useGraphStore.getState();
            expect(state.nodes.size).toBe(1);
            expect(state.nodes.get('n-new')).toEqual(newNodeData);

            const updatedGraph = state.graphs.get('g1');
            expect(updatedGraph.nodeIds).toEqual(['n-new']); // Check ID added to graph
        });

        it('updateNode: should update existing node data', () => {
            const nodeData1 = createNodeData('n1', { data: { value: 'initial' } });
            act(() => { useGraphStore.setState({ nodes: new Map([['n1', nodeData1]]) }); });

            const updateFunction = (node) => ({ ...node, data: { value: 'updated' }, name: 'Updated Name' });

            act(() => {
                useGraphStore.getState().updateNode('n1', updateFunction);
            });

            const state = useGraphStore.getState();
            const updatedNode = state.nodes.get('n1');
            expect(updatedNode.data.value).toBe('updated');
            expect(updatedNode.name).toBe('Updated Name');
        });

        it('addEdge: should add new edge data to global pool, graph, and nodes', () => {
            const nodeData1 = createNodeData('n1');
            const nodeData2 = createNodeData('n2');
            const graphData1 = createGraphData('g1', ['n1', 'n2']);
            act(() => {
                useGraphStore.setState({ 
                    graphs: new Map([['g1', graphData1]]), 
                    nodes: new Map([['n1', nodeData1], ['n2', nodeData2]]) 
                }); 
            });

            const newEdgeData = createEdgeData('e1', 'n1', 'n2');

            act(() => {
                useGraphStore.getState().addEdge('g1', newEdgeData);
            });

            const state = useGraphStore.getState();
            expect(state.edges.size).toBe(1);
            expect(state.edges.get('e1')).toEqual(newEdgeData);

            // Check graph
            const updatedGraph = state.graphs.get('g1');
            expect(updatedGraph.edgeIds).toEqual(['e1']);

            // Check nodes
            const updatedNode1 = state.nodes.get('n1');
            const updatedNode2 = state.nodes.get('n2');
            expect(updatedNode1.edgeIds).toEqual(['e1']);
            expect(updatedNode2.edgeIds).toEqual(['e1']);
        });

        it('removeNode: should remove node data and associated edges/references', () => {
            const nodeData1 = createNodeData('n1', { edgeIds: ['e1'] });
            const nodeData2 = createNodeData('n2', { edgeIds: ['e1'] });
            const edgeData1 = createEdgeData('e1', 'n1', 'n2');
            const graphData1 = createGraphData('g1', ['n1', 'n2'], ['e1']);
            act(() => {
                useGraphStore.setState({ 
                    graphs: new Map([['g1', graphData1]]), 
                    nodes: new Map([['n1', nodeData1], ['n2', nodeData2]]), 
                    edges: new Map([['e1', edgeData1]])
                }); 
            });

            act(() => {
                useGraphStore.getState().removeNode('n1');
            });

            const state = useGraphStore.getState();

            // Check node removed
            expect(state.nodes.has('n1')).toBe(false);
            expect(state.nodes.size).toBe(1);

            // Check edge removed
            expect(state.edges.has('e1')).toBe(false);
            expect(state.edges.size).toBe(0);

            // Check graph updated
            const updatedGraph = state.graphs.get('g1');
            expect(updatedGraph.nodeIds).toEqual(['n2']);
            expect(updatedGraph.edgeIds).toEqual([]);

            // Check remaining node updated
            const updatedNode2 = state.nodes.get('n2');
            expect(updatedNode2.edgeIds).toEqual([]);
        });

        it('removeEdge: should remove edge data and references from graph/nodes', () => {
            const nodeData1 = createNodeData('n1', { edgeIds: ['e1'] });
            const nodeData2 = createNodeData('n2', { edgeIds: ['e1'] });
            const edgeData1 = createEdgeData('e1', 'n1', 'n2');
            const graphData1 = createGraphData('g1', ['n1', 'n2'], ['e1']);
            act(() => {
                useGraphStore.setState({ 
                    graphs: new Map([['g1', graphData1]]), 
                    nodes: new Map([['n1', nodeData1], ['n2', nodeData2]]), 
                    edges: new Map([['e1', edgeData1]])
                }); 
            });

            act(() => {
                useGraphStore.getState().removeEdge('e1');
            });

            const state = useGraphStore.getState();

            // Check edge removed
            expect(state.edges.has('e1')).toBe(false);
            expect(state.edges.size).toBe(0);

            // Check graph updated
            const updatedGraph = state.graphs.get('g1');
            expect(updatedGraph.edgeIds).toEqual([]);

            // Check nodes updated
            const updatedNode1 = state.nodes.get('n1');
            const updatedNode2 = state.nodes.get('n2');
            expect(updatedNode1.edgeIds).toEqual([]);
            expect(updatedNode2.edgeIds).toEqual([]);
        });

        // --- Tab Management Tests (should still pass if logic unchanged) ---
        it('openGraphTab: should add graph id to openGraphIds if valid and not already open', () => {
            const graphData1 = createGraphData('g1');
             act(() => { useGraphStore.setState({ graphs: new Map([['g1', graphData1]]) }); });
            // Manually set active/open state for test setup if loadGraph isn't used
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
            const graphInst3 = mockGraphInstance('g3'); // Use mock instance for loadGraph
            act(() => { useGraphStore.getState().loadGraph(graphInst3); });
            // Manually remove from open list if needed for the test condition
            act(() => { useGraphStore.setState(state => ({ openGraphIds: state.openGraphIds.filter(id => id !== 'g3') })) });

            act(() => { useGraphStore.getState().setActiveGraphTab('g3'); });
            expect(useGraphStore.getState().activeGraphId).toBe('g2'); // Should not change

            // Set active to null
            act(() => { useGraphStore.getState().setActiveGraphTab(null); });
            expect(useGraphStore.getState().activeGraphId).toBeNull();
        });
    });

    // --- Selector Tests --- (Using plain data with injected state)

    describe('selectors', () => {
        let nodeDataA, nodeDataB, nodeDataC, edgeDataX, graphDataX, graphDataY, testState;

        // Inject test state for selectors
        beforeEach(() => {
            // Define plain data for selector tests
            nodeDataA = createNodeData('nA', { parentDefinitionNodeId: 'parent1', edgeIds: ['eX'] });
            nodeDataB = createNodeData('nB', { parentDefinitionNodeId: 'parent1', edgeIds: ['eX'] });
            nodeDataC = createNodeData('nC', { parentDefinitionNodeId: 'parent2' });
            edgeDataX = createEdgeData('eX', 'nA', 'nB');
            graphDataX = createGraphData('gX', ['nA', 'nB'], ['eX'], { name: 'Graph X' });
            graphDataY = createGraphData('gY', ['nC'], [], { name: 'Graph Y' });

            testState = {
                graphs: new Map([['gX', graphDataX], ['gY', graphDataY]]),
                nodes: new Map([['nA', nodeDataA], ['nB', nodeDataB], ['nC', nodeDataC]]),
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

        it('getNodeDataById: should return the correct node data', () => {
            expect(getNodeDataById('nB')(useGraphStore.getState())).toEqual(nodeDataB);
            const selectorNonExistent = getNodeDataById('nD');
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

        it('getNodesForGraph: should return correct node data for the graph', () => {
            const nodesX = getNodesForGraph('gX')(useGraphStore.getState());
            expect(nodesX).toEqual([nodeDataA, nodeDataB]); // Order might depend on map/array stability
            const selectorY = getNodesForGraph('gY');
            const nodesY = selectorY(useGraphStore.getState());
            expect(nodesY).toEqual([nodeDataC]);
            const nodesZ = getNodesForGraph('gZ')(useGraphStore.getState());
            expect(nodesZ).toEqual([]);
        });

        it('getEdgesForGraph: should return correct edge data for the graph', () => {
            const edgesX = getEdgesForGraph('gX')(useGraphStore.getState());
            expect(edgesX).toEqual([edgeDataX]);
            const edgesY = getEdgesForGraph('gY')(useGraphStore.getState());
            expect(edgesY).toEqual([]);
        });

        it('getNodesByParent: should return nodes with the specified parentDefinitionNodeId', () => {
            const nodesP1 = getNodesByParent('parent1')(useGraphStore.getState());
            expect(nodesP1).toEqual([nodeDataA, nodeDataB]);
            const nodesP2 = getNodesByParent('parent2')(useGraphStore.getState());
            expect(nodesP2).toEqual([nodeDataC]);
            const nodesP3 = getNodesByParent('parent3')(useGraphStore.getState());
            expect(nodesP3).toEqual([]);
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