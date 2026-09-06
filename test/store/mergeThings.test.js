import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';

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

describe('mergeNodePrototypes — description is gap-fill, not longest-wins', () => {
  beforeEach(() => resetStore());

  it('fills a description the survivor does not have', () => {
    resetStore({ nodePrototypes: new Map([proto('a', 'A'), proto('b', 'B', { description: 'theirs' })]) });
    useGraphStore.getState().mergeNodePrototypes('a', 'b');
    expect(useGraphStore.getState().nodePrototypes.get('a').description).toBe('theirs');
  });

  it('keeps a terse description rather than taking a longer one', () => {
    // The old rule kept whichever was longer, silently discarding a deliberate edit.
    resetStore({
      nodePrototypes: new Map([
        proto('a', 'A', { description: 'A dog.' }),
        proto('b', 'B', { description: 'A domesticated descendant of the wolf, kept as a pet.' }),
      ])
    });
    useGraphStore.getState().mergeNodePrototypes('a', 'b');
    expect(useGraphStore.getState().nodePrototypes.get('a').description).toBe('A dog.');
  });
});

describe('mergeNodePrototypes — things used as connection types', () => {
  beforeEach(() => resetStore());

  // A thing can be a connection's type as well as a node on a canvas. Only the
  // endpoints used to be re-pointed, so merging one left every connection it
  // typed naming a prototype that no longer existed.
  it('re-points connections typed by the thing being merged away', () => {
    resetStore({
      nodePrototypes: new Map([proto('keep', 'Eats'), proto('lose', 'Eats')]),
      edges: new Map([
        ['e1', { id: 'e1', sourceId: 'i1', destinationId: 'i2', typeNodeId: 'lose' }],
        ['e2', { id: 'e2', sourceId: 'i2', destinationId: 'i3', typeNodeId: 'keep' }],
      ]),
    });

    useGraphStore.getState().mergeNodePrototypes('keep', 'lose');

    const s = useGraphStore.getState();
    expect(s.edges.get('e1').typeNodeId).toBe('keep');
    expect(s.edges.get('e2').typeNodeId).toBe('keep');
    // The real invariant: no connection names a type that is gone.
    for (const edge of s.edges.values()) {
      if (edge.typeNodeId) expect(s.nodePrototypes.has(edge.typeNodeId)).toBe(true);
    }
  });

  it('re-points a connection’s definitionNodeIds and does not duplicate', () => {
    resetStore({
      nodePrototypes: new Map([proto('keep', 'A'), proto('lose', 'B')]),
      edges: new Map([
        ['e1', { id: 'e1', sourceId: 'i1', destinationId: 'i2', definitionNodeIds: ['lose', 'keep'] }],
      ]),
    });

    useGraphStore.getState().mergeNodePrototypes('keep', 'lose');
    expect(useGraphStore.getState().edges.get('e1').definitionNodeIds).toEqual(['keep']);
  });
});

describe('mergeThings', () => {
  beforeEach(() => resetStore());

  const twoThings = (extras = {}) => new Map([
    proto('keep', 'Keep'),
    proto('lose', 'Lose', extras),
  ]);

  it('removes the loser and keeps the survivor', () => {
    resetStore({ nodePrototypes: twoThings() });
    expect(useGraphStore.getState().mergeThings('keep', 'lose')).toBe(true);

    const s = useGraphStore.getState();
    expect(s.nodePrototypes.has('keep')).toBe(true);
    expect(s.nodePrototypes.has('lose')).toBe(false);
  });

  it('applies gap-fill carry-over to the survivor', () => {
    resetStore({ nodePrototypes: twoThings() });
    useGraphStore.getState().mergeThings('keep', 'lose', {
      carryOver: [
        { field: 'description', value: 'carried' },
        { field: 'typeNodeId', value: 'some-type' },
      ]
    });

    const p = useGraphStore.getState().nodePrototypes.get('keep');
    expect(p.description).toBe('carried');
    expect(p.typeNodeId).toBe('some-type');
  });

  it('carries the image fields as one unit', () => {
    resetStore({ nodePrototypes: twoThings() });
    useGraphStore.getState().mergeThings('keep', 'lose', {
      carryOver: [{ field: 'image', value: { imageSrc: 'x.png', thumbnailSrc: 't.png', imageAspectRatio: 1.5 } }]
    });

    const p = useGraphStore.getState().nodePrototypes.get('keep');
    expect(p.imageSrc).toBe('x.png');
    expect(p.thumbnailSrc).toBe('t.png');
    expect(p.imageAspectRatio).toBe(1.5);
  });

  it('merges abstraction chains rather than replacing them', () => {
    resetStore({
      nodePrototypes: new Map([
        proto('keep', 'Keep', { abstractionChains: { generalization: ['a'] } }),
        proto('lose', 'Lose'),
      ])
    });
    useGraphStore.getState().mergeThings('keep', 'lose', {
      carryOver: [{ field: 'abstractionChains', value: { composition: ['c'] } }]
    });

    expect(useGraphStore.getState().nodePrototypes.get('keep').abstractionChains)
      .toEqual({ generalization: ['a'], composition: ['c'] });
  });

  it('combines definition webs by default', () => {
    resetStore({
      nodePrototypes: new Map([
        proto('keep', 'Keep', { definitionGraphIds: ['g1'] }),
        proto('lose', 'Lose', { definitionGraphIds: ['g2'] }),
      ])
    });
    useGraphStore.getState().mergeThings('keep', 'lose');
    // Copy before sorting: immer freezes the stored array.
    expect([...useGraphStore.getState().nodePrototypes.get('keep').definitionGraphIds].sort())
      .toEqual(['g1', 'g2']);
  });

  it('can keep only the survivor’s definition webs', () => {
    resetStore({
      nodePrototypes: new Map([
        proto('keep', 'Keep', { definitionGraphIds: ['g1'] }),
        proto('lose', 'Lose', { definitionGraphIds: ['g2'] }),
      ])
    });
    useGraphStore.getState().mergeThings('keep', 'lose', {
      definitionStrategy: 'overwrite_with_primary'
    });
    expect(useGraphStore.getState().nodePrototypes.get('keep').definitionGraphIds).toEqual(['g1']);
  });

  it('can keep only the other one’s definition webs', () => {
    resetStore({
      nodePrototypes: new Map([
        proto('keep', 'Keep', { definitionGraphIds: ['g1'] }),
        proto('lose', 'Lose', { definitionGraphIds: ['g2'] }),
      ])
    });
    useGraphStore.getState().mergeThings('keep', 'lose', {
      definitionStrategy: 'overwrite_with_secondary'
    });
    expect(useGraphStore.getState().nodePrototypes.get('keep').definitionGraphIds).toEqual(['g2']);
  });

  it('lands as a single undo step, not one per primitive it calls', () => {
    // It calls mergeDefinitionGraphs and mergeNodePrototypes, each of which is
    // its own ctxSet. Without an explicit transaction that is three history
    // entries, and Cmd+Z walks through states the user never asked for —
    // carry-over applied but the merge not done.
    resetStore({
      nodePrototypes: new Map([
        proto('keep', 'Keep', { definitionGraphIds: ['g1'] }),
        proto('lose', 'Lose', { definitionGraphIds: ['g2'] }),
      ])
    });
    useHistoryStore.getState().clearHistory();

    useGraphStore.getState().mergeThings('keep', 'lose', {
      carryOver: [{ field: 'description', value: 'carried' }]
    });

    expect(useHistoryStore.getState().history).toHaveLength(1);
  });

  it('refuses to merge a thing into itself', () => {
    resetStore({ nodePrototypes: twoThings() });
    expect(useGraphStore.getState().mergeThings('keep', 'keep')).toBe(false);
    expect(useGraphStore.getState().nodePrototypes.has('keep')).toBe(true);
  });

  it('refuses when a thing has already gone (a stale pair in the review list)', () => {
    resetStore({ nodePrototypes: new Map([proto('keep', 'Keep')]) });
    expect(useGraphStore.getState().mergeThings('keep', 'gone')).toBe(false);
    expect(useGraphStore.getState().nodePrototypes.has('keep')).toBe(true);
  });
});
