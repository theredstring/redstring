import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLatestRef } from '../../src/hooks/useLatestRef.js';

// P3.02 / B-05: a closure made on the first render reads the latest value.
describe('useLatestRef', () => {
  it('keeps one ref whose current is the latest committed value', () => {
    const { result, rerender } = renderHook(({ v }) => useLatestRef(v), { initialProps: { v: 1 } });
    const ref = result.current;
    const firstRenderClosure = () => ref.current;
    rerender({ v: 2 });
    expect(result.current).toBe(ref);
    expect(firstRenderClosure()).toBe(2);
  });
});
