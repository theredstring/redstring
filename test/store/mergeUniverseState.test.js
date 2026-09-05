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

  it('unions open webs but never moves you off the one you are on', () => {
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
    // Yours first, theirs appended.
    expect(state.openGraphIds).toEqual(['g-mine', 'g-theirs']);
    // But the active web is still yours — a merge adds tabs, it doesn't relocate you.
    expect(state.activeGraphId).toBe('g-mine');
  });

  it('does not mutate the live store arrays while unioning them', () => {
    // The base handed to the engine IS the live state; pushing onto its own
    // openGraphIds would corrupt it in place.
    resetStore({
      graphs: new Map([graph('g-mine', 'Mine')]),
      openGraphIds: ['g-mine'],
      activeGraphId: 'g-mine',
    });
    const before = useGraphStore.getState().openGraphIds;

    const theirs = incoming({ graphs: [graph('g-theirs', 'Theirs')] });
    theirs.openGraphIds = ['g-theirs'];
    useGraphStore.getState().mergeUniverseState(theirs);

    expect(before).toEqual(['g-mine']);
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

  // The worry this guards: "open" state is deliberately NOT adopted from the
  // incoming universe, and it would be easy for that to quietly take the
  // CONTENT of those open webs with it. It must not. Open-ness is discarded;
  // every web, instance, connection and thing inside them comes through.
  describe('nothing inside the incoming universe is lost', () => {
    const build = () => {
      const inc = incoming({
        protos: [
          proto('p1', 'One'),
          proto('p2', 'Two'),
          proto('p3', 'Three'),
          proto('p-def', 'Has Definition', { definitionGraphIds: ['g-def'] }),
        ],
        graphs: [
          graph('g-open1', 'Open One', {
            instances: new Map([
              ['i1', { id: 'i1', prototypeId: 'p1', x: 0, y: 0 }],
              ['i2', { id: 'i2', prototypeId: 'p2', x: 10, y: 10 }],
            ]),
            edgeIds: ['e1'],
          }),
          graph('g-open2', 'Open Two', {
            instances: new Map([['i3', { id: 'i3', prototypeId: 'p3', x: 0, y: 0 }]]),
          }),
          graph('g-closed', 'Never Opened', {
            instances: new Map([['i4', { id: 'i4', prototypeId: 'p1', x: 0, y: 0 }]]),
          }),
          // A web *inside* a thing.
          graph('g-def', 'Definition Web', {
            instances: new Map([['i5', { id: 'i5', prototypeId: 'p2', x: 0, y: 0 }]]),
          }),
        ],
        edges: [['e1', { id: 'e1', sourceId: 'i1', destinationId: 'i2', typeNodeId: 'custom-rel' }]],
      });
      inc.openGraphIds = ['g-open1', 'g-open2'];
      inc.activeGraphId = 'g-open1';
      inc.expandedGraphIds = new Set(['g-open1']);
      inc.savedNodeIds = new Set(['p1', 'p-def']);
      inc.edgePrototypes = new Map([['custom-rel', { id: 'custom-rel', name: 'Eats' }]]);
      return inc;
    };

    const merge = (opts) => {
      resetStore({
        graphs: new Map([graph('g-mine', 'Mine')]),
        nodePrototypes: new Map([proto('mine', 'Mine Thing')]),
        openGraphIds: ['g-mine'],
        activeGraphId: 'g-mine',
      });
      useGraphStore.getState().mergeUniverseState(build(), opts);
      return useGraphStore.getState();
    };

    it('every web transfers, opened or not, including a web inside a thing', () => {
      const s = merge();
      for (const gid of ['g-open1', 'g-open2', 'g-closed', 'g-def', 'g-mine']) {
        expect(s.graphs.has(gid), `missing web ${gid}`).toBe(true);
      }
    });

    it('every instance inside those webs transfers', () => {
      const s = merge();
      expect([...s.graphs.get('g-open1').instances.keys()].sort()).toEqual(['i1', 'i2']);
      expect([...s.graphs.get('g-open2').instances.keys()]).toEqual(['i3']);
      expect([...s.graphs.get('g-closed').instances.keys()]).toEqual(['i4']);
      expect([...s.graphs.get('g-def').instances.keys()]).toEqual(['i5']);
    });

    it('every thing, connection and connection type transfers', () => {
      const s = merge();
      for (const pid of ['p1', 'p2', 'p3', 'p-def', 'mine']) {
        expect(s.nodePrototypes.has(pid), `missing thing ${pid}`).toBe(true);
      }
      expect(s.edges.has('e1')).toBe(true);
      expect(s.graphs.get('g-open1').edgeIds).toContain('e1');
      expect(s.edgePrototypes.has('custom-rel')).toBe(true);
    });

    it('a thing keeps its definition webs, and they resolve', () => {
      const s = merge();
      const p = s.nodePrototypes.get('p-def');
      expect(p.definitionGraphIds).toContain('g-def');
      for (const gid of p.definitionGraphIds) {
        expect(s.graphs.has(gid), `definition web ${gid} does not exist`).toBe(true);
      }
    });

    it('saved things transfer and survive the post-merge pruning', () => {
      const s = merge();
      expect(s.savedNodeIds.has('p1')).toBe(true);
      expect(s.savedNodeIds.has('p-def')).toBe(true);
    });

    it('open-ness transfers: their open webs arrive open, after yours', () => {
      const s = merge();
      expect(s.openGraphIds).toEqual(['g-mine', 'g-open1', 'g-open2']);
      // The web that was never opened over there stays closed over here.
      expect(s.openGraphIds).not.toContain('g-closed');
      expect(s.openGraphIds).not.toContain('g-def');
      // Expanded-ness comes along too.
      expect(s.expandedGraphIds.has('g-open1')).toBe(true);
      // But you are still where you were.
      expect(s.activeGraphId).toBe('g-mine');
    });

    it('holds with foldSameAs off too, and leaves no broken references', () => {
      const s = merge({ foldSameAs: false });
      for (const gid of ['g-open1', 'g-open2', 'g-closed', 'g-def']) {
        expect(s.graphs.has(gid)).toBe(true);
      }
      for (const g of s.graphs.values()) {
        for (const inst of g.instances.values()) {
          expect(s.nodePrototypes.has(inst.prototypeId), `instance ${inst.id} dangles`).toBe(true);
        }
      }
    });
  });

  it('refuses a state that was never deserialized rather than corrupting the store', () => {
    resetStore({ nodePrototypes: new Map([proto('a', 'Alpha')]) });

    const report = useGraphStore.getState().mergeUniverseState({ graphs: {} });

    expect(report).toBeNull();
    expect(useGraphStore.getState().nodePrototypes.has('a')).toBe(true);
  });
});
