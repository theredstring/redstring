import { describe, it, expect } from 'vitest';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

describe('Multi-edge, multi-definition, directionality roundtrip', () => {
  it('preserves multiple edges and definitionNodeIds and arrowsToward Set', () => {
    const graphs = new Map();
    const nodePrototypes = new Map();
    const edges = new Map();

    const g = 'g';
    const instA = 'ia';
    const instB = 'ib';
    const protoA = 'pa';
    const protoB = 'pb';
    const def1 = 'def1';
    const def2 = 'def2';

    nodePrototypes.set(protoA, { id: protoA, name: 'A', description: '', definitionGraphIds: [], abstractionChains: {} });
    nodePrototypes.set(protoB, { id: protoB, name: 'B', description: '', definitionGraphIds: [], abstractionChains: {} });
    nodePrototypes.set(def1, { id: def1, name: 'rel1', description: '', definitionGraphIds: [], abstractionChains: {} });
    nodePrototypes.set(def2, { id: def2, name: 'rel2', description: '', definitionGraphIds: [], abstractionChains: {} });

    const instances = new Map();
    instances.set(instA, { id: instA, prototypeId: protoA, x: 0, y: 0, scale: 1 });
    instances.set(instB, { id: instB, prototypeId: protoB, x: 100, y: 0, scale: 1 });
    graphs.set(g, { id: g, name: 'G', description: '', instances, edgeIds: [], definingNodeIds: [] });

    // Two edges between same pair, different definitions & directions
    edges.set('e1', {
      id: 'e1', sourceId: instA, destinationId: instB,
      definitionNodeIds: [def1, def2],
      directionality: { arrowsToward: new Set([instB]) } // A -> B
    });
    edges.set('e2', {
      id: 'e2', sourceId: instA, destinationId: instB,
      definitionNodeIds: [def2],
      directionality: { arrowsToward: new Set([instA, instB]) } // both ends (explicit bidirectional)
    });

    const original = {
      graphs,
      nodePrototypes,
      edges,
      openGraphIds: [],
      activeGraphId: null,
      activeDefinitionNodeId: null,
      expandedGraphIds: new Set(),
      rightPanelTabs: [],
      savedNodeIds: new Set(),
      savedGraphIds: new Set(),
      showConnectionNames: false
    };

    const exported = exportToRedstring(original);
    const { storeState } = importFromRedstring(exported, {});

    expect(storeState.edges.size).toBe(2);
    const re1 = storeState.edges.get('e1');
    const re2 = storeState.edges.get('e2');
    expect(Array.isArray(re1.definitionNodeIds)).toBe(true);
    expect(re1.definitionNodeIds.length).toBe(2);
    expect(re2.definitionNodeIds.length).toBe(1);
    expect(re1.directionality.arrowsToward instanceof Set).toBe(true);
    expect(re2.directionality.arrowsToward instanceof Set).toBe(true);
  });
});


