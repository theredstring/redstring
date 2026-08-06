import { describe, it, expect } from 'vitest';
import { updateGraphState } from './AgentLoop.js';

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
  nodePrototypes: protos
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

  it('records a real prototype and anchor when the conversion would succeed', () => {
    const state = baseState([{ id: 'grp', name: 'Cluster', color: '#111', memberInstanceIds: ['i1'] }]);

    updateGraphState(state, 'thingGroup', {}, {
      action: 'convertToThingGroup', graphId: 'g1', groupId: 'grp', groupName: 'Cluster', thingName: 'Cluster'
    });

    const group = groupsOf(state)[0];
    expect(group.linkedNodePrototypeId).toBeTruthy();
    expect(group.linkedDefinitionIndex).toBe(0);
    expect(group.anchorInstanceId).toBeTruthy();
    // The prototype must actually exist — a dangling id reads as a node-group
    // backed by no Thing.
    expect(state.nodePrototypes.some(p => p.id === group.linkedNodePrototypeId)).toBe(true);
  });

  it('does NOT invent a group when the definition graph is empty', () => {
    const state = baseState([], [{ id: 'i1', prototypeId: 'p1', name: 'Thing' }]);

    updateGraphState(state, 'decomposeNode', {}, {
      action: 'decomposeNode', graphId: 'g1', prototypeId: 'p1', nodeName: 'Thing',
      originalInstanceId: 'i1', definitionInstances: []
    });

    expect(groupsOf(state)).toHaveLength(0);
  });

  it('does NOT decompose twice into the same prototype/definition', () => {
    const state = baseState(
      [{ id: 'existing', name: 'Thing', memberInstanceIds: ['m1'], linkedNodePrototypeId: 'p1', linkedDefinitionIndex: 0 }],
      [{ id: 'i1', prototypeId: 'p1', name: 'Thing' }]
    );

    updateGraphState(state, 'decomposeNode', {}, {
      action: 'decomposeNode', graphId: 'g1', prototypeId: 'p1', nodeName: 'Thing',
      originalInstanceId: 'i1', definitionIndex: 0,
      definitionInstances: [{ prototypeId: 'p2', name: 'Part' }]
    });

    expect(groupsOf(state)).toHaveLength(1);
  });

  it('propagates decomposed members into an enclosing group so nesting derives', () => {
    const state = baseState(
      [{ id: 'outer', name: 'Outer', memberInstanceIds: ['i1', 'other'], linkedNodePrototypeId: 'p-outer', linkedDefinitionIndex: 0 }],
      [{ id: 'i1', prototypeId: 'p1', name: 'Thing' }, { id: 'other', prototypeId: 'p9', name: 'Other' }]
    );

    updateGraphState(state, 'decomposeNode', {}, {
      action: 'decomposeNode', graphId: 'g1', prototypeId: 'p1', nodeName: 'Thing',
      originalInstanceId: 'i1', definitionIndex: 0,
      definitionInstances: [{ prototypeId: 'p2', name: 'Part A' }, { prototypeId: 'p3', name: 'Part B' }]
    });

    const outer = groupsOf(state).find(g => g.id === 'outer');
    const inner = groupsOf(state).find(g => g.id !== 'outer');
    expect(inner.memberInstanceIds).toHaveLength(2);
    for (const id of inner.memberInstanceIds) {
      expect(outer.memberInstanceIds).toContain(id);
    }
  });
});

describe('predictive state — buildComposition mirror', () => {
  it('mirrors nested layers as real node-groups with derived subset membership', () => {
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

    const car = groupsOf(state).find(g => g.name === 'Car');
    const engine = groupsOf(state).find(g => g.name === 'Engine');
    expect(car?.linkedNodePrototypeId).toBeTruthy();
    expect(engine?.linkedNodePrototypeId).toBeTruthy();
    expect(car.anchorInstanceId).toBeTruthy();

    const outer = new Set(car.memberInstanceIds);
    expect(engine.memberInstanceIds.length).toBeGreaterThan(0);
    for (const id of engine.memberInstanceIds) expect(outer.has(id)).toBe(true);
  });

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
