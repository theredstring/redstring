import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useTrackedState } from '../../src/hooks/useTrackedState.js';

// Render sweep: a same-value set must not re-run the component.
describe('useTrackedState', () => {
  const counted = (useHook) => {
    let runs = 0;
    const hook = renderHook(() => { runs += 1; return useHook(false); });
    return { hook, runs: () => runs };
  };

  it('skips a set to the value it already has, where useState re-runs the component', () => {
    for (const [useHook, extraRun] of [[useState, 1], [useTrackedState, 0]]) {
      const { hook, runs } = counted(useHook);
      act(() => hook.result.current[1](true));
      const before = runs();
      act(() => hook.result.current[1](true));
      expect(runs() - before).toBe(extraRun);
      expect(hook.result.current[0]).toBe(true);
    }
  });

  it('applies updaters to the last value set, pending ones included', () => {
    const { result } = renderHook(() => useTrackedState(0));
    act(() => {
      result.current[1](1);
      result.current[1]((n) => n + 1);
      result.current[1](2); // same as the pending value: skipped, nothing lost
    });
    expect(result.current[0]).toBe(2);
  });

  it('keeps one setter for the life of the component', () => {
    const { result, rerender } = renderHook(() => useTrackedState(() => 'lazy'));
    const set = result.current[1];
    expect(result.current[0]).toBe('lazy');
    rerender();
    expect(result.current[1]).toBe(set);
  });
});
