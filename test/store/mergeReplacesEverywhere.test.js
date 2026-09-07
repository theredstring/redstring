import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';

/**
 * A merge has to REPLACE the thing it folds in, everywhere.
 *
 * Per-field assertions only cover the fields someone remembered to think of,
 * and a prototype id is referenced from a dozen places across graphs, edges,
 * groups, chains and UI state. So the load-bearing check here is a whole-file
 * one: serialize the universe and assert the merged-away id does not appear in
 * the JSON at all. Anything still pointing at it is a dangling reference that
 * survives a save and comes back on the next load.
 */

const resetStore = (patch = {}) => {
  useGraphStore.setState({
    graphs: new Map(),
    nodePrototypes: new Map(),
    edges: new Map(),
    edgePrototypes: new Map(),
    openGraphIds: [],
    activeGraphId: null,
    activeDefinitionNodeId: null,
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    mergeDismissals: {},
    isUniverseLoaded: true,
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true,
    _isLoadingUniverse: false,
    ...patch,
  }, false, 'test_reset');
};

const KEEP = 'proto-keep';
const LOSE = 'proto-lose';

const proto = (id, name, extras = {}) => [id, {
  id, name, description: '', color: '#800000',
  externalLinks: [], definitionGraphIds: [], abstractionChains: {}, ...extras,
}];

/** A universe where the loser is referenced from every shape that can hold it. */
const universeReferencingLoser = () => ({
  nodePrototypes: new Map([
    proto(KEEP, 'Dog'),
    proto(LOSE, 'Dog'),
    // Another thing typed by the loser.
    proto('proto-typed', 'Rex', { typeNodeId: LOSE }),
    // Another thing whose abstraction chain names the loser.
    proto('proto-chained', 'Animal', { abstractionChains: { generalization: ['proto-chained', LOSE] } }),
  ]),
  graphs: new Map([
    ['g1', {
      id: 'g1',
      name: 'Web',
      definingNodeIds: [LOSE],
      instances: new Map([
        ['i-keep', { id: 'i-keep', prototypeId: KEEP, x: 0, y: 0, scale: 1 }],
        ['i-lose', { id: 'i-lose', prototypeId: LOSE, x: 100, y: 0, scale: 1 }],
        ['i-other', { id: 'i-other', prototypeId: 'proto-typed', x: 200, y: 0, scale: 1 }],
      ]),
      edgeIds: ['e-typed'],
      // A node-group anchored to the loser.
      groups: new Map([
        ['grp1', {
          id: 'grp1',
          name: 'Group',
          memberInstanceIds: ['i-other'],
          linkedNodePrototypeId: LOSE,
          linkedDefinitionIndex: 0,
        }],
      ]),
      panOffset: { x: 0, y: 0 },
      zoomLevel: 1,
    }],
  ]),
  edges: new Map([
    // A connection TYPED by the loser, and defined by it.
    ['e-typed', {
      id: 'e-typed',
      sourceId: 'i-other',
      destinationId: 'i-keep',
      typeNodeId: LOSE,
      definitionNodeIds: [LOSE],
      directionality: { arrowsToward: new Set() },
    }],
  ]),
  savedNodeIds: new Set([LOSE]),
  rightPanelTabs: [
    { type: 'home', isActive: false },
    { type: 'node', nodeId: LOSE, title: 'Dog', isActive: true },
  ],
  activeGraphId: 'g1',
  openGraphIds: ['g1'],
  activeDefinitionNodeId: LOSE,
});

describe('a merged-away thing is replaced everywhere', () => {
  beforeEach(() => resetStore());

  it('leaves no reference to it anywhere in the saved file', () => {
    resetStore(universeReferencingLoser());

    expect(useGraphStore.getState().mergeThings(KEEP, LOSE)).toBe(true);

    const file = exportToRedstring(useGraphStore.getState());
    const json = JSON.stringify(file);

    // Report WHERE it survived, not just that it did.
    const survivors = [];
    const walk = (value, path) => {
      if (typeof value === 'string') {
        if (value.includes(LOSE)) survivors.push(`${path} = ${value}`);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (k.includes(LOSE)) survivors.push(`${path}.<key ${k}>`);
          walk(v, `${path}.${k}`);
        }
      }
    };
    walk(file, '$');

    expect(survivors).toEqual([]);
    expect(json).not.toContain(LOSE);
  });

  it('re-points each reference to the survivor rather than dropping it', () => {
    // Not losing the reference is only half of it — the connection, the group
    // and the chain all have to mean the same thing afterwards, now said of
    // the survivor.
    resetStore(universeReferencingLoser());
    useGraphStore.getState().mergeThings(KEEP, LOSE);

    const s = useGraphStore.getState();
    expect(s.edges.get('e-typed').typeNodeId).toBe(KEEP);
    expect(s.edges.get('e-typed').definitionNodeIds).toEqual([KEEP]);
    expect(s.nodePrototypes.get('proto-typed').typeNodeId).toBe(KEEP);
    expect(s.graphs.get('g1').definingNodeIds).toEqual([KEEP]);
    expect(s.graphs.get('g1').groups.get('grp1').linkedNodePrototypeId).toBe(KEEP);
    expect(s.nodePrototypes.get('proto-chained').abstractionChains.generalization)
      .toEqual(['proto-chained', KEEP]);
    expect(s.savedNodeIds.has(KEEP)).toBe(true);
    expect(s.activeDefinitionNodeId).toBe(KEEP);
    expect(s.rightPanelTabs.find((t) => t.type === 'node').nodeId).toBe(KEEP);
  });

  it('does not leave the survivor listed twice in a chain that named both', () => {
    resetStore({
      nodePrototypes: new Map([
        proto(KEEP, 'Dog'),
        proto(LOSE, 'Dog'),
        proto('proto-chained', 'Animal', { abstractionChains: { generalization: [KEEP, LOSE] } }),
      ]),
    });

    useGraphStore.getState().mergeThings(KEEP, LOSE);

    expect(useGraphStore.getState().nodePrototypes.get('proto-chained').abstractionChains.generalization)
      .toEqual([KEEP]);
  });
});
