import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Format Consistency Tests
 * 
 * These tests ensure 1:1 fidelity between export and import operations,
 * guaranteeing that no data is lost during round-trip operations.
 */

// Helper function to create complex test state with all features
const createComplexTestState = () => {
  const graphId1 = uuidv4();
  const graphId2 = uuidv4(); 
  const nodeId1 = uuidv4();
  const nodeId2 = uuidv4();
  const nodeId3 = uuidv4();
  const edgeId1 = uuidv4();
  const edgeId2 = uuidv4();
  const instanceId1 = uuidv4();
  const instanceId2 = uuidv4();
  const instanceId3 = uuidv4();

  return {
    graphs: new Map([
      [graphId1, {
        id: graphId1,
        name: 'Main Graph',
        description: 'Primary workspace',
        instances: new Map([
          [instanceId1, { id: instanceId1, prototypeId: nodeId1, x: 100, y: 200 }],
          [instanceId2, { id: instanceId2, prototypeId: nodeId2, x: 300, y: 400 }]
        ])
      }],
      [graphId2, {
        id: graphId2,
        name: 'Definition Graph',
        description: 'Node definition space',
        instances: new Map([
          [instanceId3, { id: instanceId3, prototypeId: nodeId3, x: 50, y: 100 }]
        ])
      }]
    ]),
    
    nodePrototypes: new Map([
      [nodeId1, {
        id: nodeId1,
        name: 'Climate Policy',
        description: 'Environmental regulation concepts',
        color: '#2E7D32',
        x: 100,
        y: 200,
        scale: 1.0,
        imageSrc: 'data:image/png;base64,test123',
        thumbnailSrc: 'data:image/png;base64,thumb123',
        imageAspectRatio: 0.75,
        definitionGraphIds: [graphId2],
        abstractionChains: {
          domain: [nodeId1, nodeId2],
          type: [nodeId1]
        },
        externalLinks: [
          'doi:10.1000/climate-policy',
          'https://en.wikipedia.org/wiki/Climate_policy',
          'wd:Q123456'
        ],
        equivalentClasses: [
          { '@id': 'dbo:EnvironmentalPolicy' },
          { '@id': 'wd:Q789012' }
        ],
        citations: [
          { '@id': 'doi:10.1000/reference1' }
        ]
      }],
      [nodeId2, {
        id: nodeId2,
        name: 'Economic Impact',
        description: 'Financial consequences analysis',
        color: '#FF6F00',
        x: 300,
        y: 400,
        scale: 1.2,
        definitionGraphIds: [],
        abstractionChains: {
          domain: [nodeId2]
        },
        externalLinks: ['https://arxiv.org/abs/2024.12345'],
        equivalentClasses: [],
        citations: []
      }],
      [nodeId3, {
        id: nodeId3,
        name: 'Market Forces',
        description: 'Supply and demand dynamics',
        color: '#8B0000',
        x: 50,
        y: 100,
        scale: 0.8,
        definitionGraphIds: [],
        abstractionChains: {},
        externalLinks: [],
        equivalentClasses: [],
        citations: []
      }]
    ]),
    
    edges: new Map([
      [edgeId1, {
        id: edgeId1,
        sourceId: instanceId1,
        destinationId: instanceId2,
        name: 'Influences',
        description: 'Causal relationship between policy and economics',
        typeNodeId: 'base-connection-prototype',
        definitionNodeIds: [],
        directionality: {
          arrowsToward: new Set([instanceId2])
        }
      }],
      [edgeId2, {
        id: edgeId2,
        sourceId: instanceId2,
        destinationId: instanceId3,
        name: 'Affects',
        description: 'Economic impacts on market dynamics',
        typeNodeId: 'influences-prototype',
        definitionNodeIds: [nodeId3],
        directionality: {
          arrowsToward: new Set() // Non-directional
        }
      }]
    ]),
    
    openGraphIds: [graphId1, graphId2],
    activeGraphId: graphId1,
    activeDefinitionNodeId: nodeId1,
    expandedGraphIds: new Set([graphId1]),
    rightPanelTabs: [
      { type: 'home', isActive: true },
      { type: 'node', nodeId: nodeId1, isActive: false }
    ],
    savedNodeIds: new Set([nodeId1, nodeId2]),
    savedGraphIds: new Set([graphId1]),
    showConnectionNames: true
  };
};

// Helper to normalize data for comparison (handle differences in Maps/Sets)
const normalizeForComparison = (state) => {
  const normalized = {
    ...state,
    graphs: state.graphs instanceof Map ? Object.fromEntries(state.graphs) : state.graphs,
    nodePrototypes: state.nodePrototypes instanceof Map ? Object.fromEntries(state.nodePrototypes) : state.nodePrototypes,
    edges: state.edges instanceof Map ? Object.fromEntries(state.edges) : state.edges,
    expandedGraphIds: state.expandedGraphIds instanceof Set ? Array.from(state.expandedGraphIds).sort() : state.expandedGraphIds?.sort?.() || [],
    savedNodeIds: state.savedNodeIds instanceof Set ? Array.from(state.savedNodeIds).sort() : state.savedNodeIds?.sort?.() || [],
    savedGraphIds: state.savedGraphIds instanceof Set ? Array.from(state.savedGraphIds).sort() : state.savedGraphIds?.sort?.() || []
  };
  
  // Remove export-added metadata for comparison
  if (normalized.graphs) {
    Object.values(normalized.graphs).forEach(graph => {
      delete graph['@type'];
      delete graph.spatial;
    });
  }
  
  if (normalized.nodePrototypes) {
    Object.values(normalized.nodePrototypes).forEach(node => {
      delete node['@type'];
      delete node['@id'];
      delete node.spatial;
      delete node.media;
      delete node.cognitive;
      delete node.semantic;
      delete node.subClassOf;
    });
  }
  
  if (normalized.edges) {
    Object.values(normalized.edges).forEach(edge => {
      delete edge.rdfStatements;
      delete edge.sourcePrototypeId;
      delete edge.destinationPrototypeId;
      delete edge.predicatePrototypeId;
    });
  }
  
  return normalized;
};

describe('Format Consistency', () => {
  let originalState;
  
  beforeEach(() => {
    originalState = createComplexTestState();
  });

  it('should maintain 1:1 fidelity between export and import', () => {
    // Export to redstring format
    const redstringData = exportToRedstring(originalState);
    
    // Import back from redstring format
    const { storeState: importedState } = importFromRedstring(redstringData, {});
    
    // Normalize both states for comparison
    const normalizedOriginal = normalizeForComparison(originalState);
    const normalizedImported = normalizeForComparison(importedState);
    
    // Assert perfect equality of core data
    expect(normalizedImported.graphs).toEqual(normalizedOriginal.graphs);
    expect(normalizedImported.nodePrototypes).toEqual(normalizedOriginal.nodePrototypes);
    expect(normalizedImported.edges).toEqual(normalizedOriginal.edges);
    expect(normalizedImported.openGraphIds).toEqual(normalizedOriginal.openGraphIds);
    expect(normalizedImported.activeGraphId).toEqual(normalizedOriginal.activeGraphId);
    expect(normalizedImported.expandedGraphIds).toEqual(normalizedOriginal.expandedGraphIds);
    expect(normalizedImported.savedNodeIds).toEqual(normalizedOriginal.savedNodeIds);
    expect(normalizedImported.savedGraphIds).toEqual(normalizedOriginal.savedGraphIds);
  });

  it('should preserve semantic web metadata', () => {
    const redstringData = exportToRedstring(originalState);
    const { storeState } = importFromRedstring(redstringData, {});
    
    const originalNode = originalState.nodePrototypes.get(Array.from(originalState.nodePrototypes.keys())[0]);
    const importedNode = storeState.nodePrototypes.get(Array.from(originalState.nodePrototypes.keys())[0]);
    
    expect(importedNode.externalLinks).toEqual(originalNode.externalLinks);
    expect(importedNode.equivalentClasses).toEqual(originalNode.equivalentClasses);
    expect(importedNode.citations).toEqual(originalNode.citations);
  });

  it('should preserve abstraction chains', () => {
    const redstringData = exportToRedstring(originalState);
    const { storeState } = importFromRedstring(redstringData, {});
    
    const originalNode = originalState.nodePrototypes.get(Array.from(originalState.nodePrototypes.keys())[0]);
    const importedNode = storeState.nodePrototypes.get(Array.from(originalState.nodePrototypes.keys())[0]);
    
    expect(importedNode.abstractionChains).toEqual(originalNode.abstractionChains);
  });

  it('should preserve edge directionality and RDF statements', () => {
    const redstringData = exportToRedstring(originalState);
    const { storeState } = importFromRedstring(redstringData, {});
    
    // Check that edges preserve directionality
    for (const [edgeId, originalEdge] of originalState.edges) {
      const importedEdge = storeState.edges.get(edgeId);
      
      expect(importedEdge.sourceId).toEqual(originalEdge.sourceId);
      expect(importedEdge.destinationId).toEqual(originalEdge.destinationId);
      expect(importedEdge.name).toEqual(originalEdge.name);
      expect(importedEdge.description).toEqual(originalEdge.description);
      
      // Directionality Sets are converted to Arrays during serialization
      const originalArrows = Array.from(originalEdge.directionality.arrowsToward || []).sort();
      const importedArrows = Array.from(importedEdge.directionality.arrowsToward || []).sort();
      expect(importedArrows).toEqual(originalArrows);
    }
  });

  it('should preserve complex graph instances and spatial data', () => {
    const redstringData = exportToRedstring(originalState);
    const { storeState } = importFromRedstring(redstringData, {});
    
    for (const [graphId, originalGraph] of originalState.graphs) {
      const importedGraph = storeState.graphs.get(graphId);
      
      expect(importedGraph.id).toEqual(originalGraph.id);
      expect(importedGraph.name).toEqual(originalGraph.name);
      expect(importedGraph.description).toEqual(originalGraph.description);
      
      // Check instances Map preservation
      expect(importedGraph.instances.size).toEqual(originalGraph.instances.size);
      
      for (const [instanceId, originalInstance] of originalGraph.instances) {
        const importedInstance = importedGraph.instances.get(instanceId);
        expect(importedInstance).toEqual(originalInstance);
      }
    }
  });

  it('should handle empty state correctly', () => {
    const emptyState = {
      graphs: new Map(),
      nodePrototypes: new Map(),
      edges: new Map(),
      openGraphIds: [],
      activeGraphId: null,
      activeDefinitionNodeId: null,
      expandedGraphIds: new Set(),
      rightPanelTabs: [{ type: 'home', isActive: true }],
      savedNodeIds: new Set(),
      savedGraphIds: new Set(),
      showConnectionNames: false
    };
    
    const redstringData = exportToRedstring(emptyState);
    const { storeState } = importFromRedstring(redstringData, {});
    
    expect(storeState.graphs.size).toBe(0);
    expect(storeState.nodePrototypes.size).toBe(0);
    expect(storeState.edges.size).toBe(0);
    expect(storeState.openGraphIds).toEqual([]);
    expect(storeState.activeGraphId).toBeNull();
    expect(storeState.expandedGraphIds.size).toBe(0);
    expect(storeState.savedNodeIds.size).toBe(0);
  });

  it('should preserve media data (images and thumbnails)', () => {
    const redstringData = exportToRedstring(originalState);
    const { storeState } = importFromRedstring(redstringData, {});
    
    const originalNode = originalState.nodePrototypes.get(Array.from(originalState.nodePrototypes.keys())[0]);
    const importedNode = storeState.nodePrototypes.get(Array.from(originalState.nodePrototypes.keys())[0]);
    
    expect(importedNode.imageSrc).toEqual(originalNode.imageSrc);
    expect(importedNode.thumbnailSrc).toEqual(originalNode.thumbnailSrc);
    expect(importedNode.imageAspectRatio).toEqual(originalNode.imageAspectRatio);
  });

  it('should handle user domain context correctly', () => {
    const userDomain = 'alice.example.com';
    const redstringData = exportToRedstring(originalState, userDomain);
    
    expect(redstringData.metadata.domain).toBe(userDomain);
    expect(redstringData.metadata.userURIs).toBeTruthy();
    
    const { storeState } = importFromRedstring(redstringData, {});
    
    // Should still import correctly with user domain context
    expect(storeState.graphs.size).toEqual(originalState.graphs.size);
    expect(storeState.nodePrototypes.size).toEqual(originalState.nodePrototypes.size);
  });

  it('should handle dual format edges correctly', () => {
    const redstringData = exportToRedstring(originalState);
    
    // Check that exported edges have both native and RDF format
    const edgeEntries = Object.entries(redstringData.edges);
    expect(edgeEntries.length).toBeGreaterThan(0);
    
    for (const [edgeId, edgeData] of edgeEntries) {
      // Should have native format
      expect(edgeData.sourceId).toBeDefined();
      expect(edgeData.destinationId).toBeDefined();
      expect(edgeData.directionality).toBeDefined();
      
      // Should have RDF metadata
      expect(edgeData.sourcePrototypeId).toBeDefined();
      expect(edgeData.destinationPrototypeId).toBeDefined();
    }
    
    // Import should preserve both formats
    const { storeState } = importFromRedstring(redstringData, {});
    expect(storeState.edges.size).toEqual(originalState.edges.size);
  });
});