import { describe, it, expect, beforeEach } from 'vitest';
import Node from '../../src/core/Node';
// Edge and Graph imports are no longer needed for basic Node tests as we use IDs
// import Edge from '../../src/core/Edge';
// import Graph from '../../src/core/Graph';
import { validate as uuidValidate } from 'uuid';

describe('Node Class', () => {
  let node;
  const testData = { key: 'value' };
  const testParentId = 'parent-node-uuid';
  const testGraphId1 = 'graph-uuid-1';
  const testGraphId2 = 'graph-uuid-2';
  const testEdgeId1 = 'edge-uuid-1';
  const testEdgeId2 = 'edge-uuid-2';

  beforeEach(() => {
    // Create a fresh node for tests that modify it
    node = new Node(testData, 'Node 1', 'Node Desc', 'node.png', '#0000ff', 'specific-node-id', 10, 20, 1.5, 'img.jpg', 'thumb.jpg', 16/9, testParentId);
  });

  it('should initialize with default values and generate a UUID', () => {
    const defaultNode = new Node();
    // Inherited defaults (Entry checks null ID)
    expect(defaultNode.getName()).toBe('Untitled');
    expect(defaultNode.getDescription()).toBe('No description.');
    expect(defaultNode.getPicture()).toBe('');
    expect(defaultNode.getColor()).toBe('');
    expect(uuidValidate(defaultNode.getId())).toBe(true); // Auto-generated UUID
    // Node specific defaults
    expect(defaultNode.getData()).toBeNull();
    expect(defaultNode.getX()).toBe(0);
    expect(defaultNode.getY()).toBe(0);
    expect(defaultNode.getScale()).toBe(1);
    expect(defaultNode.getImageSrc()).toBeNull();
    expect(defaultNode.getThumbnailSrc()).toBeNull();
    expect(defaultNode.getImageAspectRatio()).toBeNull();
    expect(defaultNode.getParentDefinitionNodeId()).toBeNull();
    expect(defaultNode.getEdgeIds()).toEqual([]);
    expect(defaultNode.getDefinitionGraphIds()).toEqual([]);
  });

  it('should initialize with provided values', () => {
    // Uses the node created in beforeEach
    expect(node.getName()).toBe('Node 1');
    expect(node.getDescription()).toBe('Node Desc');
    expect(node.getPicture()).toBe('node.png');
    expect(node.getColor()).toBe('#0000ff');
    expect(node.getId()).toBe('specific-node-id');
    expect(node.getData()).toBe(testData);
    expect(node.getX()).toBe(10);
    expect(node.getY()).toBe(20);
    expect(node.getScale()).toBe(1.5);
    expect(node.getImageSrc()).toBe('img.jpg');
    expect(node.getThumbnailSrc()).toBe('thumb.jpg');
    expect(node.getImageAspectRatio()).toBe(16/9);
    expect(node.getParentDefinitionNodeId()).toBe(testParentId);
    // edgeIds and definitionGraphIds start empty even when other args provided
    expect(node.getEdgeIds()).toEqual([]);
    expect(node.getDefinitionGraphIds()).toEqual([]);
  });

  it('should allow setting and getting data', () => {
    const newNode = new Node();
    const newData = { updated: true };
    newNode.setData(newData);
    expect(newNode.getData()).toBe(newData);
  });

  it('should add, get, and remove edge IDs correctly', () => {
    node.addEdgeId(testEdgeId1);
    node.addEdgeId(testEdgeId2);
    expect(node.getEdgeIds()).toHaveLength(2);
    expect(node.getEdgeIds()).toEqual([testEdgeId1, testEdgeId2]);

    const removed = node.removeEdgeId(testEdgeId1);
    expect(removed).toBe(true);
    expect(node.getEdgeIds()).toHaveLength(1);
    expect(node.getEdgeIds()).toEqual([testEdgeId2]);

    const removedAgain = node.removeEdgeId(testEdgeId1); // Try removing non-existent
    expect(removedAgain).toBe(false);
    expect(node.getEdgeIds()).toHaveLength(1);

    node.removeEdgeId(testEdgeId2);
    expect(node.getEdgeIds()).toEqual([]);
  });

  it('should add and get graph definition IDs correctly', () => {
    node.addDefinitionGraphId(testGraphId1);
    const result = node.addDefinitionGraphId(testGraphId2);
    expect(result).toBe(true); // Check return value consistency
    expect(node.getDefinitionGraphIds()).toHaveLength(2);
    expect(node.getDefinitionGraphIds()).toEqual([testGraphId1, testGraphId2]);
  });

  it('should set and get parent definition node ID', () => {
    const newNode = new Node();
    expect(newNode.getParentDefinitionNodeId()).toBeNull(); // Default
    newNode.setParentDefinitionNodeId(testParentId);
    expect(newNode.getParentDefinitionNodeId()).toBe(testParentId);
    newNode.setParentDefinitionNodeId(null);
    expect(newNode.getParentDefinitionNodeId()).toBeNull(); // Can be set back to null
  });

  // --- UI Property Getters/Setters (Basic Checks) ---
  it('should set and get UI properties (x, y, scale)', () => {
    const newNode = new Node();
    newNode.setX(100);
    newNode.setY(-50);
    newNode.setScale(0.5);
    expect(newNode.getX()).toBe(100);
    expect(newNode.getY()).toBe(-50);
    expect(newNode.getScale()).toBe(0.5);
  });

  it('should set and get image properties', () => {
    const newNode = new Node();
    newNode.setImageSrc('full.png');
    newNode.setThumbnailSrc('thumb.png');
    newNode.setImageAspectRatio(1);
    newNode.setImageData('full2.png', 'thumb2.png'); // Test combined setter
    expect(newNode.getImageSrc()).toBe('full2.png');
    expect(newNode.getThumbnailSrc()).toBe('thumb2.png');
    expect(newNode.getImageAspectRatio()).toBe(1);
  });


  // --- Clone Test ---
  it('should clone correctly with all properties', () => {
    // Use the node from beforeEach, and add some IDs
    node.addEdgeId(testEdgeId1);
    node.addDefinitionGraphId(testGraphId1);

    const clonedNode = node.clone();

    // Assertions
    expect(clonedNode).not.toBe(node); // Should be a new object
    expect(clonedNode.getId()).toBe(node.getId()); // ID should be the same

    // Check all properties
    expect(clonedNode.getName()).toBe(node.getName());
    expect(clonedNode.getDescription()).toBe(node.getDescription());
    expect(clonedNode.getPicture()).toBe(node.getPicture());
    expect(clonedNode.getColor()).toBe(node.getColor());
    expect(clonedNode.getData()).toBe(node.getData()); // Shallow copy of data object
    expect(clonedNode.getX()).toBe(node.getX());
    expect(clonedNode.getY()).toBe(node.getY());
    expect(clonedNode.getScale()).toBe(node.getScale());
    expect(clonedNode.getImageSrc()).toBe(node.getImageSrc());
    expect(clonedNode.getThumbnailSrc()).toBe(node.getThumbnailSrc());
    expect(clonedNode.getImageAspectRatio()).toBe(node.getImageAspectRatio());
    expect(clonedNode.getParentDefinitionNodeId()).toBe(node.getParentDefinitionNodeId());

    // Check arrays (should be new arrays with same content)
    expect(clonedNode.getEdgeIds()).toEqual(node.getEdgeIds());
    expect(clonedNode.getEdgeIds()).not.toBe(node.getEdgeIds());
    expect(clonedNode.getDefinitionGraphIds()).toEqual(node.getDefinitionGraphIds());
    expect(clonedNode.getDefinitionGraphIds()).not.toBe(node.getDefinitionGraphIds());

    // Check that modifying the clone's array doesn't affect the original
    clonedNode.addEdgeId('new-clone-edge-id');
    expect(node.getEdgeIds()).not.toContain('new-clone-edge-id');
    expect(node.getEdgeIds()).toEqual([testEdgeId1]); // Original unchanged
  });
}); 