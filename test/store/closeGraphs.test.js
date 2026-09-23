import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';

// The Open Webs list and header strip context menus close webs through
// `closeGraphs`, which — unlike the X button's `closeGraph` — is undoable.
const st = () => useGraphStore.getState();

const resetStore = () => {
  useHistoryStore.setState({ history: [], currentIndex: -1 });
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
  }, false, 'test_reset');
};

const makeGraphs = (count) => {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(st().createNewGraph({ name: `G${i}`, typeNodeId: null, color: '#333333' }));
  }
  return ids;
};

const undo = () => useHistoryStore.getState().undo(st().applyPatches);
const redo = () => useHistoryStore.getState().redo(st().applyPatches);

describe('closeGraphs', () => {
  beforeEach(resetStore);

  it('closes all others and keeps the anchor active', () => {
    const [a, b, c] = makeGraphs(3);
    st().setActiveGraphTab(c);

    st().closeGraphs([a, c], { activateId: b });

    expect(st().openGraphIds).toEqual([b]);
    expect(st().activeGraphId).toBe(b);
  });

  it('falls back to the nearest surviving web above the closed active one', () => {
    const [a, b, c, d] = makeGraphs(4);
    st().setActiveGraphTab(c);

    st().closeGraphs([b, c]);

    expect(st().openGraphIds).toEqual([a, d]);
    expect(st().activeGraphId).toBe(a);
  });

  it('lands as one undo step and undo reopens every web in its slot', () => {
    const [a, b, c] = makeGraphs(3);
    st().setActiveGraphTab(a);
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    st().closeGraphs([b, c], { label: 'Close webs below "G0"', activateId: a });

    expect(useHistoryStore.getState().history).toHaveLength(1);
    expect(st().openGraphIds).toEqual([a]);

    undo();
    expect(st().openGraphIds).toEqual([a, b, c]);
    expect(st().activeGraphId).toBe(a);

    redo();
    expect(st().openGraphIds).toEqual([a]);
  });

  it('undo restores a web the orphan sweep deleted', () => {
    // A web whose Thing is referenced nowhere else is swept once it closes. The
    // sweep runs inside the transaction, so undo brings the graph back too —
    // otherwise it would reopen an id that no longer resolves.
    const [a, b] = makeGraphs(2);
    st().setActiveGraphTab(a);
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    st().closeGraphs([b]);
    expect(st().graphs.has(b)).toBe(false);

    undo();
    expect(st().graphs.has(b)).toBe(true);
    expect(st().openGraphIds).toEqual([a, b]);
  });

  it('is a no-op for webs that are not open', () => {
    const [a] = makeGraphs(1);
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    st().closeGraphs(['nope']);

    expect(st().openGraphIds).toEqual([a]);
    expect(useHistoryStore.getState().history).toHaveLength(0);
  });
});
