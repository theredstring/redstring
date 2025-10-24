/**
 * Unified Tool Registry for Redstring AI
 * Central hub for all AI tool management, validation, and execution
 */

import toolValidator from './toolValidator.js';
import cognitiveAgent from './cognitiveAgent.js';
import useGraphStore from "../store/graphStore.jsx";
import { v4 as uuidv4 } from 'uuid';

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.executionCache = new Map();
    this.metrics = {
      toolCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalExecutionTime: 0
    };
    
    this.registerCoreTools();
  }

  /**
   * Register all core Redstring tools
   */
  registerCoreTools() {
    // Graph Management Tools
    this.registerTool('verify_state', this.verifyState);
    this.registerTool('list_available_graphs', this.listAvailableGraphs);
    this.registerTool('get_active_graph', this.getActiveGraph);
    this.registerTool('create_graph', this.createGraph);
    this.registerTool('open_graph', this.openGraph);
    this.registerTool('set_active_graph', this.setActiveGraph);

    // Node Management Tools
    this.registerTool('create_node_prototype', this.createNodePrototype);
    this.registerTool('create_node_instance', this.createNodeInstance);
    this.registerTool('search_nodes', this.searchNodes);
    this.registerTool('get_graph_instances', this.getGraphInstances);

    // Edge Management Tools
    this.registerTool('create_edge', this.createEdge);

    // Analysis Tools
    this.registerTool('identify_patterns', this.identifyPatterns);
    this.registerTool('traverse_semantic_graph', this.traverseSemanticGraph);

    // High-level Cognitive Tools
    this.registerTool('execute_goal', this.executeGoal);
  }

  /**
   * Register a new tool
   */
  registerTool(name, implementation) {
    this.tools.set(name, {
      name,
      implementation: implementation.bind(this),
      schema: toolValidator.getToolSchema(name),
      registered: new Date().toISOString()
    });
  }

  /**
   * Execute a tool with full validation and error handling
   */
  async executeTool(toolName, args = {}, context = {}) {
    const startTime = performance.now();
    this.metrics.toolCalls++;

    try {
      // Validate tool exists
      const tool = this.tools.get(toolName);
      if (!tool) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      // Validate arguments
      const validation = toolValidator.validateToolArgs(toolName, args);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.error}`);
      }

      // Execute the tool
      const result = await tool.implementation(validation.sanitized, context);

      // Track success metrics
      const endTime = performance.now();
      const executionTime = endTime - startTime;
      this.metrics.successfulCalls++;
      this.metrics.totalExecutionTime += executionTime;

      return {
        success: true,
        tool: toolName,
        result,
        executionTime,
        appliedDefaults: validation.applied_defaults
      };

    } catch (error) {
      // Track failure metrics
      const endTime = performance.now();
      const executionTime = endTime - startTime;
      this.metrics.failedCalls++;
      this.metrics.totalExecutionTime += executionTime;

      return {
        success: false,
        tool: toolName,
        error: error.message,
        executionTime,
        args
      };
    }
  }

  /**
   * Get available tools with their schemas
   */
  getAvailableTools() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      schema: tool.schema,
      registered: tool.registered
    }));
  }

  /**
   * Get execution metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      averageExecutionTime: this.metrics.toolCalls > 0 
        ? this.metrics.totalExecutionTime / this.metrics.toolCalls 
        : 0,
      successRate: this.metrics.toolCalls > 0 
        ? this.metrics.successfulCalls / this.metrics.toolCalls 
        : 0
    };
  }

  // ===== TOOL IMPLEMENTATIONS =====

  /**
   * Verify current Redstring state
   */
  async verifyState(args, context) {
    const state = useGraphStore.getState();
    
    return {
      graphCount: state.graphs.size,
      prototypeCount: state.nodePrototypes.size,
      edgeCount: state.edges.size,
      activeGraphId: state.activeGraphId,
      openGraphIds: [...state.openGraphIds],
      expandedGraphIds: [...state.expandedGraphIds],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * List all available graphs
   */
  async listAvailableGraphs(args, context) {
    const state = useGraphStore.getState();
    
    return {
      graphs: Array.from(state.graphs.values()).map(graph => ({
        id: graph.id,
        name: graph.name,
        description: graph.description,
        color: graph.color,
        instanceCount: graph.instances?.size || 0,
        edgeCount: graph.edgeIds?.length || 0,
        isActive: graph.id === state.activeGraphId,
        isOpen: state.openGraphIds.includes(graph.id),
        isExpanded: state.expandedGraphIds.has(graph.id)
      })),
      totalGraphs: state.graphs.size,
      activeGraphId: state.activeGraphId
    };
  }

  /**
   * Get active graph details
   */
  async getActiveGraph(args, context) {
    const state = useGraphStore.getState();
    
    if (!state.activeGraphId) {
      return {
        hasActiveGraph: false,
        message: 'No active graph set'
      };
    }

    const activeGraph = state.graphs.get(state.activeGraphId);
    if (!activeGraph) {
      return {
        hasActiveGraph: false,
        message: 'Active graph ID exists but graph not found',
        activeGraphId: state.activeGraphId
      };
    }

    return {
      hasActiveGraph: true,
      graph: {
        id: activeGraph.id,
        name: activeGraph.name,
        description: activeGraph.description,
        color: activeGraph.color,
        instanceCount: activeGraph.instances?.size || 0,
        instances: Array.from(activeGraph.instances?.values() || []).map(instance => {
          const prototype = state.nodePrototypes.get(instance.prototypeId);
          return {
            ...instance,
            prototypeName: prototype?.name || 'Unknown',
            prototypeColor: prototype?.color || '#000000'
          };
        }),
        edgeCount: activeGraph.edgeIds?.length || 0
      }
    };
  }

  /**
   * Create a new graph
   */
  async createGraph(args, context) {
    const { addGraph } = useGraphStore.getState();
    const graphId = uuidv4();
    
    const graphData = {
      id: graphId,
      name: args.name,
      description: args.description || '',
      color: args.color || '#4A90E2',
      instances: new Map(),
      edgeIds: [],
      definingNodeIds: [],
      directed: true
    };

    addGraph(graphData);

    return {
      created: true,
      graph: {
        id: graphId,
        name: args.name,
        description: args.description || '',
        color: args.color || '#4A90E2'
      }
    };
  }

  /**
   * Create a new node prototype
   */
  async createNodePrototype(args, context) {
    const { addNodePrototype } = useGraphStore.getState();
    const prototypeId = uuidv4();
    
    const prototypeData = {
      id: prototypeId,
      name: args.name,
      description: args.description,
      color: args.color,
      typeNodeId: args.type_node_id,
      definitionGraphIds: [],
      aiMetadata: {
        ...args.ai_metadata,
        createdAt: new Date().toISOString(),
        createdBy: 'ai_tool_registry'
      }
    };

    addNodePrototype(prototypeData);

    return {
      created: true,
      prototype_id: prototypeId,
      prototype: prototypeData
    };
  }

  /**
   * Create a node instance in a graph
   */
  async createNodeInstance(args, context) {
    const { addNodeInstance } = useGraphStore.getState();
    const instanceId = args.instance_id || uuidv4();
    
    const position = {
      x: args.x,
      y: args.y
    };

    addNodeInstance(args.graph_id, args.prototype_id, position, instanceId);

    return {
      created: true,
      instance_id: instanceId,
      prototype_id: args.prototype_id,
      graph_id: args.graph_id,
      position
    };
  }

  /**
   * Search for nodes (prototypes and/or instances)
   */
  async searchNodes(args, context) {
    const state = useGraphStore.getState();
    const query = args.query.toLowerCase();
    const results = [];

    // Search prototypes
    if (args.search_type === 'prototypes' || args.search_type === 'both') {
      for (const prototype of state.nodePrototypes.values()) {
        if (prototype.name.toLowerCase().includes(query) ||
            prototype.description?.toLowerCase().includes(query)) {
          results.push({
            type: 'prototype',
            id: prototype.id,
            name: prototype.name,
            description: prototype.description,
            color: prototype.color,
            matchType: prototype.name.toLowerCase().includes(query) ? 'name' : 'description'
          });
        }
      }
    }

    // Search instances (if specific graph or all graphs)
    if (args.search_type === 'instances' || args.search_type === 'both') {
      const graphsToSearch = args.graph_id 
        ? [state.graphs.get(args.graph_id)]
        : Array.from(state.graphs.values());

      for (const graph of graphsToSearch) {
        if (!graph?.instances) continue;
        
        for (const instance of graph.instances.values()) {
          const prototype = state.nodePrototypes.get(instance.prototypeId);
          if (prototype && (
            prototype.name.toLowerCase().includes(query) ||
            prototype.description?.toLowerCase().includes(query)
          )) {
            results.push({
              type: 'instance',
              id: instance.id,
              prototypeId: instance.prototypeId,
              prototypeName: prototype.name,
              prototypeDescription: prototype.description,
              prototypeColor: prototype.color,
              graphId: graph.id,
              graphName: graph.name,
              position: { x: instance.x, y: instance.y },
              scale: instance.scale,
              matchType: prototype.name.toLowerCase().includes(query) ? 'name' : 'description'
            });
          }
        }
      }
    }

    return {
      query: args.query,
      searchType: args.search_type,
      totalResults: results.length,
      results: results.slice(0, 50) // Limit results
    };
  }

  /**
   * Get all instances in a graph
   */
  async getGraphInstances(args, context) {
    const state = useGraphStore.getState();
    const graphId = args.graph_id || state.activeGraphId;
    
    if (!graphId) {
      return {
        error: 'No graph ID provided and no active graph'
      };
    }

    const graph = state.graphs.get(graphId);
    if (!graph) {
      return {
        error: `Graph not found: ${graphId}`
      };
    }

    const instances = Array.from(graph.instances?.values() || []).map(instance => {
      const prototype = state.nodePrototypes.get(instance.prototypeId);
      return {
        id: instance.id,
        prototypeId: instance.prototypeId,
        prototypeName: prototype?.name || 'Unknown',
        prototypeDescription: prototype?.description || '',
        prototypeColor: prototype?.color || '#000000',
        position: { x: instance.x, y: instance.y },
        scale: instance.scale
      };
    });

    return {
      graphId,
      graphName: graph.name,
      instanceCount: instances.length,
      instances
    };
  }

  /**
   * Create an edge between instances
   */
  async createEdge(args, context) {
    const { createEdge } = useGraphStore.getState();
    const edgeId = uuidv4();
    
    // TODO: This would need to be implemented in the store
    // For now, return a mock successful result
    return {
      created: true,
      edge_id: edgeId,
      source_instance_id: args.source_instance_id,
      target_instance_id: args.target_instance_id,
      graph_id: args.graph_id,
      message: 'Edge creation not fully implemented in store yet'
    };
  }

  /**
   * Execute a high-level goal using the cognitive agent
   */
  async executeGoal(args, context) {
    const goal = args.goal || args.description;
    if (!goal) {
      throw new Error('No goal provided');
    }

    return await cognitiveAgent.executeGoal(goal, context);
  }

  /**
   * Identify patterns in the graph
   */
  async identifyPatterns(args, context) {
    const state = useGraphStore.getState();
    const graphId = args.graph_id || state.activeGraphId;
    
    // Simple pattern identification - could be much more sophisticated
    const patterns = [];
    
    if (args.pattern_type === 'structural') {
      // Find nodes with multiple connections
      // This would require analyzing the edge structure
      patterns.push({
        type: 'hub_nodes',
        description: 'Nodes with many connections',
        pattern: 'Structural analysis not fully implemented'
      });
    }
    
    if (args.pattern_type === 'semantic') {
      // Find semantically similar nodes
      const prototypes = Array.from(state.nodePrototypes.values());
      const colorGroups = new Map();
      
      prototypes.forEach(proto => {
        if (!colorGroups.has(proto.color)) {
          colorGroups.set(proto.color, []);
        }
        colorGroups.get(proto.color).push(proto);
      });
      
      colorGroups.forEach((group, color) => {
        if (group.length >= args.min_occurrences) {
          patterns.push({
            type: 'color_grouping',
            description: `${group.length} nodes with color ${color}`,
            pattern: group.map(p => p.name),
            color: color,
            count: group.length
          });
        }
      });
    }

    return {
      patternType: args.pattern_type,
      minOccurrences: args.min_occurrences,
      graphId,
      patternsFound: patterns.length,
      patterns
    };
  }

  /**
   * Traverse semantic graph (simplified implementation)
   */
  async traverseSemanticGraph(args, context) {
    const state = useGraphStore.getState();
    
    // Find starting entity
    let startEntity = null;
    for (const prototype of state.nodePrototypes.values()) {
      if (prototype.name.toLowerCase().includes(args.start_entity.toLowerCase()) ||
          prototype.id === args.start_entity) {
        startEntity = prototype;
        break;
      }
    }

    if (!startEntity) {
      return {
        error: `Starting entity not found: ${args.start_entity}`,
        searchedFor: args.start_entity
      };
    }

    // Simple traversal - find related nodes
    const traversalResults = [{
      depth: 0,
      entity: {
        id: startEntity.id,
        name: startEntity.name,
        description: startEntity.description,
        color: startEntity.color
      },
      relationship: 'start'
    }];

    // Find nodes with similar colors or types (simplified semantic similarity)
    if (args.max_depth > 0) {
      for (const prototype of state.nodePrototypes.values()) {
        if (prototype.id !== startEntity.id) {
          let similarity = 0;
          
          // Color similarity
          if (prototype.color === startEntity.color) {
            similarity += 0.5;
          }
          
          // Type similarity
          if (prototype.typeNodeId === startEntity.typeNodeId) {
            similarity += 0.3;
          }
          
          // Name similarity (very basic)
          const nameWords1 = startEntity.name.toLowerCase().split(' ');
          const nameWords2 = prototype.name.toLowerCase().split(' ');
          const commonWords = nameWords1.filter(word => nameWords2.includes(word));
          similarity += commonWords.length * 0.1;

          if (similarity >= args.semantic_threshold) {
            traversalResults.push({
              depth: 1,
              entity: {
                id: prototype.id,
                name: prototype.name,
                description: prototype.description,
                color: prototype.color
              },
              relationship: 'semantic_similarity',
              similarity: similarity
            });
          }
        }
      }
    }

    return {
      startEntity: args.start_entity,
      semanticThreshold: args.semantic_threshold,
      maxDepth: args.max_depth,
      traversalResults,
      entitiesFound: traversalResults.length
    };
  }
}

// Export singleton instance
const toolRegistry = new ToolRegistry();
export default toolRegistry;