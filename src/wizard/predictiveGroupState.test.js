import { describe, it, expect } from 'vitest';
import { updateGraphState } from './AgentLoop.js';
import { drawnWebs } from './tools/utils/webView.js';

/**
 * The predictive graphState must mirror the store's REFUSALS, not just its
 * successes. ContextBuilder renders this state straight back into the model's
 * context (keyed on `linkedNodePrototypeId`), so a handler that optimistically
 * records a node-group the store never created makes the failure invisible —
 * the model reads "[Thing-Group: X]" and moves on while the canvas has a plain
 * group, or nothing at all. That is exactly how node-group creation stayed
 * broken without anyone noticing.
 */

const baseState = (groups = [], instances = [], protos = []) => ({
  activeGraphId: 'g1',
  graphs: [{ id: 'g1', name: 'Main', instances, edgeIds: [], groups, definingNodeIds: [] }],
  nodePrototypes: protos,
});

const groupsOf = (state) => state.graphs[0].groups;

describe('predictive state honesty — node-groups', () => {
  it('does NOT mark an empty group as a node-group (the store aborts on empty)', () => {
    const state = baseState([{ id: 'grp', name: 'Empty', color: '#111', memberInstanceIds: [] }]);

    updateGraphState(state, 'thingGroup', {}, {
      action: 'convertToThingGroup', graphId: 'g1', groupId: 'grp', groupName: 'Empty', thingName: 'Empty'
    });

    expect(groupsOf(state)[0].linkedNodePrototypeId).toBeUndefined();
  });

});

describe('predictive state — buildComposition mirror', () => {
  it('leaves a collapsed layer out of the parent graph\'s groups', () => {
    const state = baseState();

    updateGraphState(state, 'buildComposition', {}, {
      action: 'buildComposition', graphId: 'g1',
      spec: {
        nodes: [], edges: [], groups: [],
        layers: [{ name: 'Drivetrain', display: 'collapsed', definition: { nodes: [{ name: 'Gearbox' }] } }]
      }
    });

    expect(groupsOf(state)).toHaveLength(0);
    // ...but the Thing and its web exist, so a later tool can find them.
    expect(state.nodePrototypes.some(p => p.name === 'Drivetrain')).toBe(true);
    expect(state.graphs.some(g => g.name === 'Drivetrain')).toBe(true);
  });
});

// Definitions open in place: the Thing opens on its node, and the web as drawn (what every
// tool reads, webView.js drawnWebs) has it as a Thing-group of what its
// definition holds.
describe('predictive state — opened in place', () => {
  const drawnGroups = (state) => drawnWebs(state)('g1').groups;

  it('a group made a Thing-group opens its Thing over its members', () => {
    const state = baseState([{ id: 'grp', name: 'Cluster', color: '#111', memberInstanceIds: ['i1'] }], [{ id: 'i1', prototypeId: 'p1', name: 'Part' }], [{ id: 'p1', name: 'Part' }]);
    updateGraphState(state, 'thingGroup', {}, {
      action: 'convertToThingGroup', graphId: 'g1', groupId: 'grp', groupName: 'Cluster', thingName: 'Cluster'
    });
    expect(groupsOf(state)).toEqual([]);
    const box = drawnGroups(state).find(g => g.isOpenDefinition);
    expect(box).toMatchObject({ name: 'Cluster', memberInstanceIds: ['i1'] });
    expect(state.graphs[0].instances.map(i => i.id)).not.toContain('i1');
  });

  it('a decomposed node opens on its definition', () => {
    const state = baseState([], [{ id: 'i1', prototypeId: 'p1', name: 'Thing' }], [{ id: 'p1', name: 'Thing', definitionGraphIds: ['d1'] }]);
    state.graphs.push({ id: 'd1', name: 'Thing', instances: [{ id: 'part', prototypeId: 'p2', name: 'Part' }], edgeIds: [], groups: [] });
    state.nodePrototypes.push({ id: 'p2', name: 'Part' });
    updateGraphState(state, 'decomposeNode', {}, {
      action: 'decomposeNode', graphId: 'g1', prototypeId: 'p1', nodeName: 'Thing', originalInstanceId: 'i1', definitionIndex: 0,
    });
    expect(drawnGroups(state).find(g => g.isOpenDefinition)).toMatchObject({ name: 'Thing', memberInstanceIds: ['part'] });
  });

  it('a composition opens each layer on its node, the inner inside the outer', () => {
    const state = baseState();
    updateGraphState(state, 'buildComposition', {}, {
      action: 'buildComposition', graphId: 'g1', layerCount: 2, maxDepth: 2,
      spec: {
        nodes: [], edges: [], groups: [],
        layers: [{
          name: 'Car', color: '#a00', display: 'decomposed',
          definition: {
            nodes: [{ name: 'Chassis' }],
            layers: [{ name: 'Engine', color: '#0a0', display: 'decomposed', definition: { nodes: [{ name: 'Pistons' }] } }]
          }
        }]
      }
    });
    const groups = drawnGroups(state);
    const car = groups.find(g => g.name === 'Car');
    const engine = groups.find(g => g.name === 'Engine');
    expect(car?.isOpenDefinition).toBe(true);
    expect(engine?.isOpenDefinition).toBe(true);
    const outer = new Set(car.memberInstanceIds);
    expect(engine.memberInstanceIds.length).toBeGreaterThan(0);
    for (const id of engine.memberInstanceIds) expect(outer.has(id)).toBe(true);
  });
});
