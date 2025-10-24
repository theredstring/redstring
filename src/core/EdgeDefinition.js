import Node from './Node.js';

/**
 * Represents the definition of an edge type, often linked to a specific Node.
 * Equivalent to EdgeDefinition.java.
 */
class EdgeDefinition {
  /**
   * @param {Node} node - The node that defines this edge type.
   */
  constructor(node) {
    if (!(node instanceof Node)) {
      throw new Error('EdgeDefinition requires an instance of Node.');
    }

    /** @type {Node} The defining node. */
    this.node = node;
    /** @type {string} The color, typically inherited from the defining node. */
    this.color = node.getColor(); // Inherit color from the node
    /** @type {string} The title, typically inherited from the defining node's name. */
    this.title = node.getName(); // Inherit title from the node's name (assumption based on Java code)
  }

  // Getters
  getNode() {
    return this.node;
  }

  getColor() {
    return this.color;
  }

  getTitle() {
    return this.title;
  }

  // Setters
  setNode(node) {
    if (!(node instanceof Node)) {
        throw new Error('Cannot set node: value must be an instance of Node.');
    }
    this.node = node;
  }

  setColor(color) {
    this.color = color;
  }

  setTitle(title) {
    this.title = title;
  }
}

export default EdgeDefinition; 