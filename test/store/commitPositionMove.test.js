/**
 * commitPositionMove: an animated many-node move is ONE undoable step.
 *
 * Auto-layout, snap to grid and the force simulation all tween by writing
 * unfinalized frames to the store, landing on the final positions before they
 * commit. Committing with a plain finalized write then records nothing (the
 * write changes nothing), so auto-layout could not be undone. These pin the
 * fix: the move is recorded once, labelled, and undo/redo walk it exactly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';

const FROM = [{ instanceId: 'a', x: 0, y: 0 }, { instanceId: 'b', x: 10, y: 10 }];
const TO = [{ instanceId: 'a', x: 500, y: 500 }, { instanceId: 'b', x: 900, y: 100 }];

const positions = () => [...useGraphStore.getState().graphs.get('g1').instances.values()].map(i => [i.id, i.x, i.y]);
const history = () => useHistoryStore.getState().history;
const store = () => useGraphStore.getState();

/** What useGraphLayout's tween does before it commits. */
const tween = () => {
  for (const k of [0.25, 0.5, 1]) {
    store().updateMultipleNodeInstancePositions('g1', FROM.map((p, i) => ({
      instanceId: p.instanceId, x: p.x + (TO[i].x - p.x) * k, y: p.y + (TO[i].y - p.y) * k
    })), { skipSave: true });
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  useHistoryStore.setState({ history: [], currentIndex: -1 });
  const inst = ({ instanceId, x, y }) => [instanceId, { id: instanceId, prototypeId: 'p1', x, y, scale: 1 }];
  useGraphStore.setState({
    graphs: new Map([['g1', { id: 'g1', name: 'G', description: '', instances: new Map(FROM.map(inst)), edgeIds: [], groups: new Map(), definingNodeIds: [] }]]),
    nodePrototypes: new Map([['p1', { id: 'p1', name: 'P', description: '', color: '#8B0000', typeNodeId: 'base-thing-prototype', definitionGraphIds: [] }]]),
    edges: new Map(), openGraphIds: ['g1'], activeGraphId: 'g1'
  });
});
afterEach(() => vi.useRealTimers());

describe('commitPositionMove', () => {
  it('shows why it exists: a tween then a finalized write records nothing', async () => {
    tween();
    store().updateMultipleNodeInstancePositions('g1', TO, { finalize: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(history()).toHaveLength(0);
  });

  it('records a tweened move as one labelled entry', async () => {
    tween();
    store().commitPositionMove('g1', FROM, TO, { label: 'Auto layout' });
    await vi.advanceTimersByTimeAsync(100);
    expect(history()).toHaveLength(1);
    expect(history()[0].description).toBe('Auto layout');
  });

  it('undoes to where the move started and redoes to where it ended', async () => {
    tween();
    store().commitPositionMove('g1', FROM, TO, { label: 'Auto layout' });
    await vi.advanceTimersByTimeAsync(100);
    useHistoryStore.getState().undo(store().applyPatches);
    expect(positions()).toEqual([['a', 0, 0], ['b', 10, 10]]);
    useHistoryStore.getState().redo(store().applyPatches);
    expect(positions()).toEqual([['a', 500, 500], ['b', 900, 100]]);
  });
});
