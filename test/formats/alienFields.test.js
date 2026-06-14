import { describe, it, expect } from 'vitest';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Alien-field survival (P0.2) — pins audit finding #5 (data loss).
 *
 * Unknown fields injected at the file root, on a prototype, on an instance, and
 * on an edge must survive an import → export round trip. Today they are silently
 * dropped, so all four cases are pinned `it.fails`. Phase 1 flips them to passing:
 *   - root / prototype / edge   → P1.2 (quarantine in the migration ledger)
 *   - instance                  → P1.3 (carry `_preserved` through import/export)
 *
 * Assertion is intentionally "the marker appears ANYWHERE in the re-exported
 * JSON" — D1's exact `_preserved` location is enforced later; for now we only
 * assert it is not lost.
 */

const buildMinimalState = () => {
  const nodePrototypes = new Map([
    ['pa', { id: 'pa', name: 'A', description: '', definitionGraphIds: [], abstractionChains: {} }],
    ['pb', { id: 'pb', name: 'B', description: '', definitionGraphIds: [], abstractionChains: {} }]
  ]);
  const instances = new Map([
    ['ia', { id: 'ia', prototypeId: 'pa', x: 0, y: 0, scale: 1 }],
    ['ib', { id: 'ib', prototypeId: 'pb', x: 10, y: 0, scale: 1 }]
  ]);
  const graphs = new Map([
    ['g', { id: 'g', name: 'G', description: '', instances, edgeIds: ['e1'], definingNodeIds: [] }]
  ]);
  const edges = new Map([
    ['e1', {
      id: 'e1', sourceId: 'ia', destinationId: 'ib',
      definitionNodeIds: ['pa'],
      directionality: { arrowsToward: new Set(['ib']) }
    }]
  ]);
  return {
    graphs, nodePrototypes, edges,
    openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false
  };
};

// Round-trip a state through import after mutating the exported JSON, then return
// the re-exported JSON as a string so we can search for the injected marker.
const roundTripWithInjection = (inject) => {
  const exported = exportToRedstring(buildMinimalState());
  inject(exported);
  const { storeState } = importFromRedstring(exported, {});
  const reExported = exportToRedstring(storeState);
  return JSON.stringify(reExported);
};

describe('Alien-field survival', () => {
  it.fails('preserves an unknown field at the file root', () => {
    const out = roundTripWithInjection((ex) => {
      ex.xFutureRootField = { __alien_root__: true };
    });
    expect(out).toContain('__alien_root__');
  });

  it.fails('preserves an unknown field on a prototype', () => {
    const out = roundTripWithInjection((ex) => {
      ex.prototypeSpace.prototypes.pa.xFuturePrototypeField = '__alien_proto__';
    });
    expect(out).toContain('__alien_proto__');
  });

  it.fails('preserves an unknown field on an instance', () => {
    const out = roundTripWithInjection((ex) => {
      ex.spatialGraphs.graphs.g['redstring:instances'].ia.xFutureInstanceField = '__alien_inst__';
    });
    expect(out).toContain('__alien_inst__');
  });

  it.fails('preserves an unknown field on an edge', () => {
    const out = roundTripWithInjection((ex) => {
      ex.relationships.edges.e1.xFutureEdgeField = '__alien_edge__';
    });
    expect(out).toContain('__alien_edge__');
  });
});
