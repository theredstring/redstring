import { describe, it, expect, beforeEach } from 'vitest';
import Edge from '../../src/core/Edge';
import Node from '../../src/core/Node'; // Keep for context, though we use IDs
import Entry from '../../src/core/Entry'; // Import Entry to check inheritance
import { validate as uuidValidate } from 'uuid';

describe('Edge Class', () => {
  let sourceNodeId;
  let destNodeId;
  let defNodeId;
  let sourceNode; // Keep actual nodes for context if needed elsewhere, but use IDs
  let destNode;
  let defNode;

  beforeEach(() => {
    // Create fresh nodes for each test and get their IDs
    sourceNode = new Node(null, 'Source');
    destNode = new Node(null, 'Destination');
    defNode = new Node(null, 'Definition');
    sourceNodeId = sourceNode.getId();
    destNodeId = destNode.getId();
    defNodeId = defNode.getId();
  });

  it('should initialize with required source and destination node IDs and generate a UUID', () => {
    const edge = new Edge(sourceNodeId, destNodeId);
    expect(edge.getSourceId()).toBe(sourceNodeId);
    expect(edge.getDestinationId()).toBe(destNodeId);
    expect(edge.getDefinitionNodeIds()).toEqual([]);
    expect(edge.getName()).toBe('Untitled');
    expect(edge.getId()).toBeTypeOf('string');
    expect(uuidValidate(edge.getId())).toBe(true);
  });

  it('should initialize with source, destination, and a definition node ID', () => {
    const edge = new Edge(sourceNodeId, destNodeId, defNodeId);
    expect(edge.getSourceId()).toBe(sourceNodeId);
    expect(edge.getDestinationId()).toBe(destNodeId);
    expect(edge.getDefinitionNodeIds()).toHaveLength(1);
    expect(edge.getDefinitionNodeIds()[0]).toBe(defNodeId);
  });

  it('should initialize with all Entry properties and a specific ID', () => {
    const specificId = 'edge-test-id-123';
    const edge = new Edge(sourceNodeId, destNodeId, defNodeId, 'Edge 1', 'Edge Desc', 'edge.gif', '#ffff00', specificId);
    expect(edge.getName()).toBe('Edge 1');
    expect(edge.getDescription()).toBe('Edge Desc');
    expect(edge.getPicture()).toBe('edge.gif');
    expect(edge.getColor()).toBe('#ffff00');
    expect(edge.getId()).toBe(specificId);
  });

  it('should throw an error if sourceId is not a string', () => {
    expect(() => new Edge(123, destNodeId)).toThrow('Edge sourceId must be a non-empty string.');
    expect(() => new Edge('', destNodeId)).toThrow('Edge sourceId must be a non-empty string.');
  });

  it('should throw an error if destinationId is not a string', () => {
    expect(() => new Edge(sourceNodeId, null)).toThrow('Edge destinationId must be a non-empty string.');
    expect(() => new Edge(sourceNodeId, '')).toThrow('Edge destinationId must be a non-empty string.');
  });

  it('should throw an error if definitionNodeId is provided but not a string', () => {
    expect(() => new Edge(sourceNodeId, destNodeId, 123)).toThrow('Edge definitionNodeId must be a string.');
  });

  it('should allow adding a valid definition node ID after construction', () => {
    const edge = new Edge(sourceNodeId, destNodeId);
    const anotherDefNode = new Node(null, 'Another Def');
    const anotherDefNodeId = anotherDefNode.getId();
    edge.addDefinitionNodeId(anotherDefNodeId);
    expect(edge.getDefinitionNodeIds()).toHaveLength(1);
    expect(edge.getDefinitionNodeIds()[0]).toBe(anotherDefNodeId);
  });

   it('should throw an error when adding an invalid definition node ID', () => {
    const edge = new Edge(sourceNodeId, destNodeId);
    expect(() => edge.addDefinitionNodeId(null)).toThrow('Edge definitionNodeId must be a non-empty string.');
    expect(() => edge.addDefinitionNodeId('')).toThrow('Edge definitionNodeId must be a non-empty string.');
  });

  it('should inherit methods from Entry', () => {
    const edge = new Edge(sourceNodeId, destNodeId);
    edge.setName('Updated Edge Name');
    expect(edge.getName()).toBe('Updated Edge Name');
    expect(edge instanceof Entry).toBe(true);
  });

  it('should clone correctly', () => {
    const originalEdge = new Edge(sourceNodeId, destNodeId, defNodeId, 'Original', 'Desc', 'pic.png', '#123456');
    originalEdge.addDefinitionNodeId('another-def-id');
    const clonedEdge = originalEdge.clone();

    expect(clonedEdge).not.toBe(originalEdge);
    expect(clonedEdge.getId()).toBe(originalEdge.getId());
    expect(clonedEdge.getSourceId()).toBe(originalEdge.getSourceId());
    expect(clonedEdge.getDestinationId()).toBe(originalEdge.getDestinationId());
    expect(clonedEdge.getName()).toBe(originalEdge.getName());
    expect(clonedEdge.getDescription()).toBe(originalEdge.getDescription());
    expect(clonedEdge.getPicture()).toBe(originalEdge.getPicture());
    expect(clonedEdge.getColor()).toBe(originalEdge.getColor());
    expect(clonedEdge.getDefinitionNodeIds()).toEqual(originalEdge.getDefinitionNodeIds());
    expect(clonedEdge.getDefinitionNodeIds()).not.toBe(originalEdge.getDefinitionNodeIds()); // Ensure array is shallow copied
  });
}); 