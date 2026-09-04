import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';

/**
 * Store-level cover for mergeUniverseState. The field-merge rules themselves are
 * tested against the pure engine in test/formats/merge.test.js; what matters
 * here is the wiring the store adds on top — argument order for the survivor
 * choice, and the rule that session state never comes from the incoming side.
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
    isUniverseLoaded: true,
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true,
    _isLoadingUniverse: false,
    ...patch,
  }, false, 'test_reset');
};

const proto = (id, name, extras = {}) => [id, {
  id, name, description: '', color: '#800000',
  externalLinks: [], definitionGraphIds: [], ...extras,
}];

const graph = (id, name, extras = {}) => [id, {
  id, name, description: '', nodeIds: [], edgeIds: [], definingNodeIds: [],
  instances: new Map(), groups: new Map(), ...extras,
}];

const incoming = ({ protos = [], graphs = [], edges = [] } = {}) => ({
  nodePrototypes: new Map(protos),
  graphs: new Map(graphs),
  edges: new Map(edges),
  edgePrototypes: new Map(),
  openGraphIds: [],
  activeGraphId: null,
  expandedGraphIds: new Set(),
  savedNodeIds: new Set(),
  savedGraphIds: new Set(),
  rightPanelTabs: [],
  activeDefinitionNodeId: null,
});

describe('mergeUniverseState', () => {
  beforeEach(() => resetStore());

  it('adds the incoming universe without removing what is already there', () => {
    resetStore({ nodePrototypes: new Map([proto('a', 'Alpha')]) });

    const report = useGraphStore.getState().mergeUniverseState(
      incoming({ protos: [proto('b', 'Beta')] })
    );

    const { nodePrototypes } = useGraphStore.getState();
    expect(nodePrototypes.has('a')).toBe(true);
    expect(nodePrototypes.has('b')).toBe(true);
    expect(report.addedPrototypeIds).toContain('b');
  });

  it('the destination is the source of truth for an unavoidable ID collision', () => {
    // Two prototypes cannot share one Map key, so this conflict has to resolve.
    // The live store IS the destination, so it wins — and the loser is banked.
    resetStore({ nodePrototypes: new Map([proto('a', 'Mine')]) });

    useGraphStore.getState().mergeUniverseState(incoming({ protos: [proto('a', 'Theirs')] }));

    const p = useGraphStore.getState().nodePrototypes.get('a');
    expect(p.name).toBe('Mine');
    expect(p._preserved.merge.name).toBe('Theirs');
  });

  it('keeps the live session state rather than adopting the incoming one', () => {
    resetStore({
      graphs: new Map([graph('g-mine', 'Mine')]),
      nodePrototypes: new Map([proto('a', 'Alpha')]),
      openGraphIds: ['g-mine'],
      activeGraphId: 'g-mine',
    });

    const theirs = incoming({ graphs: [graph('g-theirs', 'Theirs')] });
    theirs.openGraphIds = ['g-theirs'];
    theirs.activeGraphId = 'g-theirs';

    useGraphStore.getState().mergeUniverseState(theirs);

    const state = useGraphStore.getState();
    expect(state.activeGraphId).toBe('g-mine');
    expect(state.openGraphIds).toEqual(['g-mine']);
    expect(state.graphs.has('g-theirs')).toBe(true); // still merged in, just not jumped to
  });

  const WIKI = 'https://www.wikidata.org/wiki/Q144';

  it('foldSameAs on: shared external link combines, leaving nothing dangling', () => {
    resetStore({ nodePrototypes: new Map([proto('mine-dog', 'Dog', { externalLinks: [WIKI] })]) });

    const report = useGraphStore.getState().mergeUniverseState(incoming({
      protos: [proto('their-dog', 'Doggo', { externalLinks: [WIKI] })],
      graphs: [graph('g1', 'Theirs', {
        instances: new Map([['i1', { id: 'i1', prototypeId: 'their-dog', x: 0, y: 0 }]]),
      })],
    }), { foldSameAs: true });

    const state = useGraphStore.getState();
    expect(state.nodePrototypes.has('their-dog')).toBe(false);
    expect(report.mergedIds).toHaveLength(1);
    for (const g of state.graphs.values()) {
      for (const inst of g.instances.values()) {
        expect(state.nodePrototypes.has(inst.prototypeId)).toBe(true);
      }
    }
  });

  it('foldSameAs off: both survive as duplicates and are reported for later', () => {
    resetStore({ nodePrototypes: new Map([proto('mine-dog', 'Dog', { externalLinks: [WIKI] })]) });

    const report = useGraphStore.getState().mergeUniverseState(incoming({
      protos: [proto('their-dog', 'Doggo', { externalLinks: [WIKI] })],
      graphs: [graph('g1', 'Theirs', {
        instances: new Map([['i1', { id: 'i1', prototypeId: 'their-dog', x: 0, y: 0 }]]),
      })],
    }), { foldSameAs: false });

    const state = useGraphStore.getState();
    expect(state.nodePrototypes.has('mine-dog')).toBe(true);
    expect(state.nodePrototypes.has('their-dog')).toBe(true);
    expect(report.mergedIds).toHaveLength(0);
    expect(report.sameAsCandidates).toHaveLength(1);
    // Duplicates are fine; broken references are not.
    for (const g of state.graphs.values()) {
      for (const inst of g.instances.values()) {
        expect(state.nodePrototypes.has(inst.prototypeId)).toBe(true);
      }
    }
  });

  it('refuses a state that was never deserialized rather than corrupting the store', () => {
    resetStore({ nodePrototypes: new Map([proto('a', 'Alpha')]) });

    const report = useGraphStore.getState().mergeUniverseState({ graphs: {} });

    expect(report).toBeNull();
    expect(useGraphStore.getState().nodePrototypes.has('a')).toBe(true);
  });
});
