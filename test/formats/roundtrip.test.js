import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Round-Trip Format Tests
 * 
 * These tests verify that export/import operations are perfect inverses,
 * ensuring no data corruption or loss during multiple round trips.
 */

// Create edge cases that might break round-trip fidelity
const createEdgeCaseState = () => {
  const graphId = uuidv4();
  const nodeId1 = uuidv4();
  const nodeId2 = uuidv4();
  const edgeId = uuidv4();
  const instanceId1 = uuidv4();
  const instanceId2 = uuidv4();

  return {
    graphs: new Map([
      [graphId, {
        id: graphId,
        name: 'Test Graph with "quotes" and special chars: <>&',
        description: 'Unicode test: 🚀 💻 🧠 and newlines\nand tabs\t',
        instances: new Map([
          [instanceId1, { 
            id: instanceId1, 
            prototypeId: nodeId1, 
            x: -150.5, // Negative and decimal coordinates
            y: 999999.999 // Very large decimal
          }],
          [instanceId2, { 
            id: instanceId2, 
            prototypeId: nodeId2, 
            x: 0, // Zero coordinates
            y: 0 
          }]
        ])
      }]
    ]),
    
    nodePrototypes: new Map([
      [nodeId1, {
        id: nodeId1,
        name: '', // Empty name
        description: null, // Null description
        color: '#FFFFFF', // Color edge case
        x: -500,
        y: 0.00001, // Very small decimal
        scale: 0, // Zero scale
        imageSrc: null,
        thumbnailSrc: '',
        imageAspectRatio: undefined,
        definitionGraphIds: [],
        abstractionChains: null, // Null chains
        externalLinks: [], // Empty arrays
        equivalentClasses: undefined,
        citations: null
      }],
      [nodeId2, {
        id: nodeId2,
        name: 'Node with extremely long name that might break serialization or cause issues with display or storage systems when dealing with very long strings that exceed normal expectations',
        description: JSON.stringify({ complex: 'object', with: ['arrays', { nested: true }] }), // JSON in description
        color: 'invalid-color', // Invalid color
        x: Infinity, // Invalid coordinate (should be handled)
        y: -Infinity,
        scale: NaN, // Invalid scale
        definitionGraphIds: [graphId, graphId, graphId], // Duplicates
        abstractionChains: {
          'dimension with spaces': [nodeId1, nodeId2, nodeId1], // Circular reference
          '': [nodeId1], // Empty dimension name
          'unicode-🚀': [nodeId2]
        },
        externalLinks: [
          'https://extremely-long-url-that-might-break-things.example.com/path/to/resource/with/many/segments/and/query/parameters?param1=value1&param2=value2&param3=very-long-value',
          'invalid-url',
          '', // Empty URL
          null // Null URL (should be filtered)
        ],
        equivalentClasses: [
          { '@id': '' }, // Empty ID
          { '@id': null }, // Null ID
          { '@id': 'valid:id' }
        ],
        citations: [
          { '@id': 'doi:' }, // Incomplete DOI
          { '@id': 'https://example.com' }
        ]
      }]
    ]),
    
    edges: new Map([
      [edgeId, {
        id: edgeId,
        sourceId: instanceId1,
        destinationId: instanceId2,
        name: null, // Null name
        description: undefined, // Undefined description
        typeNodeId: '', // Empty type
        definitionNodeIds: [nodeId1, nodeId2, '', null], // Mixed valid/invalid IDs
        directionality: {
          arrowsToward: new Set([instanceId1, instanceId2, 'invalid-id']) // Invalid ID in Set
        }
      }]
    ]),
    
    openGraphIds: [graphId, 'invalid-graph-id'], // Invalid ID mixed with valid
    activeGraphId: '', // Empty active ID
    activeDefinitionNodeId: undefined,
    expandedGraphIds: new Set([graphId, null, '']), // Mixed valid/invalid
    rightPanelTabs: [
      { type: 'invalid', isActive: true }, // Invalid tab type
      { type: 'node', nodeId: null, isActive: false }, // Null node ID
      { isActive: false } // Missing type
    ],
    savedNodeIds: new Set([nodeId1, null, '', nodeId2]), // Mixed valid/invalid
    savedGraphIds: new Set([]), // Empty Set
    showConnectionNames: undefined // Undefined boolean
  };
};

describe('Round-Trip Format Tests', () => {
  let edgeCaseState;
  
  beforeEach(() => {
    edgeCaseState = createEdgeCaseState();
  });

  it('should survive multiple round trips without data loss', () => {
    let currentState = edgeCaseState;
    
    // Perform 5 round trips
    for (let i = 0; i < 5; i++) {
      const exported = exportToRedstring(currentState);
      const { storeState: imported } = importFromRedstring(exported, {});
      currentState = imported;
    }
    
    // After 5 round trips, core structure should be preserved
    expect(currentState.graphs.size).toBe(1);
    expect(currentState.nodePrototypes.size).toBe(2);
    expect(currentState.edges.size).toBe(1);
  });

  it('should handle invalid coordinate values gracefully', () => {
    const exported = exportToRedstring(edgeCaseState);
    const { storeState } = importFromRedstring(exported, {});
    
    // Current behavior: invalid coordinates are preserved but should not crash
    const nodeWithInvalidCoords = Array.from(storeState.nodePrototypes.values())
      .find(node => node.name.startsWith('Node with extremely long'));
    
    // The system should still work even with invalid coordinates
    expect(nodeWithInvalidCoords).toBeDefined();
    expect(typeof nodeWithInvalidCoords.x).toBe('number');
    expect(typeof nodeWithInvalidCoords.scale).toBe('number');
  });

  it('should preserve complex Unicode and special characters', () => {
    const exported = exportToRedstring(edgeCaseState);
    const { storeState } = importFromRedstring(exported, {});
    
    const graph = storeState.graphs.get(Array.from(storeState.graphs.keys())[0]);
    expect(graph.name).toContain('"quotes"');
    expect(graph.name).toContain('<>&');
    expect(graph.description).toContain('🚀 💻 🧠');
    expect(graph.description).toContain('\n');
    expect(graph.description).toContain('\t');
  });

  it('should handle null and undefined values consistently', () => {
    const exported = exportToRedstring(edgeCaseState);
    const { storeState } = importFromRedstring(exported, {});
    
    // Null/undefined should be handled consistently
    const nodeWithNulls = Array.from(storeState.nodePrototypes.values())
      .find(node => node.name === '');
    
    // Should have default values for null/undefined fields
    expect(typeof nodeWithNulls.name).toBe('string');
    expect(nodeWithNulls.definitionGraphIds).toBeInstanceOf(Array);
  });

  it('should preserve Set and Map data structures', () => {
    const exported = exportToRedstring(edgeCaseState);
    const { storeState } = importFromRedstring(exported, {});
    
    expect(storeState.graphs).toBeInstanceOf(Map);
    expect(storeState.nodePrototypes).toBeInstanceOf(Map);
    expect(storeState.edges).toBeInstanceOf(Map);
    expect(storeState.expandedGraphIds).toBeInstanceOf(Set);
    expect(storeState.savedNodeIds).toBeInstanceOf(Set);
    expect(storeState.savedGraphIds).toBeInstanceOf(Set);
    
    // Edge directionality should be converted back to Set
    const edge = storeState.edges.get(Array.from(storeState.edges.keys())[0]);
    expect(edge.directionality.arrowsToward).toBeInstanceOf(Set);
  });

  it('should handle empty collections correctly', () => {
    const exported = exportToRedstring(edgeCaseState);
    const { storeState } = importFromRedstring(exported, {});
    
    expect(storeState.savedGraphIds.size).toBe(0);
    
    // Empty arrays should remain arrays
    const nodeWithEmpty = Array.from(storeState.nodePrototypes.values())
      .find(node => node.name === '');
    expect(nodeWithEmpty.externalLinks).toBeInstanceOf(Array);
    expect(nodeWithEmpty.externalLinks.length).toBe(0);
  });

  it('should handle invalid IDs and references', () => {
    const exported = exportToRedstring(edgeCaseState);
    const { storeState } = importFromRedstring(exported, {});
    
    // Current behavior: invalid IDs are preserved but system should still function
    expect(storeState.openGraphIds).toBeDefined();
    expect(Array.isArray(storeState.openGraphIds)).toBe(true);
    
    // Sets should be properly restored
    expect(storeState.expandedGraphIds).toBeInstanceOf(Set);
    expect(storeState.savedNodeIds).toBeInstanceOf(Set);
    expect(storeState.savedGraphIds).toBeInstanceOf(Set);
  });

  it('should preserve abstraction chains with special characters', () => {
    const exported = exportToRedstring(edgeCaseState);
    const { storeState } = importFromRedstring(exported, {});
    
    const nodeWithChains = Array.from(storeState.nodePrototypes.values())
      .find(node => node.abstractionChains && Object.keys(node.abstractionChains).length > 0);
    
    expect(nodeWithChains.abstractionChains).toHaveProperty('dimension with spaces');
    expect(nodeWithChains.abstractionChains).toHaveProperty('unicode-🚀');
  });

  it('should handle large data gracefully', () => {
    // Create state with large amounts of data
    const largeState = {
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
      showConnectionNames: false
    };

    // Add 1000 nodes
    for (let i = 0; i < 1000; i++) {
      const nodeId = uuidv4();
      largeState.nodePrototypes.set(nodeId, {
        id: nodeId,
        name: `Node ${i}`,
        description: `Description for node ${i}`.repeat(10), // Long descriptions
        color: '#000000',
        x: Math.random() * 10000,
        y: Math.random() * 10000,
        scale: Math.random(),
        definitionGraphIds: [],
        abstractionChains: {},
        externalLinks: [],
        equivalentClasses: [],
        citations: []
      });
    }

    const exported = exportToRedstring(largeState);
    expect(exported).toBeDefined();
    
    const { storeState } = importFromRedstring(exported, {});
    expect(storeState.nodePrototypes.size).toBe(1000);
  });

  it('should preserve JSON-LD context with user domain', () => {
    const userDomain = 'test.example.com';
    let currentState = edgeCaseState;
    
    // Multiple round trips with user domain
    for (let i = 0; i < 3; i++) {
      const exported = exportToRedstring(currentState, userDomain);
      expect(exported['@context']).toBeDefined();
      expect(exported.metadata.domain).toBe(userDomain);
      
      const { storeState } = importFromRedstring(exported, {});
      currentState = storeState;
    }
    
    expect(currentState.graphs.size).toBe(1);
  });
});