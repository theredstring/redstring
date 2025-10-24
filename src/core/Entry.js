/**
 * Base class for graph elements (Nodes, Edges).
 * Equivalent to the abstract Entry class in Java.
 */
class Entry {
  /**
   * @param {string} [name="Untitled"]
   * @param {string} [description="No description."]
   * @param {string} [picture=""]
   * @param {string} [color=""] // Added color property based on Java
   * @param {string | null} [id=null] // Use string for UUID, allow null for generation
   */
  constructor(name = "Untitled", description = "No description.", picture = "", color = "", id = null) {
    this.name = name;
    this.description = description;
    this.picture = picture;
    this.color = color;
    // Note: Java uses long. We'll use string UUIDs. Generate if null.
    // Actual UUID generation will happen in subclasses (Node, Graph, Edge).
    this.id = id;
  }

  // Getters
  getName() {
    return this.name;
  }

  getDescription() {
    return this.description;
  }

  getPicture() {
    return this.picture;
  }

  getColor() {
    return this.color;
  }

  /**
   * @returns {string | null}
   */
  getId() {
    return this.id;
  }

  // Setters
  setName(name) {
    this.name = name;
  }

  setDescription(description) {
    this.description = description;
  }

  setPicture(picture) {
    this.picture = picture;
  }

  setColor(color) {
    this.color = color;
  }

  /**
   * @param {string | null} id
   */
  setId(id) {
    this.id = id;
  }
}

// Export the class for use in other modules
export default Entry; 