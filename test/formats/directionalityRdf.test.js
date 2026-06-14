import { describe, it, expect } from 'vitest';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Directionality → RDF projection (P0.3) — pins audit finding #3.
 *
 * `edge.directionality.arrowsToward` (a Set of node IDs) has four states. The
 * correct RDF projection (per src/core/Edge.js and FORMAT_REFACTOR_PLAN.md §2):
 *
 *   empty            → 2 reciprocal triples (non-directed)
 *   {destinationId}  → 1 triple  source → dest
 *   {sourceId}       → 1 triple  dest → source
 *   both             → 2 reciprocal triples
 *
 * Originally two of these (the {sourceId} and bidirectional cases) were pinned
 * `it.fails` against audit finding #3. P1.4 fixed the projection, so all four
 * are now plain passing `it`.
 */

const PROTO_A = 'pa';
const PROTO_B = 'pb';

const buildState = (arrowsToward) => {
  const nodePrototypes = new Map([
    [PROTO_A, { id: PROTO_A, name: 'A', description: '', definitionGraphIds: [], abstractionChains: {} }],
    [PROTO_B, { id: PROTO_B, name: 'B', description: '', definitionGraphIds: [], abstractionChains: {} }]
  ]);
  const instances = new Map([
    ['ia', { id: 'ia', prototypeId: PROTO_A, x: 0, y: 0, scale: 1 }],
    ['ib', { id: 'ib', prototypeId: PROTO_B, x: 10, y: 0, scale: 1 }]
  ]);
  const graphs = new Map([
    ['g', { id: 'g', name: 'G', description: '', instances, edgeIds: ['e1'], definingNodeIds: [] }]
  ]);
  const edges = new Map([
    ['e1', {
      id: 'e1', sourceId: 'ia', destinationId: 'ib',
      typeNodeId: 'base-connection-prototype', definitionNodeIds: [],
      directionality: { arrowsToward }
    }]
  ]);
  return {
    graphs, nodePrototypes, edges,
    openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false
  };
};

// Returns the directed prototype pairs, e.g. ['pa->pb', 'pb->pa'].
const directedPairs = (arrowsToward) => {
  const exported = exportToRedstring(buildState(arrowsToward));
  const statements = exported.relationships.edges.e1.rdfStatements || [];
  return statements.map((s) => {
    const subj = String(s.subject['@id']).replace(/^node:/, '');
    const obj = String(s.object['@id']).replace(/^node:/, '');
    return `${subj}->${obj}`;
  });
};

describe('Directionality RDF projection', () => {
  it('non-directed (empty set) → two reciprocal triples', () => {
    const pairs = directedPairs(new Set());
    expect(pairs).toHaveLength(2);
    expect(pairs).toContain('pa->pb');
    expect(pairs).toContain('pb->pa');
  });

  it('source→target ({destinationId}) → one forward triple', () => {
    const pairs = directedPairs(new Set(['ib']));
    expect(pairs).toEqual(['pa->pb']);
  });

  it('target→source ({sourceId}) → one reverse triple', () => {
    const pairs = directedPairs(new Set(['ia']));
    expect(pairs).toEqual(['pb->pa']);
  });

  it('bidirectional (both) → two reciprocal triples', () => {
    const pairs = directedPairs(new Set(['ia', 'ib']));
    expect(pairs).toHaveLength(2);
    expect(pairs).toContain('pa->pb');
    expect(pairs).toContain('pb->pa');
  });
});
