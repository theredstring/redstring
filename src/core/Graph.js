import Entry from './Entry.js';
import Node from './Node.js';
import Edge from './Edge.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Represents the graph structure containing nodes and edges.
 * Stores nodes and edges by their string IDs.
 * Extends the base Entry class.
 * Equivalent to Graph.java.
 */
class Graph extends Entry {
  /**
   * @param {boolean} [directed=true] - Whether the graph is directed.
   * @param {string} [name] - Name inherited from Entry.
   * @param {string} [description] - Description inherited from Entry.
   * @param {string} [picture] - Picture inherited from Entry.
   * @param {string} [color] - Color inherited from Entry.
   * @param {string | null} [id=null] - Use string UUID, null generates one
   */
  constructor(directed = true, name, description, picture, color, id = null) {
    // Call the parent Entry constructor, generate UUID if id is null
    super(name, description, picture, color, id === null ? uuidv4() : id);

    /** @type {Map<string, Node>} Map from Node ID to Node instance. */
    this.nodes = new Map();
    /** @type {Map<string, Edge>} Map from Edge ID to Edge instance. */
    this.edges = new Map();

    /** @type {boolean} Whether the graph is directed. */
    this.directed = directed;
  }

  /**
   * Checks if the graph is directed.
   * @returns {boolean}
   */
  isDirected() {
    return this.directed;
  }

  /**
   * Gets an array of all nodes in the graph.
   * @returns {Array<Node>}
   */
  getNodes() {
    return Array.from(this.nodes.values());
  }

  /**
   * Gets a node by its ID.
   * @param {string} nodeId
   * @returns {Node | undefined}
   */
  getNodeById(nodeId) {
    return this.nodes.get(nodeId);
  }

  /**
   * Adds a node to the graph.
   * @param {Node} node - The node to add.
   * @throws {Error} if the node is not a Node instance or ID already exists.
   */
  addNode(node) {
    if (!(node instanceof Node)) {
      throw new Error('Can only add Node instances to the graph.');
    }
    const nodeId = node.getId();
    if (this.nodes.has(nodeId)) {
      console.warn(`Graph.addNode: Node with ID ${nodeId} already exists. Ignoring.`);
      // Optionally throw an error: throw new Error(`Node with ID ${nodeId} already exists.`);
      return; // Don't add if ID exists
    }
    this.nodes.set(nodeId, node);
  }

  /**
   * Updates a node instance in the graph. Finds the node by ID and replaces it.
   * Ensures the node ID hasn't changed.
   * @param {Node} updatedNode - The updated node instance.
   * @returns {boolean} True if the node was found and updated, false otherwise.
   * @throws {Error} if the node is not a Node instance.
   */
  updateNode(updatedNode) {
    if (!(updatedNode instanceof Node)) {
      throw new Error('Can only update Node instances in the graph.');
    }
    const nodeId = updatedNode.getId();
    if (!this.nodes.has(nodeId)) {
      console.warn(`Graph.updateNode: Node with ID ${nodeId} not found.`);
      return false;
    }
    this.nodes.set(nodeId, updatedNode);
    return true;
  }

  /**
   * Removes a node and all connected edges from the graph.
   * @param {string} nodeId - The ID of the node to remove.
   * @returns {boolean} True if the node was found and removed, false otherwise.
   */
  removeNode(nodeId) {
    const nodeToRemove = this.nodes.get(nodeId);
    if (!nodeToRemove) {
      return false; // Node not found
    }

    // Remove the node itself
    this.nodes.delete(nodeId);

    // Remove edges connected to this node
    const edgesToRemove = [];
    for (const edge of this.edges.values()) {
      if (edge.getSourceId() === nodeId || edge.getDestinationId() === nodeId) {
        edgesToRemove.push(edge.getId());
      }
    }
    edgesToRemove.forEach(edgeId => this.removeEdge(edgeId));

    // Clean up edge IDs in remaining nodes
    for (const node of this.nodes.values()) {
       edgesToRemove.forEach(removedEdgeId => node.removeEdgeId(removedEdgeId));
    }

    return true;
  }

  /**
   * Gets an array of all edges in the graph.
   * @returns {Array<Edge>}
   */
  getEdges() {
    return Array.from(this.edges.values());
  }

  /**
   * Gets an edge by its ID.
   * @param {string} edgeId
   * @returns {Edge | undefined}
   */
  getEdgeById(edgeId) {
    return this.edges.get(edgeId);
  }

  /**
   * Adds an edge between two nodes specified by their IDs.
   * @param {string} sourceId - The ID of the source node.
   * @param {string} destinationId - The ID of the destination node.
   * @param {string | null} [definitionNodeId=null] - Optional ID of the node defining the edge type.
   * @param {string} [name] - Optional name for the edge.
   * @param {string | null} [edgeId=null] - Optional specific ID for the edge (will generate if null).
   * @returns {Edge | null} The created edge, or null if nodes don't exist.
   * @throws {Error} if source or destination nodes do not exist in the graph.
   */
  addEdge(sourceId, destinationId, definitionNodeId = null, name = undefined, edgeId = null) {
    const sourceNode = this.nodes.get(sourceId);
    const destinationNode = this.nodes.get(destinationId);

    if (!sourceNode) {
      throw new Error(`Graph.addEdge: Source node with ID ${sourceId} not found.`);
    }
    if (!destinationNode) {
      throw new Error(`Graph.addEdge: Destination node with ID ${destinationId} not found.`);
    }

    const newEdge = new Edge(sourceId, destinationId, definitionNodeId, name, undefined, undefined, undefined, edgeId);
    const newEdgeId = newEdge.getId();

    if (this.edges.has(newEdgeId)) {
        console.warn(`Graph.addEdge: Edge with ID ${newEdgeId} already exists. Ignoring.`);
        return this.edges.get(newEdgeId); // Return existing edge
    }

    this.edges.set(newEdgeId, newEdge);

    // Update nodes with the new edge ID
    sourceNode.addEdgeId(newEdgeId);
    destinationNode.addEdgeId(newEdgeId); // Add to destination even if directed, for easy lookup

    return newEdge;
  }

   /**
   * Updates an edge instance in the graph. Finds the edge by ID and replaces it.
   * Ensures the edge ID hasn't changed.
   * @param {Edge} updatedEdge - The updated edge instance.
   * @returns {boolean} True if the edge was found and updated, false otherwise.
   * @throws {Error} if the edge is not an Edge instance.
   */
  updateEdge(updatedEdge) {
    if (!(updatedEdge instanceof Edge)) {
      throw new Error('Can only update Edge instances in the graph.');
    }
    const edgeId = updatedEdge.getId();
    if (!this.edges.has(edgeId)) {
      console.warn(`Graph.updateEdge: Edge with ID ${edgeId} not found.`);
      return false;
    }
    // Simple replacement since edge connections are stored by ID in nodes
    this.edges.set(edgeId, updatedEdge);
    return true;
  }

  /**
   * Removes an edge from the graph by its ID.
   * @param {string} edgeId - The ID of the edge to remove.
   * @returns {boolean} True if the edge was found and removed, false otherwise.
   */
  removeEdge(edgeId) {
    const edgeToRemove = this.edges.get(edgeId);
    if (!edgeToRemove) {
      return false; // Edge not found
    }

    // Remove the edge itself
    this.edges.delete(edgeId);

    // Remove edge ID from connected nodes
    const sourceNode = this.nodes.get(edgeToRemove.getSourceId());
    const destinationNode = this.nodes.get(edgeToRemove.getDestinationId());

    if (sourceNode) {
      sourceNode.removeEdgeId(edgeId);
    }
    if (destinationNode) {
      destinationNode.removeEdgeId(edgeId);
    }

    return true;
  }

  /**
   * Creates a shallow clone of the graph.
   * Nodes and Edges within the maps are copied by reference.
   * If you need to modify nodes/edges within the clone, clone them individually.
   * @returns {Graph}
   */
  clone() {
    const newGraph = new Graph(this.directed, this.getName(), this.getDescription(), this.getPicture(), this.getColor(), this.getId());

    // Shallow copy node map (references node instances)
    for (const [nodeId, node] of this.nodes.entries()) {
      newGraph.nodes.set(nodeId, node);
    }

    // Shallow copy edge map (references edge instances)
    for (const [edgeId, edge] of this.edges.entries()) {
      newGraph.edges.set(edgeId, edge);
    }

    return newGraph;
  }

  /**
   * Creates a deep clone of the graph.
   * Clones all nodes and edges within the graph.
   * @returns {Graph}
   */
  deepClone() {
      const newGraph = new Graph(this.directed, this.getName(), this.getDescription(), this.getPicture(), this.getColor(), this.getId());

      // Deep copy nodes
      for (const node of this.nodes.values()) {
          newGraph.nodes.set(node.getId(), node.clone());
      }

      // Deep copy edges
      for (const edge of this.edges.values()) {
          newGraph.edges.set(edge.getId(), edge.clone());
      }

      return newGraph;
  }

  /**
   * Creates a new Node that has this Graph's ID as one of its definitions.
   * Implements the "Reverse Blackboxing" concept.
   * @param {string} name - The name for the new composite Node.
   * @param {any} [data=null] - Optional data for the new node.
   * @returns {Node}
   */
  compose(name, data = null) {
    const newNode = new Node(data, name);
    newNode.addDefinitionGraphId(this.getId()); // Add this graph's ID as a definition
    return newNode;
  }
}

export default Graph; 