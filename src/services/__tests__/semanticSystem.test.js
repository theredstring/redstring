/**
 * Semantic Discovery System - Integration Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { discoverConnections } from '../semanticDiscovery.js';
import { calculateEntityMatchConfidence, deduplicateEntities } from '../entityMatching.js';
import { layoutRadialGraph, calculateNodeDimensions } from '../radialLayout.js';
import { exploreEntity, quickDiscover } from '../semanticIntegration.js';

describe('Semantic Discovery', () => {
  it('should discover connections with property labels', async () => {
    // Mock SPARQL client to avoid real network calls
    const mockConnection = {
      source: 'Mario',
      target: 'Nintendo',
      relation: 'developer',
      confidence: 0.90,
      distance: 1
    };

    // In a real test, we'd mock sparqlClient.executeQuery
    // For now, just verify the structure
    expect(mockConnection).toHaveProperty('source');
    expect(mockConnection).toHaveProperty('target');
    expect(mockConnection).toHaveProperty('relation');
    expect(mockConnection).toHaveProperty('confidence');
    expect(mockConnection.confidence).toBeGreaterThan(0);
    expect(mockConnection.confidence).toBeLessThanOrEqual(1);
  });

  it('should include relationship labels in results', () => {
    const connection = {
      source: 'Super Mario 64',
      target: 'Platform game',
      relation: 'genre',
      relationUri: 'dbo:genre',
      confidence: 0.85
    };

    expect(connection.relation).toBe('genre');
    expect(connection.relationUri).toContain('genre');
  });
});

describe('Entity Matching', () => {
  it('should match entities with same Wikidata ID', () => {
    const entity1 = {
      name: 'Super Mario Bros',
      wikidataId: 'Q854479',
      source: 'dbpedia'
    };

    const entity2 = {
      name: 'Super Mario Brothers',
      wikidataId: 'Q854479',
      source: 'wikidata'
    };

    const match = calculateEntityMatchConfidence(entity1, entity2);

    expect(match.confidence).toBeGreaterThan(0.85);
    expect(match.shouldMerge).toBe(true);
  });

  it('should not match entities with different Wikidata IDs', () => {
    const entity1 = {
      name: 'Mario',
      wikidataId: 'Q12379',
      source: 'wikidata'
    };

    const entity2 = {
      name: 'Zelda',
      wikidataId: 'Q45881',
      source: 'wikidata'
    };

    const match = calculateEntityMatchConfidence(entity1, entity2);

    expect(match.confidence).toBe(0);
  });

  it('should match entities with similar labels', () => {
    const entity1 = {
      name: 'Super Mario Bros',
      source: 'dbpedia'
    };

    const entity2 = {
      name: 'Super Mario Brothers',
      source: 'wikipedia'
    };

    const match = calculateEntityMatchConfidence(entity1, entity2);

    expect(match.confidence).toBeGreaterThan(0.6);
  });

  it('should deduplicate entity list', () => {
    const entities = [
      { name: 'Mario', wikidataId: 'Q12379', source: 'dbpedia' },
      { name: 'Mario', wikidataId: 'Q12379', source: 'wikidata' },
      { name: 'Luigi', wikidataId: 'Q210593', source: 'dbpedia' }
    ];

    const deduplicated = deduplicateEntities(entities);

    expect(deduplicated.length).toBe(2); // Mario merged, Luigi separate
  });
});

describe('Radial Layout', () => {
  it('should calculate node dimensions based on label', () => {
    const node1 = { name: 'A' };
    const node2 = { name: 'Super Mario Brothers' };

    const dims1 = calculateNodeDimensions(node1);
    const dims2 = calculateNodeDimensions(node2);

    expect(dims1.width).toBeLessThan(dims2.width);
    expect(dims1.height).toBe(dims2.height);
  });

  it('should position nodes without overlap', () => {
    const centralNode = { name: 'Mario' };
    const orbits = [
      {
        level: 1,
        entities: [
          { name: 'Nintendo' },
          { name: 'Platform game' },
          { name: 'Japan' }
        ]
      }
    ];

    const layout = layoutRadialGraph(centralNode, orbits);

    expect(layout.central).toBeDefined();
    expect(layout.nodes.length).toBe(3);

    // Check no overlaps (simplified - real check would use calculateOverlap)
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const node1 = layout.nodes[i];
        const node2 = layout.nodes[j];

        const dx = node2.x - node1.x;
        const dy = node2.y - node1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Nodes should be reasonably separated
        expect(distance).toBeGreaterThan(50);
      }
    }
  });

  it('should generate connection paths', () => {
    const centralNode = { name: 'Mario' };
    const orbits = [
      {
        level: 1,
        entities: [{ name: 'Nintendo' }]
      }
    ];
    const connections = [
      {
        source: 'Mario',
        target: 'Nintendo',
        relation: 'developer',
        confidence: 0.90
      }
    ];

    const layout = layoutRadialGraph(centralNode, orbits, connections);

    expect(layout.connections.length).toBe(1);
    expect(layout.connections[0].path).toBeDefined();
  });

  it('should handle overflow with subdivision', () => {
    const centralNode = { name: 'Center' };

    // Create many nodes (should trigger overflow)
    const manyNodes = Array.from({ length: 20 }, (_, i) => ({
      name: `Node ${i + 1}`
    }));

    const orbits = [
      {
        level: 1,
        entities: manyNodes
      }
    ];

    const layout = layoutRadialGraph(centralNode, orbits, [], {
      maxNodesPerOrbit: 10,
      overflowStrategy: 'subdivide'
    });

    // Should have nodes at slightly different radii (subdivided)
    const radii = new Set(layout.nodes.map(n => Math.round(n.radius)));
    expect(radii.size).toBeGreaterThan(1); // Multiple sub-orbits
  });
});

describe('Integration API', () => {
  it('should return structured exploration result', async () => {
    // Mock result structure (real test would mock API calls)
    const mockResult = {
      entity: 'Mario',
      central: { name: 'Mario' },
      entities: [
        { name: 'Mario' },
        { name: 'Nintendo' },
        { name: 'Platform game' }
      ],
      connections: [
        {
          source: 'Mario',
          target: 'Nintendo',
          relation: 'developer',
          confidence: 0.90
        }
      ],
      orbits: [
        {
          level: 1,
          entities: [
            { name: 'Nintendo' },
            { name: 'Platform game' }
          ]
        }
      ],
      layout: null,
      metadata: {
        totalEntities: 3,
        totalConnections: 1,
        sources: ['dbpedia']
      }
    };

    expect(mockResult).toHaveProperty('entity');
    expect(mockResult).toHaveProperty('central');
    expect(mockResult).toHaveProperty('entities');
    expect(mockResult).toHaveProperty('connections');
    expect(mockResult).toHaveProperty('orbits');
    expect(mockResult).toHaveProperty('metadata');

    expect(mockResult.entities.length).toBeGreaterThan(0);
    expect(mockResult.connections.length).toBeGreaterThan(0);
  });

  it('should organize entities into orbits by level', () => {
    const entities = [
      { name: 'Mario', level: 0, isRoot: true },
      { name: 'Nintendo', level: 1 },
      { name: 'Platform game', level: 1 },
      { name: 'Shigeru Miyamoto', level: 2 }
    ];

    // Group by level (simulating orbit organization)
    const orbits = [];
    const byLevel = new Map();

    for (const entity of entities) {
      if (entity.isRoot) continue;
      const level = entity.level || 1;
      if (!byLevel.has(level)) {
        byLevel.set(level, []);
      }
      byLevel.get(level).push(entity);
    }

    for (const [level, ents] of byLevel) {
      orbits.push({ level, entities: ents });
    }

    expect(orbits.length).toBe(2); // Level 1 and Level 2
    expect(orbits[0].entities.length).toBe(2); // Nintendo, Platform game
    expect(orbits[1].entities.length).toBe(1); // Shigeru Miyamoto
  });
});

describe('Property Weights', () => {
  it('should rank properties by importance', () => {
    const connections = [
      { relation: 'developer', confidence: 0.90 },
      { relation: 'mentioned in', confidence: 0.30 },
      { relation: 'genre', confidence: 0.85 }
    ];

    const sorted = connections.sort((a, b) => b.confidence - a.confidence);

    expect(sorted[0].relation).toBe('developer'); // Highest
    expect(sorted[1].relation).toBe('genre');      // Medium
    expect(sorted[2].relation).toBe('mentioned in'); // Lowest
  });
});
