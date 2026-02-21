/**
 * DruidInstance - The Druid's Cognitive State Manager
 *
 * The Druid is a meta-cognitive AI that automatically structures human thought
 * into persistent graph representations. This class manages:
 * - 6 cognitive graphs (Goals, Beliefs, Observations, Plans, Episodic Memory, Semantic Memory)
 * - Workspace discovery and creation
 * - Automatic thought structuring
 * - Termination logic for thought completion
 */

import { v4 as uuidv4 } from 'uuid';

class DruidInstance {
  constructor(graphStore) {
    this.store = graphStore;
    this.workspacePrototypeId = null; // The "Druid Workspace" prototype
    this.workspaceGraphId = null; // The active working memory graph
    this.cognitiveStateGraphId = null; // The "Druid Cognitive State" definition graph

    // IDs for the 6 cognitive sub-graphs
    this.cognitiveGraphIds = {
      goals: null,
      beliefs: null,
      observations: null,
      plans: null,
      episodic: null,
      semantic: null
    };

    // Tracking for automatic structuring
    this.conversationContext = [];
    this.structuredConcepts = new Map(); // conceptName -> { isComplex, hasDefinitionGraph, prototypeId }
    this.initialized = false;
  }

  /**
   * Core method required by DruidMindPanel
   * Returns the 6 cognitive graphs for visualization
   */
  getCognitiveGraphs() {
    const state = this.store.getState();

    return {
      goals: state.graphs.get(this.cognitiveGraphIds.goals) || null,
      beliefs: state.graphs.get(this.cognitiveGraphIds.beliefs) || null,
      observations: state.graphs.get(this.cognitiveGraphIds.observations) || null,
      plans: state.graphs.get(this.cognitiveGraphIds.plans) || null,
      episodic: state.graphs.get(this.cognitiveGraphIds.episodic) || null,
      semantic: state.graphs.get(this.cognitiveGraphIds.semantic) || null
    };
  }

  /**
   * Initialize or find Druid's workspace
   * Searches for existing "Druid Workspace" prototype or creates complete structure
   */
  async ensureWorkspace() {
    if (this.initialized) {
      console.log('[DruidInstance] Workspace already initialized');
      return this.workspaceGraphId;
    }

    console.log('[DruidInstance] Ensuring workspace...');
    const state = this.store.getState();

    // Search for existing "Druid Workspace" prototype
    const existingWorkspace = Array.from(state.nodePrototypes.values())
      .find(proto => proto.name === 'Druid Workspace');

    if (existingWorkspace) {
      console.log('[DruidInstance] Found existing Druid Workspace:', existingWorkspace.id);
      await this._loadExistingWorkspace(existingWorkspace);
    } else {
      console.log('[DruidInstance] Creating new Druid Workspace');
      await this._createNewWorkspace();
    }

    this.initialized = true;
    console.log('[DruidInstance] Workspace ready:', {
      workspacePrototypeId: this.workspacePrototypeId,
      workspaceGraphId: this.workspaceGraphId,
      cognitiveStateGraphId: this.cognitiveStateGraphId,
      cognitiveGraphIds: this.cognitiveGraphIds
    });

    return this.workspaceGraphId;
  }

  /**
   * Load existing workspace structure
   */
  async _loadExistingWorkspace(workspacePrototype) {
    this.workspacePrototypeId = workspacePrototype.id;

    // The first definition graph should be the Cognitive State
    if (workspacePrototype.definitionGraphIds && workspacePrototype.definitionGraphIds.length > 0) {
      this.cognitiveStateGraphId = workspacePrototype.definitionGraphIds[0];

      const state = this.store.getState();
      const cognitiveStateGraph = state.graphs.get(this.cognitiveStateGraphId);

      if (cognitiveStateGraph) {
        // Find the 6 cognitive sub-graphs as instances in the Cognitive State graph
        const instances = Array.from(cognitiveStateGraph.instances.values());

        for (const instance of instances) {
          const prototype = state.nodePrototypes.get(instance.prototypeId);
          if (!prototype) continue;

          // Match by prototype name to cognitive graph type
          const name = prototype.name.toLowerCase();
          if (name.includes('goal')) {
            this.cognitiveGraphIds.goals = prototype.definitionGraphIds?.[0] || null;
          } else if (name.includes('belief')) {
            this.cognitiveGraphIds.beliefs = prototype.definitionGraphIds?.[0] || null;
          } else if (name.includes('observation')) {
            this.cognitiveGraphIds.observations = prototype.definitionGraphIds?.[0] || null;
          } else if (name.includes('plan')) {
            this.cognitiveGraphIds.plans = prototype.definitionGraphIds?.[0] || null;
          } else if (name.includes('episodic')) {
            this.cognitiveGraphIds.episodic = prototype.definitionGraphIds?.[0] || null;
          } else if (name.includes('semantic')) {
            this.cognitiveGraphIds.semantic = prototype.definitionGraphIds?.[0] || null;
          }
        }
      }

      // Find or create Working Memory graph
      const workingMemoryProto = Array.from(state.nodePrototypes.values())
        .find(proto => proto.name === 'Druid Working Memory');

      if (workingMemoryProto && workingMemoryProto.definitionGraphIds?.[0]) {
        this.workspaceGraphId = workingMemoryProto.definitionGraphIds[0];
      } else {
        // Create Working Memory if missing
        this.workspaceGraphId = await this._createWorkingMemoryGraph();
      }
    } else {
      // Workspace prototype exists but no structure - create it
      await this._createWorkspaceStructure();
    }
  }

  /**
   * Create complete new workspace from scratch
   */
  async _createNewWorkspace() {
    // Create the "Druid Workspace" prototype
    const workspacePrototypeId = uuidv4();
    this.workspacePrototypeId = workspacePrototypeId;

    this.store.getState().addNodePrototype({
      id: workspacePrototypeId,
      name: 'Druid Workspace',
      description: 'The Druid\'s cognitive workspace - a meta-structure for automatic thought organization',
      color: '#9333EA', // Purple - for The Druid
      definitionGraphIds: []
    });

    await this._createWorkspaceStructure();
  }

  /**
   * Create the workspace structure: Cognitive State graph + 6 sub-graphs + Working Memory
   */
  async _createWorkspaceStructure() {
    // Create "Druid Cognitive State" definition graph
    this.cognitiveStateGraphId = this.store.getState().createAndAssignGraphDefinitionWithoutActivation(
      this.workspacePrototypeId
    );

    const state = this.store.getState();
    const cognitiveStateGraph = state.graphs.get(this.cognitiveStateGraphId);
    if (cognitiveStateGraph) {
      // Update graph name
      cognitiveStateGraph.name = 'Druid Cognitive State';
      cognitiveStateGraph.description = 'The Druid\'s internal cognitive architecture';
    }

    // Create 6 cognitive sub-graphs
    const cognitiveTypes = [
      { key: 'goals', name: 'Druid Goals', color: '#DC2626', description: 'Current goals and objectives' },
      { key: 'beliefs', name: 'Druid Beliefs', color: '#0891B2', description: 'Core beliefs and assumptions' },
      { key: 'observations', name: 'Druid Observations', color: '#16A34A', description: 'Observations from conversations' },
      { key: 'plans', name: 'Druid Plans', color: '#DB2777', description: 'Plans and strategies' },
      { key: 'episodic', name: 'Druid Episodic Memory', color: '#9333EA', description: 'Memory of specific events and conversations' },
      { key: 'semantic', name: 'Druid Semantic Memory', color: '#2563EB', description: 'General knowledge and concepts' }
    ];

    for (const cogType of cognitiveTypes) {
      // Create prototype for this cognitive graph
      const prototypeId = uuidv4();
      this.store.getState().addNodePrototype({
        id: prototypeId,
        name: cogType.name,
        description: cogType.description,
        color: cogType.color,
        definitionGraphIds: []
      });

      // Create definition graph for it
      const graphId = this.store.getState().createAndAssignGraphDefinitionWithoutActivation(prototypeId);
      this.cognitiveGraphIds[cogType.key] = graphId;

      // Add as instance to Cognitive State graph
      this.store.getState().addNodeInstance(
        this.cognitiveStateGraphId,
        prototypeId,
        { x: 0, y: 0 } // Position will be set by layout
      );
    }

    // Create Working Memory graph
    this.workspaceGraphId = await this._createWorkingMemoryGraph();

    console.log('[DruidInstance] Workspace structure created successfully');
  }

  /**
   * Create the Working Memory graph where user concepts are stored
   */
  async _createWorkingMemoryGraph() {
    const workingMemoryPrototypeId = uuidv4();

    this.store.getState().addNodePrototype({
      id: workingMemoryPrototypeId,
      name: 'Druid Working Memory',
      description: 'The Druid\'s active working memory - where current thoughts and concepts live',
      color: '#059669', // Green
      definitionGraphIds: []
    });

    const workingMemoryGraphId = this.store.getState().createAndAssignGraphDefinitionWithoutActivation(
      workingMemoryPrototypeId
    );

    const state = this.store.getState();
    const workingMemoryGraph = state.graphs.get(workingMemoryGraphId);
    if (workingMemoryGraph) {
      workingMemoryGraph.name = 'Working Memory';
      workingMemoryGraph.description = 'Current working concepts and thoughts';
    }

    return workingMemoryGraphId;
  }

  /**
   * Process a message and structure thoughts into graphs
   * This is called after each Druid response
   *
   * @param {string} message - The user's message or Druid's response
   * @param {Array} conversationHistory - Full conversation history
   * @returns {Object} - Structuring status and metadata
   */
  async processMessage(message, conversationHistory = []) {
    console.log('[DruidInstance] Processing message for thought structuring...');

    // Store conversation context
    this.conversationContext = conversationHistory;

    // TODO: Implement automatic concept extraction
    // For now, this is a placeholder that will be enhanced

    const status = {
      extracted: 0,
      created: 0,
      updated: 0,
      complete: false
    };

    console.log('[DruidInstance] Message processing status:', status);
    return status;
  }

  /**
   * Decide if thought structuring is complete
   * Primary condition: All complex concepts have definition graphs
   */
  isComplete() {
    // Check if all complex concepts have definition graphs
    for (const [name, concept] of this.structuredConcepts.entries()) {
      if (concept.isComplex && !concept.hasDefinitionGraph) {
        console.log(`[DruidInstance] Incomplete: "${name}" needs definition graph`);
        return false;
      }
    }

    // Additional checks could include:
    // - No new concepts in last message
    // - All relationships are edges
    // - All observations captured

    return true;
  }

  /**
   * Add a concept to tracking
   */
  trackConcept(name, prototypeId, isComplex, hasDefinitionGraph) {
    this.structuredConcepts.set(name, {
      prototypeId,
      isComplex,
      hasDefinitionGraph
    });
  }

  /**
   * Get summary statistics for UI display
   */
  getStats() {
    const cogGraphs = this.getCognitiveGraphs();

    const stats = {
      goals: cogGraphs.goals?.instances?.size || 0,
      beliefs: cogGraphs.beliefs?.instances?.size || 0,
      observations: cogGraphs.observations?.instances?.size || 0,
      plans: cogGraphs.plans?.instances?.size || 0,
      episodic: cogGraphs.episodic?.instances?.size || 0,
      semantic: cogGraphs.semantic?.instances?.size || 0,
      totalConcepts: this.structuredConcepts.size
    };

    return stats;
  }

  /**
   * Reset the Druid's state (for testing or new sessions)
   */
  reset() {
    this.conversationContext = [];
    this.structuredConcepts.clear();
    console.log('[DruidInstance] State reset');
  }
}

export default DruidInstance;
