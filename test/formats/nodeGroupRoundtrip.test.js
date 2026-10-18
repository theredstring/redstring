import { describe, it, expect } from 'vitest';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Node-group fields must survive a save/load round trip.
 *
 * emptyPlaceholderOrigin was the gap: it is what holds a zero-member node-group's
 * shell open at a position on the canvas (groupLayout reads it when the group has
 * no members to derive bounds from). It was written by the store and read by the
 * layout, but never serialized — so an empty node-group collapsed back onto its
 * anchor after every reload.
 */

const buildStateWithGroup = (groupExtras) => {
  const nodePrototypes = new Map([
    ['p-thing', { id: 'p-thing', name: 'Engine', description: '', definitionGraphIds: ['g-def'], abstractionChains: {} }],
    ['p-a', { id: 'p-a', name: 'Piston', description: '', definitionGraphIds: [], abstractionChains: {} }]
  ]);
  const instances = new Map([
    ['i-anchor', { id: 'i-anchor', prototypeId: 'p-thing', x: 0, y: 0, scale: 1, isGroupAnchor: true, anchorForGroupId: 'grp' }],
    ['i-a', { id: 'i-a', prototypeId: 'p-a', x: 40, y: 0, scale: 1 }]
  ]);
  const groups = new Map([
    ['grp', {
      id: 'grp',
      name: 'Engine',
      description: '',
      color: '#8B0000',
      memberInstanceIds: ['i-a'],
      linkedNodePrototypeId: 'p-thing',
      linkedDefinitionIndex: 0,
      anchorInstanceId: 'i-anchor',
      ...groupExtras
    }]
  ]);
  const graphs = new Map([
    ['g', { id: 'g', name: 'Main', description: '', instances, edgeIds: [], definingNodeIds: [], groups }],
    ['g-def', { id: 'g-def', name: 'Engine', description: '', instances: new Map(), edgeIds: [], definingNodeIds: ['p-thing'] }]
  ]);
  return {
    graphs,
    nodePrototypes,
    edges: new Map(),
    openGraphIds: ['g'],
    activeGraphId: 'g',
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(),
    savedGraphIds: new Set()
  };
};

const roundTrip = (state) => {
  const exported = exportToRedstring(state);
  const { storeState } = importFromRedstring(exported);
  return storeState.graphs.get('g').groups.get('grp');
};

describe('node-group serialization round trip', () => {
  it('preserves the fields that make a group a node-group', () => {
    const group = roundTrip(buildStateWithGroup({}));

    expect(group.linkedNodePrototypeId).toBe('p-thing');
    expect(group.linkedDefinitionIndex).toBe(0);
    expect(group.anchorInstanceId).toBe('i-anchor');
    expect(group.memberInstanceIds).toEqual(['i-a']);
  });

  it('preserves emptyPlaceholderOrigin so an empty node-group keeps its position', () => {
    const group = roundTrip(buildStateWithGroup({
      memberInstanceIds: [],
      emptyPlaceholderOrigin: { x: 320, y: 180 }
    }));

    expect(group.emptyPlaceholderOrigin).toEqual({ x: 320, y: 180 });
  });

  it('leaves emptyPlaceholderOrigin undefined for groups that never had one', () => {
    const group = roundTrip(buildStateWithGroup({}));
    expect(group.emptyPlaceholderOrigin).toBeUndefined();
  });

  it('preserves format, so a group shown as a formula stays one after a reload', () => {
    const group = roundTrip(buildStateWithGroup({ format: 'formula' }));
    expect(group.format).toBe('formula');
    const exported = exportToRedstring(buildStateWithGroup({ format: 'formula' }));
    expect(JSON.stringify(exported)).toContain('"redstring:format":"formula"');
  });

  it('writes no format for a group shown as its Things', () => {
    const group = roundTrip(buildStateWithGroup({}));
    expect(group.format).toBeUndefined();
    expect(JSON.stringify(exportToRedstring(buildStateWithGroup({})))).not.toContain('"redstring:format":');
  });

  it('preserves how a Thing is written in formulas, and writes nothing for one that has no label', () => {
    const state = buildStateWithGroup({ format: 'formula' });
    state.nodePrototypes.get('p-a').labels = { formula: 'P' };
    const exported = exportToRedstring(state);
    const { storeState } = importFromRedstring(exported);
    expect(storeState.nodePrototypes.get('p-a').labels).toEqual({ formula: 'P' });
    expect(storeState.nodePrototypes.get('p-thing').labels).toBeUndefined();
    expect(JSON.stringify(exported).match(/"redstring:labels":/g)).toHaveLength(1);
  });

  it('keeps labels an older build banked away, so a round trip through it loses nothing', () => {
    const state = buildStateWithGroup({});
    const exported = exportToRedstring(state);
    // An older build keeps a field it doesn't know in _preserved, by version.
    const proto = Object.values(exported.prototypeSpace?.prototypes || {}).find(p => p['@id']?.includes('p-a') || p.id === 'p-a')
      || Object.values(exported.prototypeSpace?.prototypes || {})[1];
    proto._preserved = { '4.0.0': { 'redstring:labels': { formula: 'P' } } };
    const { storeState } = importFromRedstring(exported);
    const read = [...storeState.nodePrototypes.values()].find(p => p.labels);
    expect(read?.labels).toEqual({ formula: 'P' });
  });
});
