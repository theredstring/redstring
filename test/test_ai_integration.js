/**
 * Test file for AI Integration with Redstring
 * Tests the MCP provider, client, and basic functionality
 */

import mcpServer from '../src/services/mcpProvider.js';
import mcpClient from '../src/services/mcpClient.js';

// Mock the graph store for testing
const mockGraphStore = {
  graphs: new Map([
    ['test-graph', {
      id: 'test-graph',
      name: 'Test Graph',
      description: 'A test graph for AI integration',
      instances: new Map([
        ['node-1', { id: 'node-1', prototypeId: 'prototype-1', x: 100, y: 100, scale: 1.0 }],
        ['node-2', { id: 'node-2', prototypeId: 'prototype-2', x: 200, y: 200, scale: 1.0 }]
      ]),
      edgeIds: ['edge-1']
    }]
  ]),
  nodePrototypes: new Map([
    ['prototype-1', {
      id: 'prototype-1',
      name: 'Test Node 1',
      description: 'First test node',
      color: '#FF0000',
      typeNodeId: null,
      definitionGraphIds: []
    }],
    ['prototype-2', {
      id: 'prototype-2',
      name: 'Test Node 2',
      description: 'Second test node',
      color: '#00FF00',
      typeNodeId: null,
      definitionGraphIds: []
    }]
  ]),
  edgePrototypes: new Map([
    ['edge-prototype-1', {
      id: 'edge-prototype-1',
      name: 'Test Connection',
      description: 'A test connection type',
      color: '#0000FF',
      typeNodeId: null,
      definitionGraphIds: []
    }]
  ]),
  edges: new Map([
    ['edge-1', {
      id: 'edge-1',
      sourceId: 'prototype-1',
      destinationId: 'prototype-2',
      typeNodeId: 'edge-prototype-1',
      definitionNodeIds: [],
      directionality: { arrowsToward: new Set() },
      name: 'Test Connection',
      description: 'Connection between test nodes'
    }]
  ]),
  activeGraphId: 'test-graph'
};

// Mock the useGraphStore
jest.mock('../src/store/graphStore.js', () => ({
  getState: () => mockGraphStore
}));

describe('AI Integration Tests', () => {
  let server;
  let client;

  beforeEach(() => {
    server = mcpServer;
    client = mcpClient;
  });

  describe('MCP Server', () => {
    test('should initialize with correct server info', () => {
      const serverInfo = server.getServerInfo();
      expect(serverInfo.name).toBe('redstring-cognitive-server');
      expect(serverInfo.version).toBe('1.0.0');
    });

    test('should have required tools', () => {
      const capabilities = server.getCapabilities();
      expect(capabilities.tools).toHaveProperty('traverse_semantic_graph');
      expect(capabilities.tools).toHaveProperty('create_cognitive_entity');
      expect(capabilities.tools).toHaveProperty('establish_semantic_relation');
      expect(capabilities.tools).toHaveProperty('identify_patterns');
    });

    test('should have required resources', () => {
      const capabilities = server.getCapabilities();
      expect(capabilities.resources).toHaveProperty('graph://schema');
      expect(capabilities.resources).toHaveProperty('graph://nodes/{type}');
      expect(capabilities.resources).toHaveProperty('spatial://position/{node_id}');
    });

    test('should have required prompts', () => {
      const capabilities = server.getCapabilities();
      expect(capabilities.prompts).toHaveProperty('systematic_literature_analysis');
      expect(capabilities.prompts).toHaveProperty('concept_mapping_workflow');
      expect(capabilities.prompts).toHaveProperty('hypothesis_generation');
    });
  });

  describe('MCP Client', () => {
    test('should initialize successfully', async () => {
      const result = await client.initialize();
      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(result.capabilities).toBeDefined();
    });

    test('should execute tools correctly', async () => {
      await client.initialize();
      
      const result = await client.executeTool('traverse_semantic_graph', {
        start_entity: 'Test Node 1',
        max_depth: 2
      });

      expect(result.success).toBe(true);
      expect(result.tool).toBe('traverse_semantic_graph');
      expect(result.result).toBeDefined();
    });

    test('should get resources correctly', async () => {
      await client.initialize();
      
      const result = await client.getResource('graph://schema');
      expect(result.success).toBe(true);
      expect(result.uri).toBe('graph://schema');
      expect(result.resource).toBeDefined();
    });

    test('should execute prompts correctly', async () => {
      await client.initialize();
      
      const result = await client.executePrompt('systematic_literature_analysis', {
        topic: 'Test Topic',
        analysis_depth: 'detailed'
      });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('systematic_literature_analysis');
      expect(result.result).toBeDefined();
    });
  });

  describe('High-Level Operations', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    test('should explore knowledge', async () => {
      const results = await client.exploreKnowledge('Test Node 1', {
        maxDepth: 2,
        includePatterns: true
      });

      expect(results.exploration).toBeDefined();
      expect(results.patterns).toBeDefined();
      expect(results.insights).toBeDefined();
    });

    test('should create concept maps', async () => {
      const concepts = [
        { name: 'Concept A', description: 'First concept' },
        { name: 'Concept B', description: 'Second concept' }
      ];

      const results = await client.createConceptMap('test_domain', concepts, {
        autoConnect: true,
        confidenceThreshold: 0.7
      });

      expect(results.entities).toBeDefined();
      expect(results.relationships).toBeDefined();
      expect(results.abstractions).toBeDefined();
    });

    test('should perform collaborative reasoning', async () => {
      const results = await client.collaborativeReasoning('Test question', {
        maxIterations: 2,
        confidenceThreshold: 0.7
      });

      expect(results.iterations).toBeDefined();
      expect(results.finalInsights).toBeDefined();
      expect(results.recommendations).toBeDefined();
    });

    test('should perform spatial-semantic reasoning', async () => {
      const results = await client.spatialSemanticReasoning('Test spatial query', {
        includeSpatialPatterns: true,
        includeSemanticPatterns: true
      });

      expect(results.spatialAnalysis).toBeDefined();
      expect(results.semanticAnalysis).toBeDefined();
      expect(results.integratedInsights).toBeDefined();
    });

    test('should perform recursive exploration', async () => {
      const results = await client.recursiveExploration('Test Node 1', {
        maxDepth: 3,
        includeAbstractions: true
      });

      expect(results.explorationTree).toBeDefined();
      expect(results.abstractions).toBeDefined();
      expect(results.insights).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid tool names', async () => {
      await client.initialize();
      
      await expect(
        client.executeTool('invalid_tool', {})
      ).rejects.toThrow("Tool 'invalid_tool' not available");
    });

    test('should handle invalid resource URIs', async () => {
      await client.initialize();
      
      await expect(
        client.getResource('invalid://resource')
      ).rejects.toThrow("Resource 'invalid://resource' not available");
    });

    test('should handle invalid prompt names', async () => {
      await client.initialize();
      
      await expect(
        client.executePrompt('invalid_prompt', {})
      ).rejects.toThrow("Prompt 'invalid_prompt' not available");
    });
  });

  describe('Session Management', () => {
    test('should maintain session state', async () => {
      await client.initialize();
      
      const sessionInfo = client.getSessionInfo();
      expect(sessionInfo.sessionId).toBeDefined();
      expect(sessionInfo.capabilities).toBeDefined();
      expect(sessionInfo.activeContext).toBeDefined();
    });

    test('should close session correctly', async () => {
      await client.initialize();
      
      const result = await client.close();
      expect(result.success).toBe(true);
      expect(result.message).toBe('Session closed successfully');
    });
  });

  describe('Helper Functions', () => {
    test('should calculate text similarity correctly', () => {
      const similarity1 = client.calculateTextSimilarity('hello world', 'hello world');
      expect(similarity1).toBe(1.0);

      const similarity2 = client.calculateTextSimilarity('hello world', 'goodbye world');
      expect(similarity2).toBeGreaterThan(0);
      expect(similarity2).toBeLessThan(1.0);

      const similarity3 = client.calculateTextSimilarity('hello world', 'completely different');
      expect(similarity3).toBe(0);
    });

    test('should extract key concepts correctly', () => {
      const concepts = client.extractKeyConcepts('The quick brown fox jumps over the lazy dog');
      expect(concepts).toContain('quick');
      expect(concepts).toContain('brown');
      expect(concepts).toContain('jumps');
      expect(concepts).not.toContain('the');
      expect(concepts).not.toContain('over');
    });

    test('should assess complexity correctly', () => {
      const simple = client.assessComplexity('Hello world.');
      expect(simple).toBe('low');

      const medium = client.assessComplexity('This is a medium complexity sentence with several words.');
      expect(medium).toBe('medium');

      const complex = client.assessComplexity('This is a very complex sentence with many sophisticated words and intricate grammatical structures that demonstrate high lexical diversity.');
      expect(complex).toBe('high');
    });
  });
});

// Integration test for the complete workflow
describe('Complete AI Integration Workflow', () => {
  test('should perform end-to-end AI collaboration', async () => {
    // Initialize client
    await client.initialize();

    // Explore knowledge
    const exploration = await client.exploreKnowledge('Test Node 1', {
      maxDepth: 2,
      includePatterns: true
    });

    // Create concept map from exploration
    const conceptMap = await client.createConceptMap('exploration_results', [
      { name: 'Explored Concept', description: 'From exploration' }
    ], {
      autoConnect: true,
      confidenceThreshold: 0.7
    });

    // Perform collaborative reasoning
    const collaboration = await client.collaborativeReasoning(
      'What insights can we draw from this exploration?',
      {
        maxIterations: 2,
        confidenceThreshold: 0.7
      }
    );

    // Build abstractions
    const abstractions = await client.buildAbstractions(['pattern_1'], {
      abstractionName: 'Test Abstraction',
      abstractionDescription: 'From workflow test'
    });

    // Verify all operations completed successfully
    expect(exploration.exploration).toBeDefined();
    expect(conceptMap.entities.length).toBeGreaterThan(0);
    expect(collaboration.iterations.length).toBeGreaterThan(0);
    expect(abstractions.abstraction).toBeDefined();

    // Close session
    await client.close();
  });
}); 