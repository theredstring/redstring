import { describe, it, expect } from 'vitest';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Single-source serialization (P1.5 / P3.1).
 *
 * Each entity is serialized exactly once under the canonical v4 sections
 * (prototypeSpace / spatialGraphs). In v4, edges are scoped inside their
 * spatial graph under `redstring:edges` — no top-level `relationships` section.
 * Historical duplicate mirrors (graphs / nodePrototypes / edges) and `legacy`
 * blocks are no longer written.
 */

const buildState = () => {
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
    ['e1', { id: 'e1', sourceId: 'ia', destinationId: 'ib', definitionNodeIds: ['pa'], directionality: { arrowsToward: new Set(['ib']) } }]
  ]);
  return {
    graphs, nodePrototypes, edges,
    openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false
  };
};

describe('Single-source serialization', () => {
  const exported = exportToRedstring(buildState());

  it('writes the canonical sections', () => {
    expect(exported.prototypeSpace?.prototypes).toBeTruthy();
    expect(exported.spatialGraphs?.graphs).toBeTruthy();
    // v4: edges live inside the graph, not in a top-level relationships section.
    expect(exported.spatialGraphs?.graphs?.g?.['redstring:edges']).toBeTruthy();
    expect(exported.relationships).toBeUndefined();
  });

  it('does not write duplicate top-level mirrors or a legacy block', () => {
    expect(exported.graphs).toBeUndefined();
    expect(exported.nodePrototypes).toBeUndefined();
    expect(exported.edges).toBeUndefined();
    expect(exported.legacy).toBeUndefined();
  });

  it('serializes each entity exactly once in the JSON text', () => {
    const json = JSON.stringify(exported);
    expect(Object.keys(exported.prototypeSpace.prototypes)).toEqual(['pa', 'pb']);
    expect(Object.keys(exported.spatialGraphs.graphs)).toEqual(['g']);
    // v4: edges are in the owning graph, not in a separate top-level section.
    expect(Object.keys(exported.spatialGraphs.graphs.g['redstring:edges'])).toEqual(['e1']);
    expect(json).not.toContain('"legacy"');
  });

  it('still round-trips through import', () => {
    const { storeState } = importFromRedstring(exported, {});
    expect(storeState.nodePrototypes.size).toBe(2);
    expect(storeState.graphs.size).toBe(1);
    expect(storeState.edges.size).toBe(1);
  });
});
