import { describe, it, expect, beforeEach } from 'vitest';
import Graph from '../../src/core/Graph';
import Node from '../../src/core/Node';
import Edge from '../../src/core/Edge';
import Entry from '../../src/core/Entry';
import { validate as uuidValidate } from 'uuid';

describe('Graph Class', () => {
  let graph;
  let nodeA;
  let nodeB;
  let nodeC;
  let nodeAId;
  let nodeBId;
  let nodeCId;

  beforeEach(() => {
    // Create a fresh graph and nodes for each test
    graph = new Graph(true, 'Test Graph', 'Graph Desc', 'graph.png', '#eeeeee'); // Directed, ID auto-generated
    nodeA = new Node({ data: 'dataA' }, 'A');
    nodeB = new Node({ data: 'dataB' }, 'B');
    nodeC = new Node({ data: 'dataC' }, 'C');
    nodeAId = nodeA.getId();
    nodeBId = nodeB.getId();
    nodeCId = nodeC.getId();

    // Add nodes to graph for most tests
    graph.addNode(nodeA);
    graph.addNode(nodeB);
    graph.addNode(nodeC);
  });

  it('should initialize with default and provided values, inheriting from Entry, and generate UUID', () => {
    const specificId = 'graph-test-id';
    const specificGraph = new Graph(true, 'Specific Graph', 'Specific Desc', 's_graph.png', '#111111', specificId);
    expect(specificGraph.isDirected()).toBe(true);
    expect(specificGraph.getNodes()).toEqual([]);
    expect(specificGraph.getEdges()).toEqual([]);
    expect(specificGraph.getName()).toBe('Specific Graph');
    expect(specificGraph.getDescription()).toBe('Specific Desc');
    expect(specificGraph.getPicture()).toBe('s_graph.png');
    expect(specificGraph.getColor()).toBe('#111111');
    expect(specificGraph.getId()).toBe(specificId);
    expect(specificGraph instanceof Entry).toBe(true);

    // Test auto-generated ID
    const autoIdGraph = new Graph();
    expect(uuidValidate(autoIdGraph.getId())).toBe(true);
    expect(autoIdGraph.getNodes()).toEqual([]);
    expect(autoIdGraph.getEdges()).toEqual([]);
    expect(autoIdGraph.isDirected()).toBe(true); // Default
  });

  it('should allow initializing as an undirected graph', () => {
    const undirectedGraph = new Graph(false, 'Undirected');
    expect(undirectedGraph.isDirected()).toBe(false);
  });

  // --- Node Management Tests ---

  it('should add nodes correctly and get them', () => {
    const freshGraph = new Graph();
    freshGraph.addNode(nodeA);
    freshGraph.addNode(nodeB);
    expect(freshGraph.getNodes()).toHaveLength(2);
    expect(freshGraph.getNodes()).toContain(nodeA);
    expect(freshGraph.getNodes()).toContain(nodeB);
    expect(freshGraph.getNodeById(nodeAId)).toBe(nodeA);
    expect(freshGraph.getNodeById(nodeBId)).toBe(nodeB);
    expect(freshGraph.getNodeById('non-existent-id')).toBeUndefined();
  });

  it('should not add a node if ID already exists (and warn)', () => {
    const initialNodeCount = graph.getNodes().length;
    const duplicateNode = new Node(null, 'Duplicate A', undefined, undefined, undefined, nodeAId); // Same ID as nodeA
    // Mock console.warn if desired
    graph.addNode(duplicateNode);
    expect(graph.getNodes().length).toBe(initialNodeCount); // Count shouldn't change
    expect(graph.getNodeById(nodeAId)).toBe(nodeA); // Original node should remain
  });

  it('should throw an error when adding non-Node objects', () => {
    expect(() => graph.addNode('not-a-node')).toThrow('Can only add Node instances to the graph.');
  });

  it('should update a node by ID', () => {
    const updatedNodeA = nodeA.clone();
    updatedNodeA.setName('Updated A');
    updatedNodeA.setData({ newData: 'stuff' });

    const result = graph.updateNode(updatedNodeA);
    expect(result).toBe(true);
    const fetchedNode = graph.getNodeById(nodeAId);
    expect(fetchedNode).toBe(updatedNodeA); // Should be the new instance
    expect(fetchedNode.getName()).toBe('Updated A');
    expect(fetchedNode.getData()).toEqual({ newData: 'stuff' });
  });

  it('should return false when updating a non-existent node', () => {
    const nonExistentNode = new Node(null, 'Non-existent');
    // Mock console.warn if desired
    const result = graph.updateNode(nonExistentNode);
    expect(result).toBe(false);
  });

    it('should throw an error when updating with non-Node objects', () => {
        expect(() => graph.updateNode('not-a-node')).toThrow('Can only update Node instances in the graph.');
    });

  it('should remove nodes and associated edges correctly by ID', () => {
    const edgeAB = graph.addEdge(nodeAId, nodeBId);
    const edgeBC = graph.addEdge(nodeBId, nodeCId);
    const edgeCA = graph.addEdge(nodeCId, nodeAId);
    const edgeABId = edgeAB.getId();
    const edgeBCId = edgeBC.getId();
    const edgeCAId = edgeCA.getId();

    expect(graph.getNodes()).toHaveLength(3);
    expect(graph.getEdges()).toHaveLength(3);
    expect(graph.getNodeById(nodeAId).getEdgeIds()).toContain(edgeABId);
    expect(graph.getNodeById(nodeAId).getEdgeIds()).toContain(edgeCAId);
    expect(graph.getNodeById(nodeBId).getEdgeIds()).toContain(edgeABId);
    expect(graph.getNodeById(nodeBId).getEdgeIds()).toContain(edgeBCId);

    const removeResult = graph.removeNode(nodeBId); // Remove node B by ID

    expect(removeResult).toBe(true);
    expect(graph.getNodes()).toHaveLength(2);
    expect(graph.getNodeById(nodeBId)).toBeUndefined();
    expect(graph.getEdges()).toHaveLength(1); // Only edge C->A should remain
    expect(graph.getEdgeById(edgeABId)).toBeUndefined();
    expect(graph.getEdgeById(edgeBCId)).toBeUndefined();
    expect(graph.getEdgeById(edgeCAId)).toBe(edgeCA); // C->A remains

    // Check edge IDs removed from remaining nodes
    expect(graph.getNodeById(nodeAId).getEdgeIds()).not.toContain(edgeABId);
    expect(graph.getNodeById(nodeAId).getEdgeIds()).toContain(edgeCAId);
    expect(graph.getNodeById(nodeCId).getEdgeIds()).not.toContain(edgeBCId);
    expect(graph.getNodeById(nodeCId).getEdgeIds()).toContain(edgeCAId);
  });

  it('should return false when removing a non-existent node ID', () => {
    const result = graph.removeNode('non-existent-id');
    expect(result).toBe(false);
  });

  // --- Edge Management Tests ---

  it('should add edges correctly by ID and get them', () => {
    const edge1 = graph.addEdge(nodeAId, nodeBId, null, 'Edge AB');
    const edge2 = graph.addEdge(nodeBId, nodeCId); // No name provided, should default
    expect(edge1).toBeInstanceOf(Edge);
    expect(edge2).toBeInstanceOf(Edge);
    expect(edge1.getName()).toBe('Edge AB');
    expect(edge2.getName()).toBe('Untitled'); // Expecting default name
    expect(graph.getEdges()).toHaveLength(2);
    expect(graph.getEdges()).toContain(edge1);
    expect(graph.getEdges()).toContain(edge2);
    expect(graph.getEdgeById(edge1.getId())).toBe(edge1);
    expect(graph.getEdgeById(edge2.getId())).toBe(edge2);
    expect(graph.getEdgeById('non-existent-id')).toBeUndefined();

    // Check edge IDs added to nodes
    expect(graph.getNodeById(nodeAId).getEdgeIds()).toContain(edge1.getId());
    expect(graph.getNodeById(nodeBId).getEdgeIds()).toContain(edge1.getId());
    expect(graph.getNodeById(nodeBId).getEdgeIds()).toContain(edge2.getId());
    expect(graph.getNodeById(nodeCId).getEdgeIds()).toContain(edge2.getId());
  });

  it('should not add an edge if ID already exists (and warn)', () => {
      const edgeAB = graph.addEdge(nodeAId, nodeBId);
      const edgeABId = edgeAB.getId();
      const initialEdgeCount = graph.getEdges().length;

      // Attempt to add edge with the same explicit ID
      const duplicateEdge = graph.addEdge(nodeBId, nodeCId, null, 'Duplicate Edge', edgeABId);

      expect(graph.getEdges().length).toBe(initialEdgeCount);
      expect(graph.getEdgeById(edgeABId)).toBe(edgeAB); // Should be the original edge
      expect(duplicateEdge).toBe(edgeAB); // addEdge should return the existing edge
  });

  it('should throw an error when adding edge with non-existent node IDs', () => {
    expect(() => graph.addEdge('non-existent-id', nodeBId)).toThrow(/Source node with ID .* not found/);
    expect(() => graph.addEdge(nodeAId, 'non-existent-id')).toThrow(/Destination node with ID .* not found/);
  });

  it('should update an edge by ID', () => {
      const edgeAB = graph.addEdge(nodeAId, nodeBId);
      const edgeABId = edgeAB.getId();

      const updatedEdge = edgeAB.clone();
      updatedEdge.setName('Updated AB');
      updatedEdge.addDefinitionNodeId('def-id-123');

      const result = graph.updateEdge(updatedEdge);
      expect(result).toBe(true);
      const fetchedEdge = graph.getEdgeById(edgeABId);
      expect(fetchedEdge).toBe(updatedEdge);
      expect(fetchedEdge.getName()).toBe('Updated AB');
      expect(fetchedEdge.getDefinitionNodeIds()).toContain('def-id-123');
  });

    it('should return false when updating a non-existent edge', () => {
        const nonExistentEdge = new Edge(nodeAId, nodeBId);
        // Mock console.warn if desired
        const result = graph.updateEdge(nonExistentEdge);
        expect(result).toBe(false);
    });

    it('should throw an error when updating with non-Edge objects', () => {
        expect(() => graph.updateEdge('not-an-edge')).toThrow('Can only update Edge instances in the graph.');
    });

  it('should remove edges correctly by ID', () => {
    const edgeAB = graph.addEdge(nodeAId, nodeBId);
    const edgeBC = graph.addEdge(nodeBId, nodeCId);
    const edgeABId = edgeAB.getId();
    const edgeBCId = edgeBC.getId();

    expect(graph.getEdges()).toHaveLength(2);
    expect(graph.getNodeById(nodeAId).getEdgeIds()).toContain(edgeABId);
    expect(graph.getNodeById(nodeBId).getEdgeIds()).toContain(edgeABId);
    expect(graph.getNodeById(nodeBId).getEdgeIds()).toContain(edgeBCId);

    const removeResult = graph.removeEdge(edgeABId);
    expect(removeResult).toBe(true);
    expect(graph.getEdges()).toHaveLength(1);
    expect(graph.getEdgeById(edgeABId)).toBeUndefined();
    expect(graph.getEdgeById(edgeBCId)).toBe(edgeBC); // BC remains

    // Check edge ID removed from nodes
    expect(graph.getNodeById(nodeAId).getEdgeIds()).not.toContain(edgeABId);
    expect(graph.getNodeById(nodeBId).getEdgeIds()).not.toContain(edgeABId);
    expect(graph.getNodeById(nodeBId).getEdgeIds()).toContain(edgeBCId); // B still connected to C
  });

  it('should return false when removing a non-existent edge ID', () => {
    const result = graph.removeEdge('non-existent-id');
    expect(result).toBe(false);
  });

  // --- Graph Operations ---

  it('should shallow clone the graph correctly', () => {
    const edgeAB = graph.addEdge(nodeAId, nodeBId);
    const clonedGraph = graph.clone();

    expect(clonedGraph).not.toBe(graph);
    expect(clonedGraph.getId()).toBe(graph.getId());
    expect(clonedGraph.getName()).toBe(graph.getName());
    expect(clonedGraph.isDirected()).toBe(graph.isDirected());

    // Check nodes (should be same instances)
    expect(clonedGraph.getNodes()).toHaveLength(graph.getNodes().length);
    expect(clonedGraph.getNodeById(nodeAId)).toBe(nodeA);
    expect(clonedGraph.getNodeById(nodeBId)).toBe(nodeB);

    // Check edges (should be same instances)
    expect(clonedGraph.getEdges()).toHaveLength(graph.getEdges().length);
    expect(clonedGraph.getEdgeById(edgeAB.getId())).toBe(edgeAB);

    // Modify original graph - clone should NOT be affected (structural independence)
    const nodeD = new Node(null, 'D');
    graph.addNode(nodeD);
    expect(clonedGraph.getNodes()).toHaveLength(3); // Clone still has 3 nodes
    expect(clonedGraph.getNodeById(nodeD.getId())).toBeUndefined();

    // Modify node in original - clone SHOULD be affected (shallow copy)
    nodeA.setName('Changed A in Original');
    expect(clonedGraph.getNodeById(nodeAId).getName()).toBe('Changed A in Original');
  });

  it('should deep clone the graph correctly', () => {
      const edgeAB = graph.addEdge(nodeAId, nodeBId);
      const deepClonedGraph = graph.deepClone();

      expect(deepClonedGraph).not.toBe(graph);
      expect(deepClonedGraph.getId()).toBe(graph.getId());
      expect(deepClonedGraph.getName()).toBe(graph.getName());

      // Check nodes (should be DIFFERENT instances but equal)
      expect(deepClonedGraph.getNodes()).toHaveLength(graph.getNodes().length);
      const clonedNodeA = deepClonedGraph.getNodeById(nodeAId);
      expect(clonedNodeA).not.toBe(nodeA);
      expect(clonedNodeA.getName()).toBe(nodeA.getName());
      expect(clonedNodeA.getData()).toEqual(nodeA.getData()); // Assuming data is cloneable or primitive

      // Check edges (should be DIFFERENT instances but equal)
      expect(deepClonedGraph.getEdges()).toHaveLength(graph.getEdges().length);
      const clonedEdgeAB = deepClonedGraph.getEdgeById(edgeAB.getId());
      expect(clonedEdgeAB).not.toBe(edgeAB);
      expect(clonedEdgeAB.getSourceId()).toBe(edgeAB.getSourceId());
      expect(clonedEdgeAB.getDestinationId()).toBe(edgeAB.getDestinationId());

      // Modify node in original - deep clone should NOT be affected
      nodeA.setName('Changed A in Original Again');
      expect(deepClonedGraph.getNodeById(nodeAId).getName()).not.toBe('Changed A in Original Again');
      expect(deepClonedGraph.getNodeById(nodeAId).getName()).toBe('A'); // Should have original name
  });

  it('should compose a new node defined by the graph ID', () => {
    graph.addEdge(nodeAId, nodeBId); // Add some structure
    const compositeNode = graph.compose('Composite Node', { compData: 1 });

    expect(compositeNode).toBeInstanceOf(Node);
    expect(compositeNode.getName()).toBe('Composite Node');
    expect(compositeNode.getData()).toEqual({ compData: 1 });
    expect(compositeNode.getDefinitionGraphIds()).toHaveLength(1);
    expect(compositeNode.getDefinitionGraphIds()[0]).toBe(graph.getId()); // Check for graph ID
    expect(uuidValidate(compositeNode.getId())).toBe(true);
  });
}); 