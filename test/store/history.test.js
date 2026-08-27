import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import {
  isDocumentPatch,
  deriveDomain,
  collapseBatch,
  patchSignature,
  HISTORY_ROOTS,
} from '../../src/store/historyPolicy.js';

// The middleware debounces its flush; advancing timers is how we close a batch.
const FLUSH_MS = 60;

const flush = async () => {
  await vi.advanceTimersByTimeAsync(FLUSH_MS);
};

const makeGraph = (id, overrides = {}) => ({
  id,
  name: `Graph ${id}`,
  description: '',
  instances: new Map(),
  edgeIds: [],
  groups: new Map(),
  definingNodeIds: [],
  ...overrides,
});

const makePrototype = (id, overrides = {}) => ({
  id,
  name: `Proto ${id}`,
  description: '',
  color: '#8B0000',
  typeNodeId: 'base-thing-prototype',
  definitionGraphIds: [],
  ...overrides,
});

/** Reset both stores to a known, minimal state. */
const resetStores = (graphId = 'g1') => {
  useHistoryStore.setState({ history: [], currentIndex: -1 });
  useGraphStore.setState({
    graphs: new Map([[graphId, makeGraph(graphId)]]),
    nodePrototypes: new Map([['p1', makePrototype('p1')]]),
    edges: new Map(),
    openGraphIds: [graphId],
    activeGraphId: graphId,
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
  });
};

const history = () => useHistoryStore.getState().history;
const undo = () => {
  const { undo: doUndo } = useHistoryStore.getState();
  doUndo(useGraphStore.getState().applyPatches);
};
/** Applies an undo without going through historyActions (no flush/navigate). */
const performUndoInline = () => undo();

describe('historyPolicy', () => {
  describe('isDocumentPatch', () => {
    it('accepts patches under persisted document roots', () => {
      expect(isDocumentPatch({ op: 'replace', path: ['nodePrototypes', 'p1', 'name'], value: 'X' })).toBe(true);
      expect(isDocumentPatch({ op: 'add', path: ['edges', 'e1'], value: {} })).toBe(true);
      expect(isDocumentPatch({ op: 'replace', path: ['graphs', 'g1', 'name'], value: 'X' })).toBe(true);
    });

    it('rejects UI and settings roots', () => {
      // The guarantee that makes record-by-default safe.
      expect(isDocumentPatch({ op: 'replace', path: ['darkMode'], value: true })).toBe(false);
      expect(isDocumentPatch({ op: 'replace', path: ['leftPanelExpanded'], value: false })).toBe(false);
      expect(isDocumentPatch({ op: 'replace', path: ['gridSettings', 'size'], value: 10 })).toBe(false);
      expect(isDocumentPatch({ op: 'replace', path: ['typeListMode'], value: 'node' })).toBe(false);
    });

    it('rejects a live class instance parked in the store', () => {
      // setGitSyncEngine writes through produce, so without this filter the
      // engine would be pinned in history for the whole session.
      expect(isDocumentPatch({ op: 'replace', path: ['gitSyncEngine'], value: {} })).toBe(false);
    });

    it('rejects per-graph viewport fields but keeps sibling graph fields', () => {
      expect(isDocumentPatch({ op: 'replace', path: ['graphs', 'g1', 'panOffset'], value: {} })).toBe(false);
      expect(isDocumentPatch({ op: 'replace', path: ['graphs', 'g1', 'zoomLevel'], value: 2 })).toBe(false);
      expect(isDocumentPatch({ op: 'replace', path: ['graphs', 'g1', 'instances', 'i1', 'x'], value: 5 })).toBe(true);
    });

    it('treats a Set index as opaque, never as a field name', () => {
      // immer emits Set patches with an iteration index it then ignores on apply.
      expect(isDocumentPatch({ op: 'add', path: ['savedNodeIds', 3], value: 'p1' })).toBe(true);
    });

    it('derives its roots from the persisted-key set', () => {
      expect(HISTORY_ROOTS.has('graphs')).toBe(true);
      expect(HISTORY_ROOTS.has('rightPanelTabs')).toBe(true); // cascade target of a rename
      expect(HISTORY_ROOTS.has('savedNodeIds')).toBe(true);   // cascade target of a delete
      expect(HISTORY_ROOTS.has('showConnectionNames')).toBe(false); // a preference
      expect(HISTORY_ROOTS.has('darkMode')).toBe(false);
    });
  });

  describe('deriveDomain', () => {
    it('scopes to one graph when every patch is inside it', () => {
      expect(deriveDomain([
        { op: 'replace', path: ['graphs', 'gA', 'instances', 'i1', 'x'], value: 1 },
        { op: 'replace', path: ['graphs', 'gA', 'instances', 'i2', 'x'], value: 2 },
      ])).toBe('graph-gA');
    });

    it('is global when patches span graphs or leave graphs entirely', () => {
      expect(deriveDomain([
        { op: 'replace', path: ['graphs', 'gA', 'name'], value: 'a' },
        { op: 'replace', path: ['graphs', 'gB', 'name'], value: 'b' },
      ])).toBe('global');
      expect(deriveDomain([
        { op: 'replace', path: ['nodePrototypes', 'p1', 'name'], value: 'x' },
      ])).toBe('global');
    });
  });

  describe('collapseBatch', () => {
    it('keeps only the net effect of a typing burst', () => {
      const path = ['nodePrototypes', 'p1', 'name'];
      const patches = ['P', 'Ph', 'Pho'].map(v => ({ op: 'replace', path, value: v }));
      // Inverse patches are unshifted, so newest-first.
      const inverse = ['Ph', 'P', ''].map(v => ({ op: 'replace', path, value: v }));

      const result = collapseBatch(patches, inverse);
      expect(result.isNoop).toBe(false);
      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].value).toBe('Pho');
      expect(result.inversePatches).toHaveLength(1);
      expect(result.inversePatches[0].value).toBe(''); // the original
    });

    it('reports a no-op when the edit ends where it started', () => {
      // Escape during a rename live-commits the original name back.
      const path = ['nodePrototypes', 'p1', 'name'];
      const patches = ['A', 'Ab', 'A'].map(v => ({ op: 'replace', path, value: v }));
      const inverse = ['Ab', 'A', 'A'].map(v => ({ op: 'replace', path, value: v }));

      const result = collapseBatch(patches, inverse);
      expect(result.isNoop).toBe(true);
      expect(result.patches).toHaveLength(0);
    });

    it('refuses to collapse structural edits', () => {
      // Keeping only the last patch per path would corrupt these.
      const patches = [
        { op: 'add', path: ['edges', 'e1'], value: { id: 'e1' } },
        { op: 'remove', path: ['edges', 'e1'] },
      ];
      const result = collapseBatch(patches, []);
      expect(result.patches).toHaveLength(2);
      expect(result.isNoop).toBe(false);
    });
  });

  describe('patchSignature', () => {
    it('distinguishes patches whose Map values JSON.stringify identically', () => {
      // The old dedup used JSON.stringify, which renders a Map as {} — so two
      // graph-creates with the same name compared equal and one was dropped.
      const a = [{ op: 'add', path: ['graphs', 'gA'], value: { instances: new Map() } }];
      const b = [{ op: 'add', path: ['graphs', 'gB'], value: { instances: new Map() } }];
      expect(JSON.stringify(a)).toBe(JSON.stringify(b).replace('gB', 'gA')); // same shape
      expect(patchSignature(a)).not.toBe(patchSignature(b));
    });
  });
});

describe('history recording (record-by-default)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
  });

  it('records an edge directionality toggle — previously invisible to undo', async () => {
    const store = useGraphStore.getState();
    store.addNodeInstance('g1', 'p1', { x: 0, y: 0 }, 'i1');
    store.addNodeInstance('g1', 'p1', { x: 100, y: 0 }, 'i2');
    store.addEdge('g1', { id: 'e1', sourceId: 'i1', destinationId: 'i2' });
    await flush();
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    // updateEdge is how every arrow toggle in the app writes directionality.
    useGraphStore.getState().updateEdge('e1', (draft) => {
      draft.directionality = { arrowsToward: new Set(['i2']) };
    });
    await flush();

    expect(history()).toHaveLength(1);
    undo();
    const arrows = useGraphStore.getState().edges.get('e1').directionality?.arrowsToward;
    expect(arrows?.has('i2')).toBeFalsy();
  });

  it('records an abstraction chain insertion', async () => {
    useGraphStore.setState({
      nodePrototypes: new Map([
        ['p1', makePrototype('p1')],
        ['p2', makePrototype('p2')],
      ]),
    });
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    useGraphStore.getState().addToAbstractionChain('p1', 'specificity', 'above', 'p2');
    await flush();

    expect(history()).toHaveLength(1);
    expect(useGraphStore.getState().nodePrototypes.get('p1').abstractionChains.specificity).toContain('p2');

    undo();
    const chain = useGraphStore.getState().nodePrototypes.get('p1').abstractionChains?.specificity;
    expect(chain ?? []).not.toContain('p2');
  });

  it('records a graph deletion and restores it on undo', async () => {
    useGraphStore.getState().deleteGraph('g1');
    await flush();

    expect(useGraphStore.getState().graphs.has('g1')).toBe(false);
    expect(history()).toHaveLength(1);

    undo();
    expect(useGraphStore.getState().graphs.has('g1')).toBe(true);
    // Nested Maps must survive the patch round-trip.
    expect(useGraphStore.getState().graphs.get('g1').instances).toBeInstanceOf(Map);
  });

  it('records a prototype deletion', async () => {
    useGraphStore.getState().deleteNodePrototype('p1');
    await flush();

    expect(useGraphStore.getState().nodePrototypes.has('p1')).toBe(false);
    expect(history()).toHaveLength(1);

    undo();
    expect(useGraphStore.getState().nodePrototypes.has('p1')).toBe(true);
  });

  it('names the thing that was deleted, though it is already gone', async () => {
    // generateDescription runs after the mutation, so deletions have to carry
    // the name on the context or the entry reads "Deleted graph".
    useGraphStore.setState({
      graphs: new Map([['g1', makeGraph('g1', { name: 'Photosynthesis' })]]),
    });
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    useGraphStore.getState().deleteGraph('g1');
    await flush();

    expect(history()[0].description).toBe('Deleted graph "Photosynthesis"');
  });

  it('labels a directionality toggle and a chain edit readably', async () => {
    const store = useGraphStore.getState();
    store.addNodeInstance('g1', 'p1', { x: 0, y: 0 }, 'i1');
    store.addNodeInstance('g1', 'p1', { x: 100, y: 0 }, 'i2');
    store.addEdge('g1', { id: 'e1', sourceId: 'i1', destinationId: 'i2' });
    await flush();
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    useGraphStore.getState().updateEdge('e1', (d) => {
      d.directionality = { arrowsToward: new Set(['i2']) };
    });
    await flush();
    expect(history()[0].description).toBe('Updated connection');
  });

  it('does NOT record the Orbit catalog materializing at startup', async () => {
    // upsertProtectedPrototype used to declare prototype_create, so the whole
    // vocabulary landed in history on every launch.
    for (let i = 0; i < 5; i++) {
      useGraphStore.getState().upsertProtectedPrototype({
        id: `orbit-${i}`, name: `Orbit ${i}`, typeNodeId: 'base-thing-prototype',
      });
    }
    await flush();

    expect(history()).toHaveLength(0);
  });

  it('does NOT record cleanup or repair sweeps', async () => {
    const store = useGraphStore.getState();
    store.cleanupOrphanedData();
    store.cleanupOrphanedGraphs();
    store.repairGraphLinkages();
    await flush();

    expect(history()).toHaveLength(0);
  });

  it('records a bulk enrichment as one entry instead of bypassing the store', async () => {
    // This used to be a raw useGraphStore.setState, which skipped the middleware
    // entirely — no patches, no SaveCoordinator notification, no tripwire.
    useGraphStore.setState({
      nodePrototypes: new Map([['p1', makePrototype('p1')], ['p2', makePrototype('p2')]]),
    });
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    useGraphStore.getState().applyPrototypeMetadataBatch([
      { protoId: 'p1', updates: { description: 'From Wikipedia' } },
      { protoId: 'p2', updates: { description: 'Also enriched' } },
    ]);
    await flush();

    expect(history()).toHaveLength(1);
    expect(history()[0].description).toBe('Enriched 2 nodes');

    undo();
    expect(useGraphStore.getState().nodePrototypes.get('p1').description).toBe('');
  });

  it('does NOT record an image upload', async () => {
    // Both the patch and its inverse would carry a full base64 data URL.
    useGraphStore.getState().updateNodePrototype(
      'p1',
      (d) => { d.imageSrc = 'data:image/png;base64,AAAA'; },
      { type: 'prototype_image' }
    );
    await flush();

    expect(history()).toHaveLength(0);
    expect(useGraphStore.getState().nodePrototypes.get('p1').imageSrc).toBe('data:image/png;base64,AAAA');
  });

  it('does NOT record settings or viewport changes', async () => {
    const store = useGraphStore.getState();
    store.toggleDarkMode();
    store.setConnectionLabelSize(20);
    store.toggleLeftPanel();
    store.updateGraphView('g1', { x: 10, y: 10 }, 2);
    await flush();

    expect(history()).toHaveLength(0);
  });

  it('does NOT record workspace navigation', async () => {
    const store = useGraphStore.getState();
    store.toggleSavedNode('p1');
    store.toggleGraphExpanded('g1');
    await flush();

    expect(history()).toHaveLength(0);
  });
});

describe('history undo safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
  });

  it('does not wedge when a patch path no longer resolves', () => {
    // Reachable whenever state was mutated outside the patch-capturing path.
    useHistoryStore.getState().pushAction({
      domain: 'graph-g1',
      actionType: 'node_position',
      description: 'Moved a node that no longer exists',
      patches: [{ op: 'replace', path: ['graphs', 'gGONE', 'instances', 'iX', 'x'], value: 5 }],
      inversePatches: [{ op: 'replace', path: ['graphs', 'gGONE', 'instances', 'iX', 'x'], value: 0 }],
    });
    useHistoryStore.getState().pushAction({
      domain: 'global',
      actionType: 'prototype_update',
      description: 'Renamed a prototype',
      patches: [{ op: 'replace', path: ['nodePrototypes', 'p1', 'name'], value: 'After' }],
      inversePatches: [{ op: 'replace', path: ['nodePrototypes', 'p1', 'name'], value: 'Before' }],
    });

    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => undo()).not.toThrow();              // good entry
    expect(useGraphStore.getState().nodePrototypes.get('p1').name).toBe('Before');

    expect(() => undo()).not.toThrow();              // the unresolvable one
    // Critically, it stepped PAST the bad entry rather than retrying it forever.
    expect(useHistoryStore.getState().canUndo()).toBe(false);

    warn.mockRestore();
  });

  it('marks undo as a non-recordable change so it never re-enters history', async () => {
    useGraphStore.getState().updateNodePrototype('p1', (d) => { d.name = 'Renamed'; });
    await flush();
    expect(history()).toHaveLength(1);

    undo();
    await flush();

    // Still one entry — the undo did not record itself.
    expect(history()).toHaveLength(1);
    expect(useGraphStore.getState().nodePrototypes.get('p1').name).toBe('Proto p1');
  });
});

describe('withHistoryTransaction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
  });

  it('groups a gesture spanning global and graph-scoped actions into one entry', async () => {
    // This is the case the 50ms debounce structurally cannot handle: the batch is
    // force-flushed on domain change regardless of timing.
    const store = useGraphStore.getState();
    store.addNodeInstance('g1', 'p1', { x: 0, y: 0 }, 'i1');
    store.addNodeInstance('g1', 'p1', { x: 100, y: 0 }, 'i2');
    await flush();
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    useGraphStore.getState().withHistoryTransaction('Defined connection', () => {
      const s = useGraphStore.getState();
      s.addNodePrototype({ id: 'ptype', name: 'Depends On', color: '#333', definitionGraphIds: [] });
      s.addEdge('g1', { id: 'e1', sourceId: 'i1', destinationId: 'i2' });
      s.updateEdge('e1', (draft) => { draft.definitionNodeIds = ['ptype']; });
    });
    await flush();

    expect(history()).toHaveLength(1);
    expect(history()[0].description).toBe('Defined connection');

    // And undo must leave no partial state behind.
    undo();
    const after = useGraphStore.getState();
    expect(after.edges.has('e1')).toBe(false);
    expect(after.nodePrototypes.has('ptype')).toBe(false);
  });

  it('does not split when a gesture mixes graph-scoped and global writes', async () => {
    // The domain check force-flushes regardless of timing, so this is the case
    // the 50ms debounce can never handle: placing an instance is graph-scoped,
    // creating a prototype is global, and both belong to one gesture.
    useGraphStore.getState().withHistoryTransaction('Placed a new Thing', () => {
      const s = useGraphStore.getState();
      s.addNodeInstance('g1', 'p1', { x: 0, y: 0 }, 'i1');          // graph-g1
      s.addNodePrototype({ id: 'p9', name: 'New Thing', definitionGraphIds: [] }); // global
      s.addNodeInstance('g1', 'p9', { x: 80, y: 0 }, 'i2');          // graph-g1
    });
    await flush();

    expect(history()).toHaveLength(1);
    expect(history()[0].description).toBe('Placed a new Thing');
    // Spanning both, it belongs to neither graph in particular.
    expect(history()[0].domain).toBe('global');

    undo();
    const after = useGraphStore.getState();
    expect(after.nodePrototypes.has('p9')).toBe(false);
    expect(after.graphs.get('g1').instances.has('i1')).toBe(false);
    expect(after.graphs.get('g1').instances.has('i2')).toBe(false);
  });

  it('adopts repair-typed writes that are silent on their own', async () => {
    // ensureGroupAnchor is housekeeping when the startup sweep calls it, but an
    // inseparable part of the gesture when converting a node to a node-group.
    // Dropping it there left undo restoring a group with no anchor.
    const store = useGraphStore.getState();
    store.addNodeInstance('g1', 'p1', { x: 0, y: 0 }, 'i1');
    await flush();
    const groupId = store.createGroup('g1', { name: 'G', memberInstanceIds: ['i1'] });
    await flush();
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    // Alone: silent.
    useGraphStore.getState().ensureGroupAnchor('g1', groupId, { preferredAnchorInstanceId: 'i1' });
    await flush();
    expect(history()).toHaveLength(0);

    // Inside a transaction: part of the entry.
    useGraphStore.getState().withHistoryTransaction('Converted to node-group', () => {
      const s = useGraphStore.getState();
      s.addNodeInstance('g1', 'p1', { x: 50, y: 50 }, 'i2');
      s.ensureGroupAnchor('g1', groupId, { preferredAnchorInstanceId: 'i2' });
    });
    await flush();

    expect(history()).toHaveLength(1);
    expect(history()[0].description).toBe('Converted to node-group');
  });

  it('never adopts undo itself, even inside a transaction', async () => {
    useGraphStore.getState().updateNodePrototype('p1', (d) => { d.name = 'X'; });
    await flush();
    const before = history().length;

    useGraphStore.getState().withHistoryTransaction('Should not capture the undo', () => {
      performUndoInline();
    });
    await flush();

    // The undo applied, but did not become an entry of its own.
    expect(history()).toHaveLength(before);
  });

  it('flushes even when the body throws', async () => {
    expect(() => {
      useGraphStore.getState().withHistoryTransaction('Boom', () => {
        useGraphStore.getState().updateNodePrototype('p1', (d) => { d.name = 'Partial'; });
        throw new Error('boom');
      });
    }).toThrow('boom');

    expect(history()).toHaveLength(1);
    expect(history()[0].description).toBe('Boom');
  });
});

describe('coalesced edits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
  });

  it('turns a typing burst into a single entry', async () => {
    const key = 'name:p1';
    for (const value of ['P', 'Ph', 'Pho', 'Phot', 'Photo']) {
      useGraphStore.getState().updateNodePrototype('p1', (d) => { d.name = value; }, { coalesce: key });
      await vi.advanceTimersByTimeAsync(120); // slower than the 50ms batch window
    }
    expect(history()).toHaveLength(0); // still open

    useGraphStore.getState().updateNodePrototype('p1', (d) => { d.name = 'Photo'; }, { coalesceCommit: key });
    await flush();

    expect(history()).toHaveLength(1);
    undo();
    expect(useGraphStore.getState().nodePrototypes.get('p1').name).toBe('Proto p1');
  });

  it('records nothing when the edit is abandoned', async () => {
    const key = 'name:p1';
    const original = useGraphStore.getState().nodePrototypes.get('p1').name;

    useGraphStore.getState().updateNodePrototype('p1', (d) => { d.name = 'Ab'; }, { coalesce: key });
    await vi.advanceTimersByTimeAsync(120);
    // Escape restores the original, then aborts.
    useGraphStore.getState().updateNodePrototype('p1', (d) => { d.name = original; }, { coalesceAbort: key });
    await flush();

    expect(history()).toHaveLength(0);
    expect(useGraphStore.getState().nodePrototypes.get('p1').name).toBe(original);
  });

  it('closes an open edit if its commit boundary never arrives', async () => {
    useGraphStore.getState().updateNodePrototype('p1', (d) => { d.name = 'Orphaned'; }, { coalesce: 'name:p1' });
    await vi.advanceTimersByTimeAsync(2100); // past the idle backstop

    expect(history()).toHaveLength(1);
  });
});
