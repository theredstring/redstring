import { describe, it, expect, beforeEach } from 'vitest';
import EdgeDefinition from '../../src/core/EdgeDefinition';
import Node from '../../src/core/Node';

describe('EdgeDefinition Class', () => {
  let definingNode;

  beforeEach(() => {
    // Create a fresh node for each test
    definingNode = new Node(null, 'Def Node', 'Node used for definition', 'def.ico', '#cccccc', 99);
  });

  it('should initialize with a Node instance', () => {
    const edgeDef = new EdgeDefinition(definingNode);
    expect(edgeDef.getNode()).toBe(definingNode);
    // Check inherited properties (based on our implementation choices)
    expect(edgeDef.getColor()).toBe('#cccccc'); // Inherited from node
    expect(edgeDef.getTitle()).toBe('Def Node'); // Inherited from node's name
  });

  it('should throw an error if constructor argument is not a Node instance', () => {
    expect(() => new EdgeDefinition({})).toThrow('EdgeDefinition requires an instance of Node.');
    expect(() => new EdgeDefinition('not a node')).toThrow('EdgeDefinition requires an instance of Node.');
    expect(() => new EdgeDefinition(null)).toThrow('EdgeDefinition requires an instance of Node.');
  });

  it('should allow setting and getting the node', () => {
    const edgeDef = new EdgeDefinition(definingNode);
    const newNode = new Node(null, 'New Def Node');
    edgeDef.setNode(newNode);
    expect(edgeDef.getNode()).toBe(newNode);
  });

  it('should throw an error when setting node with an invalid type', () => {
    const edgeDef = new EdgeDefinition(definingNode);
    expect(() => edgeDef.setNode('invalid')).toThrow('Cannot set node: value must be an instance of Node.');
  });

  it('should allow setting and getting the color', () => {
    const edgeDef = new EdgeDefinition(definingNode);
    edgeDef.setColor('#123456');
    expect(edgeDef.getColor()).toBe('#123456');
  });

  it('should allow setting and getting the title', () => {
    const edgeDef = new EdgeDefinition(definingNode);
    edgeDef.setTitle('Explicit Title');
    expect(edgeDef.getTitle()).toBe('Explicit Title');
  });
}); 