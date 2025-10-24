import Entry from './Entry.js';
import { v4 as uuidv4 } from 'uuid';
// We'll define Edge and Graph later, but import placeholders for now
// import Edge from './Edge.js';
// import Graph from './Graph.js';

/**
 * Represents a node in the graph, extending the base Entry class.
 * Equivalent to Node.java.
 */
class Node extends Entry {
  /**
   * @param {any} [data=null] - The data payload associated with the node.
   * @param {string} [name="Untitled"]
   * @param {string} [description="No description."]
   * @param {string} [picture=""]
   * @param {string} [color=""]
   * @param {string | null} [id=null] // Use string UUID, null generates one
   * @param {number} [x=0] - UI x-coordinate
   * @param {number} [y=0] - UI y-coordinate
   * @param {number} [scale=1] - UI scale factor
   * @param {string | null} [imageSrc=null] - Full resolution image data URL
   * @param {string | null} [thumbnailSrc=null] - Thumbnail image data URL
   * @param {number | null} [imageAspectRatio=null] - Aspect ratio (height/width) of the image
   * @param {string | null} [parentDefinitionNodeId=null] - ID of the parent definition node, if any.
   * @param {string | null} [graphId=null] - ID of the graph this node belongs to.
   * @param {string | null} [typeNodeId=null] - ID of the node that defines this node's type.
   */
  constructor(data = null, name, description, picture, color, id = null, x = 0, y = 0, scale = 1, imageSrc = null, thumbnailSrc = null, imageAspectRatio = null, parentDefinitionNodeId = null, graphId = null, typeNodeId = null) {
    // Call the parent Entry constructor, generate UUID if id is null
    super(name, description, picture, color, id === null ? uuidv4() : id);

    /** @type {any} The data held by the node. */
    this.data = data;

    // UI specific properties
    /** @type {number} The x-coordinate for rendering. */
    this.x = x;
    /** @type {number} The y-coordinate for rendering. */
    this.y = y;
    /** @type {number} The scale factor for rendering. */
    this.scale = scale;

    /** @type {string | null} Full resolution image data URL. */
    this.imageSrc = imageSrc;
    /** @type {string | null} Thumbnail image data URL. */
    this.thumbnailSrc = thumbnailSrc;

    /** @type {number | null} Aspect ratio (height/width) of the image. */
    this.imageAspectRatio = imageAspectRatio;

    /** @type {string | null} ID of the parent definition node, if any. */
    this.parentDefinitionNodeId = parentDefinitionNodeId;

    /** @type {string | null} ID of the graph this node belongs to. */
    this.graphId = graphId;

    /** @type {string | null} ID of the node that defines this node's type. */
    this.typeNodeId = typeNodeId;

    /** @type {Array<string>} List of Edge IDs connected to this node. (Edges stored in Graph) */
    this.edgeIds = []; // Renamed from edges, stores IDs now

    /** @type {Array<string>} List of Graph IDs defining this node (Reverse Blackboxing). */
    this.definitionGraphIds = []; // Renamed from definitions, stores IDs now
  }

  /**
   * Adds an edge ID to this node's list of edge IDs.
   * @param {string} edgeId - The ID of the edge to add.
   */
  addEdgeId(edgeId) {
    this.edgeIds.push(edgeId);
  }

  /**
   * Gets the list of edge IDs connected to this node.
   * @returns {Array<string>}
   */
  getEdgeIds() {
    return this.edgeIds;
  }

  /**
   * Removes an edge ID from this node's list.
   * @param {string} edgeId - The ID of the edge to remove.
   * @returns {boolean} True if the edge ID was removed, false otherwise.
   */
  removeEdgeId(edgeId) {
    const index = this.edgeIds.indexOf(edgeId);
    if (index > -1) {
      this.edgeIds.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Gets the data associated with this node.
   * @returns {any}
   */
  getData() {
    return this.data;
  }

   /**
   * Sets the data associated with this node.
   * @param {any} data
   */
  setData(data) {
    this.data = data;
  }

  /**
   * Gets the list of graph definition IDs for this node.
   * @returns {Array<string>}
   */
  getDefinitionGraphIds() {
    return this.definitionGraphIds;
  }

  /**
   * Adds a graph definition ID to this node.
   * @param {string} graphId - The graph definition ID to add.
   * @returns {boolean} - Returns true (consistent with Java ArrayList.add behavior).
   */
  addDefinitionGraphId(graphId) {
    this.definitionGraphIds.push(graphId);
    return true; // Mimic Java's ArrayList.add return
  }

  /**
   * Gets the ID of the parent definition node.
   * @returns {string | null}
   */
  getParentDefinitionNodeId() {
    return this.parentDefinitionNodeId;
  }

  /**
   * Sets the ID of the parent definition node.
   * @param {string | null} nodeId
   */
  setParentDefinitionNodeId(nodeId) {
    this.parentDefinitionNodeId = nodeId;
  }

  /**
   * Gets the ID of the node that defines this node's type.
   * @returns {string | null}
   */
  getTypeNodeId() {
    return this.typeNodeId;
  }

  /**
   * Sets the ID of the node that defines this node's type.
   * @param {string | null} nodeId
   */
  setTypeNodeId(nodeId) {
    this.typeNodeId = nodeId;
  }

  // --- UI Property Getters/Setters ---

  getX() {
    return this.x;
  }

  setX(x) {
    this.x = x;
  }

  getY() {
    return this.y;
  }

  setY(y) {
    this.y = y;
  }

  getScale() {
    return this.scale;
  }

  setScale(scale) {
    this.scale = scale;
  }

  getImageSrc() {
    return this.imageSrc;
  }

  setImageSrc(src) {
    this.imageSrc = src;
  }

  getThumbnailSrc() {
    return this.thumbnailSrc;
  }

  setThumbnailSrc(src) {
    this.thumbnailSrc = src;
  }

  // Optional convenience setter
  setImageData(imageSrc, thumbnailSrc) {
    this.imageSrc = imageSrc;
    this.thumbnailSrc = thumbnailSrc;
  }

  getImageAspectRatio() {
    return this.imageAspectRatio;
  }

  setImageAspectRatio(ratio) {
    this.imageAspectRatio = ratio;
  }

  /**
   * Creates a shallow clone of the node.
   * Note: edgeIds and definitionGraphIds arrays are shallow copied.
   * Data object is also copied by reference.
   * @returns {Node}
   */
  clone() {
    const newNode = new Node(
      this.data, // Shallow copy data
      this.getName(),
      this.getDescription(),
      this.getPicture(),
      this.getColor(),
      this.getId(), // Clone uses the same ID
      this.x,
      this.y,
      this.scale,
      this.imageSrc,
      this.thumbnailSrc,
      this.imageAspectRatio,
      this.parentDefinitionNodeId, // Clone parent definition node ID
      this.graphId, // Clone graph ID
      this.typeNodeId // Clone type node ID
    );
    // Shallow copy the ID arrays
    newNode.edgeIds = [...this.edgeIds];
    newNode.definitionGraphIds = [...this.definitionGraphIds];
    return newNode;
  }
}

export default Node; 