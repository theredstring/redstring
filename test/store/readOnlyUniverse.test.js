import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import useReadOnlyUniverse, { setReadOnlyUniverse } from '../../src/store/readOnlyUniverse.js';
import saveCoordinator from '../../src/services/SaveCoordinator.js';

const graph = (id) => ({ id, name: id, instances: new Map(), edgeIds: [], definingNodeIds: [] });

const seed = () => {
  useGraphStore.getState().loadUniverseFromFile({
    graphs: new Map([['g1', graph('g1')], ['g2', graph('g2')]]),
    nodePrototypes: new Map([['p1', { id: 'p1', name: 'One', color: '#800000', definitionGraphIds: [] }]]),
    edges: new Map(),
    edgePrototypes: new Map(),
    openGraphIds: ['g1', 'g2'],
    activeGraphId: 'g1',
    expandedGraphIds: new Set(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    _universeSlug: 'visit',
  });
};

beforeEach(() => {
  setReadOnlyUniverse(null);
  seed();
});
afterEach(() => setReadOnlyUniverse(null));

describe('a universe open read-only', () => {
  beforeEach(() => setReadOnlyUniverse({ slug: 'visit', name: 'Visit', sourceUrl: 'https://x/f.redstring' }));

  it('refuses edits', () => {
    const before = useGraphStore.getState();
    before.updateNodePrototype('p1', (draft) => { draft.name = 'Changed'; });
    const after = useGraphStore.getState();
    expect(after.nodePrototypes).toBe(before.nodePrototypes);
    expect(after.nodePrototypes.get('p1').name).toBe('One');
  });

  it('records nothing to undo', () => {
    useHistoryStore.getState().clearHistory();
    useGraphStore.getState().updateNodePrototype('p1', (draft) => { draft.name = 'Changed'; });
    useGraphStore.getState().flushHistoryBatch?.();
    expect(useHistoryStore.getState().history?.length ?? 0).toBe(0);
  });

  it('still lets you look around', () => {
    const before = useGraphStore.getState();
    before.setActiveGraph('g2');
    const after = useGraphStore.getState();
    expect(after.activeGraphId).toBe('g2');
    expect(after.graphs).toBe(before.graphs);
  });

  it('still takes a load', () => {
    expect(useGraphStore.getState().loadUniverseFromFile({
      graphs: new Map([['g9', graph('g9')]]),
      nodePrototypes: new Map(),
      edges: new Map(),
      edgePrototypes: new Map(),
      _universeSlug: 'other',
    })).toBe(true);
    expect(useGraphStore.getState().graphs.has('g9')).toBe(true);
  });

  it('writes nothing, however a save is asked for', async () => {
    const write = { saved: 0 };
    const wasEnabled = saveCoordinator.isEnabled;
    saveCoordinator.isEnabled = true;
    saveCoordinator.fileStorage = { saveUniverse: () => { write.saved += 1; } };
    try {
      saveCoordinator.hasLoadedFromFile = true;
      saveCoordinator.onStateChange(useGraphStore.getState(), { type: 'node_update' });
      expect(saveCoordinator.pendingHash).toBeFalsy();
      expect(saveCoordinator.saveTimer).toBeFalsy();
      saveCoordinator.executeSave();
      expect(await saveCoordinator.flush('test')).toBe(false);
      await expect(saveCoordinator.forceSave(useGraphStore.getState())).rejects.toThrow(/read only/);
      expect(write.saved).toBe(0);
    } finally {
      saveCoordinator.isEnabled = wasEnabled;
      saveCoordinator.fileStorage = null;
    }
  });
});

describe('with nothing open read-only', () => {
  it('edits as usual', () => {
    useGraphStore.getState().updateNodePrototype('p1', (draft) => { draft.name = 'Changed'; });
    expect(useGraphStore.getState().nodePrototypes.get('p1').name).toBe('Changed');
  });
});

describe('answering a refused edit', () => {
  const edit = () => useGraphStore.getState().updateNodePrototype('p1', (draft) => { draft.name = 'Changed'; });

  beforeEach(() => setReadOnlyUniverse({ slug: 'visit', name: 'Visit', sourceUrl: 'https://x/f.redstring' }));
  afterEach(() => vi.unstubAllGlobals());

  it('stays quiet for a write nobody just asked for', () => {
    vi.stubGlobal('navigator', { userActivation: { isActive: false } });
    const nudges = useReadOnlyUniverse.getState().nudge;
    edit();
    expect(useReadOnlyUniverse.getState().nudge).toBe(nudges);
    expect(useGraphStore.getState().nodePrototypes.get('p1').name).toBe('One');
  });

  it('speaks up right after the person did something', () => {
    vi.stubGlobal('navigator', { userActivation: { isActive: true } });
    const nudges = useReadOnlyUniverse.getState().nudge;
    edit();
    expect(useReadOnlyUniverse.getState().nudge).toBe(nudges + 1);
  });
});
