import { describe, it, expect } from 'vitest';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';
import { MIGRATIONS } from '../../src/formats/migrations.js';

/**
 * Phase 3 — Dataset structure tests (P3.1 / P3.2 / P3.3)
 *
 * P3.1: exportToRedstring({ emitV4: true }) produces D10 shape — edges inside
 *       their graph, no top-level relationships.
 * P3.2: importFromRedstring reads edges from graph-embedded location when
 *       relationships is absent.
 * P3.3: STAGED_MIGRATIONS['3.0.0→4.0.0'] correctly relocates edges and handles
 *       both edgeIds-based and instance-containment assignment.
 */

// ── Shared state builder ────────────────────────────────────────────────────

const buildState = ({ withEdgeIds = true } = {}) => {
  const nodePrototypes = new Map([
    ['dog', { id: 'dog', name: 'Dog', description: '', definitionGraphIds: [], abstractionChains: {} }],
    ['cat', { id: 'cat', name: 'Cat', description: '', definitionGraphIds: [], abstractionChains: {} }]
  ]);

  const instances = new Map([
    ['i1', { id: 'i1', prototypeId: 'dog', x: 10, y: 20, scale: 1 }],
    ['i2', { id: 'i2', prototypeId: 'cat', x: 30, y: 40, scale: 1 }]
  ]);

  const graphShape = {
    id: 'g1', name: 'Main', description: '', instances,
    definingNodeIds: [],
    ...(withEdgeIds ? { edgeIds: ['e1'] } : {})
  };

  const edges = new Map([
    ['e1', {
      id: 'e1', sourceId: 'i1', destinationId: 'i2',
      typeNodeId: 'base-connection-prototype', definitionNodeIds: [],
      directionality: { arrowsToward: new Set(['i2']) },
      name: 'relates', description: ''
    }]
  ]);

  return {
    graphs: new Map([['g1', graphShape]]),
    nodePrototypes, edges,
    openGraphIds: ['g1'], activeGraphId: 'g1', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false
  };
};

// ── P3.1: v4 export shape ────────────────────────────────────────────────────

describe('P3.1 — v4 export shape (emitV4: true)', () => {
  const state = buildState();
  const ex = exportToRedstring(state, null, { emitV4: true });

  it('emits format redstring-v4.1.0', () => {
    expect(ex.format).toBe('redstring-v4.1.0');
    expect(ex.metadata.version).toBe('4.1.0');
  });

  it('has NO top-level relationships section', () => {
    expect(ex.relationships).toBeUndefined();
  });

  it('embeds edges inside the owning spatialGraph entry', () => {
    const g = ex.spatialGraphs.graphs.g1;
    expect(g['redstring:edges']).toBeDefined();
    expect(g['redstring:edges'].e1).toBeDefined();
    expect(g['redstring:edges'].e1.sourceId).toBe('i1');
  });

  it('retains all edge fields inside the graph entry', () => {
    const e = ex.spatialGraphs.graphs.g1['redstring:edges'].e1;
    expect(e.destinationId).toBe('i2');
    expect(e.directionality.arrowsToward).toEqual(['i2']);
    expect(e.rdfStatements).toHaveLength(1);
  });

  it('emitV4: false still produces a legacy-structure export with relationships, no graph edges', () => {
    // The default (EMIT_V4=true) now produces v4. Explicit false still emits v3 structure.
    const legacy = exportToRedstring(state, null, { emitV4: false });
    expect(legacy.relationships.edges.e1).toBeDefined();
    const g = legacy.spatialGraphs.graphs.g1;
    expect(g['redstring:edges']).toBeUndefined();
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────
// EMIT_V4=true is now live, so the default export IS v4. No header-patching needed.

// ── P3.2: import v4-shaped data ─────────────────────────────────────────────

describe('P3.2 — import reads edges from spatialGraph entries', () => {
  const state = buildState();

  it('round-trips through v4 export: edge count and directionality survive', () => {
    const ex = exportToRedstring(state);
    const { storeState } = importFromRedstring(ex, {});
    expect(storeState.edges.size).toBe(1);
    const e = storeState.edges.get('e1');
    expect(e).toBeDefined();
    expect(e.sourceId).toBe('i1');
    expect(e.destinationId).toBe('i2');
    expect(e.directionality.arrowsToward).toBeInstanceOf(Set);
    expect(e.directionality.arrowsToward.has('i2')).toBe(true);
  });

  it('multi-graph: edges assigned to the right graph', () => {
    const s = buildState();
    s.nodePrototypes.set('bird', { id: 'bird', name: 'Bird', description: '', definitionGraphIds: [], abstractionChains: {} });
    const instances2 = new Map([
      ['i3', { id: 'i3', prototypeId: 'bird', x: 0, y: 0, scale: 1 }],
      ['i4', { id: 'i4', prototypeId: 'cat', x: 50, y: 0, scale: 1 }]
    ]);
    s.graphs.set('g2', { id: 'g2', name: 'G2', description: '', instances: instances2, edgeIds: ['e2'], definingNodeIds: [] });
    s.edges.set('e2', {
      id: 'e2', sourceId: 'i3', destinationId: 'i4',
      typeNodeId: 'base-connection-prototype', definitionNodeIds: [],
      directionality: { arrowsToward: new Set() }
    });

    const ex = exportToRedstring(s); // default is now v4
    expect(ex.spatialGraphs.graphs.g1['redstring:edges'].e1).toBeDefined();
    expect(ex.spatialGraphs.graphs.g2['redstring:edges'].e2).toBeDefined();
    expect(ex.spatialGraphs.graphs.g1['redstring:edges'].e2).toBeUndefined();

    const { storeState } = importFromRedstring(ex, {});
    expect(storeState.edges.size).toBe(2);
  });

  it('v4-shaped doc with absent relationships → reads graph-embedded edges', () => {
    // Build a minimal v4 doc with no relationships section and edges in a graph.
    const doc = {
      format: 'redstring-v4.0.0',
      metadata: { version: '4.0.0' },
      prototypeSpace: {
        prototypes: {
          dog: { '@type': ['redstring:Prototype'], '@id': 'urn:redstring:id:dog', name: 'Dog', description: '' }
        }
      },
      spatialGraphs: {
        graphs: {
          g1: {
            '@type': 'redstring:SpatialGraph',
            '@id': 'urn:redstring:id:g1',
            'rdfs:label': 'G1',
            'redstring:edgeIds': ['e1'],
            'redstring:instances': {
              i1: { '@type': 'redstring:Instance', '@id': 'urn:redstring:id:i1', 'redstring:prototypeId': 'dog' },
              i2: { '@type': 'redstring:Instance', '@id': 'urn:redstring:id:i2', 'redstring:prototypeId': 'dog' }
            },
            'redstring:edges': {
              e1: {
                id: 'e1', sourceId: 'i1', destinationId: 'i2',
                typeNodeId: 'base-connection-prototype', definitionNodeIds: [],
                directionality: { arrowsToward: ['i2'] }, rdfStatements: null
              }
            }
          }
        }
      }
      // intentionally NO relationships section
    };
    const { storeState } = importFromRedstring(doc, {});
    expect(storeState.edges.size).toBe(1);
    expect(storeState.edges.get('e1').sourceId).toBe('i1');
  });
});

// ── P3.3: MIGRATIONS['3.0.0→4.0.0'] (formerly STAGED_MIGRATIONS) ────────────

describe('P3.3 — migration 3.0.0→4.0.0', () => {
  const migrate = MIGRATIONS.find((m) => m.from === '3.0.0' && m.to === '4.0.0');

  it('migration entry exists in MIGRATIONS', () => {
    expect(migrate).toBeDefined();
    expect(migrate.from).toBe('3.0.0');
    expect(migrate.to).toBe('4.0.0');
  });

  const makeV3Doc = (withEdgeIds = true) => ({
    format: 'redstring-v3.0.0',
    metadata: { version: '3.0.0' },
    prototypeSpace: { prototypes: { dog: { id: 'dog', name: 'Dog' } } },
    spatialGraphs: {
      graphs: {
        g1: {
          '@type': 'redstring:SpatialGraph',
          id: 'g1',
          'redstring:edgeIds': withEdgeIds ? ['e1'] : [],
          'redstring:instances': {
            i1: { id: 'i1', prototypeId: 'dog', x: 0, y: 0 },
            i2: { id: 'i2', prototypeId: 'cat', x: 10, y: 0 }
          }
        }
      }
    },
    relationships: {
      edges: {
        e1: { id: 'e1', sourceId: 'i1', destinationId: 'i2', name: 'relates' }
      }
    }
  });

  it('moves edges into the owning graph via edgeIds', () => {
    const result = migrate.migrate(makeV3Doc(true));
    expect(result.relationships).toBeUndefined();
    expect(result.spatialGraphs.graphs.g1['redstring:edges'].e1).toBeDefined();
    expect(result.spatialGraphs.graphs.g1['redstring:edges'].e1.name).toBe('relates');
  });

  it('falls back to instance containment when edgeIds is empty', () => {
    const result = migrate.migrate(makeV3Doc(false));
    expect(result.relationships).toBeUndefined();
    // i1 and i2 are instances of g1 — migration should find the graph via them
    expect(result.spatialGraphs.graphs.g1['redstring:edges'].e1).toBeDefined();
  });

  it('quarantines truly unownable edges to _preserved to avoid data loss', () => {
    const doc = makeV3Doc(false);
    // Remove instances so there's no containment fallback either
    doc.spatialGraphs.graphs.g1['redstring:instances'] = {};
    const result = migrate.migrate(doc);
    expect(result._preserved['3.0.0']._unownedEdges.e1).toBeDefined();
    // The graph entry should exist but have no edges
    expect(Object.keys(result.spatialGraphs.graphs.g1['redstring:edges']).length).toBe(0);
  });

  it('does not mutate its input (pure)', () => {
    const doc = makeV3Doc(true);
    const snapshot = JSON.stringify(doc);
    migrate.migrate(doc);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('full round-trip via migration: v3 doc → migrate → import → same edge state', () => {
    const v3Doc = makeV3Doc(true);
    const migrated = migrate.migrate(v3Doc);
    // CURRENT_FORMAT_VERSION is now 4.0.0, so stamp the migrated doc as v4.
    const v4Doc = { ...migrated, format: 'redstring-v4.0.0', metadata: { ...(migrated.metadata || {}), version: '4.0.0' } };
    const { storeState } = importFromRedstring(v4Doc, {});
    expect(storeState.edges.size).toBe(1);
    expect(storeState.edges.get('e1').name).toBe('relates');
  });
});
