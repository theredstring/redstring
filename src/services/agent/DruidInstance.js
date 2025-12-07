/**
 * Druid Instance - The agent's cognitive state as a Redstring graph
 * The Druid is an agent whose mind IS a Redstring instance
 */

import createDruidStore from './DruidStore.js';

class DruidInstance {
  constructor() {
    this.store = createDruidStore();
    this.store.getState().initialize();
  }

  /**
   * Get the store
   */
  getStore() {
    return this.store;
  }

  /**
   * Add a goal
   */
  addGoal(goalText, priority = 0.5) {
    this.store.getState().addGoal(goalText, priority);
  }

  /**
   * Add a belief
   */
  addBelief(beliefText, confidence = 0.5) {
    this.store.getState().addBelief(beliefText, confidence);
  }

  /**
   * Record an observation
   */
  recordObservation(data, source = 'unknown') {
    this.store.getState().recordObservation(data, source);
  }

  /**
   * Create a plan
   */
  createPlan(goalId, steps = []) {
    this.store.getState().createPlan(goalId, steps);
  }

  /**
   * Store an episode
   */
  storeEpisode(interaction) {
    this.store.getState().storeEpisode(interaction);
  }

  /**
   * Query semantic memory
   */
  querySemanticMemory(query) {
    return this.store.getState().querySemanticMemory(query);
  }

  /**
   * Get all cognitive graphs
   */
  getCognitiveGraphs() {
    return this.store.getState().getCognitiveGraphs();
  }

  /**
   * Export cognitive state
   */
  export() {
    const state = this.store.getState();
    return {
      graphs: Array.from(state.graphs.entries()).map(([id, graph]) => ({
        id,
        name: graph.name,
        description: graph.description,
        instances: Array.from(graph.instances.entries()).map(([instId, inst]) => ({
          id: instId,
          ...inst
        })),
        edgeIds: graph.edgeIds || []
      })),
      nodePrototypes: Array.from(state.nodePrototypes.entries()).map(([id, proto]) => ({
        id,
        ...proto
      }))
    };
  }

  /**
   * Import cognitive state
   */
  import(data) {
    // Implementation for importing saved cognitive state
    // This would restore The Druid's mind from a saved state
  }
}

export default DruidInstance;



