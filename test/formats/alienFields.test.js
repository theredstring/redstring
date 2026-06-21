import { describe, it, expect } from 'vitest';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Alien-field survival — audit finding #5 (data loss).
 *
 * Unknown fields injected at the file root, on a prototype, on an instance, and
 * on an edge must survive an import → export round trip. Originally all four were
 * pinned `it.fails`; P1.2 (quarantine into _preserved in the migration ledger) +
 * P1.3 (carry _preserved through import/export) fixed it, so all four now pass.
 *
 * Assertion is intentionally "the marker appears ANYWHERE in the re-exported
 * JSON" — the field lands in a `_preserved[version]` bag (D1); here we only
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
  it('preserves an unknown field at the file root', () => {
    const out = roundTripWithInjection((ex) => {
      ex.xFutureRootField = { __alien_root__: true };
    });
    expect(out).toContain('__alien_root__');
  });

  it('preserves an unknown field on a prototype', () => {
    const out = roundTripWithInjection((ex) => {
      ex.prototypeSpace.prototypes.pa.xFuturePrototypeField = '__alien_proto__';
    });
    expect(out).toContain('__alien_proto__');
  });

  it('preserves an unknown field on an instance', () => {
    const out = roundTripWithInjection((ex) => {
      ex.spatialGraphs.graphs.g['redstring:instances'].ia.xFutureInstanceField = '__alien_inst__';
    });
    expect(out).toContain('__alien_inst__');
  });

  it('preserves an unknown field on an edge', () => {
    const out = roundTripWithInjection((ex) => {
      ex.relationships.edges.e1.xFutureEdgeField = '__alien_edge__';
    });
    expect(out).toContain('__alien_edge__');
  });
});
