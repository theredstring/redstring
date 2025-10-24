import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Property-Based Format Tests
 * 
 * These tests use property-based testing to generate many different graph structures
 * and verify that format consistency holds across all of them.
 */

// Simple property-based testing implementation (alternative to fast-check)
const generateInteger = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const generateFloat = (min, max) => Math.random() * (max - min) + min;
const generateString = (maxLength = 50) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -_';
  let result = '';
  const length = generateInteger(0, maxLength);
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const generateArray = (generator, maxSize = 10) => {
  const size = generateInteger(0, maxSize);
  return Array.from({ length: size }, () => generator());
};

const generateColor = () => {
  const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#000000', '#FFFFFF', ''];
  return colors[Math.floor(Math.random() * colors.length)];
};

const generateAbstractionChains = (nodeIds) => {
  if (Math.random() < 0.3 || nodeIds.length === 0) return {};
  
  const chains = {};
  const dimensionCount = generateInteger(1, 3);
  
  for (let i = 0; i < dimensionCount; i++) {
    const dimensionName = generateString(20) || `dimension_${i}`;
    const chainLength = generateInteger(1, Math.min(5, nodeIds.length));
    const chain = [];
    
    for (let j = 0; j < chainLength; j++) {
      const nodeId = nodeIds[Math.floor(Math.random() * nodeIds.length)];
      chain.push(nodeId);
    }
    
    chains[dimensionName] = chain;
  }
  
  return chains;
};

const generateExternalLinks = () => {
  const links = [];
  const linkCount = generateInteger(0, 5);
  
  for (let i = 0; i < linkCount; i++) {
    const linkTypes = [
      'https://example.com/resource',
      'doi:10.1000/test',
      'wd:Q123456',
      'https://en.wikipedia.org/wiki/Test',
      'https://arxiv.org/abs/2024.12345'
    ];
    links.push(linkTypes[Math.floor(Math.random() * linkTypes.length)]);
  }
  
  return links;
};

const generateRandomGraphState = (nodeCount, edgeCount, graphCount) => {
  const state = {
    graphs: new Map(),
    nodePrototypes: new Map(),
    edges: new Map(),
    openGraphIds: [],
    activeGraphId: null,
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set(),
    rightPanelTabs: [],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    showConnectionNames: Math.random() < 0.5
  };

  // Generate nodes
  const nodeIds = [];
  for (let i = 0; i < nodeCount; i++) {
    const nodeId = uuidv4();
    nodeIds.push(nodeId);
    
    state.nodePrototypes.set(nodeId, {
      id: nodeId,
      name: generateString(30),
      description: generateString(100),
      color: generateColor(),
      x: generateFloat(-1000, 1000),
      y: generateFloat(-1000, 1000),
      scale: generateFloat(0.1, 2.0),
      imageSrc: Math.random() < 0.2 ? `data:image/png;base64,${generateString(50)}` : null,
      thumbnailSrc: Math.random() < 0.1 ? `data:image/png;base64,${generateString(30)}` : null,
      imageAspectRatio: Math.random() < 0.2 ? generateFloat(0.5, 2.0) : null,
      definitionGraphIds: [],
      abstractionChains: generateAbstractionChains(nodeIds.slice(0, Math.max(1, i))),
      externalLinks: generateExternalLinks(),
      equivalentClasses: generateArray(() => ({ '@id': `class:${generateString(10)}` }), 3),
      citations: generateArray(() => ({ '@id': `doi:10.1000/${generateString(10)}` }), 2)
    });
    
    if (Math.random() < 0.3) {
      state.savedNodeIds.add(nodeId);
    }
  }

  // Generate graphs
  const graphIds = [];
  for (let i = 0; i < graphCount; i++) {
    const graphId = uuidv4();
    graphIds.push(graphId);
    
    const graphNodeIds = nodeIds.filter(() => Math.random() < 0.7);
    const instances = new Map();
    
    graphNodeIds.forEach(nodeId => {
      const instanceId = uuidv4();
      instances.set(instanceId, {
        id: instanceId,
        prototypeId: nodeId,
        x: generateFloat(-500, 500),
        y: generateFloat(-500, 500)
      });
    });
    
    state.graphs.set(graphId, {
      id: graphId,
      name: generateString(30),
      description: generateString(100),
      instances: instances
    });
    
    if (Math.random() < 0.5) {
      state.openGraphIds.push(graphId);
    }
    
    if (Math.random() < 0.2) {
      state.expandedGraphIds.add(graphId);
    }
    
    if (Math.random() < 0.1) {
      state.savedGraphIds.add(graphId);
    }
  }

  // Generate edges
  const allInstanceIds = [];
  state.graphs.forEach(graph => {
    graph.instances.forEach((instance, instanceId) => {
      allInstanceIds.push(instanceId);
    });
  });

  for (let i = 0; i < edgeCount && allInstanceIds.length >= 2; i++) {
    const edgeId = uuidv4();
    const sourceId = allInstanceIds[Math.floor(Math.random() * allInstanceIds.length)];
    let destinationId = allInstanceIds[Math.floor(Math.random() * allInstanceIds.length)];
    
    // Ensure source != destination
    while (destinationId === sourceId && allInstanceIds.length > 1) {
      destinationId = allInstanceIds[Math.floor(Math.random() * allInstanceIds.length)];
    }
    
    const arrowsToward = new Set();
    if (Math.random() < 0.7) { // 70% chance of directional edge
      if (Math.random() < 0.5) {
        arrowsToward.add(destinationId);
      } else {
        arrowsToward.add(sourceId);
      }
    }
    
    state.edges.set(edgeId, {
      id: edgeId,
      sourceId: sourceId,
      destinationId: destinationId,
      name: generateString(20),
      description: generateString(50),
      typeNodeId: nodeIds[Math.floor(Math.random() * nodeIds.length)] || 'base-connection',
      definitionNodeIds: generateArray(() => nodeIds[Math.floor(Math.random() * nodeIds.length)], 2),
      directionality: {
        arrowsToward: arrowsToward
      }
    });
  }

  // Set active graph
  if (state.openGraphIds.length > 0) {
    state.activeGraphId = state.openGraphIds[0];
  }

  // Add some tabs
  state.rightPanelTabs = [
    { type: 'home', isActive: true }
  ];

  if (nodeIds.length > 0 && Math.random() < 0.3) {
    state.rightPanelTabs.push({
      type: 'node',
      nodeId: nodeIds[0],
      isActive: false
    });
  }

  return state;
};

// Normalize state for comparison
const normalizeState = (state) => {
  const normalized = { ...state };
  
  // Convert Maps to Objects for comparison
  if (normalized.graphs instanceof Map) {
    normalized.graphs = Object.fromEntries(normalized.graphs);
  }
  if (normalized.nodePrototypes instanceof Map) {
    normalized.nodePrototypes = Object.fromEntries(normalized.nodePrototypes);
  }
  if (normalized.edges instanceof Map) {
    normalized.edges = Object.fromEntries(normalized.edges);
  }
  
  // Convert Sets to sorted Arrays
  if (normalized.expandedGraphIds instanceof Set) {
    normalized.expandedGraphIds = Array.from(normalized.expandedGraphIds).sort();
  }
  if (normalized.savedNodeIds instanceof Set) {
    normalized.savedNodeIds = Array.from(normalized.savedNodeIds).sort();
  }
  if (normalized.savedGraphIds instanceof Set) {
    normalized.savedGraphIds = Array.from(normalized.savedGraphIds).sort();
  }
  
  // Sort arrays for consistent comparison
  if (Array.isArray(normalized.openGraphIds)) {
    normalized.openGraphIds = [...normalized.openGraphIds].sort();
  }
  
  return normalized;
};

describe('Property-Based Format Tests', () => {
  it('should preserve data integrity across random small graphs', () => {
    // Test 20 random small graphs
    for (let test = 0; test < 20; test++) {
      const originalState = generateRandomGraphState(
        generateInteger(1, 5), // 1-5 nodes
        generateInteger(0, 6), // 0-6 edges  
        generateInteger(1, 3)  // 1-3 graphs
      );
      
      const exported = exportToRedstring(originalState);
      const { storeState } = importFromRedstring(exported, {});
      
      const normalizedOriginal = normalizeState(originalState);
      const normalizedImported = normalizeState(storeState);
      
      // Core data should be preserved
      expect(Object.keys(normalizedImported.graphs).length).toBe(Object.keys(normalizedOriginal.graphs).length);
      expect(Object.keys(normalizedImported.nodePrototypes).length).toBe(Object.keys(normalizedOriginal.nodePrototypes).length);
      expect(Object.keys(normalizedImported.edges).length).toBe(Object.keys(normalizedOriginal.edges).length);
    }
  });

  it('should preserve data integrity across random medium graphs', () => {
    // Test 10 random medium graphs
    for (let test = 0; test < 10; test++) {
      const originalState = generateRandomGraphState(
        generateInteger(5, 20),  // 5-20 nodes
        generateInteger(3, 30),  // 3-30 edges
        generateInteger(2, 5)    // 2-5 graphs
      );
      
      const exported = exportToRedstring(originalState);
      const { storeState } = importFromRedstring(exported, {});
      
      // Verify Maps are restored correctly
      expect(storeState.graphs).toBeInstanceOf(Map);
      expect(storeState.nodePrototypes).toBeInstanceOf(Map);
      expect(storeState.edges).toBeInstanceOf(Map);
      
      // Verify Sets are restored correctly
      expect(storeState.expandedGraphIds).toBeInstanceOf(Set);
      expect(storeState.savedNodeIds).toBeInstanceOf(Set);
      expect(storeState.savedGraphIds).toBeInstanceOf(Set);
      
      // Size preservation
      expect(storeState.graphs.size).toBe(originalState.graphs.size);
      expect(storeState.nodePrototypes.size).toBe(originalState.nodePrototypes.size);
      expect(storeState.edges.size).toBe(originalState.edges.size);
    }
  });

  it('should handle edge cases in random data', () => {
    // Test 15 graphs with potential edge cases
    for (let test = 0; test < 15; test++) {
      const originalState = generateRandomGraphState(
        generateInteger(0, 3),   // 0-3 nodes (including empty)
        generateInteger(0, 2),   // 0-2 edges (including no edges)
        generateInteger(1, 2)    // 1-2 graphs
      );
      
      // Add some edge cases
      if (originalState.nodePrototypes.size > 0) {
        const firstNodeId = Array.from(originalState.nodePrototypes.keys())[0];
        const node = originalState.nodePrototypes.get(firstNodeId);
        
        // Add edge cases
        node.name = ''; // Empty name
        node.description = null; // Null description
        node.x = NaN; // Invalid coordinate
        node.scale = Infinity; // Invalid scale
      }
      
      const exported = exportToRedstring(originalState);
      const { storeState } = importFromRedstring(exported, {});
      
      // Should not throw errors
      expect(storeState).toBeDefined();
      expect(storeState.graphs).toBeInstanceOf(Map);
      
      // Invalid values should be normalized
      if (storeState.nodePrototypes.size > 0) {
        const firstNodeId = Array.from(storeState.nodePrototypes.keys())[0];
        const node = storeState.nodePrototypes.get(firstNodeId);
        
        expect(typeof node.name).toBe('string');
        expect(typeof node.x).toBe('number'); // Should be a number (even if invalid)
        expect(typeof node.scale).toBe('number'); // Should be a number (even if invalid)
      }
    }
  });

  it('should preserve complex abstraction chains in random data', () => {
    for (let test = 0; test < 10; test++) {
      const originalState = generateRandomGraphState(
        generateInteger(3, 10),
        generateInteger(2, 15),
        generateInteger(1, 3)
      );
      
      const exported = exportToRedstring(originalState);
      const { storeState } = importFromRedstring(exported, {});
      
      // Check that abstraction chains are preserved
      for (const [nodeId, originalNode] of originalState.nodePrototypes) {
        const importedNode = storeState.nodePrototypes.get(nodeId);
        
        if (originalNode.abstractionChains && Object.keys(originalNode.abstractionChains).length > 0) {
          expect(importedNode.abstractionChains).toBeDefined();
          
          for (const [dimension, chain] of Object.entries(originalNode.abstractionChains)) {
            expect(importedNode.abstractionChains).toHaveProperty(dimension);
            expect(importedNode.abstractionChains[dimension]).toEqual(chain);
          }
        }
      }
    }
  });

  it('should preserve external links and semantic data in random graphs', () => {
    for (let test = 0; test < 10; test++) {
      const originalState = generateRandomGraphState(
        generateInteger(2, 8),
        generateInteger(1, 10),
        generateInteger(1, 3)
      );
      
      const exported = exportToRedstring(originalState);
      const { storeState } = importFromRedstring(exported, {});
      
      // Check semantic data preservation
      for (const [nodeId, originalNode] of originalState.nodePrototypes) {
        const importedNode = storeState.nodePrototypes.get(nodeId);
        
        expect(importedNode.externalLinks).toEqual(originalNode.externalLinks);
        expect(importedNode.equivalentClasses).toEqual(originalNode.equivalentClasses);
        expect(importedNode.citations).toEqual(originalNode.citations);
      }
    }
  });

  it('should handle large random graphs efficiently', () => {
    // Test one large graph
    const originalState = generateRandomGraphState(
      50,  // 50 nodes
      75,  // 75 edges
      5    // 5 graphs
    );
    
    const startTime = performance.now();
    const exported = exportToRedstring(originalState);
    const exportTime = performance.now() - startTime;
    
    expect(exportTime).toBeLessThan(1000); // Should export in under 1 second
    
    const importStartTime = performance.now();
    const { storeState } = importFromRedstring(exported, {});
    const importTime = performance.now() - importStartTime;
    
    expect(importTime).toBeLessThan(1000); // Should import in under 1 second
    
    // Verify data integrity
    expect(storeState.graphs.size).toBe(5);
    expect(storeState.nodePrototypes.size).toBe(50);
    expect(storeState.edges.size).toBe(originalState.edges.size); // Some edges might be filtered if invalid
  });
});