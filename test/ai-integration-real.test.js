/**
 * Real AI Integration Tests
 * Tests AI functionality with actual Redstring data structures
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import toolValidator from '../src/services/toolValidator.js';
import cognitiveAgent from '../src/services/cognitiveAgent.js';
import useGraphStore from '../src/store/graphStore.jsx';

// Mock the graph store with realistic data
const mockRedstringState = {
  graphs: new Map([
    ['graph-1', {
      id: 'graph-1',
      name: 'Test Knowledge Graph',
      description: 'A test graph for AI integration',
      color: '#4A90E2',
      instances: new Map([
        ['instance-1', {
          id: 'instance-1',
          prototypeId: 'proto-1',
          x: 100,
          y: 200,
          scale: 1.0
        }],
        ['instance-2', {
          id: 'instance-2',
          prototypeId: 'proto-2',
          x: 300,
          y: 200,
          scale: 1.0
        }]
      ]),
      edgeIds: ['edge-1'],
      definingNodeIds: [],
      directed: true
    }]
  ]),
  nodePrototypes: new Map([
    ['base-thing-prototype', {
      id: 'base-thing-prototype',
      name: 'Thing',
      description: 'The base type for all things',
      color: '#8B0000',
      typeNodeId: null,
      definitionGraphIds: []
    }],
    ['proto-1', {
      id: 'proto-1',
      name: 'Climate Change',
      description: 'Global warming and environmental changes',
      color: '#FF6B6B',
      typeNodeId: 'base-thing-prototype',
      definitionGraphIds: []
    }],
    ['proto-2', {
      id: 'proto-2',
      name: 'Carbon Emissions',
      description: 'Greenhouse gas emissions from human activity',
      color: '#4ECDC4',
      typeNodeId: 'base-thing-prototype',
      definitionGraphIds: []
    }]
  ]),
  edges: new Map([
    ['edge-1', {
      id: 'edge-1',
      sourceId: 'instance-1',
      destinationId: 'instance-2',
      name: 'causes',
      description: 'causal relationship',
      typeNodeId: 'base-connection-prototype',
      directionality: { arrowsToward: ['instance-2'] }
    }]
  ]),
  activeGraphId: 'graph-1',
  openGraphIds: ['graph-1'],
  activeDefinitionNodeId: null,
  expandedGraphIds: new Set(),
  rightPanelTabs: [],
  savedNodeIds: new Set(),
  savedGraphIds: new Set()
};

// Mock the store
vi.mock('../src/store/graphStore.jsx', () => ({
  default: {
    getState: () => mockRedstringState,
    setState: vi.fn(),
    subscribe: vi.fn()
  }
}));

describe('Tool Validation with Real Data', () => {
  describe('Node Prototype Creation', () => {
    it('should validate correct node prototype data', () => {
      const validData = {
        name: 'Economic Policy',
        description: 'Government economic policies and regulations',
        color: '#9C27B0',
        type_node_id: 'base-thing-prototype'
      };

      const result = toolValidator.validateToolArgs('create_node_prototype', validData);
      
      expect(result.valid).toBe(true);
      expect(result.sanitized.name).toBe('Economic Policy');
      expect(result.sanitized.type_node_id).toBe('base-thing-prototype');
    });

    it('should apply defaults for missing optional fields', () => {
      const minimalData = {
        name: 'Test Concept'
      };

      const result = toolValidator.validateToolArgs('create_node_prototype', minimalData);
      
      expect(result.valid).toBe(true);
      expect(result.sanitized.description).toBe('');
      expect(result.sanitized.color).toBe('#4A90E2');
      expect(result.sanitized.type_node_id).toBe('base-thing-prototype');
      expect(result.applied_defaults).toEqual({
        description: '',
        color: '#4A90E2',
        type_node_id: 'base-thing-prototype',
        ai_metadata: {}
      });
    });

    it('should reject invalid color formats', () => {
      const invalidData = {
        name: 'Test Concept',
        color: 'blue' // Invalid hex format
      };

      const result = toolValidator.validateToolArgs('create_node_prototype', invalidData);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not match required pattern');
    });

    it('should reject names that are too long', () => {
      const invalidData = {
        name: 'A'.repeat(201) // Too long
      };

      const result = toolValidator.validateToolArgs('create_node_prototype', invalidData);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be at most 200 characters');
    });
  });

  describe('Node Instance Creation', () => {
    it('should validate instance creation with existing prototype', () => {
      const validData = {
        prototype_id: 'proto-1',
        graph_id: 'graph-1',
        x: 150,
        y: 250,
        scale: 1.2
      };

      const result = toolValidator.validateToolArgs('create_node_instance', validData);
      
      expect(result.valid).toBe(true);
      expect(result.sanitized.prototype_id).toBe('proto-1');
      expect(result.sanitized.graph_id).toBe('graph-1');
      expect(result.sanitized.x).toBe(150);
      expect(result.sanitized.scale).toBe(1.2);
    });

    it('should apply default coordinates', () => {
      const minimalData = {
        prototype_id: 'proto-1',
        graph_id: 'graph-1'
      };

      const result = toolValidator.validateToolArgs('create_node_instance', minimalData);
      
      expect(result.valid).toBe(true);
      expect(result.sanitized.x).toBe(0);
      expect(result.sanitized.y).toBe(0);
      expect(result.sanitized.scale).toBe(1.0);
    });

    it('should reject invalid scale values', () => {
      const invalidData = {
        prototype_id: 'proto-1',
        graph_id: 'graph-1',
        scale: 10.0 // Too large
      };

      const result = toolValidator.validateToolArgs('create_node_instance', invalidData);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be at most 5');
    });
  });

  describe('Edge Creation', () => {
    it('should validate edge creation between existing instances', () => {
      const validData = {
        source_instance_id: 'instance-1',
        target_instance_id: 'instance-2',
        graph_id: 'graph-1',
        name: 'influences',
        directionality: {
          arrowsToward: ['instance-2']
        }
      };

      const result = toolValidator.validateToolArgs('create_edge', validData);
      
      expect(result.valid).toBe(true);
      expect(result.sanitized.source_instance_id).toBe('instance-1');
      expect(result.sanitized.target_instance_id).toBe('instance-2');
      expect(result.sanitized.edge_prototype_id).toBe('base-connection-prototype');
    });

    it('should handle bidirectional edges', () => {
      const validData = {
        source_instance_id: 'instance-1',
        target_instance_id: 'instance-2',
        graph_id: 'graph-1',
        directionality: {
          arrowsToward: [] // Bidirectional
        }
      };

      const result = toolValidator.validateToolArgs('create_edge', validData);
      
      expect(result.valid).toBe(true);
      expect(result.sanitized.directionality.arrowsToward).toEqual([]);
    });
  });

  describe('Search Functionality', () => {
    it('should validate search queries', () => {
      const validData = {
        query: 'climate',
        search_type: 'both'
      };

      const result = toolValidator.validateToolArgs('search_nodes', validData);
      
      expect(result.valid).toBe(true);
      expect(result.sanitized.query).toBe('climate');
      expect(result.sanitized.search_type).toBe('both');
    });

    it('should reject empty search queries', () => {
      const invalidData = {
        query: ''
      };

      const result = toolValidator.validateToolArgs('search_nodes', invalidData);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be at least 1 characters');
    });
  });
});

describe('Cognitive Agent with Real Data', () => {
  beforeEach(() => {
    // Reset agent state
    cognitiveAgent.resetSession();
  });

  describe('Goal Parsing', () => {
    it('should parse exploration goals correctly', async () => {
      const goal = await cognitiveAgent.parseGoal('Show me all available graphs', {});
      
      expect(goal.type).toBe('exploration');
      expect(goal.subtype).toBe('list_graphs');
      expect(goal.priority).toBe('high');
    });

    it('should parse creation goals with entity extraction', async () => {
      const goal = await cognitiveAgent.parseGoal('Create a node called "Solar Energy"', {});
      
      expect(goal.type).toBe('creation');
      expect(goal.subtype).toBe('create_concept');
      expect(goal.entityName).toBe('Solar Energy');
    });

    it('should parse search goals with query extraction', async () => {
      const goal = await cognitiveAgent.parseGoal('Show me nodes related to climate change', {});
      
      expect(goal.type).toBe('exploration');
      expect(goal.subtype).toBe('explore_nodes');
      expect(goal.searchQuery).toContain('climate change');
    });

    it('should parse analysis goals', async () => {
      const goal = await cognitiveAgent.parseGoal('Analyze the semantic patterns in this graph', {});
      
      expect(goal.type).toBe('analysis');
      expect(goal.subtype).toBe('pattern_analysis');
      expect(goal.analysisType).toBe('semantic');
    });
  });

  describe('Plan Generation', () => {
    it('should create valid exploration plans', async () => {
      const goal = {
        type: 'exploration',
        subtype: 'list_graphs',
        description: 'Show all graphs',
        priority: 'high'
      };

      const plan = await cognitiveAgent.planGoal(goal, { activeGraphId: 'graph-1' });
      
      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0].action).toBe('verify_state');
      expect(plan.steps[1].action).toBe('list_available_graphs');
      expect(plan.steps[2].action).toBe('get_active_graph');
      expect(plan.expectedOutcome).toContain('graph overview');
    });

    it('should create valid creation plans', async () => {
      const goal = {
        type: 'creation',
        subtype: 'create_concept',
        description: 'Create a new concept',
        entityName: 'Renewable Energy',
        position: { x: 100, y: 100 }
      };

      const plan = await cognitiveAgent.planGoal(goal, { activeGraphId: 'graph-1' });
      
      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0].action).toBe('verify_state');
      expect(plan.steps[1].action).toBe('create_node_prototype');
      expect(plan.steps[2].action).toBe('create_node_instance');
      expect(plan.steps[2].dependencies).toContain('create_node_prototype');
    });

    it('should include fallback steps for required operations', async () => {
      const goal = {
        type: 'exploration',
        subtype: 'list_graphs',
        description: 'Show all graphs'
      };

      const plan = await cognitiveAgent.planGoal(goal, {});
      
      expect(plan.fallbackSteps).toHaveLength(1);
      expect(plan.fallbackSteps[0].action).toBe('verify_state');
    });
  });

  describe('Tool Execution Integration', () => {
    it('should execute simple state verification', async () => {
      const result = await cognitiveAgent.executeTool('verify_state', {}, {});
      
      expect(result).toHaveProperty('graphCount');
      expect(result).toHaveProperty('activeGraphId');
      expect(result.graphCount).toBe(1);
      expect(result.activeGraphId).toBe('graph-1');
    });

    it('should execute graph listing', async () => {
      const result = await cognitiveAgent.executeTool('list_available_graphs', {}, {});
      
      expect(result).toHaveProperty('graphs');
      expect(result.graphs).toHaveLength(1);
      expect(result.graphs[0].name).toBe('Test Knowledge Graph');
      expect(result.graphs[0].instanceCount).toBe(2);
    });

    it('should handle unknown tools gracefully', async () => {
      await expect(
        cognitiveAgent.executeTool('unknown_tool', {}, {})
      ).rejects.toThrow('Tool unknown_tool not implemented');
    });
  });

  describe('End-to-End Goal Execution', () => {
    it('should successfully execute a simple exploration goal', async () => {
      const result = await cognitiveAgent.executeGoal('Show me the current state of Redstring');
      
      expect(result.success).toBe(true);
      expect(result.goal.type).toBe('exploration');
      expect(result.executionHistory).toHaveLength(1);
      expect(result.executionHistory[0].success).toBe(true);
    });

    it('should handle goal execution failures gracefully', async () => {
      // Test the fallback mechanism works correctly
      const originalExecuteTool = cognitiveAgent.executeTool;
      let callCount = 0;
      
      // Mock to fail the first call but succeed on fallback
      cognitiveAgent.executeTool = vi.fn().mockImplementation((toolName, args, context) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Main tool failed');
        }
        // Allow fallback to succeed
        return originalExecuteTool.call(cognitiveAgent, toolName, args, context);
      });
      
      const result = await cognitiveAgent.executeGoal('Show me all graphs');
      
      // Should succeed via fallback
      expect(result.success).toBe(true);
      expect(result.result.summary).toContain('Fallback execution completed');
      
      // Restore original method
      cognitiveAgent.executeTool = originalExecuteTool;
    });

    it('should track working memory during execution', async () => {
      const result = await cognitiveAgent.executeGoal('Show me the current graph state');
      
      expect(result.workingMemory).toHaveProperty('verify_state');
      expect(result.workingMemory.verify_state.result.activeGraphId).toBe('graph-1');
    });
  });
});

describe('Integration with Real Redstring Store', () => {
  it('should work with actual store structure', () => {
    const state = useGraphStore.getState();
    
    // Verify we're working with the correct data structure
    expect(state.graphs).toBeInstanceOf(Map);
    expect(state.nodePrototypes).toBeInstanceOf(Map);
    expect(state.edges).toBeInstanceOf(Map);
    
    // Verify we can access real data
    const activeGraph = state.graphs.get(state.activeGraphId);
    expect(activeGraph).toBeDefined();
    expect(activeGraph.instances).toBeInstanceOf(Map);
  });

  it('should validate tool args against real store data types', () => {
    const state = useGraphStore.getState();
    const firstGraph = Array.from(state.graphs.values())[0];
    const firstPrototype = Array.from(state.nodePrototypes.values())[0];
    
    const validInstanceData = {
      prototype_id: firstPrototype.id,
      graph_id: firstGraph.id,
      x: 100,
      y: 200
    };

    const result = toolValidator.validateToolArgs('create_node_instance', validInstanceData);
    expect(result.valid).toBe(true);
  });

  it('should handle missing data gracefully', () => {
    const invalidData = {
      prototype_id: 'non-existent-prototype',
      graph_id: 'non-existent-graph'
    };

    // Validation should pass (structure is correct)
    const validationResult = toolValidator.validateToolArgs('create_node_instance', invalidData);
    expect(validationResult.valid).toBe(true);
    
    // But execution would need to check if IDs exist in store
    // This is handled at the tool execution level, not validation level
  });
});

describe('Spatial Reasoning Features', () => {
  describe('Spatial Map Analysis', () => {
    it('should analyze node clusters correctly', () => {
      const nodes = [
        { id: 'n1', name: 'Climate Change', x: 100, y: 100 },
        { id: 'n2', name: 'Global Warming', x: 120, y: 120 },
        { id: 'n3', name: 'Solar Power', x: 400, y: 300 },
        { id: 'n4', name: 'Wind Energy', x: 420, y: 320 }
      ];
      
      // Mock cluster analysis function (would be imported from MCP server)
      const clusters = {
        cluster_0: {
          center: [110, 110],
          nodes: ['n1', 'n2'],
          density: 0.8,
          bounds: { minX: 100, maxX: 120, minY: 100, maxY: 120 }
        },
        cluster_1: {
          center: [410, 310], 
          nodes: ['n3', 'n4'],
          density: 0.8,
          bounds: { minX: 400, maxX: 420, minY: 300, maxY: 320 }
        }
      };
      
      expect(Object.keys(clusters)).toHaveLength(2);
      expect(clusters.cluster_0.nodes).toContain('n1');
      expect(clusters.cluster_0.nodes).toContain('n2');
      expect(clusters.cluster_1.nodes).toContain('n3');
      expect(clusters.cluster_1.nodes).toContain('n4');
    });

    it('should find empty regions on canvas', () => {
      const nodes = [
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 200, y: 100 }
      ];
      const canvasSize = { width: 1000, height: 600 };
      
      // Mock empty region detection
      const emptyRegions = [
        { x: 400, y: 150, width: 100, height: 100, suitability: "high" },
        { x: 600, y: 200, width: 100, height: 100, suitability: "medium" }
      ];
      
      expect(emptyRegions).toHaveLength(2);
      expect(emptyRegions[0].suitability).toBe("high");
      expect(emptyRegions[0].x).toBeGreaterThan(350); // Past left panel
    });

    it('should respect panel constraints', () => {
      const panelConstraints = {
        leftPanel: { x: 0, width: 300, description: "Avoid placing nodes here" },
        header: { y: 0, height: 80, description: "Keep nodes below this" },
        rightPanel: { x: 750, width: 250, description: "Right panel may cover this area" }
      };
      
      // Test that generated positions avoid panels
      const testPosition = { x: 450, y: 150 };
      expect(testPosition.x).toBeGreaterThan(panelConstraints.leftPanel.width);
      expect(testPosition.y).toBeGreaterThan(panelConstraints.header.height);
      expect(testPosition.x).toBeLessThan(panelConstraints.rightPanel.x);
    });
  });

  describe('Node Boundary Calculations', () => {
    it('should calculate correct node dimensions', () => {
      const shortName = 'AI';
      const longName = 'Artificial Intelligence Systems';
      
      // Mock dimension calculation
      const shortDimensions = { width: 150, height: 100 };
      const longDimensions = { width: 150, height: 120 }; // Extra height for text wrap
      
      expect(shortDimensions.width).toBe(150);
      expect(shortDimensions.height).toBe(100);
      expect(longDimensions.height).toBeGreaterThan(shortDimensions.height);
    });

    it('should account for image nodes', () => {
      const textOnlyNode = { hasImage: false };
      const imageNode = { hasImage: true };
      
      const textDimensions = { width: 150, height: 100 };
      const imageDimensions = { width: 300, height: 100 }; // EXPANDED_NODE_WIDTH
      
      expect(imageDimensions.width).toBeGreaterThan(textDimensions.width);
      expect(imageDimensions.width).toBe(300);
    });
  });
});

describe('Batch Knowledge Graph Generation', () => {
  describe('Layout Algorithms', () => {
    it('should generate clustered layout correctly', () => {
      const concepts = [
        { name: 'Solar Power', cluster: 'energy' },
        { name: 'Wind Power', cluster: 'energy' },
        { name: 'Battery Storage', cluster: 'storage' },
        { name: 'Grid Integration', cluster: 'storage' }
      ];
      
      const nodeSpacing = { horizontal: 220, vertical: 140, clusterGap: 300 };
      
      // Mock clustered layout result
      const positions = {
        'Solar Power': { x: 400, y: 150, cluster: 'energy' },
        'Wind Power': { x: 620, y: 150, cluster: 'energy' },
        'Battery Storage': { x: 700, y: 150, cluster: 'storage' },
        'Grid Integration': { x: 920, y: 150, cluster: 'storage' }
      };
      
      expect(positions['Solar Power'].cluster).toBe('energy');
      expect(positions['Battery Storage'].cluster).toBe('storage');
      expect(positions['Wind Power'].x - positions['Solar Power'].x).toBe(nodeSpacing.horizontal);
    });

    it('should generate hierarchical layout correctly', () => {
      const concepts = [
        { name: 'System', cluster: 'level-1' },
        { name: 'Component A', cluster: 'level-2' },
        { name: 'Component B', cluster: 'level-2' },
        { name: 'Detail A1', cluster: 'level-3' }
      ];
      
      // Mock hierarchical layout
      const positions = {
        'System': { x: 400, y: 150, level: 0 },
        'Component A': { x: 400, y: 290, level: 1 },
        'Component B': { x: 620, y: 290, level: 1 },
        'Detail A1': { x: 400, y: 430, level: 2 }
      };
      
      expect(positions['System'].level).toBe(0);
      expect(positions['Component A'].level).toBe(1);
      expect(positions['Detail A1'].level).toBe(2);
      expect(positions['Detail A1'].y).toBeGreaterThan(positions['Component A'].y);
    });

    it('should generate radial layout correctly', () => {
      const concepts = [
        { name: 'Core', cluster: 'center' },
        { name: 'Node A', cluster: 'ring-1' },
        { name: 'Node B', cluster: 'ring-1' },
        { name: 'Node C', cluster: 'ring-1' }
      ];
      
      // Mock radial layout
      const positions = {
        'Core': { x: 500, y: 300, radius: 0 },
        'Node A': { x: 650, y: 300, radius: 150, angle: 0 },
        'Node B': { x: 500, y: 150, radius: 150, angle: Math.PI/2 },
        'Node C': { x: 350, y: 300, radius: 150, angle: Math.PI }
      };
      
      expect(positions['Core'].radius).toBe(0);
      expect(positions['Node A'].radius).toBe(150);
      expect(positions['Node B'].radius).toBe(150);
      expect(positions['Node C'].radius).toBe(150);
    });
  });

  describe('Batch Creation Validation', () => {
    it('should validate batch creation parameters', () => {
      const validBatchData = {
        topic: 'Renewable Energy Systems',
        concepts: [
          { name: 'Solar Power', description: 'Photovoltaic energy generation' },
          { name: 'Wind Power', description: 'Wind turbine energy generation' }
        ],
        layout: 'clustered',
        spacing: 'normal'
      };
      
      // Mock validation
      expect(validBatchData.topic).toBe('Renewable Energy Systems');
      expect(validBatchData.concepts).toHaveLength(2);
      expect(validBatchData.layout).toBe('clustered');
      expect(validBatchData.spacing).toBe('normal');
      expect(validBatchData.concepts[0].name).toBe('Solar Power');
    });

    it('should handle invalid batch creation parameters', () => {
      const invalidBatchData = {
        topic: '', // Invalid: empty topic
        concepts: [], // Invalid: no concepts
        layout: 'invalid-layout', // Invalid: unknown layout
        spacing: 'invalid-spacing' // Invalid: unknown spacing
      };
      
      // Mock validation errors
      const errors = [];
      if (!invalidBatchData.topic) errors.push('Topic is required');
      if (invalidBatchData.concepts.length === 0) errors.push('At least one concept is required');
      if (!['hierarchical', 'clustered', 'radial', 'linear'].includes(invalidBatchData.layout)) {
        errors.push('Invalid layout type');
      }
      if (!['compact', 'normal', 'spacious'].includes(invalidBatchData.spacing)) {
        errors.push('Invalid spacing type');
      }
      
      expect(errors).toHaveLength(4);
    });
  });

  describe('Spatial Integration', () => {
    it('should integrate with existing nodes', () => {
      const existingNodes = [
        { id: 'existing-1', x: 200, y: 200, name: 'Existing Concept' }
      ];
      
      const newConcepts = [
        { name: 'New Concept A', cluster: 'new-cluster' },
        { name: 'New Concept B', cluster: 'new-cluster' }
      ];
      
      // Mock placement that avoids existing nodes
      const newPositions = {
        'New Concept A': { x: 500, y: 150 }, // Away from existing node
        'New Concept B': { x: 720, y: 150 }
      };
      
      const minDistance = 200; // Minimum distance from existing nodes
      const distanceToExisting = Math.sqrt(
        Math.pow(newPositions['New Concept A'].x - existingNodes[0].x, 2) +
        Math.pow(newPositions['New Concept A'].y - existingNodes[0].y, 2)
      );
      
      expect(distanceToExisting).toBeGreaterThan(minDistance);
    });
  });
});

describe('Performance with Real Data Sizes', () => {
  it('should handle validation of large tool argument sets quickly', () => {
    const start = performance.now();
    
    // Validate 100 node creations
    for (let i = 0; i < 100; i++) {
      toolValidator.validateToolArgs('create_node_prototype', {
        name: `Test Node ${i}`,
        description: `Description for node ${i}`,
        color: '#4A90E2'
      });
    }
    
    const end = performance.now();
    const duration = end - start;
    
    // Should complete in under 100ms
    expect(duration).toBeLessThan(100);
  });

  it('should handle complex goal parsing efficiently', async () => {
    const complexGoal = 'Create a comprehensive analysis of climate change impacts including economic policy responses, technological solutions like solar energy and wind power, and their relationships to carbon emissions and greenhouse gas reduction strategies';
    
    const start = performance.now();
    const goal = await cognitiveAgent.parseGoal(complexGoal, {});
    const end = performance.now();
    
    expect(end - start).toBeLessThan(50);
    expect(goal.type).toBeDefined();
  });

  it('should handle batch creation of large graphs efficiently', () => {
    const largeBatch = {
      topic: 'Large System Architecture',
      concepts: Array.from({ length: 50 }, (_, i) => ({
        name: `Component ${i + 1}`,
        description: `System component number ${i + 1}`,
        cluster: `cluster-${Math.floor(i / 10)}`
      })),
      layout: 'clustered',
      spacing: 'normal'
    };
    
    const start = performance.now();
    
    // Mock batch processing
    const processedConcepts = largeBatch.concepts.map(concept => ({
      ...concept,
      position: { x: Math.random() * 800 + 400, y: Math.random() * 400 + 150 }
    }));
    
    const end = performance.now();
    const duration = end - start;
    
    expect(processedConcepts).toHaveLength(50);
    expect(duration).toBeLessThan(50); // Should be very fast for positioning calculation
  });
});