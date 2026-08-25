import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { exportToRedstring, importFromRedstring, getRedstringStats } from '../../src/formats/redstringFormat.js';

/**
 * Stats Reader Tests
 *
 * The repository/universe selectors show "N webs · N things · N connections"
 * for files they have not loaded. Those counts used to be read with a
 * store-shaped reader (top-level nodePrototypes/graphs/edges), which does not
 * match ANY on-disk .redstring shape — so every scanned repository file
 * reported 0 things and 0 connections. These tests pin the reader to whatever
 * a real import would produce.
 */

const buildState = () => {
  const graphA = uuidv4();
  const graphB = uuidv4();
  const protoA = uuidv4();
  const protoB = uuidv4();
  const protoC = uuidv4();
  const instA = uuidv4();
  const instB = uuidv4();
  const edgeId = uuidv4();

  return {
    graphs: new Map([
      [graphA, {
        id: graphA,
        name: 'Web A',
        description: '',
        instances: new Map([
          [instA, { id: instA, prototypeId: protoA, x: 0, y: 0, scale: 1 }],
          [instB, { id: instB, prototypeId: protoB, x: 100, y: 100, scale: 1 }]
        ]),
        edgeIds: [edgeId],
        definingNodeIds: []
      }],
      [graphB, {
        id: graphB,
        name: 'Web B',
        description: '',
        instances: new Map(),
        edgeIds: [],
        definingNodeIds: []
      }]
    ]),
    nodePrototypes: new Map([
      [protoA, { id: protoA, name: 'A', description: '', color: '#8B0000', definitionGraphIds: [] }],
      [protoB, { id: protoB, name: 'B', description: '', color: '#8B0000', definitionGraphIds: [] }],
      [protoC, { id: protoC, name: 'C', description: '', color: '#8B0000', definitionGraphIds: [] }]
    ]),
    edges: new Map([
      [edgeId, {
        id: edgeId,
        sourceId: instA,
        destinationId: instB,
        directionality: { arrowsToward: new Set() }
      }]
    ]),
    edgePrototypes: new Map(),
    openGraphIds: [],
    activeGraphId: graphA,
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    showConnectionNames: false
  };
};

const EXPECTED = { nodeCount: 3, graphCount: 2, connectionCount: 1, instanceCount: 2 };

describe('getRedstringStats', () => {
  it('counts a v4 file (edges nested inside each spatial graph)', () => {
    const file = JSON.parse(JSON.stringify(exportToRedstring(buildState())));
    expect(file.relationships).toBeUndefined(); // v4: no global edge map
    expect(getRedstringStats(file)).toEqual(EXPECTED);
  });

  it('counts a v3 file (global relationships.edges map)', () => {
    const file = JSON.parse(JSON.stringify(exportToRedstring(buildState(), null, { emitV4: false })));
    expect(file.relationships.edges).toBeDefined();
    expect(getRedstringStats(file)).toEqual(EXPECTED);
  });

  it('counts a live store state with Maps', () => {
    expect(getRedstringStats(buildState())).toEqual(EXPECTED);
  });

  it('counts a legacy/flat document', () => {
    const state = buildState();
    const flat = {
      format: 'redstring-v2.0.0-semantic',
      metadata: { version: '2.0.0-semantic' },
      nodePrototypes: Object.fromEntries(state.nodePrototypes),
      graphs: Object.fromEntries(
        Array.from(state.graphs, ([id, g]) => [id, { ...g, instances: Object.fromEntries(g.instances) }])
      ),
      edges: Object.fromEntries(state.edges)
    };
    expect(getRedstringStats(flat)).toEqual(EXPECTED);
  });

  it('matches what a real import produces', () => {
    const file = JSON.parse(JSON.stringify(exportToRedstring(buildState())));
    const { storeState } = importFromRedstring(file);
    const stats = getRedstringStats(file);
    expect(stats.nodeCount).toBe(storeState.nodePrototypes.size);
    expect(stats.graphCount).toBe(storeState.graphs.size);
    expect(stats.connectionCount).toBe(storeState.edges.size);
  });

  it('does not double-count when both edge locations are populated', () => {
    const file = JSON.parse(JSON.stringify(exportToRedstring(buildState())));
    const graph = Object.values(file.spatialGraphs.graphs).find(g => Object.keys(g['redstring:edges'] || {}).length > 0);
    // Simulate a partially-migrated file carrying the same edge in both places.
    file.relationships = { edges: { ...graph['redstring:edges'] } };
    expect(getRedstringStats(file).connectionCount).toBe(1);
  });

  it('reports nulls rather than a confident zero for unreadable input', () => {
    const nulls = { nodeCount: null, graphCount: null, connectionCount: null, instanceCount: null };
    expect(getRedstringStats(null)).toEqual(nulls);
    expect(getRedstringStats([1, 2, 3])).toEqual(nulls);
    expect(getRedstringStats({ some: 'other json' })).toEqual(nulls);
  });

  it('reports zeros for a genuinely empty universe file', () => {
    const empty = exportToRedstring({
      graphs: new Map(),
      nodePrototypes: new Map(),
      edges: new Map(),
      edgePrototypes: new Map()
    });
    expect(getRedstringStats(JSON.parse(JSON.stringify(empty)))).toEqual({
      nodeCount: 0, graphCount: 0, connectionCount: 0, instanceCount: 0
    });
  });
});
