import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { create } from 'zustand';
import { useStableSelector, shallowArrayEqual, arrayOfRecordsEqual } from '../../src/hooks/useStableSelector.js';

// P2.10: a derived list keeps its identity, and its component doesn't
// re-render, while an unrelated write replaces the Map it comes from.

const makeStore = () => create(() => ({
  items: new Map([['a', { id: 'a', name: 'A', x: 0 }], ['b', { id: 'b', name: 'B', x: 0 }]]),
}));
const selectNames = (state) => [...state.items.values()].map((item) => ({ id: item.id, name: item.name }));
const sameNames = arrayOfRecordsEqual(['id', 'name']);

describe('useStableSelector', () => {
  it('keeps the previous result, and skips the render, while the derived value is equal', () => {
    const useStore = makeStore();
    let renders = 0;
    const { result } = renderHook(() => { renders += 1; return useStableSelector(useStore, selectNames, sameNames); });
    const first = result.current;
    const rendersBefore = renders;

    act(() => useStore.setState((s) => ({
      items: new Map([...s.items].map(([k, v]) => [k, { ...v, x: v.x + 10 }])),
    })));
    expect(result.current).toBe(first);
    expect(renders).toBe(rendersBefore);

    act(() => useStore.setState((s) => {
      const items = new Map(s.items);
      items.set('a', { ...items.get('a'), name: 'A2' });
      return { items };
    }));
    expect(result.current).not.toBe(first);
    expect(result.current[0].name).toBe('A2');
  });

  it('shallowArrayEqual compares elements by identity', () => {
    const x = {};
    expect(shallowArrayEqual([x], [x])).toBe(true);
    expect(shallowArrayEqual([x], [{}])).toBe(false);
    expect(shallowArrayEqual([x], [x, x])).toBe(false);
  });
});
