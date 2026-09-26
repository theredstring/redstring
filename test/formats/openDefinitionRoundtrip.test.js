import { describe, it, expect } from 'vitest';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

// Definitions opened in place (src/core/openDefinitions.js) add two optional
// fields: redstring:openDefinition on an instance, and sourceVia/destinationVia on
// a connection that reaches into a definition. Both are additive, no version bump.
// These tests pin that they round-trip, that a trip through a build that predates
// them loses nothing, and that the connection still reads as a plain statement.

const graph = (id, instances, edgeIds) => ({
  id, name: id, description: '',
  instances: new Map(instances.map(i => [i.id, i])),
  edgeIds,
  groups: new Map(),
  definingNodeIds: [],
});

const buildState = ({ open = true } = {}) => ({
  graphs: new Map([
    ['main', graph('main', [
      { id: 'box', prototypeId: 'p-box', x: 500, y: 500, scale: 1, ...(open ? { openDefinition: { index: 0, offset: { x: 400, y: 450 } } } : {}) },
      { id: 'out', prototypeId: 'p-out', x: 0, y: 0, scale: 1 },
    ], ['e-across'])],
    ['box-def', graph('box-def', [
      { id: 'a', prototypeId: 'p-a', x: 100, y: 50, scale: 1 },
    ], [])],
  ]),
  nodePrototypes: new Map([
    ['p-box', { id: 'p-box', name: 'Box', description: '', definitionGraphIds: ['box-def'], abstractionChains: {} }],
    ['p-out', { id: 'p-out', name: 'Outside', description: '', definitionGraphIds: [], abstractionChains: {} }],
    ['p-a', { id: 'p-a', name: 'A', description: '', definitionGraphIds: [], abstractionChains: {} }],
    ['p-rel', { id: 'p-rel', name: 'Feeds', description: '', definitionGraphIds: [], abstractionChains: {} }],
  ]),
  edges: new Map([
    ['e-across', {
      id: 'e-across', sourceId: 'a', destinationId: 'out', sourceVia: ['box'],
      typeNodeId: 'p-rel', definitionNodeIds: [],
      directionality: { arrowsToward: new Set(['out']) },
    }],
  ]),
  openGraphIds: ['main'],
  activeGraphId: 'main',
  activeDefinitionNodeId: null,
  expandedGraphIds: new Set(),
  rightPanelTabs: [],
  savedNodeIds: new Set(),
  savedGraphIds: new Set(),
  showConnectionNames: false,
});

const instanceIn = (doc, graphId, instanceId) =>
  doc.spatialGraphs.graphs[graphId]['redstring:instances'][instanceId];
const edgeIn = (doc, graphId, edgeId) =>
  doc.spatialGraphs.graphs[graphId]['redstring:edges'][edgeId];

/**
 * What a build that predates these fields does to them on read: quarantine
 * unknown top-level keys into _preserved[version], then write the bag back out.
 */
const throughOlderBuild = (doc) => {
  const box = instanceIn(doc, 'main', 'box');
  if (box['redstring:openDefinition']) {
    box._preserved = { '4.1.0': { 'redstring:openDefinition': box['redstring:openDefinition'] } };
    delete box['redstring:openDefinition'];
  }
  const across = edgeIn(doc, 'main', 'e-across');
  across._preserved = { '4.1.0': { sourceVia: across.sourceVia } };
  delete across.sourceVia;
  return doc;
};

describe('open definitions in the .redstring format', () => {
  it('writes the open node and the connection readably', () => {
    const doc = exportToRedstring(buildState());
    expect(instanceIn(doc, 'main', 'box')['redstring:openDefinition']).toEqual({
      'redstring:definitionIndex': 0,
      'redstring:xOffset': 400,
      'redstring:yOffset': 450,
    });
    const across = edgeIn(doc, 'main', 'e-across');
    expect(across.sourceVia).toEqual(['box']);
    // The connection lives in the outer web and still reads as a plain statement
    // between the Things themselves: A feeds Outside.
    expect(across.rdfStatements).toEqual([expect.objectContaining({
      subject: { '@id': expect.stringContaining('p-a') },
      object: { '@id': expect.stringContaining('p-out') },
    })]);
    // The definition itself holds no copy of anything and no reference outward.
    expect(Object.keys(doc.spatialGraphs.graphs['box-def']['redstring:instances'])).toEqual(['a']);
    expect(doc.spatialGraphs.graphs['box-def']['redstring:edges']).toEqual({});
  });

  it('leaves both fields out when nothing is open or reached into', () => {
    const state = buildState({ open: false });
    state.edges.get('e-across').sourceVia = undefined;
    const doc = exportToRedstring(state);
    expect('redstring:openDefinition' in instanceIn(doc, 'main', 'box')).toBe(false);
    expect('sourceVia' in edgeIn(doc, 'main', 'e-across')).toBe(false);
  });

  it('round-trips', () => {
    const back = importFromRedstring(exportToRedstring(buildState())).storeState;
    expect(back.graphs.get('main').instances.get('box').openDefinition).toEqual({ index: 0, offset: { x: 400, y: 450 } });
    expect(back.edges.get('e-across').sourceVia).toEqual(['box']);
    expect(back.graphs.get('main').edgeIds).toContain('e-across');
  });

  it('comes back whole after a trip through a build that predates it', () => {
    const doc = throughOlderBuild(exportToRedstring(buildState()));
    const back = importFromRedstring(doc).storeState;
    const box = back.graphs.get('main').instances.get('box');
    expect(box.openDefinition).toEqual({ index: 0, offset: { x: 400, y: 450 } });
    expect(back.edges.get('e-across').sourceVia).toEqual(['box']);
    // Taken out of the bag, so the recovered copy is the only one.
    expect(box._preserved).toBeUndefined();
    expect(back.edges.get('e-across')._preserved).toBeUndefined();
  });

  it('stays closed once closed, even if an older build carried the open state', () => {
    const doc = throughOlderBuild(exportToRedstring(buildState()));
    const loaded = importFromRedstring(doc).storeState;
    delete loaded.graphs.get('main').instances.get('box').openDefinition; // closed here
    const again = importFromRedstring(exportToRedstring(loaded)).storeState;
    expect(again.graphs.get('main').instances.get('box').openDefinition).toBeUndefined();
  });
});
