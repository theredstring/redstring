/**
 * Agent Executor - Traverses agent graphs and executes nodes
 */

import WorkingMemory from './WorkingMemory.js';
import {
  runExecutor,
  runRouter,
  runValidator,
  runTransformer,
  runAggregator,
  runSensor
} from './nodeRunners.js';

class AgentExecutor {
  constructor(agentGraph, apiKey, apiConfig = null) {
    this.graph = agentGraph; // Graph object with nodes and edges
    this.apiKey = apiKey;
    this.apiConfig = apiConfig;
    this.workingMemory = new WorkingMemory();
    this.executionTrace = [];
    this.maxDepth = 50; // Prevent infinite loops
  }

  /**
   * Find entry point node (no incoming 'Delegates To' edges)
   */
  findEntryNode() {
    const nodes = this.getNodes();
    const edges = this.getEdges();

    // Find nodes with no incoming 'Delegates To' edges
    const nodeIds = new Set(nodes.map(n => n.id));
    const hasIncomingDelegation = new Set();

    edges.forEach(edge => {
      const edgeType = this.getEdgeType(edge);
      if (edgeType === 'Delegates To' || edgeType === 'agent-delegates-to') {
        hasIncomingDelegation.add(edge.destinationId);
      }
    });

    // Return first node without incoming delegation
    for (const node of nodes) {
      if (!hasIncomingDelegation.has(node.id) && node.agentConfig?.enabled) {
        return node;
      }
    }

    // Fallback: return first enabled node
    return nodes.find(n => n.agentConfig?.enabled) || nodes[0];
  }

  /**
   * Get nodes from graph
   */
  getNodes() {
    if (Array.isArray(this.graph.nodes)) {
      return this.graph.nodes;
    }
    if (this.graph.nodePrototypes) {
      // Graph store format - convert prototypes to nodes
      const prototypes = this.graph.nodePrototypes instanceof Map
        ? Array.from(this.graph.nodePrototypes.values())
        : Array.isArray(this.graph.nodePrototypes)
          ? this.graph.nodePrototypes
          : [];
      return prototypes.filter(p => p.agentConfig?.enabled);
    }
    return [];
  }

  /**
   * Get edges from graph
   */
  getEdges() {
    if (Array.isArray(this.graph.edges)) {
      return this.graph.edges;
    }
    if (this.graph.graphEdges) {
      return Array.isArray(this.graph.graphEdges) ? this.graph.graphEdges : [];
    }
    return [];
  }

  /**
   * Get edge type name
   */
  getEdgeType(edge) {
    if (edge.typeNodeId) {
      // Look up edge prototype
      const edgePrototypes = this.graph.edgePrototypes || new Map();
      const proto = edgePrototypes instanceof Map
        ? edgePrototypes.get(edge.typeNodeId)
        : null;
      return proto?.name || 'Connection';
    }
    return edge.name || 'Connection';
  }

  /**
   * Get outgoing edges for a node
   */
  getOutgoingEdges(nodeId) {
    return this.getEdges().filter(e => e.sourceId === nodeId);
  }

  /**
   * Get node by ID
   */
  getNode(nodeId) {
    return this.getNodes().find(n => n.id === nodeId);
  }

  /**
   * Execute agent graph
   */
  async execute(input, entryNodeId = null) {
    const entryNode = entryNodeId
      ? this.getNode(entryNodeId)
      : this.findEntryNode();

    if (!entryNode) {
      throw new Error('No entry node found in agent graph');
    }

    // Setup event listeners
    this.setupEventListeners();

    // Start execution
    return this.runNode(entryNode, input, 0);
  }

  /**
   * Setup event listeners for event-driven execution
   */
  setupEventListeners() {
    const nodes = this.getNodes();
    
    nodes.forEach(node => {
      const config = node.agentConfig;
      if (!config?.enabled || !config.events) return;

      config.events.forEach(eventName => {
        this.workingMemory.subscribe(eventName, async (event, data) => {
          // Trigger this node when event fires
          const result = await this.runNode(node, data, 0);
          return result;
        });
      });
    });
  }

  /**
   * Run a single node
   */
  async runNode(node, input, depth) {
    if (depth > this.maxDepth) {
      throw new Error(`Maximum execution depth (${this.maxDepth}) exceeded`);
    }

    const config = node.agentConfig;
    if (!config?.enabled) {
      return input; // Pass through disabled nodes
    }

    // Store input in working memory
    this.workingMemory.set(`${node.name}.input`, input, node.id);
    this.recordExecution(node, 'start', input);

    let output;
    try {
      // Execute based on node type
      switch (config.type) {
        case 'executor':
          output = await runExecutor(node, input, this.workingMemory, this.apiKey, this.apiConfig);
          break;
        case 'router':
          output = await runRouter(node, input, this.workingMemory, this.apiKey, this.apiConfig);
          break;
        case 'validator':
          output = await runValidator(node, input, this.workingMemory, this.apiKey, this.apiConfig);
          break;
        case 'transformer':
          output = runTransformer(node, input, this.workingMemory);
          break;
        case 'aggregator':
          output = await runAggregator(node, input, this.workingMemory, this.apiKey, this.apiConfig);
          break;
        case 'sensor':
          output = await runSensor(node, input, this.workingMemory);
          break;
        default:
          output = input; // Unknown type, pass through
      }

      // Store output
      this.workingMemory.set(`${node.name}.output`, output, node.id);
      this.recordExecution(node, 'complete', output);

      // Emit completion event
      this.workingMemory.emit(`${node.name}.complete`, output);
      this.workingMemory.emit('node:complete', { nodeId: node.id, nodeName: node.name, output });

      // Follow edges
      return this.followEdges(node, output, depth);
    } catch (error) {
      this.recordExecution(node, 'error', error.message);
      this.workingMemory.emit(`${node.name}.error`, error);
      
      // Try fallback edges
      return this.followFallbackEdges(node, input, depth);
    }
  }

  /**
   * Follow edges from a node based on output
   */
  async followEdges(node, output, depth) {
    const outgoingEdges = this.getOutgoingEdges(node.id);
    if (outgoingEdges.length === 0) {
      return output; // End of chain
    }

    const results = [];

    for (const edge of outgoingEdges) {
      const edgeType = this.getEdgeType(edge);
      const targetNode = this.getNode(edge.destinationId);
      
      if (!targetNode) continue;

      // Handle different edge types
      if (edgeType === 'Delegates To' || edgeType === 'agent-delegates-to') {
        // Sequential delegation
        const result = await this.runNode(targetNode, output, depth + 1);
        results.push(result);
      } else if (edgeType === 'Reports To' || edgeType === 'agent-reports-to') {
        // Child reports back to parent (already handled by delegation)
        continue;
      } else if (edgeType === 'Triggers' || edgeType === 'agent-triggers') {
        // Event trigger - fire asynchronously
        this.workingMemory.emit(`trigger:${targetNode.name}`, output);
      } else if (edgeType === 'Depends On' || edgeType === 'agent-depends-on') {
        // Wait for dependency - check if dependency output exists
        const depOutput = this.workingMemory.get(`${targetNode.name}.output`);
        if (depOutput) {
          const result = await this.runNode(targetNode, depOutput, depth + 1);
          results.push(result);
        }
      } else if (edgeType === 'Validates' || edgeType === 'agent-validates') {
        // Validation edge - run validator
        const validation = await runValidator(targetNode, output, this.workingMemory, this.apiKey, this.apiConfig);
        if (!validation.valid) {
          throw new Error(`Validation failed: ${validation.reason}`);
        }
      }
    }

    // If router output specifies a route, follow that specific edge
    if (output.route && output.targetNodeId) {
      const targetNode = this.getNode(output.targetNodeId);
      if (targetNode) {
        return this.runNode(targetNode, output.input || output, depth + 1);
      }
    }

    // Return last result or aggregated results
    return results.length > 0 ? results[results.length - 1] : output;
  }

  /**
   * Follow fallback edges on error
   */
  async followFallbackEdges(node, input, depth) {
    const outgoingEdges = this.getOutgoingEdges(node.id);
    const fallbackEdges = outgoingEdges.filter(e => {
      const edgeType = this.getEdgeType(e);
      return edgeType === 'Fallback To' || edgeType === 'agent-fallback-to';
    });

    if (fallbackEdges.length > 0) {
      const fallbackEdge = fallbackEdges[0];
      const targetNode = this.getNode(fallbackEdge.destinationId);
      if (targetNode) {
        return this.runNode(targetNode, input, depth + 1);
      }
    }

    throw new Error(`Node ${node.name} failed and no fallback available`);
  }

  /**
   * Record execution step
   */
  recordExecution(node, stage, data) {
    this.executionTrace.push({
      nodeId: node.id,
      nodeName: node.name,
      stage,
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Get execution trace
   */
  getTrace() {
    return [...this.executionTrace];
  }

  /**
   * Get working memory
   */
  getWorkingMemory() {
    return this.workingMemory;
  }
}

export default AgentExecutor;



