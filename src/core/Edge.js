import Entry from './Entry.js';
import { v4 as uuidv4 } from 'uuid';
// Node import is just for type checking, we store IDs
// import Node from './Node.js';

/**
 * Represents an edge connecting two nodes in the graph.
 * Extends the base Entry class.
 * Stores references to nodes via their string IDs.
 * Equivalent to Edge.java.
 */
class Edge extends Entry {
  /**
   * @param {string} sourceId - The ID of the source node.
   * @param {string} destinationId - The ID of the destination node.
   * @param {string | null} [definitionNodeId=null] - Optional ID of the node defining the edge type/meaning.
   * @param {string} [name]
   * @param {string} [description]
   * @param {string} [picture]
   * @param {string} [color]
   * @param {string | null} [id=null] // Use string UUID, null generates one
   */
  constructor(sourceId, destinationId, definitionNodeId = null, name, description, picture, color, id = null) {
    // Call the parent Entry constructor, generate UUID if id is null
    super(name, description, picture, color, id === null ? uuidv4() : id);

    if (typeof sourceId !== 'string' || !sourceId) {
      throw new Error('Edge sourceId must be a non-empty string.');
    }
    if (typeof destinationId !== 'string' || !destinationId) {
      throw new Error('Edge destinationId must be a non-empty string.');
    }

    /** @type {string} The ID of the source node. */
    this.sourceId = sourceId;

    /** @type {string} The ID of the destination node. */
    this.destinationId = destinationId;

    /** @type {Array<string>} List of Node IDs defining this edge. */
    this.definitionNodeIds = [];

    if (definitionNodeId) {
      if (typeof definitionNodeId !== 'string') {
        throw new Error('Edge definitionNodeId must be a string.');
      }
      this.definitionNodeIds.push(definitionNodeId);
    }

    /** @type {Object} Node-relative directionality settings for the edge. */
    this.directionality = {
      arrowsToward: new Set() // Contains node IDs that have arrows pointing toward them
    };
  }

  /**
   * Gets the ID of the source node.
   * @returns {string}
   */
  getSourceId() {
    return this.sourceId;
  }

  /**
   * Gets the ID of the destination node.
   * @returns {string}
   */
  getDestinationId() {
    return this.destinationId;
  }

  /**
   * Gets the definition node IDs for this edge.
   * @returns {Array<string>}
   */
  getDefinitionNodeIds() {
    return this.definitionNodeIds;
  }

  /**
   * Adds a definition node ID for this edge.
   * @param {string} definitionNodeId
   */
  addDefinitionNodeId(definitionNodeId) {
     if (typeof definitionNodeId !== 'string' || !definitionNodeId) {
        throw new Error('Edge definitionNodeId must be a non-empty string.');
      }
    this.definitionNodeIds.push(definitionNodeId);
  }

  /**
   * Creates a clone of the edge.
   * @returns {Edge}
   */
  clone() {
    const newEdge = new Edge(
        this.sourceId,
        this.destinationId,
        null, // Definitions handled separately
        this.getName(),
        this.getDescription(),
        this.getPicture(),
        this.getColor(),
        this.getId() // Clone uses the same ID
    );
    // Shallow copy the definition ID array
    newEdge.definitionNodeIds = [...this.definitionNodeIds];
    // Copy the directionality settings - deep copy the Set
    newEdge.directionality = { 
      arrowsToward: new Set(this.directionality.arrowsToward) 
    };
    return newEdge;
  }
}

export default Edge; 