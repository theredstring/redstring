import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';

/**
 * P1.09 — setSelectedEdgeIds skips the write when the selection is unchanged.
 *
 * NodeCanvas subscribes to `selectedEdgeIds` and clears it with `new Set()` on
 * several paths where it is usually empty already. Each of those used to be a
 * fresh Set, so a full canvas render, for nothing.
 */
describe('setSelectedEdgeIds no-op guard (P1.09)', () => {
  const st = () => useGraphStore.getState();
  let notifications;
  let unsubscribe;

  beforeEach(() => {
    useGraphStore.setState({ selectedEdgeIds: new Set() });
    notifications = 0;
    unsubscribe = useGraphStore.subscribe(() => { notifications++; });
  });

  afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
  });

  it('does not write when clearing an already-empty selection', () => {
    const before = st();
    const beforeSet = before.selectedEdgeIds;

    st().setSelectedEdgeIds(new Set());
    st().setSelectedEdgeIds([]);
    st().setSelectedEdgeIds(undefined); // new Set(undefined) is empty, as before

    expect(st()).toBe(before);
    expect(st().selectedEdgeIds).toBe(beforeSet);
    expect(notifications).toBe(0);
  });

  it('does not write when the members are the same, whatever iterable carries them', () => {
    st().setSelectedEdgeIds(['a', 'b']);
    expect(notifications).toBe(1);
    const stored = st().selectedEdgeIds;

    st().setSelectedEdgeIds(new Set(['b', 'a']));       // order
    st().setSelectedEdgeIds(['a', 'b', 'a']);           // duplicates
    st().setSelectedEdgeIds(new Map([['a', 1], ['b', 2]]).keys()); // iterator

    expect(st().selectedEdgeIds).toBe(stored);
    expect(notifications).toBe(1);
  });

  it('writes when the size or the members differ', () => {
    st().setSelectedEdgeIds(['a', 'b']);
    st().setSelectedEdgeIds(['a']);          // smaller
    expect([...st().selectedEdgeIds]).toEqual(['a']);
    st().setSelectedEdgeIds(['a', 'c']);     // larger
    st().setSelectedEdgeIds(['a', 'd']);     // same size, different member
    expect([...st().selectedEdgeIds].sort()).toEqual(['a', 'd']);
    st().setSelectedEdgeIds([]);             // cleared
    expect(st().selectedEdgeIds.size).toBe(0);
    expect(notifications).toBe(5);
  });

  it('still stores its own copy, never the caller\'s Set', () => {
    const mine = new Set(['x']);
    st().setSelectedEdgeIds(mine);
    expect(st().selectedEdgeIds).not.toBe(mine);
    mine.add('y');
    expect([...st().selectedEdgeIds]).toEqual(['x']);
  });

  it('writes when the current value is not a Set', () => {
    useGraphStore.setState({ selectedEdgeIds: [] });
    notifications = 0;

    st().setSelectedEdgeIds([]);

    expect(st().selectedEdgeIds).toBeInstanceOf(Set);
    expect(notifications).toBe(1);
  });

  it('no longer logs', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    st().setSelectedEdgeIds(['a']);
    st().setSelectedEdgeIds(['a']);
    expect(log.mock.calls.filter(args => String(args[0]).includes('selectedEdgeIds'))).toEqual([]);
  });
});
